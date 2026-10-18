"""产奶量记录与统计。"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, rules
from ..deps import require

router = APIRouter(prefix="/api/milk", tags=["milk"])


class MilkIn(BaseModel):
    biz_date: str
    group_code: str = "全群"
    batch: str = "生鲜奶"
    weight_kg: float = Field(ge=0)
    discard_kg: float = 0
    price: float = Field(ge=0)
    grade: str = ""
    shift: str = "早/晚"
    note: str = ""


class MilkPatch(BaseModel):
    biz_date: str | None = None
    group_code: str | None = None
    batch: str | None = None
    weight_kg: float | None = None
    discard_kg: float | None = None
    price: float | None = None
    grade: str | None = None
    shift: str | None = None
    note: str | None = None


def _row_dict(r, milking_heads: int = 0) -> dict:
    d = dict(r)
    d["amount"] = round((d.get("weight_kg") or 0) * (d.get("price") or 0), 2)
    d["per_head"] = round(d["weight_kg"] / milking_heads, 2) if milking_heads else None
    return d


@router.get("/options")
def options(_: dict = Depends(require("milk.read"))):
    used = [r[0] for r in db.rows("SELECT DISTINCT batch FROM milk ORDER BY batch")]
    groups = [r[0] for r in db.rows("SELECT DISTINCT group_code FROM milk ORDER BY group_code")]
    return {
        "batches": rules.MILK_BATCHES + [b for b in used if b not in rules.MILK_BATCHES],
        "groups": ["全群"] + rules.MILK_GROUPS + [g for g in groups if g not in rules.MILK_GROUPS],
    }


@router.get("")
def list_milk(start: str = "", end: str = "", batch: str = "", group: str = "",
               limit: int = 200, offset: int = 0, _: dict = Depends(require("milk.read"))):
    where, args = [], []
    if start:
        where.append("biz_date >= ?"); args.append(start)
    if end:
        where.append("biz_date <= ?"); args.append(end)
    if batch:
        where.append("batch = ?"); args.append(batch)
    if group:
        where.append("group_code = ?"); args.append(group)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.scalar(f"SELECT COUNT(*) FROM milk{clause}", tuple(args), 0)
    rs = db.rows(
        f"SELECT m.*, u.full_name AS user_name FROM milk m LEFT JOIN users u ON u.id=m.user_id"
        f"{clause} ORDER BY m.biz_date DESC, m.id DESC LIMIT ? OFFSET ?",
        tuple(args) + (limit, offset))
    return {"items": [_row_dict(r) for r in rs], "total": total}


@router.get("/daily")
def daily(start: str = "", end: str = "", _: dict = Depends(require("milk.read"))):
    """按天汇总：产奶量、弃奶、金额、当日平均单产。"""
    if not end:
        end = rules.today_str()
    if not start:
        start = (date.fromisoformat(end) - timedelta(days=29)).isoformat()
    rs = db.rows(
        "SELECT biz_date, SUM(weight_kg) AS w, SUM(discard_kg) AS d, SUM(weight_kg*price) AS amt"
        " FROM milk WHERE biz_date BETWEEN ? AND ? GROUP BY biz_date ORDER BY biz_date", (start, end))
    out = []
    for r in rs:
        heads = db.scalar(
            "SELECT COUNT(*) FROM goat WHERE status='alive' AND sex='f' AND first_kidding IS NOT NULL"
            " AND birth_date<=? AND (status_date IS NULL OR status_date>?)",
            (r["biz_date"], r["biz_date"]), 0)
        out.append({
            "date": r["biz_date"],
            "weight_kg": round(r["w"] or 0, 2),
            "discard_kg": round(r["d"] or 0, 2),
            "amount": round(r["amt"] or 0, 2),
            "milking_heads": heads,
            "per_head": round((r["w"] or 0) / heads, 2) if heads else None,
        })
    return {"items": out, "start": start, "end": end}


@router.get("/stats")
def stats(start: str = "", end: str = "", gran: str = "day", _: dict = Depends(require("milk.read"))):
    """产量趋势：day / week / month，附单产与环比。"""
    if not end:
        end = rules.today_str()
    if not start:
        start = (date.fromisoformat(end) - timedelta(days=59)).isoformat()

    fmt_sql = {"day": "%Y-%m-%d", "week": "%Y-W%W", "month": "%Y-%m"}[gran]
    by_bucket = db.rows(
        f"SELECT strftime('{fmt_sql}', biz_date) AS bucket, SUM(weight_kg) AS w,"
        f" SUM(discard_kg) AS d, SUM(weight_kg*price) AS amt FROM milk"
        f" WHERE biz_date BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket", (start, end))
    by_batch = db.rows(
        "SELECT batch, SUM(weight_kg) AS w, SUM(weight_kg*price) AS amt, COUNT(DISTINCT biz_date) AS d"
        " FROM milk WHERE biz_date BETWEEN ? AND ? GROUP BY batch ORDER BY w DESC", (start, end))

    buckets = []
    for r in by_bucket:
        w = r["w"] or 0
        amt = r["amt"] or 0
        buckets.append({
            "bucket": r["bucket"], "weight_kg": round(w, 2),
            "discard_kg": round(r["d"] or 0, 2),
            "amount": round(amt, 2),
            "avg_price": round(amt / w, 2) if w else 0,
            "discard_rate": round((r["d"] or 0) / (w + (r["d"] or 0)) * 100, 2)
            if (w + (r["d"] or 0)) else 0,
        })

    heads_today = db.scalar(
        "SELECT COUNT(*) FROM goat WHERE status='alive' AND sex='f' AND first_kidding IS NOT NULL", (), 0)
    days = db.scalar("SELECT COUNT(DISTINCT biz_date) FROM milk WHERE biz_date BETWEEN ? AND ?",
                     (start, end), 0) or 0
    total_w = db.scalar("SELECT SUM(weight_kg) FROM milk WHERE biz_date BETWEEN ? AND ?",
                        (start, end), 0) or 0
    total_amt = db.scalar("SELECT SUM(weight_kg*price) FROM milk WHERE biz_date BETWEEN ? AND ?",
                          (start, end), 0) or 0
    return {
        "gran": gran, "start": start, "end": end,
        "buckets": buckets,
        "by_batch": [{"batch": r["batch"], "weight_kg": round(r["w"] or 0, 2),
                      "amount": round(r["amt"] or 0, 2), "days": r["d"],
                      "avg_price": round((r["amt"] or 0) / (r["w"] or 1), 2)} for r in by_batch],
        "total_weight": round(total_w, 2),
        "total_amount": round(total_amt, 2),
        "avg_price": round(total_amt / total_w, 2) if total_w else 0,
        "avg_daily": round(total_w / days, 2) if days else 0,
        "milking_heads": heads_today,
        "per_head_today": round(total_w / days / heads_today, 2) if days and heads_today else 0,
    }


@router.get("/compare")
def compare(months: int = 6, _: dict = Depends(require("milk.read"))):
    """近 N 个月产量与单产对比。"""
    end = date.today().replace(day=1)
    out = []
    for i in reversed(range(months)):
        m0 = rules.add_months(end, -i)
        m1 = rules.add_months(m0, 1)
        s, e = m0.isoformat(), (m1 - timedelta(days=1)).isoformat()
        w = db.scalar("SELECT SUM(weight_kg) FROM milk WHERE biz_date BETWEEN ? AND ?", (s, e), 0) or 0
        amt = db.scalar("SELECT SUM(weight_kg*price) FROM milk WHERE biz_date BETWEEN ? AND ?", (s, e), 0) or 0
        heads = db.scalar(
            "SELECT COUNT(*) FROM goat WHERE status='alive' AND sex='f' AND first_kidding IS NOT NULL"
            " AND birth_date<=? AND (status_date IS NULL OR status_date>?)", (e, e), 0)
        dim = m1.day
        out.append({
            "month": m0.strftime("%Y-%m"), "weight_kg": round(w, 1), "amount": round(amt, 1),
            "milking_heads": heads,
            "per_head": round(w / dim / heads, 2) if heads else 0,
            "avg_price": round(amt / w, 2) if w else 0,
        })
    return {"items": out}


@router.post("")
def create_milk(body: MilkIn, user: dict = Depends(require("milk.write"))):
    if body.biz_date > rules.today_str():
        raise HTTPException(400, "日期不能晚于今天")
    mid = db.insert(
        "INSERT INTO milk (biz_date,group_code,batch,weight_kg,discard_kg,price,amount,grade,"
        "shift,note,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (body.biz_date, body.group_code, body.batch, body.weight_kg, body.discard_kg, body.price,
         round(body.weight_kg * body.price, 2), body.grade, body.shift, body.note,
         user["id"], db.now()))
    return {"id": mid, "amount": round(body.weight_kg * body.price, 2)}


@router.put("/{mid}")
def update_milk(mid: int, body: MilkPatch, _: dict = Depends(require("milk.write"))):
    if not db.row("SELECT 1 FROM milk WHERE id=?", (mid,)):
        raise HTTPException(404, "记录不存在")
    d = body.model_dump(exclude_none=True)
    if not d:
        return {"ok": True}
    cur = db.row("SELECT * FROM milk WHERE id=?", (mid,))
    if "amount" not in d:
        w = d.get("weight_kg", cur["weight_kg"])
        p = d.get("price", cur["price"])
        d["amount"] = round(w * p, 2)
    sets = ", ".join(f"{k}=?" for k in d)
    db.execute(f"UPDATE milk SET {sets} WHERE id=?", tuple(d.values()) + (mid,))
    return {"ok": True}


@router.delete("/{mid}")
def delete_milk(mid: int, _: dict = Depends(require("milk.write"))):
    db.execute("DELETE FROM milk WHERE id=?", (mid,))
    return {"ok": True}


@router.post("/quick")
def quick(payload: dict, user: dict = Depends(require("milk.write"))):
    """快捷录入：一键登记当天某批次的总产。"""
    d = rules.today_str()
    body = MilkIn(
        biz_date=payload.get("biz_date") or d,
        group_code=payload.get("group_code", "全群"),
        batch=payload.get("batch", "生鲜奶"),
        weight_kg=float(payload.get("weight_kg") or 0),
        price=float(payload.get("price") or 0),
        note=payload.get("note", "快捷录入"),
    )
    return create_milk(body, user)
