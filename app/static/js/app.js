import {
  store, api, POST, ok, err, esc, params, confirmLogout, sheet,
  syncNetBadge, flushQueue, clearSwCache, OfflineQueued, $, $$,
} from './core.js';

// 视图按需加载：首屏只拉 core.js + app.js，用到哪个页面才取哪个模块
const LOADERS = {
  home: () => import('./views/home.js'),
  goats: () => import('./views/goats.js'),
  herd: () => import('./views/herd.js'),
  milk: () => import('./views/milk.js'),
  fin: () => import('./views/fin.js'),
  rep: () => import('./views/rep.js'),
  me: () => import('./views/me.js'),
};
const VIEWS = {};
async function view(key) {
  return VIEWS[key] || (VIEWS[key] = await LOADERS[key]());
}

const ROUTES = [
  [/^\/?$/, 'home', '看板'],
  [/^\/home/, 'home', '看板'],
  [/^\/goats/, 'goats', '羊只档案'],
  [/^\/goat\/(\d+)/, 'goats', '羊只档案'],
  [/^\/herd/, 'herd', '存栏统计'],
  [/^\/milk/, 'milk', '产奶统计'],
  [/^\/fin/, 'fin', '出入账'],
  [/^\/acct/, 'fin', '账户余额'],
  [/^\/rep/, 'rep', '财务报表'],
  [/^\/me/, 'me', '我的'],
];

// ---------- 闪屏 ----------
let splashDone = false;
function hideSplash() {
  if (splashDone) return;
  splashDone = true;
  const s = $('#splash');
  if (!s) return;
  s.classList.add('gone');
  setTimeout(() => s.remove(), 420);
}

// ---------- 路由 ----------
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  const m = ROUTES.find(([re]) => re.test(hash));
  if (!m) return;
  const [, key, title] = m;
  Object.keys(params).forEach(k => delete params[k]);
  const found = hash.match(m[0]);
  if (found) found.slice(1).forEach((v, i) => params['p' + i] = v);

  $('#pageTitle').textContent = title;
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === key));
  // 关键修复：每次切换视图前重建 #view 元素（cloneNode 复制 id 与 class，不复制子节点与监听）。
  // 上一视图模块绑定在 #view 上的全部事件委托（[data-t]/[data-id] 等）会随旧元素一起销毁，
  // 杜绝「点击当前页内部选项，却同时触发其他模块的渲染函数，导致渲染串页/误跳转」的顽固问题。
  const _old = $('#view');
  const vEl = _old.cloneNode(false);
  _old.replaceWith(vEl);
  vEl.innerHTML = '<div class="card"><div class="skel" style="height:17px;margin-bottom:11px"></div>'
    + '<div class="skel" style="height:17px"></div></div>';
  window.scrollTo(0, 0);
  try {
    const V = await view(key);
    await V.render(vEl, { params });
    hideSplash();
  } catch (e) {
    hideSplash();
    if (e.message.includes('登录')) return;
    vEl.innerHTML = `<div class="card"><div class="empty"><div class="ico">⚠</div>
      <div class="t">页面加载失败</div><div class="s">${esc(e.message)}</div>
      <button class="btn btn-sm mt12" onclick="location.reload()">重新加载</button></div></div>`;
  }
}

export function go(hash) {
  if (location.hash === '#' + hash) route();
  else location.hash = hash;
}
window.addEventListener('hashchange', route);

// ---------- 登录 ----------
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginHint').textContent = '';
  hideSplash();
}

async function boot() {
  syncNetBadge();
  if (queueHasWork()) await flushQueue().catch(() => {});
  if (!store.token) return showLogin();
  try {
    const d = await api('/api/auth/me');
    store.user = d.user;
    store.perms = d.permissions;
    start();
  } catch {
    showLogin();
  }
}

function queueHasWork() {
  try { return (JSON.parse(localStorage.getItem('g_offline_q') || '[]')).length > 0; }
  catch { return false; }
}

function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  syncNetBadge();
  if (!location.hash) location.hash = '#/home';
  route();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    clearSwCache();                 // 换账号：清掉上一个人的离线缓存
    const d = await POST('/api/auth/login', {
      username: f.username.value.trim(), password: f.password.value,
    });
    store.token = d.token; store.user = d.user;
    const me_ = await api('/api/auth/me');
    store.perms = me_.permissions;
    f.password.value = '';
    start();
    ok(`欢迎回来，${d.user.full_name || d.user.username}`);
  } catch (ex) {
    if (ex instanceof OfflineQueued || ex.offline) {
      err('离线无法登录，请先连上网络', 4000);
    } else {
      $('#loginHint').textContent = ex.message;
      err(ex.message);
    }
    btn.disabled = false; btn.textContent = '登 录';
  }
});

document.addEventListener('need-login', showLogin);

// ---------- 全局动作 ----------
document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  const act = a.dataset.action;
  if (act === 'search') openSearch();
  if (act === 'go-me') go('/me');
});

function openSearch() {
  sheet({
    title: '全局搜索',
    body: `<input id="sq" type="search" placeholder="搜索耳标号 / 备注 / 科目 / 账户"
              style="width:100%;padding:11px 13px;border:1px solid var(--line2);border-radius:10px">
            <div id="sres" class="mt12"></div>`,
    onMount(b) {
      const q = b.querySelector('#sq');
      const res = b.querySelector('#sres');
      let t;
      q.oninput = () => {
        clearTimeout(t);
        const v = q.value.trim();
        if (v.length < 1) { res.innerHTML = ''; return; }
        t = setTimeout(async () => {
          try {
            const d = await api('/api/search?q=' + encodeURIComponent(v));
            res.innerHTML = renderSearch(d);
          } catch { res.innerHTML = ''; }
        }, 260);
      }
      res.addEventListener('click', ev => {
        const g = ev.target.closest('[data-goat]');
        if (g) { b.closest('.mask').remove(); go('/goat/' + g.dataset.goat); }
      });
      setTimeout(() => q.focus(), 150);
    },
  });
}

function renderSearch(d) {
  const parts = [];
  if (d.goats?.length) parts.push(`<div class="card-t" style="margin-bottom:6px">羊只 <small>${d.goats.length}</small></div>
    <ul class="list">${d.goats.map(g => `<li data-goat="${g.id}" style="cursor:pointer">
      <div class="avatar ${g.sex}">${esc(g.tag_no.slice(-2))}</div>
      <div class="li-main"><div class="li-t">${esc(g.tag_no)}</div>
      <div class="li-s">${esc(g.age_text)} · ${esc(g.barn || '未分栏')}</div></div>
      <span class="li-arrow">›</span></li>`).join('')}</ul>`);
  if (d.categories?.length) parts.push(`<div class="card-t mt12" style="margin-bottom:6px">科目</div>
    <ul class="list">${d.categories.map(c => `<li><div class="li-main"><div class="li-t">${esc(c.name)}</div>
      <div class="li-s">${c.kind === 'income' ? '收入' : '支出'}</div></div></li>`).join('')}</ul>`);
  return parts.length ? parts.join('') : '<div class="empty"><div class="s">没有匹配的结果</div></div>';
}

// ---------- 启动 ----------
boot();
export { showLogin, confirmLogout, route };
