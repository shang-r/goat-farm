"""针对运行中的真服务做端到端 HTTP 校验（非 TestClient，走真实 socket）。

用法：python tools/http_check.py            # 默认 http://127.0.0.1:8771
      python tools/http_check.py URL        # 指定地址
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
B = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8771").rstrip("/")
bad = 0


def req(path, tok=None, data=None, method=None, timeout=15):
    r = urllib.request.Request(B + path,
                               data=(json.dumps(data).encode() if data is not None else None),
                               method=method)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    return urllib.request.urlopen(r, timeout=timeout)


def js(r):
    return json.loads(r.read().decode("utf-8"))


STAMP = int(time.time() * 1000) % 1000000  # 每次运行唯一，避免耳标号重复
TAG = "QA-%06d" % STAMP

print("== 1. 前端静态资源 ==")
h = req("/")
html = h.read().decode("utf-8")
print("  %-26s HTTP %d %6d bytes  标题命中: %s" % ("/", h.status, len(html), "羊场管家" in html))
bad += "羊场管家" not in html
for p in ["/css/app.css", "/js/app.js", "/js/core.js",
          "/js/views/home.js", "/js/views/goats.js", "/js/views/herd.js",
          "/js/views/milk.js", "/js/views/fin.js", "/js/views/rep.js", "/js/views/me.js",
          "/manifest.webmanifest", "/icon.svg"]:
    r = req(p)
    n = len(r.read())
    ok = r.status == 200 and n > 0
    print("  %-26s HTTP %d %7d bytes %s" % (p, r.status, n, "OK" if ok else "FAIL"))
    bad += not ok

heal = js(req("/api/health"))
print("  健康检查            ", heal)

print("\n== 2. 登录 ==")
tok = js(req("/api/auth/login", data={"username": "admin", "password": "goat2024"}))["token"]
print("  admin/goat2024 -> token %d 字符" % len(tok))
bad += len(tok) < 10

try:
    req("/api/auth/login", data={"username": "admin", "password": "wrong"})
    print("  [FAIL] 错误密码竟然登录成功")
    bad += 1
except Exception as e:
    print("  [OK ] 错误密码被拒（%s）" % type(e).__name__)

print("\n== 3. 只读接口 ==")
GETS = ["/api/dashboard", "/api/herd/summary", "/api/herd/trend?days=30",
        "/api/herd/age-matrix", "/api/herd/alerts", "/api/herd/movements?days=30",
        "/api/milk/daily?start=2026-08-01&end=2026-10-18",
        "/api/milk/stats?gran=day", "/api/milk/stats?gran=week", "/api/milk/compare?months=3",
        "/api/fin/accounts", "/api/fin/categories", "/api/fin/txns?limit=50",
        "/api/fin/balances", "/api/fin/monthly?year=2026", "/api/fin/daily-cash",
        "/api/rep/profit?preset=month", "/api/rep/profit?preset=quarter",
        "/api/rep/profit?preset=year", "/api/rep/trend",
        "/api/rep/cashflow?preset=month", "/api/rep/balance-sheet",
        "/api/rep/category-ledger?preset=month", "/api/rep/operations?preset=month",
        "/api/settings", "/api/auth/me"]
for p in GETS:
    d = js(req(p, tok))
    print("  %-40s HTTP 200  %2d 键" % (p, len(d)))

print("\n== 4. 写入接口 ==")
accs = js(req("/api/fin/accounts", tok))["items"]
bank_id = [a["id"] for a in accs if a["kind"] == "bank"][0]
wechat_id = [a["id"] for a in accs if a["kind"] == "wechat"][0]

# 科目按名字取 id（列表里混着 _group 分组标题，跳过）
CATS = {x["name"]: x["id"] for x in js(req("/api/fin/categories", tok))["items"] if "id" in x}
print("  科目共 %d 个" % len(CATS))


def chk(tag, resp):
    global bad
    d = js(resp)
    ok = resp.status == 200
    print("  %-30s HTTP %d %s" % (tag, resp.status, json.dumps(d, ensure_ascii=False)[:70]))
    bad += not ok
    return d


g = chk("POST 建羊只档案", req("/api/goats", tok,
      {"tag_no": TAG, "sex": "f", "birth_date": "2025-04-10", "barn": "A1"}))
gid = g["id"]
chk("POST 记一次产奶（分群）", req("/api/milk", tok,
    {"biz_date": "2026-10-18", "group_code": "泌乳群", "batch": "生鲜奶",
     "weight_kg": 340.0, "discard_kg": 2.0, "price": 4.2, "grade": "一级",
     "shift": "早晚", "note": "10/18"}))
chk("POST 卖奶收入（影响利润）", req("/api/fin/txns", tok,
    {"biz_date": "2026-10-18", "account_id": bank_id,
     "category_id": CATS["卖奶收入"], "direction": "income",
     "amount": 28000, "counterparty": "乳品厂", "note": "10/18 鲜奶"}))
chk("POST 精饲料支出（影响利润）", req("/api/fin/txns", tok,
    {"biz_date": "2026-10-18", "account_id": bank_id,
     "category_id": CATS["精饲料"], "direction": "expense",
     "amount": 9200, "counterparty": "饲料厂"}))
chk("POST 银行→微信 内部对转", req("/api/fin/transfer", tok,
    {"biz_date": "2026-10-18", "from_account_id": bank_id,
     "to_account_id": wechat_id, "amount": 5000}))
chk("POST 羊只事件（称重）", req("/api/goats/%d/events" % gid, tok,
    {"event_date": "2026-10-18", "type": "weigh", "weight": 48.5, "note": "称重"}))
chk("PUT 改羊只档案", req("/api/goats/%d" % gid, tok,
    {"tag_no": TAG, "sex": "f", "birth_date": "2025-04-10", "barn": "A2"},
    method="PUT"))

# 校验：方向与科目不符必须被拒（精饲料是支出科目，不能记收入）
try:
    req("/api/fin/txns", tok,
        {"biz_date": "2026-10-18", "account_id": bank_id,
         "category_id": CATS["精饲料"], "direction": "income", "amount": 100})
    print("  [FAIL] 方向与科目不符竟然通过了")
    bad += 1
except urllib.error.HTTPError as e:
    print("  [OK ] 方向与科目不符被拒（HTTP %d）" % e.code)

print("\n== 5. 报表 & Excel 导出 ==")
for p in ["/api/rep/profit?preset=month", "/api/rep/cashflow?preset=month",
          "/api/rep/balance-sheet", "/api/rep/category-ledger?preset=month",
          "/api/rep/operations?preset=month"]:
    print("  %-40s %d 键" % (p, len(js(req(p, tok)))))
for p in ["/api/rep/export/profit?preset=month", "/api/rep/export/summary?preset=month",
          "/api/rep/export/summary-all?preset=year", "/api/rep/export/txns?preset=month",
          "/api/rep/export/milk?preset=month", "/api/rep/export/herd"]:
    r = req(p, tok, timeout=30)
    b = r.read()
    ok = r.status == 200 and b[:2] == b"PK"
    print("  %-40s HTTP %d %7d bytes %s" % (p, r.status, len(b), "xlsx OK" if ok else "FAIL"))
    bad += not ok

print("\n== 6. 业务逻辑抽查 ==")
bs = js(req("/api/rep/balance-sheet", tok))
print("  资产负债简表键:", list(bs.keys()))
cf = js(req("/api/rep/cashflow?preset=month", tok))
print("  现金流量表键  :", list(cf.keys()))
pl = js(req("/api/rep/profit?preset=month", tok))
print("  利润表键      :", list(pl.keys()))
# 利润表应有净现金流口径与利润口径的差异字段
print("  利润=收入-成本:", pl.get("profit_total"), "  收入", pl.get("income_total"), "  成本", pl.get("cost_total"))

print("\n" + "=" * 52)
print("  失败项：%d" % bad)
print("=" * 52)
sys.exit(1 if bad else 0)
