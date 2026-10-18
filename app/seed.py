"""初始化基础数据：账户、收支科目、栋舍、首个管理员。"""
from __future__ import annotations

import os

from . import db, security
from .rules import today_str

ACCOUNTS = [
    ("现金", "cash", 1, "场部备用金"),
    ("银行账户", "bank", 1, "养殖场基本户"),
    ("微信/支付宝", "wechat", 1, "零星收付"),
    ("应收账款", "receivable", 1, "客户欠款台账"),
    ("应付账款", "payable", 1, "供应商欠款台账"),
]

# (名称, 方向, 分组, 影响损益, 排序)
CATEGORIES = [
    ("卖奶收入", "income", "主营业务", 1, 1),
    ("卖羊收入", "income", "主营业务", 1, 2),
    ("羔羊收入", "income", "主营业务", 1, 3),
    ("淘汰羊变现", "income", "主营业务", 1, 4),
    ("补贴收入", "income", "其他收益", 1, 10),
    ("资产处置", "income", "其他收益", 1, 11),
    ("其他收入", "income", "其他收益", 1, 99),

    ("精饲料", "expense", "饲料", 1, 1),
    ("青贮/粗饲料", "expense", "饲料", 1, 2),
    ("草料", "expense", "饲料", 1, 3),
    ("添加剂", "expense", "饲料", 1, 4),
    ("兽药疫苗", "expense", "防疫医疗", 1, 10),
    ("治疗费", "expense", "防疫医疗", 1, 11),
    ("防疫驱虫", "expense", "防疫医疗", 1, 12),
    ("配种费", "expense", "繁殖", 1, 15),
    ("人工费", "expense", "生产费用", 1, 20),
    ("水电费", "expense", "生产费用", 1, 21),
    ("维修费", "expense", "生产费用", 1, 22),
    ("运费", "expense", "生产费用", 1, 23),
    ("防疫用品", "expense", "生产费用", 1, 24),
    ("租金", "expense", "生产费用", 1, 25),
    ("折旧摊销", "expense", "生产费用", 1, 26),
    ("奶品加工费", "expense", "生产费用", 1, 27),
    ("销售费用", "expense", "生产费用", 1, 28),
    ("办公/杂项", "expense", "管理费用", 1, 40),
    ("税费", "expense", "管理费用", 1, 41),
    ("利息支出", "expense", "管理费用", 1, 42),

    ("借款", "income", "资金往来", 0, 60),
    ("还款", "expense", "资金往来", 0, 60),
    ("股东投入", "income", "资金往来", 0, 60),
    ("内部转账", "expense", "资金往来", 0, 61),
    ("内部转账", "income", "资金往来", 0, 61),
    ("提取现金", "expense", "资金往来", 0, 61),
    ("提取现金", "income", "资金往来", 0, 61),
    ("应收收回", "expense", "资金往来", 0, 62),
    ("应收收回", "income", "资金往来", 0, 62),
    ("应付支付", "expense", "资金往来", 0, 63),
    ("应付支付", "income", "资金往来", 0, 63),
]

DEFAULT_SETTINGS = {
    "farm_name": "奶山羊养殖场",
    "owner": "",
    "milking_target_kg": "3.0",       # 经产母羊日单产目标(kg)
    "milk_sell_price": "5.0",         # 生鲜奶参考单价(元/kg)
    "warn_low_stock_days": "7",
}


def seed() -> dict:
    created = {"accounts": 0, "categories": 0, "settings": 0, "admin": False}
    t = today_str()

    for name, kind, sign, note in ACCOUNTS:
        if not db.row("SELECT 1 FROM accounts WHERE name=?", (name,)):
            db.execute(
                "INSERT INTO accounts (name, kind, sign, opening_balance, opening_date, note, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (name, kind, sign, 0.0, t, note, db.now()),
            )
            created["accounts"] += 1

    for name, kind, grp, affect, sort in CATEGORIES:
        if not db.row("SELECT 1 FROM categories WHERE name=? AND kind=?", (name, kind)):
            db.execute(
                "INSERT INTO categories (name, kind, group_name, affect, sort) VALUES (?,?,?,?,?)",
                (name, kind, grp, affect, sort),
            )
            created["categories"] += 1

    for k, v in DEFAULT_SETTINGS.items():
        if not db.row("SELECT 1 FROM setting WHERE key=?", (k,)):
            db.execute("INSERT INTO setting (key, value) VALUES (?,?)", (k, v))
            created["settings"] += 1

    if not db.row("SELECT 1 FROM users LIMIT 1"):
        pwd = os.environ.get("GOAT_ADMIN_PASSWORD", "goat2024")
        h, s = security.hash_password(pwd)
        db.execute(
            "INSERT INTO users (username, password_hash, salt, full_name, role, created_at, must_change)"
            " VALUES (?,?,?,?,?,?,1)",
            ("admin", h, s, "场长", "admin", db.now()),
        )
        created["admin"] = True
        created["default_password"] = pwd
    return created
