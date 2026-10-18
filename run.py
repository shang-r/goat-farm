#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""奶山羊养殖场管理系统 - 启动入口

用法:
    python run.py                 # 默认 127.0.0.1:8770
    python run.py --port 9000
    python run.py --host 0.0.0.0  # 允许同一 WiFi 下的手机访问
    python run.py --open          # 启动后自动打开浏览器
    python run.py --setup         # 只建库和初始化数据，不启动服务
"""
from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("223.5.5.5", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="奶山羊养殖场管理系统")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址，0.0.0.0 允许局域网访问")
    ap.add_argument("--port", type=int,
                    default=int(os.environ.get("PORT", "8770")),
                    help="监听端口（默认 8770；云端部署时自动读取 PORT 环境变量）")
    ap.add_argument("--open", action="store_true", help="启动后打开浏览器")
    ap.add_argument("--setup", action="store_true", help="仅初始化数据库")
    ap.add_argument("--db", default="", help="数据库文件路径")
    args = ap.parse_args()

    if args.db:
        os.environ["GOAT_DB_PATH"] = args.db

    from app import db, seed

    db.init_db()
    info = seed.seed()
    print(f"✓ 数据库就绪  {db.DB_PATH}")
    if info.get("admin"):
        print(f"✓ 已创建初始管理员  账号 admin  密码 {info['default_password']}  （请尽快修改）")
    if args.setup:
        return 0

    import uvicorn

    host = args.host
    print()
    print("  ┌─────────────────────────────────────────────┐")
    print("  │        奶山羊养殖场管理系统 已启动            │")
    print("  └─────────────────────────────────────────────┘")
    print(f"    本机访问   http://127.0.0.1:{args.port}")
    if host == "0.0.0.0":
        print(f"    手机访问   http://{lan_ip()}:{args.port}   （手机需与电脑同一 WiFi）")
    print("    接口文档   http://127.0.0.1:%d/api/docs" % args.port)
    print("    停止服务   Ctrl + C")
    print()

    if args.open:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}")).start()

    uvicorn.run("app.main:app", host=host, port=args.port, log_level="info",
                access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
