@echo off
chcp 65001 >nul
title 羊场管家 - 启动中
cd /d "%~dp0"

REM ---- 找 Python（优先项目自带虚拟环境）----
set "PY=E:\OPENCODE\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

set PYTHONIOENCODING=utf-8
set GOAT_DB_PATH=%~dp0data\farm.db

echo.
echo ================================================
echo     奶山羊养殖场管理系统
echo ================================================
echo.
%PY% run.py --host 0.0.0.0 --port 8770 --open

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
