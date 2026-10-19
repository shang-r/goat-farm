"""双后端数据库层：本地 SQLite，云端 PostgreSQL（Render）。

自动根据环境变量 DATABASE_URL 选择后端：
- 未设置 DATABASE_URL → SQLite（本地开发，默认 data/farm.db）
- 设置 DATABASE_URL（postgres://...）→ PostgreSQL（Render 云端，数据持久保存）

API 层无需改动：rows / row / scalar / execute / insert / tx 接口保持兼容。
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("GOAT_DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.environ.get("GOAT_DB_PATH", DATA_DIR / "farm.db"))
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_PG = DATABASE_URL.startswith("postgres")

if IS_PG:
    import psycopg2
    import psycopg2.extras

_local = threading.local()


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ---------- PostgreSQL SQL 翻译 ----------

def _translate_strftime(m):
    fmt = (m.group(2) or m.group(3) or "").replace("'", "").replace('"', "")
    col = m.group(4)
    if fmt == "%Y-%m-%d":
        return col
    if fmt == "%Y-%m":
        return f"LEFT({col}, 7)"
    if fmt == "%Y-W%W":
        return f"TO_CHAR({col}::DATE, 'YYYY-\"W\"WW')"
    return m.group(0)


_STRFTIME_RE = re.compile(r"strftime\(\s*('([^']*)'|\"([^\"]*)\")\s*,\s*([\w.]+)\s*\)")


def _translate(sql: str) -> str:
    """SQLite SQL → PostgreSQL SQL（仅 PG 模式生效）。"""
    if not IS_PG:
        return sql
    sql = _STRFTIME_RE.sub(_translate_strftime, sql)
    sql = sql.replace("%", "%%")   # 字面 % 转义：Postgres 下 %% 表示 %
    sql = sql.replace("?", "%s")   # 占位符
    return sql


def _translate_schema(text: str) -> str:
    text = re.sub(r"INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY", text)
    text = re.sub(r"PRAGMA [^;]*;", "", text)
    return text


# ---------- 连接 ----------

class PG_Row(dict):
    """兼容 sqlite3.Row：既支持 r['col'] 也支持 r[0]。"""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return dict.__getitem__(self, key)


def get_conn():
    conn = getattr(_local, "conn", None)
    if conn is None:
        if IS_PG:
            conn = psycopg2.connect(DATABASE_URL)
            conn.autocommit = True
        else:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(DB_PATH, timeout=15.0, isolation_level=None)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 10000")
        _local.conn = conn
    return conn


def close_conn() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def rows(sql: str, params: tuple | dict = ()):
    conn = get_conn()
    if IS_PG:
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(_translate(sql), params)
        return [PG_Row(r) for r in cur.fetchall()]
    return conn.execute(sql, params).fetchall()


def row(sql: str, params: tuple | dict = ()):
    conn = get_conn()
    if IS_PG:
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute(_translate(sql), params)
        r = cur.fetchone()
        return PG_Row(r) if r else None
    return conn.execute(sql, params).fetchone()


def scalar(sql: str, params: tuple | dict = (), default=None):
    r = row(sql, params)
    return default if r is None else r[0]


def execute(sql: str, params: tuple | dict = ()):
    conn = get_conn()
    if IS_PG:
        cur = conn.cursor()
        cur.execute(_translate(sql), params)
        return cur
    return conn.execute(sql, params)


def insert(sql: str, params: tuple | dict = ()) -> int:
    conn = get_conn()
    if IS_PG:
        sql2 = _translate(sql).rstrip()
        if sql2.lstrip().upper().startswith("INSERT") and not re.search(r"\bRETURNING\b", sql2, re.I):
            sql2 += " RETURNING id"
        cur = conn.cursor()
        cur.execute(sql2, params)
        r = cur.fetchone()
        return r[0] if r else 0
    return conn.execute(sql, params).lastrowid


class tx:
    """事务上下文：立即开启，异常回滚。

    PG 模式走 autocommit（get_conn 已设 autocommit=True），
    BEGIN/COMMIT/ROLLBACK 均不需要；SQLite 保持原事务语义。
    """

    def __enter__(self):
        self.conn = get_conn()
        if not IS_PG:
            self.conn.execute("BEGIN IMMEDIATE")
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if not IS_PG:
            if exc_type is None:
                self.conn.execute("COMMIT")
            else:
                self.conn.execute("ROLLBACK")
        return False


def init_db() -> None:
    if IS_PG:
        conn = get_conn()
        schema = _translate_schema(SCHEMA_PATH.read_text(encoding="utf-8"))
        cur = conn.cursor()
        for stmt in schema.split(";"):
            s = stmt.strip()
            if s:
                cur.execute(s)
        cur.close()
    else:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = get_conn()
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
