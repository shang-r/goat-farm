"""密码哈希与登录令牌（仅用标准库）。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from . import db

PBKDF2_ROUNDS = 200_000
TOKEN_TTL = 60 * 60 * 12  # 12 小时

ROLES = {
    "admin": "管理员",
    "keeper": "饲养员",
    "finance": "会计",
    "boss": "场长",
}

# 权限矩阵：模块 -> 允许的角色
PERMISSIONS = {
    "goat.read":  {"admin", "boss", "keeper", "finance"},
    "goat.write": {"admin", "boss", "keeper"},
    "milk.read":  {"admin", "boss", "keeper", "finance"},
    "milk.write": {"admin", "boss", "keeper"},
    "fin.read":   {"admin", "boss", "finance"},
    "fin.write":  {"admin", "finance"},
    "rep.read":   {"admin", "boss", "finance"},
    "sys.write":  {"admin"},
}


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return dk.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    calc, _ = hash_password(password, salt)
    return hmac.compare_digest(calc, password_hash)


def make_token(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + TOKEN_TTL}"
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}"


def read_token(token: str) -> int | None:
    try:
        uid, exp, sig = token.rsplit(".", 2)
        payload = f"{uid}.{exp}"
        expect = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(expect, sig):
            return None
        if int(exp) < time.time():
            return None
        return int(uid)
    except (ValueError, TypeError):
        return None


def _secret() -> bytes:
    val = db.scalar("SELECT value FROM setting WHERE key='auth_secret'")
    if not val:
        val = secrets.token_hex(32)
        # SQLite / PostgreSQL 通用的 UPSERT 语法
        db.execute(
            "INSERT INTO setting (key, value) VALUES ('auth_secret', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (val,)
        )
    return val.encode()


def can(role: str, perm: str) -> bool:
    return role in PERMISSIONS.get(perm, set())
