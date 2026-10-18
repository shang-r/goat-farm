"""业务规则：日龄、存栏分组、单产、日期工具。"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

# 存栏分组定义：(code, 名称, 最小日龄, 最大日龄, 适用性别, 是否泌乳群)
# 日龄含边界；max_days=None 表示不限
GROUPS: list[tuple[str, str, int, int | None, str, bool]] = [
    ("lamb",        "羔羊",     0,    59,  "all", False),
    ("youth",       "育成羊",   60,   179, "all", False),
    ("young",       "青年羊",   180,  364, "all", False),
    ("milking",     "经产泌乳", 365, None, "f",   True),
    ("dry",         "干奶母羊", 365, None, "f",   False),
    ("buck",        "种公羊",   365, None, "m",   False),
    ("buck_try",    "试情公羊", 60,  364, "m",   False),
]

GROUP_NAME = {g[0]: g[1] for g in GROUPS}
GROUP_ORDER = [g[0] for g in GROUPS]
MILKING_CODES = {g[0] for g in GROUPS if g[5]}

MILK_BATCHES = ["生鲜奶", "巴氏奶", "酸奶", "奶酪", "乳饮料", "奶粉原料"]
MILK_GROUPS = ["全群", "经产泌乳群", "新产群", "干奶群", "育成群", "仔羊群"]
GOAT_STATUS = {"alive": "在场", "sold": "已售", "dead": "死亡", "cull": "淘汰", "loan": "外借"}

EVENT_TYPES = {
    "birth": "出生", "purchase": "购入", "sale": "售出", "death": "死亡", "cull": "淘汰",
    "loan_out": "外借", "transfer": "转群", "weigh": "称重", "vaccine": "防疫",
    "treat": "治疗", "breed": "配种", "kidding": "产羔", "wean": "断奶",
    "milk_dry": "干奶", "note": "备注",
}
EVENT_TYPES_NEED_WEIGHT = {"weigh", "birth"}
EVENT_TYPES_NEED_AMOUNT = {"purchase", "sale", "cull"}

EVENT_TYPE_OPTIONS = [
    {"code": "weigh", "label": "称重", "icon": "⚖", "fields": ["weight"], "cats": []},
    {"code": "vaccine", "label": "防疫/驱虫", "icon": "💉", "fields": ["note"], "cats": ["疫苗", "驱虫药"]},
    {"code": "treat", "label": "治疗", "icon": "🩺", "fields": ["note"], "cats": ["治疗费"]},
    {"code": "breed", "label": "配种", "icon": "🐑", "fields": ["note"], "cats": ["配种费"]},
    {"code": "kidding", "label": "产羔", "icon": "🍼", "fields": ["weight", "milk_qty"], "cats": []},
    {"code": "transfer", "label": "转群/调栏", "icon": "🔄", "fields": ["barn"], "cats": []},
    {"code": "sale", "label": "售出", "icon": "💰", "fields": ["amount", "note"], "cats": ["卖羊收入"]},
    {"code": "death", "label": "死亡", "icon": "⚰", "fields": ["note"], "cats": []},
    {"code": "cull", "label": "淘汰", "icon": "🚫", "fields": ["amount", "note"], "cats": []},
    {"code": "loan_out", "label": "外借", "icon": "📤", "fields": ["note"], "cats": []},
    {"code": "wean", "label": "断奶", "icon": "🌾", "fields": ["weight"], "cats": []},
    {"code": "milk_dry", "label": "干奶", "icon": "🧊", "fields": ["note"], "cats": []},
    {"code": "note", "label": "备注", "icon": "📝", "fields": ["note"], "cats": []},
]


def parse_date(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def fmt(d: date) -> str:
    return d.isoformat()


def today_str() -> str:
    return date.today().isoformat()


def month_str(d: str) -> str:
    return d[:7]


def days_between(a: str, b: str) -> int:
    return (parse_date(b) - parse_date(a)).days


def age_days(birth: str, on: str | None = None) -> int:
    return days_between(birth, on or today_str())


def age_text(birth: str, on: str | None = None) -> str:
    d = max(0, age_days(birth, on))
    if d < 60:
        return f"{d}天"
    if d < 730:
        return f"{d // 30}月{d % 30}天" if d % 30 else f"{d // 30}月龄"
    return f"{d // 365}岁{(d % 365) // 30}月"


def group_of(goat: sqlite3.Row | dict, on: str | None = None) -> str:
    """按日龄 + 性别 + 产羔史判定存栏分组。"""
    g = dict(goat)
    sex = g.get("sex") or "f"
    days = age_days(g["birth_date"], on)
    if sex == "m":
        if days < 60:
            return "lamb"
        if days < 365:
            return "buck_try"
        return "buck"
    if days < 60:
        return "lamb"
    if days < 180:
        return "youth"
    if days < 365:
        return "young"
    first_kidding = g.get("first_kidding")
    if first_kidding and days_between(first_kidding, on or today_str()) >= 0:
        role = g.get("milk_role") or ""
        if "干奶" in role or "干奶" in str(g.get("note") or ""):
            return "dry"
        return "milking"
    return "young"


def group_sort_key(code: str) -> int:
    return GROUP_ORDER.index(code) if code in GROUP_ORDER else 99


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return date(y, m, day)


def period_range(kind: str, anchor: str | None = None) -> tuple[str, str]:
    """kind: today/week/month/quarter/year/prev_month/last_30 返回起止日期。"""
    d = parse_date(anchor) if anchor else date.today()
    if kind == "today":
        return fmt(d), fmt(d)
    if kind == "week":
        return fmt(d - timedelta(days=d.weekday())), fmt(d)
    if kind == "month":
        return fmt(d.replace(day=1)), fmt(add_months(d.replace(day=1), 1) - timedelta(days=1))
    if kind == "quarter":
        q0 = d.replace(month=3 * ((d.month - 1) // 3) + 1, day=1)
        return fmt(q0), fmt(add_months(q0, 3) - timedelta(days=1))
    if kind == "year":
        return f"{d.year}-01-01", f"{d.year}-12-31"
    if kind == "prev_month":
        first = d.replace(day=1) - timedelta(days=1)
        return fmt(first.replace(day=1)), fmt(first)
    if kind == "last_30":
        return fmt(d - timedelta(days=29)), fmt(d)
    return fmt(d - timedelta(days=29)), fmt(d)


def month_list(start: str, end: str) -> list[str]:
    out, cur = [], parse_date(start).replace(day=1)
    last = parse_date(end).replace(day=1)
    while cur <= last:
        out.append(fmt(cur)[:7])
        cur = add_months(cur, 1)
    return out
