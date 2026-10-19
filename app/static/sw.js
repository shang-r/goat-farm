/* 羊场管家 Service Worker
 *
 * 策略（保守，宁可旧也不要错）：
 *   导航请求   网络优先，断网时回退到缓存首页 —— 离线也能打开 App
 *   静态资源   缓存优先 + 后台更新 —— 二次打开秒开，有网自动换新
 *   GET /api  网络优先，断网时回退到缓存 —— 只在真的离线才给旧数据
 *   写 /api   不接管，交给页面 api() —— 离线时写入本机队列，联网自动补传
 *
 * 接口缓存按用户隔离：cache key 里带 token 尾部，换人登录不会串数据。
 */

const VER = 'v11';
const SHELL = 'shell-' + VER;
const API = 'api-' + VER;
const API_MAX = 24 * 3600 * 1000;   // 接口缓存保留 24 小时，超期的清掉

const PRECACHE = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/core.js',
  './js/views/home.js',
  './js/views/goats.js',
  './js/views/herd.js',
  './js/views/milk.js',
  './js/views/fin.js',
  './js/views/rep.js',
  './js/views/me.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(PRECACHE.map(async p => {
      try { await c.add(p); } catch { /* 单个资源失败不影响整体安装 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(k => k !== SHELL && k !== API)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 页面告诉 SW 清掉接口缓存（退出登录 / 切换账号时调用）
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'clear-api') {
    caches.open(API).then(c => c.clear()).catch(() => {});
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 写请求：走网络，由页面兜底
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;    // 跨域：不接管

  const path = u.pathname;

  if (path.startsWith('/api/')) {
    e.respondWith(apiNetworkFirst(req));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() =>
        caches.match('./index.html').then(r => r || caches.match('./')).catch(() => Response.error())
      )
    );
    return;
  }

  e.respondWith(cacheFirst(req));
});

/* 静态资源：缓存优先，后台补更新 */
async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    }).catch(() => {});
    return hit;
  }
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    return Response.error();
  }
}

/* 接口：网络优先，断网回退缓存。cache key 按用户隔离。
 * 给网络请求 25 秒上限：免费云实例冷启动时别让页面无限转圈。 */
async function apiNetworkFirst(req) {
  const cache = await caches.open(API);
  const key = cacheKey(req);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch {
    clearTimeout(timer);
    const hit = await cache.match(key).catch(() => null);
    if (!hit) {
      return new Response(
        JSON.stringify({ detail: '离线，且这条数据没有缓存可显示' }),
        { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
    const h = new Headers(hit.headers);
    h.set('X-Served-Offline', '1');
    return new Response(hit.body, { status: hit.status, headers: h });
  }
}

/* cache key = 原 URL + 用户标识。不同账号各自一份，互不串。 */
function cacheKey(req) {
  const u = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  u.searchParams.set('__u', auth ? auth.slice(-6) : 'anon');
  return u.toString();
}

// 定期清掉超期的接口缓存，避免一直占空间
setInterval(() => {
  caches.open(API).then(async c => {
    const cut = Date.now() - API_MAX;
    for (const m of await c.matchAll()) {
      if (new Date(m.response.headers.get('date') || 0).getTime() < cut) c.delete(m.request).catch(() => {});
    }
  }).catch(() => {});
}, 6 * 3600 * 1000);
