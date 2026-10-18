"""羊只个体档案、事件流水、存栏动态统计。"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, rules
from ..deps import require
from ..rules import fmt, group_of, parse_date, today_str

router = APIRouter(prefix="/api", tags=["goat"])


class GoatIn(BaseModel):
    tag_no: str = Field(min_length=1, max_length=40)
    name: str = ""
    sex: str = "f"
    breed: str = "萨能奶山羊"
    birth_date: str
    birth_weight: float | None = None
    source: str = ""
    buy_price: float = 0
    sire_tag: str = ""
    dam_tag: str = ""
    barn: str = ""
    first_kidding: str | None = None
    milk_role: str = ""
    status: str = "alive"
    status_date: str | None = None
    exit_reason: str = ""
    exit_price: float = 0
    weaned_date: str | None = None
    note: str = ""


class GoatPatch(BaseModel):
    tag_no: str | None = None
    name: str | None = None
    sex: str | None = None
    breed: str | None = None
    birth_date: str | None = None
    birth_weight: float | None = None
    source: str | None = None
    buy_price: float | None = None
    sire_tag: str | None = None
    dam_tag: str | None = None
    barn: str | None = None
    first_kidding: str | None = None
    milk_role: str | None = None
    status: str | None = None
    status_date: str | None = None
    exit_reason: str | None = None
    exit_price: float | None = None
    weaned_date: str | None = None
    note: str | None = None


class EventIn(BaseModel):
    event_date: str
    type: str
    barn: str = ""
    weight: float | None = None
    amount: float = 0
    milk_qty: float | None = None
    batch: str = ""
    note: str = ""
    # 出生/购入时可直接建档
    kid_tag_no: str = ""
    kid_sex: str = "f"
    kid_weight: float | None = None


def _goat_dict(r: sqlite3.Row, on: str | None = None) -> dict:
    g = dict(r)
    g["group"] = group_of(g, on)
    g["group_name"] = rules.GROUP_NAME.get(g["group"], g["group"])
    g["age_days"] = rules.age_days(g["birth_date"], on)
    g["age_text"] = rules.age_text(g["birth_date"], on)
    g["status_name"] = rules.GOAT_STATUS.get(g["status"], g["status"])
    return g


# ---------------- 档案 CRUD ----------------
def _auto_sale_txn(goat_id: int, biz_date: str, amount: float, note: str, user_id: int) -> int | None:
    """卖羊收入自动生成一笔台账（挂银行账户），避免手工漏记；同一只羊只生成一次。"""
    if db.row("SELECT 1 FROM txn WHERE link_type='sale' AND link_id=?", (goat_id,)):
        return None
    acc = db.row("SELECT id FROM accounts WHERE kind='bank' AND active=1 LIMIT 1") \
        or db.row("SELECT id FROM accounts WHERE kind IN ('cash','wechat','alipay') AND active=1 LIMIT 1")
    cat = db.row("SELECT id FROM categories WHERE name='卖羊收入' AND active=1")
    if not acc or not cat:
        return None
    return db.insert(
        "INSERT INTO txn (biz_date,account_id,category_id,direction,amount,affect,counterparty,note,"
        "user_id,link_type,link_id,created_at) VALUES (?,?,?,?,?,1,?,?,?,'sale',?,?)",
        (biz_date, acc["id"], cat["id"], "income", round(amount, 2),
         "出售活羊", note, user_id, goat_id, db.now()))


@router.get("/goats/options")
def options(_: dict = Depends(require("goat.read"))):
    barns = [r[0] for r in db.rows("SELECT DISTINCT barn FROM goat WHERE barn<>'' ORDER BY barn")]
    breeds = [r[0] for r in db.rows("SELECT DISTINCT breed FROM goat WHERE breed<>'' ORDER BY breed")]
    if not breeds:
        breeds = ["萨能奶山羊", "关山羊", "奶山羊杂交", "其他"]
    return {
        "barns": barns,
        "breeds": breeds,
        "groups": [{"code": c, "name": n} for c, n in rules.GROUP_NAME.items()],
        "status": [{"code": k, "name": v} for k, v in rules.GOAT_STATUS.items()],
        "event_types": rules.EVENT_TYPE_OPTIONS,
    }


@router.get("/goats")
def list_goats(
    q: str = "",
    status: str = "alive",
    sex: str = "",
    grp: str = "",
    barn: str = "",
    from_date: str = "",
    to_date: str = "",
    page: int = 1,
    size: int = 50,
    _: dict = Depends(require("goat.read")),
):
    where, args = [], []
    if status:
        where.append("status = ?")
        args.append(status)
    if sex:
        where.append("sex = ?")
        args.append(sex)
    if barn:
        where.append("barn = ?")
        args.append(barn)
    if from_date:
        where.append("birth_date <= ?")
        args.append(from_date)
    if to_date:
        where.append("birth_date >= ?")
        args.append(to_date)
    if q:
        where.append("(tag_no LIKE ? OR name LIKE ? OR dam_tag LIKE ? OR note LIKE ?)")
        args += [f"%{q}%"] * 4
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    total = db.scalar(f"SELECT COUNT(*) FROM goat{clause}", tuple(args), 0)
    pages = max(1, (total + size - 1) // size)
    page = max(1, min(page, pages))
    rs = db.rows(
        f"SELECT * FROM goat{clause} ORDER BY tag_no LIMIT ? OFFSET ?",
        tuple(args) + (size, (page - 1) * size),
    )
    items = [_goat_dict(r) for r in rs]
    if grp:
        items = [i for i in items if i["group"] == grp]
    return {"items": items, "total": total, "page": page, "pages": pages, "size": size}


@router.get("/goats/{gid}")
def goat_detail(gid: int, _: dict = Depends(require("goat.read"))):
    g = db.row("SELECT * FROM goat WHERE id=?", (gid,))
    if g is None:
        raise HTTPException(404, "羊只档案不存在")
    d = _goat_dict(g)
    evs = db.rows(
        "SELECT e.*, u.full_name AS user_name FROM goat_event e"
        " LEFT JOIN users u ON u.id = e.user_id"
        " WHERE e.goat_id=? ORDER BY e.event_date DESC, e.id DESC LIMIT 300", (gid,)
    )
    d["events"] = [
        {**dict(e), "type_name": rules.EVENT_TYPES.get(e["type"], e["type"])} for e in evs
    ]
    d["kids"] = [dict(r) for r in db.rows(
        "SELECT tag_no, sex, birth_date, status FROM goat WHERE dam_tag=? ORDER BY birth_date", (g["tag_no"],))]
    d["parent_info"] = {}
    for rel in ("dam_tag", "sire_tag"):
        tag = g[rel]
        p = db.row("SELECT tag_no, birth_date, sex, status FROM goat WHERE tag_no=?", (tag,)) if tag else None
        if p:
            d["parent_info"][rel] = {**dict(p), "age_text": rules.age_text(p["birth_date"]),
                                     "group_name": rules.GROUP_NAME.get(group_of(p), "")}
    return d


@router.post("/goats")
def create_goat(body: GoatIn, user: dict = Depends(require("goat.write"))):
    tag = body.tag_no.strip()
    if db.row("SELECT 1 FROM goat WHERE tag_no=?", (tag,)):
        raise HTTPException(400, f"耳标号 {tag} 已存在")
    if body.sex not in ("f", "m"):
        raise HTTPException(400, "性别只能是 f 或 m")
    if body.status not in rules.GOAT_STATUS:
        raise HTTPException(400, "状态不合法")
    with db.tx():
        gid = db.insert(
            "INSERT INTO goat (tag_no,name,sex,breed,birth_date,birth_weight,source,buy_price,"
            "sire_tag,dam_tag,barn,first_kidding,milk_role,status,status_date,exit_reason,"
            "exit_price,weaned_date,note,created_at,created_by)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tag, body.name, body.sex, body.breed, body.birth_date, body.birth_weight, body.source,
             body.buy_price, body.sire_tag, body.dam_tag, body.barn, body.first_kidding,
             body.milk_role, body.status, body.status_date, body.exit_reason, body.exit_price,
             body.weaned_date, body.note, db.now(), user["id"]),
        )
        if body.status == "alive":
            etype = "birth" if body.source == "自繁" else "purchase"
            db.insert(
                "INSERT INTO goat_event (goat_id,event_date,type,barn,weight,amount,note,user_id,created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (gid, body.birth_date if etype == "birth" else (body.status_date or today_str()),
                 etype, body.barn, body.birth_weight, body.buy_price,
                 "建档" if etype == "purchase" else "出生建档", user["id"], db.now()),
            )
        else:
            db.insert(
                "INSERT INTO goat_event (goat_id,event_date,type,amount,note,user_id,created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (gid, body.status_date or today_str(), body.status, body.exit_price,
                 body.exit_reason or "建档即离场", user["id"], db.now()),
            )
    return {"id": gid}


@router.put("/goats/{gid}")
def update_goat(gid: int, body: GoatPatch, user: dict = Depends(require("goat.write"))):
    g = db.row("SELECT * FROM goat WHERE id=?", (gid,))
    if g is None:
        raise HTTPException(404, "羊只档案不存在")
    data = body.model_dump(exclude_none=True)
    if "tag_no" in data:
        dup = db.row("SELECT 1 FROM goat WHERE tag_no=? AND id<>?", (data["tag_no"], gid))
        if dup:
            raise HTTPException(400, "耳标号已存在")
    if not data:
        return {"ok": True}
    sets = ", ".join(f"{k}=?" for k in data)
    with db.tx():
        db.execute(f"UPDATE goat SET {sets} WHERE id=?", tuple(data.values()) + (gid,))
        if {"status", "status_date"} & set(data):
            new_status = data.get("status", g["status"])
            new_date = data.get("status_date", g["status_date"]) or today_str()
            db.insert(
                "INSERT INTO goat_event (goat_id,event_date,type,amount,note,user_id,created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (gid, new_date, new_status, g["exit_price"] or 0,
                 data.get("exit_reason", g["exit_reason"]) or "档案状态变更", user["id"], db.now()),
            )
    return {"ok": True}


@router.delete("/goats/{gid}")
def delete_goat(gid: int, _: dict = Depends(require("goat.write"))):
    n = db.scalar("SELECT COUNT(*) FROM goat_event WHERE goat_id=?", (gid,), 0)
    if n > 1:
        raise HTTPException(400, "该羊已有事件记录，建议改为「离场/淘汰」而非删除")
    db.execute("DELETE FROM goat_event WHERE goat_id=?", (gid,))
    db.execute("DELETE FROM goat WHERE id=?", (gid,))
    return {"ok": True}


# ---------------- 事件 ----------------
@router.get("/goats/{gid}/events")
def goat_events(gid: int, limit: int = 200, _: dict = Depends(require("goat.read"))):
    rs = db.rows(
        "SELECT e.*, u.full_name AS user_name FROM goat_event e"
        " LEFT JOIN users u ON u.id=e.user_id WHERE e.goat_id=?"
        " ORDER BY e.event_date DESC, e.id DESC LIMIT ?", (gid, limit))
    return {"items": [{**dict(r), "type_name": rules.EVENT_TYPES.get(r["type"], r["type"])} for r in rs]}


EXIT_MAP = {"sale": "sold", "death": "dead", "cull": "cull", "loan_out": "loan"}


@router.post("/goats/{gid}/events")
def add_event(gid: int, body: EventIn, user: dict = Depends(require("goat.write"))):
    g = db.row("SELECT * FROM goat WHERE id=?", (gid,))
    if g is None:
        raise HTTPException(404, "羊只档案不存在")
    if body.type not in rules.EVENT_TYPES:
        raise HTTPException(400, "事件类型不合法")
    if body.event_date > today_str():
        raise HTTPException(400, "事件日期不能晚于今天")

    with db.tx():
        db.insert(
            "INSERT INTO goat_event (goat_id,event_date,type,barn,weight,amount,milk_qty,batch,note,user_id,created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (gid, body.event_date, body.type, body.barn, body.weight, body.amount,
             body.milk_qty, body.batch, body.note, user["id"], db.now()),
        )
        if body.type == "weigh" and body.weight:
            db.execute("UPDATE goat SET birth_weight=COALESCE(birth_weight, ?) WHERE id=? AND birth_weight IS NULL",
                       (body.weight, gid))
        elif body.type == "kidding":
            db.execute("UPDATE goat SET first_kidding=COALESCE(first_kidding, ?) WHERE id=?",
                       (body.event_date, gid))
        elif body.type == "wean":
            db.execute("UPDATE goat SET weaned_date=? WHERE id=?", (body.event_date, gid))
        elif body.type == "milk_dry":
            db.execute("UPDATE goat SET milk_role='干奶' WHERE id=?", (gid,))
        elif body.type == "transfer" and body.barn:
            db.execute("UPDATE goat SET barn=? WHERE id=?", (body.barn, gid))
        elif body.type in EXIT_MAP:
            db.execute("UPDATE goat SET status=?, status_date=?, exit_price=?, exit_reason=? WHERE id=?",
                       (EXIT_MAP[body.type], body.event_date, body.amount, body.note, gid))
            if body.type == "sale" and body.amount > 0:
                _auto_sale_txn(g["tag_no"], body.event_date, body.amount,
                               body.note or "出售 " + g["tag_no"], user["id"])
        # 产羔自动建档
        if body.type == "kidding" and body.kid_tag_no.strip():
            kt = body.kid_tag_no.strip()
            if db.row("SELECT 1 FROM goat WHERE tag_no=?", (kt,)):
                raise HTTPException(400, f"羔羊耳标号 {kt} 已存在")
            kid_id = db.insert(
                "INSERT INTO goat (tag_no,sex,birth_date,birth_weight,source,dam_tag,sire_tag,barn,"
                "status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,'alive',?,?)",
                (kt, body.kid_sex, body.event_date, body.kid_weight, "自繁",
                 g["tag_no"], g["sire_tag"], body.barn or g["barn"], db.now(), user["id"]),
            )
            db.insert(
                "INSERT INTO goat_event (goat_id,event_date,type,weight,note,user_id,created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (kid_id, body.event_date, "birth", body.kid_weight,
                 f"母羊 {g['tag_no']} 产羔", user["id"], db.now()),
            )
    return {"ok": True}


# ---------------- 存栏统计 ----------------
@router.get("/herd/summary")
def herd_summary(on: str = "", _: dict = Depends(require("goat.read"))):
    on = on or today_str()
    rs = db.rows(
        "SELECT id, sex, birth_date, barn, first_kidding, milk_role, note FROM goat"
        " WHERE status='alive' AND birth_date<=?", (on,))
    matrix = {c: {"f": 0, "m": 0} for c in rules.GROUP_ORDER}
    for r in rs:
        c = group_of(r, on)
        matrix[c][r["sex"]] += 1
    total_f = sum(v["f"] for v in matrix.values())
    total_m = sum(v["m"] for v in matrix.values())
    milk_heads = matrix["milking"]["f"]
    barn_map: dict[str, int] = {}
    for r in rs:
        b = r["barn"] or "未分栏"
        barn_map[b] = barn_map.get(b, 0) + 1
    return {
        "date": on,
        "total": total_f + total_m,
        "female": total_f,
        "male": total_m,
        "milking_heads": milk_heads,
        "matrix": [
            {"code": c, "name": rules.GROUP_NAME[c],
             "f": matrix[c]["f"], "m": matrix[c]["m"], "total": matrix[c]["f"] + matrix[c]["m"]}
            for c in rules.GROUP_ORDER
        ],
        "barns": sorted(({"name": k, "count": v} for k, v in barn_map.items()),
                        key=lambda x: -x["count"]),
    }


@router.get("/herd/trend")
def herd_trend(days: int = 60, _: dict = Depends(require("goat.read"))):
    """存栏量历史曲线：出生 +1、离场 -1，按日重放。"""
    end = date.today()
    start = end - timedelta(days=max(1, min(days, 730)) - 1)
    s, e = fmt(start), fmt(end)

    births = db.rows(
        "SELECT birth_date AS d, COUNT(*) AS n FROM goat WHERE birth_date BETWEEN ? AND ?"
        " GROUP BY birth_date", (s, e))
    exits = db.rows(
        "SELECT status_date AS d, COUNT(*) AS n FROM goat"
        " WHERE status<>'alive' AND status_date BETWEEN ? AND ? GROUP BY status_date", (s, e))

    base = db.scalar(
        "SELECT COUNT(*) FROM goat WHERE birth_date < ? AND"
        " (status='alive' OR (status_date IS NULL OR status_date >= ?))", (s, s), 0)
    delta: dict[str, int] = {}
    for r in births:
        delta[r["d"]] = delta.get(r["d"], 0) + r["n"]
    for r in exits:
        delta[r["d"]] = delta.get(r["d"], 0) - r["n"]

    series, cur = [], base
    d = start
    while d <= end:
        cur += delta.get(fmt(d), 0)
        series.append({"date": fmt(d), "total": cur})
        d += timedelta(days=1)

    male_ratio = db.scalar(
        "SELECT AVG(sex='m') FROM goat WHERE status='alive'", (), 0) or 0
    return {
        "series": series,
        "change_30d": (series[-1]["total"] - series[0]["total"]) if series else 0,
        "male_ratio": round(male_ratio * 100, 1),
        "start": s, "end": e,
    }


@router.get("/herd/age-matrix")
def age_matrix(_: dict = Depends(require("goat.read"))):
    """日龄结构矩阵，用于判断群结构是否合理。"""
    buckets = [(0, 60, "0-2月"), (60, 120, "2-4月"), (120, 180, "4-6月"),
               (180, 270, "6-9月"), (270, 365, "9-12月"), (365, 548, "1-1.5年"),
               (548, 1095, "1.5-3年"), (1095, 99999, "3年以上")]
    on = today_str()
    rs = db.rows("SELECT sex, birth_date FROM goat WHERE status='alive'")
    out = []
    for lo, hi, label in buckets:
        cnt = {"f": 0, "m": 0}
        for r in rs:
            a = rules.age_days(r["birth_date"], on)
            if lo <= a < hi:
                cnt[r["sex"]] += 1
        out.append({"label": label, "f": cnt["f"], "m": cnt["m"],
                    "total": cnt["f"] + cnt["m"]})
    return {"buckets": out}


@router.get("/herd/movements")
def movements(days: int = 14, _: dict = Depends(require("goat.read"))):
    """存栏动态变化明细（出入场流水）。"""
    since = fmt(date.today() - timedelta(days=max(1, days) - 1))
    in_rows = db.rows(
        "SELECT g.tag_no, g.sex, g.birth_date, g.barn, 'in' AS io, MIN(e.event_date) AS d"
        " FROM goat g JOIN goat_event e ON e.goat_id=g.id"
        " WHERE e.event_date>=? AND e.type IN ('birth','purchase')"
        " GROUP BY g.id ORDER BY d DESC", (since,))
    out_rows = db.rows(
        "SELECT g.tag_no, g.sex, g.birth_date, g.barn, 'out' AS io, e.event_date AS d, e.type,"
        " e.amount, e.note FROM goat g JOIN goat_event e ON e.goat_id=g.id"
        " WHERE e.event_date>=? AND e.type IN ('sale','death','cull','loan_out')"
        " ORDER BY e.event_date DESC", (since,))
    items = []
    for r in list(in_rows) + list(out_rows):
        d = dict(r)
        d["io_name"] = "入场" if d["io"] == "in" else "离场"
        d["type_name"] = rules.EVENT_TYPES.get(d.get("type"), "出生" if d["io"] == "in" else "")
        d["age_text"] = rules.age_text(d["birth_date"], d["d"])
        items.append(d)
    items.sort(key=lambda x: (x["d"], x["io"]), reverse=True)
    return {"since": since, "items": items[:300],
            "in_count": len(in_rows), "out_count": len(out_rows)}


@router.get("/herd/alerts")
def alerts(_: dict = Depends(require("goat.read"))):
    """饲养预警：待配种、产羔临近、该断奶、久未称重、公母比例。"""
    on = today_str()
    rs = db.rows(
        "SELECT id, tag_no, sex, birth_date, barn, first_kidding, milk_role, note FROM goat"
        " WHERE status='alive'")
    res = {"待配种": [], "产羔临近": [], "待断奶": [], "久未称重": [], "种公羊不足": []}

    for r in rs:
        a = rules.age_days(r["birth_date"], on)
        d = dict(r)
        if r["sex"] == "f" and 365 <= a < 500 and not r["first_kidding"]:
            res["待配种"].append(d)
        if r["first_kidding"] and r["milk_role"] != "干奶":
            gap = rules.days_between(r["first_kidding"], on)
            if 120 <= gap <= 150:
                res["产羔临近"].append({**d, "gap": gap})
        if a >= 75 and a <= 100 and not db.row(
                "SELECT 1 FROM goat_event WHERE goat_id=? AND type='wean'", (r["id"],)):
            res["待断奶"].append(d)

    rs2 = db.rows("SELECT id, tag_no, sex, birth_date FROM goat WHERE status='alive' AND sex='m'")
    for r in rs2:
        last = db.row(
            "SELECT MAX(event_date) AS d FROM goat_event WHERE goat_id=? AND type='weigh'", (r["id"],))
        if last and last["d"]:
            if rules.days_between(last["d"], on) > 90:
                res["久未称重"].append({**dict(r), "last_weigh": last["d"],
                                        "gap": rules.days_between(last["d"], on)})
    female = sum(1 for r in rs if r["sex"] == "f")
    male = sum(1 for r in rs if r["sex"] == "m")
    if male and female / male > 25:
        res["种公羊不足"] = [{"female": female, "male": male,
                             "ratio": round(female / male, 1), "suggest": max(1, female // 25 - male)}]
    return {k: v[:50] for k, v in res.items()}
