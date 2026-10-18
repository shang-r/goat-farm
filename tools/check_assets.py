"""前端资源体检：index.html 引用的每个静态文件都必须真实存在，且 JS 里的接口路径都要在后端注册。

用法：python tools/check_assets.py
"""
from __future__ import annotations

import io
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "app", "static")
sys.path.insert(0, ROOT)

bad = 0

print("== 1. index.html 引用的资源是否都存在 ==")
html = io.open(os.path.join(STATIC, "index.html"), encoding="utf-8").read()
refs = re.findall(r"(?:src|href)=\"([^\"]+)\"", html)
for r in refs:
    if r.startswith(("http", "#", "data:", "mailto")):
        print(f"  [-- ] {r:28s} (外链，跳过)")
        continue
    p = os.path.join(STATIC, r.replace("./", "").lstrip("/"))
    okk = os.path.exists(p)
    print(f"  [{'OK ' if okk else '缺 '}] {r:28s} {os.path.getsize(p) if okk else '-':>7}")
    bad += not okk

print("\n== 2. JS 里 fetch 的接口是否都在后端注册 ==")
from app.main import app  # noqa: E402

routes = set()
for path, ops in app.openapi()["paths"].items():
    routes.add(path)

js_dirs = [STATIC, os.path.join(STATIC, "js"), os.path.join(STATIC, "js", "views")]
SKIP = {"sw.js"}   # Service Worker 不是页面脚本，里面会写 '/api/' 前缀判断
called: set[str] = set()
for d in js_dirs:
    for fn in os.listdir(d):
        if not fn.endswith(".js") or fn in SKIP:
            continue
        s = io.open(os.path.join(d, fn), encoding="utf-8").read()
        called |= set(re.findall(r"['\"](/api/[A-Za-z0-9_/?=:+.-]*)['\"]", s))

# 模板串里拼参数的路径（形如 api(`/api/milk/stats?start=...`)）取前缀
tpl = set()
for d in js_dirs:
    for fn in os.listdir(d):
        if not fn.endswith(".js") or fn in SKIP:
            continue
        s = io.open(os.path.join(d, fn), encoding="utf-8").read()
        tpl |= set(re.findall(r"\`(/api/[A-Za-z0-9_/-]+)[?${]", s))
called |= tpl

missing = sorted(c for c in called if not any(
    c == rp or c.startswith(rp.rstrip("/")) for rp in routes))
print(f"  JS 调用 {len(called)} 个路径，后端注册 {len(routes)} 条路由")
if missing:
    for m in missing:
        print(f"  [后端无此路由] {m}")
        bad += 1
else:
    print("  [OK ] 全部命中")

print("\n== 3. CSS 引用的类名是否有定义 ==")
css = io.open(os.path.join(STATIC, "css", "app.css"), encoding="utf-8").read()
defined = set(re.findall(r"\.([A-Za-z][\w-]*)", css))
used: set[str] = set()
for d in js_dirs:
    for fn in os.listdir(d):
        if not fn.endswith(".js") or fn in SKIP:
            continue
        s = io.open(os.path.join(d, fn), encoding="utf-8").read()
        # class 属性里可能混着模板表达式 ${...}，只取纯标识符部分
        for raw in re.findall(r'class="([^"]+)"', s):
            txt = re.sub(r"\$\{[^}]*\}", " ", raw)
            used |= set(re.findall(r"[A-Za-z][\w-]*", txt))
for raw in re.findall(r'class="([^"]+)"', html):
    used |= set(re.findall(r"[A-Za-z][\w-]*", raw))
missing_cls = sorted(u for u in used if u not in defined)
print(f"  前端用到 {len(used)} 个类名，CSS 定义 {len(defined)} 个")
if missing_cls:
    print(f"  [未定义] {' '.join(missing_cls)}")
    bad += 1
else:
    print("  [OK ] 全部有定义")

print("\n== 4. Service Worker 预缓存清单里的文件是否都存在 ==")
sw_path = os.path.join(STATIC, "sw.js")
if not os.path.exists(sw_path):
    print("  [缺] sw.js 不存在")
    bad += 1
else:
    sw = io.open(sw_path, encoding="utf-8").read()
    precache = re.findall(r"^\s*'\.\/([^']+)',", sw, re.M)
    print(f"  sw.js 预缓存 {len(precache)} 个资源")
    for p in precache:
        full = os.path.join(STATIC, p)
        okk = os.path.exists(full)
        print(f"  [{'OK ' if okk else '缺 '}] {p:26s} {os.path.getsize(full) if okk else '-':>7}")
        bad += not okk
    # 反向检查：views 目录下每个 js 都进了预缓存，否则离线打不开那个页面
    views = sorted(f for f in os.listdir(os.path.join(STATIC, "js", "views")) if f.endswith(".js"))
    for v in views:
        rel = "js/views/" + v
        if rel not in precache:
            print(f"  [未预缓存] {rel}  —— 离线时打不开该页面")
            bad += 1

print("\n" + "=" * 52)
print(f"  问题数：{bad}")
print("=" * 52)
sys.exit(1 if bad else 0)
