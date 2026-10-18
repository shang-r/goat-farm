#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""端到端冒烟测试：建库 -> 登录 -> 全模块读写 -> 报表 -> 导出。"""
from __future__ import annotations

import io
import os
import shutil
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

import logging  # noqa: E402

logging.getLogger("goat").setLevel(logging.CRITICAL)

TMP = Path(tempfile.mkdtemp(prefix="goatsmoke_"))
os.environ["GOAT_DB_PATH"] = str(TMP / "t.db")
os.environ["GOAT_ADMIN_PASSWORD"] = "test1234"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

PASS, FAIL = 0, 0
def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {extra}")

def section(t):
    print(f"\n── {t} " + "─" * (56 - len(t)))


c = TestClient(app)
with c:
    section("健康检查 / 初始化")
    r = c.get("/api/health"); check("health 200", r.status_code == 200, r.text)
    r = c.get("/")
    check("静态页可访问", r.status_code == 200)
    # 回归：/ 必须返回 HTML。若直接 return str，FastAPI 会当成 JSON 序列化，
    # 浏览器收到 application/json 的转义字符串，页面就是坏的（表现为"乱码"）。
    check("首页 Content-Type 是 text/html", r.headers.get("content-type", "").startswith("text/html"),
          r.headers.get("content-type", ""))
    check("首页带 charset=utf-8", "charset=utf-8" in r.headers.get("content-type", ""),
          r.headers.get("content-type", ""))
    check("首页是 HTML 而非 JSON 转义串", r.text.lstrip().startswith("<!DOCTYPE"), r.text[:40])
    check("首页中文正常", "羊场管家" in r.text and "\\u" not in r.text[:200])
    for p in ["/css/app.css", "/js/app.js", "/js/core.js"]:
        rr = c.get(p)
        check(f"{p} 带 charset=utf-8", "charset=utf-8" in rr.headers.get("content-type", ""),
              rr.headers.get("content-type", ""))

    section("登录与权限")
    check("错误密码被拒", c.post("/api/auth/login", json={"username": "admin", "password": "x"}).status_code == 400)
    r = c.post("/api/auth/login", json={"username": "admin", "password": "test1234"})
    check("登录成功", r.status_code == 200, r.text)
    TOK = r.json()["token"]
    H = {"Authorization": "Bearer " + TOK}
    check("无 token 被拒", TestClient(app).get("/api/dashboard").status_code == 401)
    check("me 返回权限表", "goat.write" in c.get("/api/auth/me", headers=H).json()["permissions"])

    section("基础选项")
    acc = c.get("/api/fin/accounts", headers=H).json()["items"]
    cats = c.get("/api/fin/categories", headers=H).json()["items"]
    check("预置 5 个账户", len(acc) == 5, str(len(acc)))
    check("预置科目 > 30", len([x for x in cats if not x.get("_group")]) > 30)
    CAT = lambda n, k="expense": next(x["id"] for x in cats
          if not x.get("_group") and x["name"] == n and x["kind"] == k)
    CAT_I = lambda n: next(x["id"] for x in cats
          if not x.get("_group") and x["name"] == n and x["kind"] == "income")
    BANK = next(a["id"] for a in acc if a["kind"] == "bank")
    CASH = next(a["id"] for a in acc if a["kind"] == "cash")
    AR = next(a["id"] for a in acc if a["kind"] == "receivable")

    section("羊只档案")
    t0 = date.today() - timedelta(days=400)
    r = c.post("/api/goats", headers=H, json={
        "tag_no": "M001", "sex": "f", "birth_date": t0.isoformat(),
        "source": "外购", "buy_price": 1800, "barn": "A栋",
        "first_kidding": (t0 + timedelta(days=300)).isoformat(),
    })
    check("建档成功", r.status_code == 200, r.text)
    MID = r.json()["id"]
    check("重复耳标号被拒", c.post("/api/goats", headers=H, json={
        "tag_no": "M001", "sex": "f", "birth_date": t0.isoformat()}).status_code == 400)

    kids = []
    for i in range(4):
        b = date.today() - timedelta(days=30 + i * 25)
        rid = c.post("/api/goats", headers=H, json={
            "tag_no": f"L{i:03d}", "sex": "f" if i % 2 == 0 else "m",
            "birth_date": b.isoformat(), "barn": "B栋"}).json()["id"]
        kids.append(rid)
    r = c.post("/api/goats", headers=H, json={
        "tag_no": "B001", "sex": "m", "birth_date": (date.today() - timedelta(days=500)).isoformat(),
        "barn": "A栋"})
    BUCK = r.json()["id"]

    detail = c.get(f"/api/goats/{MID}", headers=H).json()
    check("详情含分组", detail["group"] == "milking", detail.get("group"))
    check("详情含日龄", 395 <= detail["age_days"] <= 405, str(detail["age_days"]))
    check("事件流水已记购入", any(e["type"] == "purchase" for e in detail["events"]))

    section("事件（产羔自动建档 + 离场）")
    r = c.post(f"/api/goats/{MID}/events", headers=H, json={
        "event_date": date.today().isoformat(), "type": "kidding",
        "kid_tag_no": "KIDS001", "kid_sex": "f", "kid_weight": 3.2, "milk_qty": 4.5})
    check("产羔成功", r.status_code == 200, r.text)
    check("羔羊自动建档", c.get("/api/goats?status=alive&q=KIDS001", headers=H).json()["total"] == 1)
    check("母羊转经产", c.get(f"/api/goats/{MID}", headers=H).json()["group"] == "milking")

    check("未来日期被拒", c.post(f"/api/goats/{MID}/events", headers=H, json={
        "event_date": (date.today() + timedelta(days=5)).isoformat(), "type": "weigh"}).status_code == 400)

    r = c.post(f"/api/goats/{kids[1]}/events", headers=H, json={
        "event_date": date.today().isoformat(), "type": "sale", "amount": 1200, "note": "出售"})
    check("售出成功", r.status_code == 200)
    check("售出后不在场", c.get("/api/goats?status=alive", headers=H).json()["total"] == 6,
          str(c.get("/api/goats?status=alive", headers=H).json()["total"]))
    check("已售状态", c.get(f"/api/goats/{kids[1]}", headers=H).json()["status"] == "sold")

    section("存栏统计")
    s = c.get("/api/herd/summary", headers=H).json()
    check("存栏合计 = 在场数", s["total"] == 6, str(s["total"]))
    check("泌乳母羊 = 1", s["milking_heads"] == 1, str(s.get("milking_heads")))
    groups = {m["code"]: m["total"] for m in s["matrix"]}
    check("分组矩阵含种公羊", groups.get("buck") == 1, str(groups))
    check("栋舍分布", len(s["barns"]) == 2, str(s["barns"]))
    tr = c.get("/api/herd/trend?days=30", headers=H).json()
    check("趋势 30 个点", len(tr["series"]) == 30, str(len(tr["series"])))
    check("趋势今日=存栏", tr["series"][-1]["total"] == s["total"])
    check("趋势区间净变化 = 期末-期初",
          tr["change_30d"] == tr["series"][-1]["total"] - tr["series"][0]["total"],
          f'{tr["change_30d"]} vs {tr["series"][-1]["total"]} - {tr["series"][0]["total"]}')
    check("出生+离场都能反映到趋势", abs(tr["series"][0]["total"] - tr["series"][-1]["total"]) <= 2)
    am = c.get("/api/herd/age-matrix", headers=H).json()
    check("日龄矩阵", sum(b["total"] for b in am["buckets"]) == 6)
    mv = c.get("/api/herd/movements?days=30", headers=H).json()
    check("变动流水含入场", mv["in_count"] >= 1 and mv["out_count"] >= 1, str(mv))
    al = c.get("/api/herd/alerts", headers=H).json()
    check("预警结构完整", set(al) == {"待配种", "产羔临近", "待断奶", "久未称重", "种公羊不足"})

    section("产奶量")
    t = date.today()
    r = c.post("/api/milk", headers=H, json={
        "biz_date": (t - timedelta(days=3)).isoformat(), "batch": "生鲜奶",
        "weight_kg": 100, "price": 5.5, "group_code": "全群"})
    check("录入产奶", r.status_code == 200 and r.json()["amount"] == 550.0, r.text)
    MID_ = r.json()["id"]
    c.post("/api/milk", headers=H, json={
        "biz_date": t.isoformat(), "batch": "生鲜奶", "weight_kg": 42.5, "price": 5.5,
        "group_code": "经产泌乳群"})
    c.post("/api/milk", headers=H, json={
        "biz_date": t.isoformat(), "batch": "酸奶", "weight_kg": 10, "price": 12,
        "discard_kg": 1.5, "group_code": "全群"})
    check("未来日期被拒", c.post("/api/milk", headers=H, json={
        "biz_date": (t + timedelta(days=1)).isoformat(), "weight_kg": 1, "price": 1}).status_code == 400)
    d = c.get("/api/milk/daily?start=" + (t - timedelta(days=7)).isoformat() + "&end=" + t.isoformat(),
              headers=H).json()
    check("按天汇总", len(d["items"]) == 2, str(d["items"]))
    today_row = next(x for x in d["items"] if x["date"] == t.isoformat())
    check("今日产量 52.5", abs(today_row["weight_kg"] - 52.5) < 0.01, str(today_row))
    check("单产计算", today_row["per_head"] is not None and today_row["milking_heads"] >= 1)
    st = c.get("/api/milk/stats?gran=month", headers=H).json()
    check("月统计合计", abs(st["total_weight"] - 152.5) < 0.01, str(st["total_weight"]))
    check("批次拆分 2 项", len(st["by_batch"]) == 2, str(st["by_batch"]))
    cp = c.get("/api/milk/compare?months=3", headers=H).json()
    check("月度对比 3 月", len(cp["items"]) == 3)
    check("改记录", c.put(f"/api/milk/{MID_}", headers=H, json={"weight_kg": 120}).json()["ok"])
    edited = next(x for x in c.get("/api/milk?limit=10", headers=H).json()["items"] if x["id"] == MID_)
    check("改记录后金额联动", edited["amount"] == 660.0, str(edited["amount"]))

    section("出入账 / 账户余额")
    r = c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT_I("卖奶收入"),
        "direction": "income", "amount": 3000, "counterparty": "乳品厂", "note": "8月奶款"})
    check("记收入", r.status_code == 200, r.text)
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT("精饲料"),
        "direction": "expense", "amount": 1800, "counterparty": "饲料厂"})
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT("人工费"),
        "direction": "expense", "amount": 2200})
    check("方向与科目不符被拒", c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT("精饲料"),
        "direction": "income", "amount": 100}).status_code == 400)

    b = c.get("/api/fin/balances", headers=H).json()
    bank = next(x for x in b["items"] if x["id"] == BANK)
    check("银行余额含自动卖羊款 3000+1200-1800-2200", abs(bank["balance"] - 200) < 0.01, str(bank["balance"]))
    check("资金合计", abs(b["money_total"] - 200) < 0.01, str(b["money_total"]))

    # 赊销 -> 应收增加；回款 -> 应收减少 + 银行增加；都不重复计入损益
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": AR, "category_id": CAT_I("卖奶收入"),
        "direction": "income", "amount": 5000, "counterparty": "张老板"})
    b2 = c.get("/api/fin/balances", headers=H).json()
    check("应收增加 5000", abs(b2["receivable"] - 5000) < 0.01, str(b2["receivable"]))
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": AR, "category_id": CAT("应收收回"),
        "direction": "expense", "amount": 5000})
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT_I("应收收回"),
        "direction": "income", "amount": 5000})
    b3 = c.get("/api/fin/balances", headers=H).json()
    check("回款减少应收", abs(next(x for x in b3["items"] if x["id"] == AR)["balance"]) < 0.01,
          str(next(x for x in b3["items"] if x["id"] == AR)["balance"]))
    check("回款进银行", abs(next(x for x in b3["items"] if x["id"] == BANK)["balance"] - 5200) < 0.01,
          str(next(x for x in b3["items"] if x["id"] == BANK)["balance"]))

    pl_pre = c.get("/api/rep/profit?preset=month", headers=H).json()["current"]["total_income"]
    c.post("/api/fin/transfer", headers=H, json={
        "biz_date": t.isoformat(), "from_account_id": BANK, "to_account_id": CASH, "amount": 1500})
    pl_post = c.get("/api/rep/profit?preset=month", headers=H).json()["current"]["total_income"]
    check("内部对转不影响收入", abs(pl_pre - pl_post) < 0.01, f"{pl_pre} -> {pl_post}")
    b4 = c.get("/api/fin/balances", headers=H).json()
    check("对转后现金+银行不变",
          abs(next(x for x in b4["items"] if x["id"] == CASH)["balance"] - 1500) < 0.01)

    tx = c.get("/api/fin/txns?limit=50", headers=H).json()
    check("流水列表带关联名", tx["items"][0]["account_name"] and tx["items"][0]["category_name"])
    check("流水收支持平（含往来款）",
          abs(tx["income"] - 15700) < 0.01 and abs(tx["expense"] - 10500) < 0.01,
          str((tx["income"], tx["expense"])))
    check("卖羊收入已自动生成台账",
          any(x["category_name"] == "卖羊收入" and x["counterparty"] == "出售活羊" for x in tx["items"]))
    check("自动生成台账不可直接删",
          c.delete("/api/fin/txns/" + str(next(x["id"] for x in tx["items"]
             if x["category_name"] == "卖羊收入" and x["counterparty"] == "出售活羊")),
             headers=H).status_code == 400)

    # 借款到账：只动现金不动利润，但应体现在现金流量表里
    c.post("/api/fin/txns", headers=H, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT_I("借款"),
        "direction": "income", "amount": 2800, "counterparty": "银行"})
    check("借款不改变收入", c.get("/api/rep/profit?preset=month", headers=H).json()["current"]["total_income"] == 9200)

    m = c.get("/api/fin/monthly?year=" + str(t.year), headers=H).json()
    check("逐月 12 条", len(m["items"]) == 12)
    check("月度收入>0", m["items"][t.month - 1]["income"] > 0)
    dc = c.get("/api/fin/daily-cash?month=" + t.strftime("%Y-%m"), headers=H).json()
    check("每日现金滚动余额 = 实际现金", dc["items"] and abs(dc["closing"] - 8000) < 0.01,
          f'opening={dc["opening"]} closing={dc["closing"]}')

    section("财务报表")
    pr = c.get("/api/rep/profit?preset=month", headers=H).json()
    pc = pr["current"]
    check("收入 = 3000奶+5000赊销+1200卖羊", abs(pc["total_income"] - 9200) < 0.01, str(pc["total_income"]))
    check("支出 = 1800料+2200人工", abs(pc["total_expense"] - 4000) < 0.01, str(pc["total_expense"]))
    check("利润 = 5200", abs(pc["profit"] - 5200) < 0.01, str(pc["profit"]))
    fin_grp = [g for g in pc["expense"] + pc["income"] if g["group"] == "资金往来"]
    check("往来款不进损益", not fin_grp or all(g["amount"] == 0 for g in fin_grp), str(fin_grp))
    check("有环比对比", pr["compare"] is not None)

    cf = c.get("/api/rep/cashflow?preset=month", headers=H).json()
    check("现金流入含借款与回款", abs(cf["total_inflow"] - 12000) < 0.01, str(cf["total_inflow"]))
    check("现金流出 = 4000", abs(cf["total_outflow"] - 4000) < 0.01, str(cf["total_outflow"]))
    check("现金净额 = 8000", abs(cf["net"] - 8000) < 0.01, str(cf["net"]))
    check("净现金流 = 利润 + 借款", abs(cf["net"] - pc["profit"] - 2800) < 0.01,
          f'net={cf["net"]} profit={pc["profit"]}')
    check("对转不计入现金流",
          not any("现金" in x["account"] and x["inflow"] > 0 for x in cf["by_account"]),
          str(cf["by_account"]))
    bs = c.get("/api/rep/balance-sheet", headers=H).json()
    check("净资产 = 资产 - 负债",
          abs(bs["totals"]["net_asset"] - (bs["totals"]["assets"] - bs["totals"]["liabilities"])) < 0.01,
          str(bs["totals"]))
    check("负债含未偿借款 2800", abs(bs["totals"]["liabilities"] - 2800) < 0.01, str(bs["totals"]))
    check("存栏资产含在册羊", bs["totals"]["heads"] == 6, str(bs["totals"]["heads"]))
    lg = c.get("/api/rep/category-ledger?preset=month", headers=H).json()
    check("科目汇总收入", abs(lg["total_income"] - 9200) < 0.01, str(lg["total_income"]))
    op = c.get("/api/rep/operations?preset=month", headers=H).json()
    check("经营分析含奶业", op["milk"]["weight_kg"] > 0 and op["herd"]["milking"] >= 1)
    tr2 = c.get("/api/rep/trend", headers=H).json()
    check("逐月趋势", len(tr2["items"]) >= 1)

    section("看板")
    db_ = c.get("/api/dashboard", headers=H).json()
    check("看板存栏", db_["herd"]["total"] == 6, str(db_["herd"]["total"]))
    check("看板奶量", db_["milk"]["month_kg"] > 0)
    check("看板资金", "cash_total" in db_["money"])
    check("看板待办", isinstance(db_["todos"], list))
    check("最近流水", len(db_["recent"]) > 0)
    check("全局搜索", c.get("/api/search?q=M001", headers=H).json()["goats"][0]["tag_no"] == "M001")

    section("权限隔离")
    r = c.post("/api/auth/users", headers=H, json={
        "username": "keeper1", "password": "keeper123", "full_name": "饲养员小王", "role": "keeper"})
    check("新增用户", r.status_code == 200, r.text)
    kr = c.post("/api/auth/login", json={"username": "keeper1", "password": "keeper123"})
    KH = {"Authorization": "Bearer " + kr.json()["token"]}
    check("饲养员可看羊只", c.get("/api/goats", headers=KH).status_code == 200)
    check("饲养员可录产奶", c.post("/api/milk", headers=KH, json={
        "biz_date": t.isoformat(), "weight_kg": 1, "price": 1}).status_code == 200)
    check("饲养员不能记账", c.post("/api/fin/txns", headers=KH, json={
        "biz_date": t.isoformat(), "account_id": BANK, "category_id": CAT("精饲料"),
        "direction": "expense", "amount": 1}).status_code == 403)
    check("饲养员看不到账目", c.get("/api/fin/txns", headers=KH).status_code == 403)
    check("饲养员可建羊档（分内事）", c.post("/api/goats", headers=KH, json={
        "tag_no": "X1", "sex": "f", "birth_date": t.isoformat()}).status_code == 200)
    kp = c.get("/api/auth/me", headers=KH).json()["permissions"]
    check("饲养员权限矩阵正确",
          all(kp.get(k) == v for k, v in {
              "goat.read": True, "goat.write": True, "milk.read": True, "milk.write": True,
              "fin.read": False, "fin.write": False, "rep.read": False, "sys.write": False,
          }.items()), str(kp))
    check("饲养员看不到报表", c.get("/api/rep/profit", headers=KH).status_code == 403)
    check("饲养员不能改系统设置", c.put("/api/settings", headers=KH,
          json={"items": {"farm_name": "hax"}}).status_code == 403)
    check("饲养员看不到用户管理", c.get("/api/auth/users", headers=KH).status_code == 403)
    c.delete("/api/auth/users/" + str(r.json()["id"]), headers=H)
    check("停用后无法登录", c.post("/api/auth/login", json={
        "username": "keeper1", "password": "keeper123"}).status_code == 403)

    section("Excel 导出")
    for path, must in [("/api/rep/export/profit?preset=year", b"openxml"),
                       ("/api/rep/export/txns?preset=year", b"openxml"),
                       ("/api/rep/export/milk?preset=year", b"openxml"),
                       ("/api/rep/export/herd", b"openxml"),
                       ("/api/rep/export/summary?preset=month", b"openxml")]:
        rr = c.get(path, headers=H)
        okk = rr.status_code == 200 and rr.content[:2] == b"PK" and must in rr.headers.get("content-type", "").encode()
        check(f"导出 {path.split('?')[0]}", okk, f"{rr.status_code} {len(rr.content)}B")

    section("数据一致性")
    n_goat = c.get("/api/goats?status=&size=1", headers=H).json()["total"]
    n_alive = c.get("/api/goats?status=alive&size=1", headers=H).json()["total"]
    n_sold = c.get("/api/goats?status=sold&size=1", headers=H).json()["total"]
    check("档案总数 = 在场+已售", n_goat == n_alive + n_sold, f"{n_goat} vs {n_alive}+{n_sold}")
    check("存栏合计 = 在场数", c.get("/api/herd/summary", headers=H).json()["total"] == n_alive)
    ev = c.get(f"/api/goats/{MID}/events", headers=H).json()["items"]
    check("事件按时间倒序", [e["event_date"] for e in ev] == sorted(
        [e["event_date"] for e in ev], reverse=True))
    check("删除校验：有事件的羊不可删",
          c.delete(f"/api/goats/{MID}", headers=H).status_code == 400)

print("\n" + "═" * 62)
print(f"  通过 {PASS}　失败 {FAIL}")
print("═" * 62)
shutil.rmtree(TMP, ignore_errors=True)
sys.exit(1 if FAIL else 0)
