"""账户、出入账流水、余额。"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, rules
from ..deps import require

router = APIRouter(prefix="/api/fin", tags=["finance"])

KIND_NAME = {"cash": "现金", "bank": "银行", "wechat": "微信/支付宝",
             "alipay": "支付宝", "receivable": "应收", "payable": "应付", "other": "其他"}
MONEY_KINDS = ("cash", "bank", "wechat", "alipay", "other")


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    kind: str = "cash"
    opening_balance: float = 0
    opening_date: str = ""
    note: str = ""


class TxnIn(BaseModel):
    biz_date: str
    account_id: int
    category_id: int
    direction: str
    amount: float = Field(gt=0)
    affect: int | None = None
    counterparty: str = ""
    note: str = ""


class TransferIn(BaseModel):
    biz_date: str
    from_account_id: int
    to_account_id: int
    amount: float = Field(gt=0)
    note: str = ""
    pair: str = "内部转账"   # 内部转账 / 提取现金


def _balance(account_id: int, until: str | None = None) -> dict:
    a = db.row("SELECT * FROM accounts WHERE id=?", (account_id,))
    if a is None:
        return {}
    until = until or rules.today_str()
    inc = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE account_id=? AND direction='income'"
                    " AND biz_date<=?", (account_id, until), 0)
    exp = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE account_id=? AND direction='expense'"
                    " AND biz_date<=?", (account_id, until), 0)
    bal = a["opening_balance"] + a["sign"] * (inc - exp)
    return {
        "id": a["id"], "name": a["name"], "kind": a["kind"],
        "kind_name": KIND_NAME.get(a["kind"], a["kind"]),
        "sign": a["sign"], "is_money": a["kind"] in MONEY_KINDS,
        "opening_balance": round(a["opening_balance"], 2),
        "opening_date": a["opening_date"], "note": a["note"], "active": a["active"],
        "income": round(inc, 2), "expense": round(exp, 2), "balance": round(bal, 2),
    }


# ---------------- 账户 ----------------
@router.get("/accounts")
def list_accounts(until: str = "", active_only: bool = False, _: dict = Depends(require("fin.read"))):
    sql = "SELECT * FROM accounts"
    if active_only:
        sql += " WHERE active=1"
    sql += " ORDER BY CASE kind WHEN 'cash' THEN 0 WHEN 'bank' THEN 1 WHEN 'wechat' THEN 2"
    sql += " WHEN 'alipay' THEN 3 WHEN 'other' THEN 4 WHEN 'receivable' THEN 5 ELSE 6 END, id"
    items = [_balance(r["id"], until) for r in db.rows(sql)]
    money = sum(i["balance"] for i in items if i["is_money"])
    recv = sum(i["balance"] for i in items if i["kind"] == "receivable")
    pay = sum(i["balance"] for i in items if i["kind"] == "payable")
    return {"items": items, "money_total": round(money, 2),
            "receivable": round(recv, 2), "payable": round(pay, 2),
            "net_position": round(money + recv - pay, 2)}


@router.post("/accounts")
def create_account(body: AccountIn, _: dict = Depends(require("fin.write"))):
    if body.kind not in KIND_NAME:
        raise HTTPException(400, "账户类型不合法")
    if db.row("SELECT 1 FROM accounts WHERE name=?", (body.name.strip(),)):
        raise HTTPException(400, "账户名称已存在")
    aid = db.insert(
        "INSERT INTO accounts (name,kind,sign,opening_balance,opening_date,note,created_at)"
        " VALUES (?,?,?,?,?,?,?)",
        (body.name.strip(), body.kind, -1 if body.kind == "payable" else 1,
         body.opening_balance, body.opening_date or rules.today_str(), body.note, db.now()))
    return {"id": aid}


@router.put("/accounts/{aid}")
def update_account(aid: int, body: AccountIn, _: dict = Depends(require("fin.write"))):
    if not db.row("SELECT 1 FROM accounts WHERE id=?", (aid,)):
        raise HTTPException(404, "账户不存在")
    sign = -1 if body.kind == "payable" else 1
    db.execute("UPDATE accounts SET name=?, kind=?, sign=?, note=? WHERE id=?",
               (body.name.strip(), body.kind, sign, body.note, aid))
    return {"ok": True}


@router.put("/accounts/{aid}/opening")
def set_opening(aid: int, body: dict, _: dict = Depends(require("fin.write"))):
    db.execute("UPDATE accounts SET opening_balance=?, opening_date=? WHERE id=?",
               (float(body.get("opening_balance") or 0),
                body.get("opening_date") or rules.today_str(), aid))
    return {"ok": True}


@router.delete("/accounts/{aid}")
def disable_account(aid: int, _: dict = Depends(require("fin.write"))):
    n = db.scalar("SELECT COUNT(*) FROM txn WHERE account_id=?", (aid,), 0)
    if n:
        db.execute("UPDATE accounts SET active=0 WHERE id=?", (aid,))
        return {"ok": True, "archived": True}
    db.execute("DELETE FROM accounts WHERE id=?", (aid,))
    return {"ok": True, "archived": False}


# ---------------- 科目 ----------------
@router.get("/categories")
def list_categories(kind: str = "", _: dict = Depends(require("fin.read"))):
    sql = "SELECT * FROM categories WHERE active=1"
    args: tuple = ()
    if kind:
        sql += " AND kind=?"
        args = (kind,)
    rs = db.rows(sql + " ORDER BY kind DESC, sort, id", args)
    out, cur = [], None
    for r in rs:
        if r["group_name"] != cur:
            cur = r["group_name"]
            out.append({"_group": cur})
        out.append({"id": r["id"], "name": r["name"], "kind": r["kind"],
                    "group_name": r["group_name"], "affect": r["affect"], "sort": r["sort"]})
    return {"items": out}


@router.post("/categories")
def create_category(body: dict, _: dict = Depends(require("fin.write"))):
    name = (body.get("name") or "").strip()
    kind = body.get("kind", "expense")
    if not name:
        raise HTTPException(400, "科目名称不能为空")
    if db.row("SELECT 1 FROM categories WHERE name=? AND kind=?", (name, kind)):
        raise HTTPException(400, "该科目已存在")
    cid = db.insert(
        "INSERT INTO categories (name,kind,group_name,affect,sort) VALUES (?,?,?,?,?)",
        (name, kind, body.get("group_name") or "其他",
         int(body.get("affect", 1)), int(body.get("sort", 90))))
    return {"id": cid}


@router.put("/categories/{cid}")
def update_category(cid: int, body: dict, _: dict = Depends(require("fin.write"))):
    db.execute("UPDATE categories SET group_name=?, affect=?, sort=? WHERE id=?",
               (body.get("group_name") or "其他", int(body.get("affect", 1)),
                int(body.get("sort", 90)), cid))
    return {"ok": True}


@router.delete("/categories/{cid}")
def disable_category(cid: int, _: dict = Depends(require("fin.write"))):
    n = db.scalar("SELECT COUNT(*) FROM txn WHERE category_id=?", (cid,), 0)
    if n:
        db.execute("UPDATE categories SET active=0 WHERE id=?", (cid,))
        return {"ok": True, "archived": True}
    db.execute("DELETE FROM categories WHERE id=?", (cid,))
    return {"ok": True, "archived": False}


# ---------------- 流水 ----------------
@router.get("/txns")
def list_txns(start: str = "", end: str = "", account_id: str = "0", category_id: str = "0",
              direction: str = "", q: str = "", limit: int = 100, offset: int = 0,
              _: dict = Depends(require("fin.read"))):
    where, args = [], []
    if start:
        where.append("t.biz_date >= ?"); args.append(start)
    if end:
        where.append("t.biz_date <= ?"); args.append(end)
    if account_id and account_id != "0":
        where.append("t.account_id = ?"); args.append(int(account_id))
    if category_id and category_id != "0":
        where.append("t.category_id = ?"); args.append(int(category_id))
    if direction:
        where.append("t.direction = ?"); args.append(direction)
    if q:
        where.append("(t.note LIKE ? OR t.counterparty LIKE ?)"); args += [f"%{q}%"] * 2
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.scalar(f"SELECT COUNT(*) FROM txn t{clause}", tuple(args), 0)

    def _sum(direction: str) -> float:
        sql = f"SELECT COALESCE(SUM(t.amount),0) FROM txn t{clause}"
        if clause:
            sql += f" AND t.direction='{direction}'"
        else:
            sql += f" WHERE t.direction='{direction}'"
        return db.scalar(sql, tuple(args), 0)

    inc, exp = _sum("income"), _sum("expense")
    rs = db.rows(
        f"SELECT t.*, a.name AS account_name, a.kind AS account_kind, c.name AS category_name,"
        f" c.group_name, c.affect AS cat_affect, u.full_name AS user_name"
        f" FROM txn t JOIN accounts a ON a.id=t.account_id JOIN categories c ON c.id=t.category_id"
        f" LEFT JOIN users u ON u.id=t.user_id{clause}"
        f" ORDER BY t.biz_date DESC, t.id DESC LIMIT ? OFFSET ?",
        tuple(args) + (limit, offset))
    return {"items": [dict(r) for r in rs], "total": total,
            "income": round(inc or 0, 2), "expense": round(exp or 0, 2),
            "net": round((inc or 0) - (exp or 0), 2)}


@router.post("/txns")
def create_txn(body: TxnIn, user: dict = Depends(require("fin.write"))):
    if body.direction not in ("income", "expense"):
        raise HTTPException(400, "方向不合法")
    if body.biz_date > rules.today_str():
        raise HTTPException(400, "日期不能晚于今天")
    acc = db.row("SELECT * FROM accounts WHERE id=?", (body.account_id,))
    if acc is None:
        raise HTTPException(400, "账户不存在")
    cat = db.row("SELECT * FROM categories WHERE id=?", (body.category_id,))
    if cat is None:
        raise HTTPException(400, "科目不存在")
    if cat["kind"] != body.direction:
        raise HTTPException(400, f"科目「{cat['name']}」是{'收入' if cat['kind'] == 'income' else '支出'}科目，方向不符")
    affect = body.affect if body.affect is not None else cat["affect"]
    tid = db.insert(
        "INSERT INTO txn (biz_date,account_id,category_id,direction,amount,affect,counterparty,"
        "note,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (body.biz_date, body.account_id, body.category_id, body.direction, round(body.amount, 2),
         affect, body.counterparty, body.note, user["id"], db.now()))
    return {"id": tid}


@router.put("/txns/{tid}")
def update_txn(tid: int, body: TxnIn, user: dict = Depends(require("fin.write"))):
    t = db.row("SELECT * FROM txn WHERE id=?", (tid,))
    if t is None:
        raise HTTPException(404, "流水不存在")
    cat = db.row("SELECT * FROM categories WHERE id=?", (body.category_id,))
    if cat is None:
        raise HTTPException(400, "科目不存在")
    if cat["kind"] != body.direction:
        raise HTTPException(400, "方向与科目不符")
    db.execute(
        "UPDATE txn SET biz_date=?, account_id=?, category_id=?, direction=?, amount=?,"
        " counterparty=?, note=? WHERE id=?",
        (body.biz_date, body.account_id, body.category_id, body.direction,
         round(body.amount, 2), body.counterparty, body.note, tid))
    return {"ok": True}


@router.delete("/txns/{tid}")
def delete_txn(tid: int, _: dict = Depends(require("fin.write"))):
    if db.row("SELECT link_type FROM txn WHERE id=? AND link_type<>''", (tid,)):
        raise HTTPException(400, "该流水由业务单据自动生成，请到来源处修改")
    db.execute("DELETE FROM txn WHERE id=?", (tid,))
    return {"ok": True}


@router.post("/transfer")
def transfer(body: TransferIn, user: dict = Depends(require("fin.write"))):
    """内部对转 / 提取现金：钱换个口袋，只动余额不影响损益，也不计入现金流量表。"""
    if body.from_account_id == body.to_account_id:
        raise HTTPException(400, "转出与转入账户不能相同")
    for aid in (body.from_account_id, body.to_account_id):
        if not db.row("SELECT 1 FROM accounts WHERE id=?", (aid,)):
            raise HTTPException(400, "账户不存在")
    pair = body.pair if body.pair in ("内部转账", "提取现金") else "内部转账"
    cats = db.rows("SELECT * FROM categories WHERE name=?", (pair,))
    if len(cats) != 2:
        raise HTTPException(400, f"缺少「{pair}」科目（需要收入、支出各一条）")
    out_cat, in_cat = [c for c in cats if c["kind"] == "expense"][0], \
                      [c for c in cats if c["kind"] == "income"][0]
    with db.tx():
        for (aid, cat_id, direction) in ((body.from_account_id, out_cat["id"], "expense"),
                                         (body.to_account_id, in_cat["id"], "income")):
            db.insert(
                "INSERT INTO txn (biz_date,account_id,category_id,direction,amount,affect,note,"
                "user_id,link_type,created_at) VALUES (?,?,?,?,?,0,?,?,'transfer',?)",
                (body.biz_date, aid, cat_id, direction, round(body.amount, 2),
                 body.note or pair, user["id"], db.now()))
    return {"ok": True}


@router.get("/balances")
def balances(until: str = "", _: dict = Depends(require("fin.read"))):
    until = until or rules.today_str()
    items = [_balance(r["id"], until) for r in db.rows("SELECT * FROM accounts WHERE active=1 ORDER BY id")]
    money = sum(i["balance"] for i in items if i["is_money"])
    recv = sum(i["balance"] for i in items if i["kind"] == "receivable")
    pay = sum(i["balance"] for i in items if i["kind"] == "payable")
    return {"date": until, "items": items,
            "money_total": round(money, 2), "receivable": round(recv, 2),
            "payable": round(pay, 2), "net_position": round(money + recv - pay, 2)}


@router.get("/monthly")
def monthly(year: int = 0, _: dict = Depends(require("fin.read"))):
    """按月收支柱状图（仅资金账户，剔除了应收应付往来）。"""
    year = year or date.today().year
    rs = db.rows(
        "SELECT strftime('%Y-%m', biz_date) AS m,"
        " SUM(CASE WHEN direction='income' THEN amount ELSE 0 END) AS inc,"
        " SUM(CASE WHEN direction='expense' THEN amount ELSE 0 END) AS exp"
        " FROM txn WHERE biz_date BETWEEN ? AND ? AND affect=1 GROUP BY m ORDER BY m",
        (f"{year}-01-01", f"{year}-12-31"))
    out = [{"month": r["m"], "income": round(r["inc"] or 0, 2), "expense": round(r["exp"] or 0, 2),
            "profit": round((r["inc"] or 0) - (r["exp"] or 0), 2)} for r in rs]
    for i in range(1, 13):
        if not any(o["month"] == f"{year}-{i:02d}" for o in out):
            out.append({"month": f"{year}-{i:02d}", "income": 0, "expense": 0, "profit": 0})
    out.sort(key=lambda x: x["month"])
    return {"year": year, "items": out}


@router.get("/daily-cash")
def daily_cash(month: str = "", _: dict = Depends(require("fin.read"))):
    """某月资金账户每日流入/流出与滚动余额。"""
    month = month or date.today().strftime("%Y-%m")
    money_acc = db.rows("SELECT * FROM accounts WHERE kind IN ('cash','bank','wechat','alipay','other') AND active=1")
    prev_last = (date.fromisoformat(month + "-01") - timedelta(days=1)).isoformat()
    opening = round(sum(_balance(a["id"], prev_last)["balance"] for a in money_acc), 2)

    rs = db.rows(
        "SELECT t.biz_date AS d,"
        " SUM(CASE WHEN t.direction='income' THEN t.amount ELSE 0 END) AS inc,"
        " SUM(CASE WHEN t.direction='expense' THEN t.amount ELSE 0 END) AS exp"
        # 滚动余额要对得上账户实际余额，所以这里保留内部对转的腿
        " FROM txn t JOIN accounts a ON a.id=t.account_id"
        " WHERE t.biz_date LIKE ? AND a.kind IN ('cash','bank','wechat','alipay','other')"
        " GROUP BY d ORDER BY d", (f"{month}-%",))
    out, run = [], opening
    for r in rs:
        inc, exp = round(r["inc"] or 0, 2), round(r["exp"] or 0, 2)
        run = round(run + inc - exp, 2)
        out.append({"date": r["d"], "income": inc, "expense": exp,
                    "net": round(inc - exp, 2), "balance": run})
    return {"month": month, "opening": opening, "closing": run, "items": out}
