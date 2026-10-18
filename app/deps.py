"""FastAPI 依赖：当前用户与权限校验。"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from . import db, security


def current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        token = request.query_params.get("token", "")
    if not token:
        raise HTTPException(401, "未登录")
    uid = security.read_token(token)
    if uid is None:
        raise HTTPException(401, "登录已过期，请重新登录")
    u = db.row(
        "SELECT id, username, full_name, role, active FROM users WHERE id=?", (uid,)
    )
    if u is None or not u["active"]:
        raise HTTPException(401, "账号不存在或已停用")
    return dict(u)


def require(perm: str):
    """依赖注入：要求当前用户具备某权限。"""

    def _dep(user: dict = Depends(current_user)) -> dict:
        if not security.can(user["role"], perm):
            raise HTTPException(403, "没有该操作权限")
        return user

    return _dep
