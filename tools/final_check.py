"""最终交付验收：一次跑完所有能对得上的项。"""
import json, os, re, sys, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

B = "http://127.0.0.1:8770"
ST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "static")
bad = 0


def get(path, tok=None):
    r = urllib.request.Request(B + path)
    if tok:
        r.add_header("Authorization", "Bearer " + tok)
    return urllib.request.urlopen(r, timeout=15)


def js(r):
    return json.loads(r.read().decode("utf-8"))


print("== 1. 静态资源与响应头 ==")
HEADS = [("/", "text/html"), ("/sw.js", "javascript"), ("/css/app.css", "css"),
         ("/js/app.js", "javascript"), ("/js/core.js", "javascript"),
         ("/js/views/home.js", "javascript"), ("/manifest.webmanifest", "manifest"),
         ("/icon-192.png", "png"), ("/icon-512.png", "png"),
         ("/icon-maskable-512.png", "png"), ("/apple-touch-icon.png", "png")]
for p, want in HEADS:
    r = get(p)
    ct = r.headers.get("Content-Type", "")
    ok = want in ct
    print("  %-26s %-30s %6d B %s" % (p, ct, r.length, "OK" if ok else "FAIL"))
    bad += not ok

print("\n== 2. 前端关键能力是否在位 ==")
html = get("/").read().decode("utf-8")
core = open(os.path.join(ST, "js", "core.js"), encoding="utf-8").read()
appjs = open(os.path.join(ST, "js", "app.js"), encoding="utf-8").read()
sw = open(os.path.join(ST, "sw.js"), encoding="utf-8").read()
FEAT = [
    ("index.html", "启动闪屏", 'id="splash"', html),
    ("index.html", "离线徽标", 'id="netBadge"', html),
    ("index.html", "SW 注册", "serviceWorker.register", html),
    ("index.html", "PNG 图标（iOS 必需）", "apple-touch-icon.png", html),
    ("index.html", "首页返回 HTML 而非 JSON 转义串", html.lstrip().startswith("<!DOCTYPE"), ""),
    ("core.js", "离线写入队列", "function enqueue", core),
    ("core.js", "队列补传 flushQueue", "export async function flushQueue", core),
    ("core.js", "401 不丢数据", "authFail", core),
    ("core.js", "表单草稿自动保存", "function saveDraft", core),
    ("core.js", "草稿 7 天过期", "7 * 86400", core),
    ("core.js", "离线数据提示", "noteOfflineOnce", core),
    ("core.js", "换号清 SW 缓存", "clearSwCache", core),
    ("app.js", "视图按需加载", "import('./views/", appjs),
    ("app.js", "启动时补传队列", "flushQueue()", appjs),
    ("sw.js", "导航离线回退", "req.mode === 'navigate'", sw),
    ("sw.js", "静态资源缓存优先", "async function cacheFirst", sw),
    ("sw.js", "接口按用户隔离缓存", "function cacheKey", sw),
    ("sw.js", "离线标记头", "X-Served-Offline", sw),
]
for f, label, needle, hay in FEAT:
    ok = needle if isinstance(needle, bool) else (needle in hay)
    print("  %-12s %-24s %s" % (f, label, "OK" if ok else "FAIL"))
    bad += not ok

print("\n== 3. 视图按需加载后仍能全部取到 ==")
for v in ["home", "goats", "herd", "milk", "fin", "rep", "me"]:
    r = get("/js/views/%s.js" % v)
    print("  /js/views/%-8s %6d B OK" % (v + ".js", r.length))

print("\n== 4. 接口回归（只读，不写库）==")
tok = js(urllib.request.urlopen(urllib.request.Request(B + "/api/auth/login",
      data=json.dumps({"username": "admin", "password": "goat2024"}).encode(),
      headers={"Content-Type": "application/json"}, method="POST"), timeout=15))["token"]
for p in ["/api/health", "/api/dashboard", "/api/herd/summary", "/api/rep/profit?preset=month"]:
    r = get(p, tok if p != "/api/health" else None)
    print("  %-34s HTTP 200 %d 键" % (p, len(js(r))))

print("\n" + "=" * 52)
print("  失败项：%d" % bad)
print("=" * 52)
sys.exit(1 if bad else 0)
