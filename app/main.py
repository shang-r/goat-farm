"""FastAPI 应用入口。"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, seed
from .api import auth, dashboard, finance, goats, milk, reports

log = logging.getLogger("goat")
STATIC = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    info = seed.seed()
    log.info("数据库就绪: %s", db.DB_PATH)
    if info.get("admin"):
        log.warning("已创建初始管理员 admin / %s，请登录后立即修改密码", info["default_password"])
    yield
    db.close_conn()


app = FastAPI(title="奶山羊养殖场管理系统", version="1.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.exception_handler(StarletteHTTPException)
async def http_err(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def val_err(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", [])[1:]) or "参数"
    return JSONResponse({"detail": f"{loc}：{first.get('msg', '格式不正确')}"}, status_code=422)


@app.exception_handler(Exception)
async def any_err(request: Request, exc: Exception):
    log.exception("未处理异常 %s %s", request.method, request.url.path)
    return JSONResponse({"detail": f"服务器内部错误：{exc}"}, status_code=500)


app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(goats.router)
app.include_router(milk.router)
app.include_router(finance.router)
app.include_router(reports.router)


@app.get("/api/health")
def health():
    n = db.scalar("SELECT COUNT(*) FROM goat WHERE status='alive'", (), 0)
    return {"ok": True, "goats_alive": n, "db": str(db.DB_PATH)}


@app.get("/", include_in_schema=False)
def index():
    # 必须用 HTMLResponse：直接 return str 会被 FastAPI 当成 JSON 序列化，
    # 浏览器收到 application/json 的转义字符串，页面就是坏的。
    return HTMLResponse((STATIC / "index.html").read_text(encoding="utf-8"))


app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
