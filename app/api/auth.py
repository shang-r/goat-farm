"""登录、用户管理、系统设置。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, security
from ..deps import current_user, require

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=100)


class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=4, max_length=100)
    full_name: str = ""
    role: str = "keeper"
    phone: str = ""


class PasswordIn(BaseModel):
    old_password: str = ""
    new_password: str = Field(min_length=4, max_length=100)


class SettingIn(BaseModel):
    items: dict[str, str]


def _public(u) -> dict:
    return {
        "id": u["id"],
        "username": u["username"],
        "full_name": u["full_name"],
        "role": u["role"],
        "role_name": security.ROLES.get(u["role"], u["role"]),
        "phone": u["phone"] if "phone" in u.keys() else "",
    }


@router.post("/auth/login")
def login(body: LoginIn):
    u = db.row("SELECT * FROM users WHERE username=?", (body.username.strip(),))
    if u is None or not security.verify_password(body.password, u["password_hash"], u["salt"]):
        raise HTTPException(400, "用户名或密码不正确")
    if not u["active"]:
        raise HTTPException(403, "账号已停用，请联系管理员")
    db.execute("UPDATE users SET last_login_at=? WHERE id=?", (db.now(), u["id"]))
    return {"token": security.make_token(u["id"]), "user": _public(u)}


@router.post("/auth/logout")
def logout(_: dict = Depends(current_user)):
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(current_user)):
    perms = {m: security.can(user["role"], m) for m in security.PERMISSIONS}
    return {"user": user, "permissions": perms, "must_change_password": False}


@router.get("/auth/users")
def list_users(_: dict = Depends(require("sys.write"))):
    us = db.rows("SELECT * FROM users ORDER BY id")
    return {"items": [_public(u) | {"active": u["active"],
                                     "last_login_at": u["last_login_at"],
                                     "created_at": u["created_at"]} for u in us]}


@router.post("/auth/users")
def create_user(body: UserIn, _: dict = Depends(require("sys.write"))):
    if body.role not in security.ROLES:
        raise HTTPException(400, "角色不合法")
    if db.row("SELECT 1 FROM users WHERE username=?", (body.username.strip(),)):
        raise HTTPException(400, "用户名已存在")
    h, s = security.hash_password(body.password)
    uid = db.insert(
        "INSERT INTO users (username, password_hash, salt, full_name, role, phone, created_at)"
        " VALUES (?,?,?,?,?,?,?)",
        (body.username.strip(), h, s, body.full_name or body.username, body.role, body.phone, db.now()),
    )
    return {"id": uid}


@router.put("/auth/users/{uid}")
def update_user(uid: int, body: UserIn, _: dict = Depends(require("sys.write"))):
    u = db.row("SELECT * FROM users WHERE id=?", (uid,))
    if u is None:
        raise HTTPException(404, "用户不存在")
    if body.role not in security.ROLES:
        raise HTTPException(400, "角色不合法")
    if body.password:
        h, s = security.hash_password(body.password)
        db.execute(
            "UPDATE users SET full_name=?, role=?, phone=?, password_hash=?, salt=? WHERE id=?",
            (body.full_name, body.role, body.phone, h, s, uid),
        )
    else:
        db.execute("UPDATE users SET full_name=?, role=?, phone=? WHERE id=?",
                   (body.full_name, body.role, body.phone, uid))
    return {"ok": True}


@router.delete("/auth/users/{uid}")
def disable_user(uid: int, _: dict = Depends(require("sys.write"))):
    me_ = db.row("SELECT role FROM users WHERE username='admin' AND active=1")
    if uid == 1:
        raise HTTPException(400, "不能停用初始管理员")
    db.execute("UPDATE users SET active=0 WHERE id=?", (uid,))
    return {"ok": True}


@router.post("/auth/password")
def change_password(body: PasswordIn, user: dict = Depends(current_user)):
    u = db.row("SELECT * FROM users WHERE id=?", (user["id"],))
    if not security.verify_password(body.old_password, u["password_hash"], u["salt"]):
        raise HTTPException(400, "原密码不正确")
    h, s = security.hash_password(body.new_password)
    db.execute("UPDATE users SET password_hash=?, salt=?, must_change=0 WHERE id=?",
               (h, s, user["id"]))
    return {"ok": True}


@router.get("/settings")
def get_settings(_: dict = Depends(current_user)):
    return {"items": {r["key"]: r["value"] for r in db.rows("SELECT * FROM setting")}}


@router.put("/settings")
def put_settings(body: SettingIn, _: dict = Depends(require("sys.write"))):
    with db.tx():
        for k, v in body.items.items():
            db.execute("INSERT INTO setting (key, value) VALUES (?,?) "
                       "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(v)))
    return {"ok": True}
