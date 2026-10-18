"""首页看板：一眼看清存栏、产奶、钱。"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends

from .. import db, rules
from ..api.finance import MONEY_KINDS, _balance
from ..deps import require

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(_: dict = Depends(require("goat.read"))):
    t = rules.today_str()
    s, e = rules.period_range("month")
    prev_s, prev_e = rules.period_range("prev_month")
    yr_s = f"{date.today().year}-01-01"

    # --- 存栏 ---
    total = db.scalar("SELECT COUNT(*) FROM goat WHERE status='alive'", (), 0)
    female = db.scalar("SELECT COUNT(*) FROM goat WHERE status='alive' AND sex='f'", (), 0)
    milk_heads = db.scalar(
        "SELECT COUNT(*) FROM goat WHERE status='alive' AND sex='f' AND first_kidding IS NOT NULL"
        " AND (milk_role IS NULL OR milk_role NOT LIKE '%干奶%')", (), 0)

    y = t
    d1 = (date.fromisoformat(t) - timedelta(days=1)).isoformat()
    yest = db.scalar(
        "SELECT COUNT(*) FROM goat WHERE status='alive' AND birth_date<=?"
        " AND (status_date IS NULL OR status_date>?)", (d1, d1), 0)
    born_today = db.scalar("SELECT COUNT(*) FROM goat WHERE birth_date=?", (t,), 0)
    out_today = db.scalar(
        "SELECT COUNT(*) FROM goat WHERE status<>'alive' AND status_date=?", (t,), 0)
    new_month = db.scalar("SELECT COUNT(*) FROM goat WHERE birth_date BETWEEN ? AND ?", (s, e), 0)
    out_month = db.scalar("SELECT COUNT(*) FROM goat WHERE status<>'alive' AND status_date BETWEEN ? AND ?",
                          (s, e), 0)

    # --- 产奶 ---
    mk = db.scalar("SELECT COALESCE(SUM(weight_kg),0) FROM milk WHERE biz_date BETWEEN ? AND ?",
                   (s, e), 0) or 0
    mk_prev = db.scalar("SELECT COALESCE(SUM(weight_kg),0) FROM milk WHERE biz_date BETWEEN ? AND ?",
                        (prev_s, prev_e), 0) or 0
    mk_today = db.scalar("SELECT COALESCE(SUM(weight_kg),0) FROM milk WHERE biz_date=?", (t,), 0) or 0
    mk_amt = db.scalar("SELECT COALESCE(SUM(weight_kg*price),0) FROM milk WHERE biz_date BETWEEN ? AND ?",
                       (s, e), 0) or 0
    dim = date.fromisoformat(e).day
    per_head = round(mk / dim / milk_heads, 2) if milk_heads else 0

    # --- 钱 ---
    accounts = db.rows("SELECT * FROM accounts WHERE active=1")
    balances = [_balance(a["id"], t) for a in accounts]
    money = round(sum(b["balance"] for b in balances if b["kind"] in MONEY_KINDS), 2)
    recv = round(sum(b["balance"] for b in balances if b["kind"] == "receivable"), 2)
    pay = round(sum(b["balance"] for b in balances if b["kind"] == "payable"), 2)

    inc_m = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='income' AND affect=1", (s, e), 0) or 0
    exp_m = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='expense' AND affect=1", (s, e), 0) or 0
    inc_p = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='income' AND affect=1", (prev_s, prev_e), 0) or 0
    exp_p = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='expense' AND affect=1", (prev_s, prev_e), 0) or 0
    inc_y = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='income' AND affect=1", (yr_s, t), 0) or 0
    exp_y = db.scalar("SELECT COALESCE(SUM(amount),0) FROM txn WHERE biz_date BETWEEN ? AND ?"
                      " AND direction='expense' AND affect=1", (yr_s, t), 0) or 0

    unpaid_recv = db.scalar(
        "SELECT COALESCE(SUM(amount),0) FROM txn WHERE direction='income'"
        " AND account_id IN (SELECT id FROM accounts WHERE kind='receivable')", (), 0) or 0

    recent = db.rows(
        "SELECT t.biz_date, t.direction, t.amount, t.note, c.name cat, a.name acct,"
        " u.full_name usr FROM txn t JOIN categories c ON c.id=t.category_id"
        " JOIN accounts a ON a.id=t.account_id LEFT JOIN users u ON u.id=t.user_id"
        " ORDER BY t.biz_date DESC, t.id DESC LIMIT 8")

    # --- 待办 ---
    todos = []
    if not db.row("SELECT 1 FROM milk WHERE biz_date=?", (t,)):
        todos.append({"icon": "🍼", "text": "今天还没登记产奶量", "go": "#/milk"})
    if not db.scalar("SELECT COUNT(*) FROM goat_event WHERE event_date=?", (t,), 0):
        todos.append({"icon": "📝", "text": "今天还没有任何存栏变动记录", "go": "#/herd"})
    if exp_m > inc_m:
        todos.append({"icon": "⚠", "text": "本月支出已超过收入", "go": "#/rep"})
    if unpaid_recv > 0:
        todos.append({"icon": "💰", "text": f"有 {unpaid_recv:,.0f} 元应收未收回", "go": "#/fin"})
    if milk_heads == 0 and total > 0:
        todos.append({"icon": "🐑", "text": "还没有母羊登记首次产羔日期，单产算不出来", "go": "#/goats"})

    return {
        "date": t,
        "herd": {
            "total": total, "female": female, "male": total - female,
            "milking": milk_heads, "yesterday": yest, "delta_day": total - yest,
            "born_today": born_today, "out_today": out_today,
            "born_month": new_month, "out_month": out_month,
            "delta_month": new_month - out_month,
        },
        "milk": {
            "month_kg": round(mk, 1), "prev_kg": round(mk_prev, 1),
            "delta": round(mk - mk_prev, 1), "today_kg": round(mk_today, 1),
            "month_amount": round(mk_amt, 2), "per_head": per_head,
        },
        "money": {
            "cash_total": money, "receivable": recv, "payable": pay,
            "month_income": round(inc_m, 2), "month_expense": round(exp_m, 2),
            "month_profit": round(inc_m - exp_m, 2),
            "prev_profit": round(inc_p - exp_p, 2),
            "year_profit": round(inc_y - exp_y, 2),
            "profit_delta": round((inc_m - exp_m) - (inc_p - exp_p), 2),
        },
        "recent": [dict(r) for r in recent],
        "todos": todos,
    }


@router.get("/search")
def search(q: str, _: dict = Depends(require("goat.read"))):
    q = f"%{q.strip()}%"
    goats = db.rows(
        "SELECT id, tag_no, sex, birth_date, status, barn FROM goat"
        " WHERE tag_no LIKE ? OR name LIKE ? OR note LIKE ? LIMIT 12", (q, q, q))
    return {
        "goats": [{**dict(r), "age_text": rules.age_text(r["birth_date"])} for r in goats],
        "accounts": [dict(r) for r in db.rows("SELECT id, name, kind FROM accounts WHERE name LIKE ? LIMIT 5", (q,))],
        "categories": [dict(r) for r in db.rows(
            "SELECT id, name, kind FROM categories WHERE name LIKE ? AND active=1 LIMIT 8", (q,))],
    }
