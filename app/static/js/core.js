// ============ 核心工具：请求 / 格式化 / 弹层 / 表单 / 图表 ============

// ---------- 路由参数（由 app.js 填充）----------
export const params = {};

export const store = {
  get token() { return localStorage.getItem('g_token') || ''; },
  set token(v) { v ? localStorage.setItem('g_token', v) : localStorage.removeItem('g_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('g_user') || 'null'); } catch { return null; } },
  set user(v) { v ? localStorage.setItem('g_user', JSON.stringify(v)) : localStorage.removeItem('g_user'); },
  get perms() { try { return JSON.parse(localStorage.getItem('g_perms') || '{}'); } catch { return {}; } },
  set perms(v) { localStorage.setItem('g_perms', JSON.stringify(v || {})); },
  can(p) { return !!this.perms[p]; },
  cache(k, v) { v === undefined ? this._c?.[k] : ((this._c ||= {})[k] = v); },
  _c: {},
};

// ---------- 请求 ----------
/** 写请求因断网被存进本机队列时抛出。调用方可据此弹「已保存」而不是报错。 */
export class OfflineQueued extends Error {
  constructor(msg) { super(msg); this.name = 'OfflineQueued'; this.offline = true; }
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/** 带超时的 fetch：免费云实例冷启动可能要 30~60 秒，等久一点，别让用户一遇到慢就报错。 */
async function _fetch(path, o, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(path, { ...o, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function api(path, opt = {}) {
  const o = { headers: {}, ...opt };
  o.headers = { ...o.headers };
  if (store.token) o.headers.Authorization = 'Bearer ' + store.token;
  if (o.body !== undefined && typeof o.body !== 'string') {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const method = (o.method || 'GET').toUpperCase();
  o.method = method;
  let res;
  try {
    res = await _fetch(path, o, 45000);
  } catch (e) {
    // 超时 / 网络抖动：免费云实例可能在冷启动，读请求自动重试一次。
    // 写请求绝不重试（避免重复提交），断网时走离线队列。
    if (!o._retried && (e.name === 'AbortError' || !WRITE_METHODS.has(method))) {
      o._retried = true;
      try { res = await _fetch(path, o, 30000); } catch { /* 仍失败则按下方处理 */ }
    }
    if (!res) {
      // 断网。写请求先存本机，等有网了自动补传；读请求直接报错。
      if (WRITE_METHODS.has(method) && enqueue(path, o)) {
        throw new OfflineQueued('网络不通，已存到本机，联网后自动上传');
      }
      throw new Error('网络不稳定或服务器正在唤醒，请稍后重试');
    }
  }
  if (res.status === 401) {
    store.token = ''; store.user = null;
    location.hash = '';
    document.dispatchEvent(new CustomEvent('need-login'));
    throw new Error('登录已过期，请重新登录');
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) {
    if (!res.ok) throw new Error('请求失败 ' + res.status);
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || '请求失败 ' + res.status);
  // Service Worker 在离线时回退到缓存。金额类数据看旧的不算错，但得说出来。
  if (res.headers.get('x-served-offline')) noteOfflineOnce();
  return data;
}
export const GET = (p) => api(p);
export const POST = (p, b) => api(p, { method: 'POST', body: b ?? {} });
export const PUT = (p, b) => api(p, { method: 'PUT', body: b ?? {} });
export const DEL = (p) => api(p, { method: 'DELETE' });

// ---------- 离线写入队列 ----------
// 在羊舍没信号时照常点保存，请求落在这里；走回有信号的地方自动补传。
const QKEY = 'g_offline_q';
const QMAX = 200;

export function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch { return []; }
}
export function saveQueue(q) {
  try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* 存满了就静默丢弃 */ }
  syncNetBadge();
}
export const queueCount = () => loadQueue().length;

function enqueue(path, opt) {
  const q = loadQueue();
  if (q.length >= QMAX) return false;
  q.push({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    path, method: (opt.method || 'POST').toUpperCase(),
    headers: opt.headers || {}, body: opt.body, ts: Date.now(),
  });
  saveQueue(q);
  return true;
}

/** 按顺序补传队列。
 *  - 成功 → 出队
 *  - 401 → 登录态失效，整队保留（别丢数据），提示重新登录
 *  - 其它 4xx → 服务端明确拒绝，重试也没用，出队并提示
 *  - 5xx / 断网 → 保留，下次再试
 */
export async function flushQueue() {
  if (!navigator.onLine) return queueCount() === 0;
  let q = loadQueue();
  if (!q.length) return true;
  let uploaded = 0, rejected = 0, authFail = false;
  let i = 0;
  while (i < q.length) {
    const it = q[i];
    let res;
    try {
      res = await fetch(it.path, { method: it.method, headers: it.headers, body: it.body });
    } catch { break; }
    if (res.ok) { q.splice(i, 1); uploaded++; continue; }
    if (res.status === 401) { authFail = true; break; }
    if (res.status < 500) { q.splice(i, 1); rejected++; continue; }
    break;
  }
  saveQueue(q);
  if (uploaded) ok('已上传离线记录 ' + uploaded + ' 条');
  if (rejected) err('有 ' + rejected + ' 条离线记录被拒绝（数据可能已变化），请重新录入', 4500);
  if (authFail) err('离线记录待上传，但登录已过期，请重新登录', 4500);
  return q.length === 0;
}

/** 顶栏的离线 / 待传徽标。 */
export function syncNetBadge() {
  const el = document.getElementById('netBadge');
  if (!el) return;
  const n = queueCount();
  const off = !navigator.onLine;
  if (off || n > 0) {
    el.classList.remove('hidden');
    el.textContent = off ? (n ? '离线 · 待传' + n : '离线') : '待传' + n;
  } else {
    el.classList.add('hidden');
  }
}

addEventListener('online', () => { syncNetBadge(); flushQueue(); });
addEventListener('offline', syncNetBadge);

/** 让 Service Worker 清掉接口缓存（换账号 / 退出时调用）。 */
export function clearSwCache() {
  const c = navigator.serviceWorker?.controller;
  if (c) c.postMessage({ type: 'clear-api' });
}

// 离线期间第一次读到缓存数据时提示一次，避免用户误以为数字是实时的
let _offlineNoticed = false;
addEventListener('online', () => { _offlineNoticed = false; });
function noteOfflineOnce() {
  if (_offlineNoticed) return;
  _offlineNoticed = true;
  warn('当前离线，页面显示的是上次保存的数据');
}

// ---------- 格式化 ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (n, dp = 2) => {
  const v = Number(n || 0);
  return v.toLocaleString('zh-CN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
export const wan = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(Math.abs(v) >= 1000000 ? 1 : 2) + '万';
  return money(v, Math.abs(v) >= 1000 ? 0 : 2);
};
export const num = (n, dp = 1) => {
  const v = Number(n || 0);
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: dp });
};
export const today = () => new Date().toLocaleDateString('sv-SE');
export function addDays(d, n) {
  const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n);
  return t.toLocaleDateString('sv-SE');
}
export function addMonths(d, n) {
  const t = new Date(d + 'T00:00:00');
  t.setMonth(t.getMonth() + n);
  return t.toLocaleDateString('sv-SE');
}
export function thisMonth() { return today().slice(0, 7); }
export function monthStart(m = thisMonth()) { return m + '-01'; }
export function monthEnd(m = thisMonth()) {
  const t = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
  return t.toLocaleDateString('sv-SE');
}
export const md = (d) => (d || '').slice(5).replace('-', '/');
export const ym = (d) => (d || '').slice(0, 7);

/** 涨跌徽标 */
export const delta = (cur, prev, unit = '', digits = 1) => {
  const d = Number(cur || 0) - Number(prev || 0);
  if (!prev && !d) return `<span class="kpi-d flat">—</span>`;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const sign = d > 0 ? '▲' : d < 0 ? '▼' : '—';
  return `<span class="kpi-d ${cls}">${sign} ${d > 0 ? '+' : ''}${num(d, digits)}${esc(unit)}</span>`;
};

// ---------- DOM ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const on = (root, ev, sel, fn) =>
  root.addEventListener(ev, e => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });

// ---------- 提示 ----------
let toastTimer = [];
export function toast(msg, type = '', ms = 2200) {
  const wrap = $('#toast');
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  wrap.appendChild(d);
  const t = setTimeout(() => { d.style.opacity = '0'; d.style.transition = 'opacity .2s'; setTimeout(() => d.remove(), 220); }, ms);
  toastTimer.push(t);
  if (wrap.children.length > 3) wrap.firstChild.remove();
}
export const ok = (m) => toast(m, 'ok');
export const err = (m, ms) => toast(m, 'err', ms ?? 3200);
export const warn = (m) => toast(m, 'warn', 3200);

// ---------- 弹层 ----------
let sheetStack = [];
export function sheet({ title, body, footer = '', onMount, size }) {
  const root = $('#sheetRoot');
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `
    <div class="sheet" ${size ? `style="max-height:${size}"` : ''} role="dialog" aria-modal="true">
      <div class="sheet-h"><h3>${esc(title)}</h3><button class="sheet-x" data-x>✕</button></div>
      <div class="sheet-b">${body}</div>
      ${footer ? `<div class="sheet-f">${footer}</div>` : ''}
    </div>`;
  root.appendChild(mask);
  const close = () => {
    mask.remove();
    sheetStack = sheetStack.filter(x => x !== close);
    if (!sheetStack.length) document.body.style.overflow = '';
  };
  sheetStack.push(close);
  document.body.style.overflow = 'hidden';
  const born = Date.now();
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.closest('[data-x]')) {
      // 移动端合成点击穿透：弹层刚弹出 400ms 内的空白点击不关闭
      if (e.target === mask && Date.now() - born < 400) return;
      close();
    }
  });
  if (onMount) onMount($('.sheet-b', mask), close, $('.sheet-f', mask));
  return { close, el: mask };
}

export function confirmBox(title, msg, onYes, yesText = '确定', danger = true) {
  sheet({
    title,
    body: `<p style="margin:4px 0 8px;font-size:14.5px;line-height:1.7">${esc(msg)}</p>`,
    footer: `<button class="btn" data-x>取消</button>
             <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(yesText)}</button>`,
    onMount(b, close, f) {
      f.querySelector('[data-yes]').onclick = async () => { close(); await onYes(); };
    },
  });
}

/** 单选列表选择器 */
export function pickOne(title, options, value, onPick) {
  const body = `<div class="opt-list">${options.map(o => `
    <label><input type="radio" name="pk" value="${esc(o.value)}" ${String(o.value) === String(value) ? 'checked' : ''}>
      <span>${esc(o.label)}</span>${o.meta ? `<span class="meta">${esc(o.meta)}</span>` : ''}</label>`).join('')}</div>`;
  sheet({
    title, body,
    onMount(b, close) {
      b.addEventListener('change', e => { if (e.target.name === 'pk') { close(); onPick(e.target.value); } });
    },
  });
}

// ---------- 表单 ----------
/**
 * fields: {name,label,type,value,options,required,hint,placeholder,step,min,max,full,readonly,rows}
 * type: text|number|money|date|textarea|select|radio|hidden|static|checkbox
 * draft: 传一个字符串键则开启草稿自动保存（填到一半误关也能续上）
 */
export function formSheet({ title, fields, submitText = '保存', onSubmit, onDelete, extraFooter = '', note = '', draft = '' }) {
  const dkey = draft ? 'g_draft_' + draft : '';
  const draftHit = dkey ? readDraft(dkey) : null;
  const body = (note ? `<div class="notice i">${note}</div>` : '')
    + (draftHit ? `<div class="notice" data-draft-tip>已恢复上次未保存的内容，可继续填</div>` : '')
    + `<form id="fx" novalidate>${fields.map(fieldHTML).join('')}</form>`;
  const footer = `${extraFooter}${onDelete ? `<button class="btn btn-danger" style="flex:0 0 84px" data-del>删除</button>` : ''}
    <button class="btn btn-primary" data-save>${esc(submitText)}</button>`;

  sheet({
    title, body, footer,
    onMount(b, close, f) {
      const form = $('#fx', b);

      if (draftHit) restoreDraft(form, fields, draftHit);

      // 草稿：输入 500ms 后落盘，成功保存后清除
      let dt;
      if (dkey) {
        const snap = () => {
          const seen = new Set();
          const seen2 = [];
          const vals = {};
          for (const fd of fields) {
            const el = form.elements[fd.name];
            if (!el) continue;
            if (el instanceof Set) continue;
            vals[fd.name] = fd.type === 'checkbox' ? (el.checked ? 1 : 0) : String(el.value ?? '');
            if (vals[fd.name]) seen2.push(fd.name);
          }
          saveDraft(dkey, { vals, t: Date.now(), filled: seen2.length });
        };
        b.addEventListener('input', () => { clearTimeout(dt); dt = setTimeout(snap, 500); });
        b.addEventListener('change', () => { clearTimeout(dt); dt = setTimeout(snap, 200); });
      }

      // 金额快捷键
      $$('[data-quick]', b).forEach(q => q.onclick = () => {
        const t = form.elements[q.dataset.quick];
        t.value = (+t.value || 0) + (+q.dataset.val);
        t.dispatchEvent(new Event('input'));
      });
      // 联动
      b.addEventListener('change', e => {
        if (e.target.dataset.relink !== undefined) relink(form);
      });
      relink(form);

      f.querySelector('[data-save]').onclick = async e => {
        const btn = e.currentTarget;
        const data = collect(form, fields);
        if (data === false) return;
        btn.disabled = true; btn.textContent = '保存中…';
        try {
          await onSubmit(data);
          if (dkey) localStorage.removeItem(dkey);
          close();
        } catch (ex) {
          if (ex.offline) {                       // 已入离线队列，数据没丢
            if (dkey) localStorage.removeItem(dkey);
            close();
            warn(ex.message);
          } else {
            err(ex.message);
            btn.disabled = false; btn.textContent = submitText;
          }
        }
      };
      const del = f.querySelector('[data-del]');
      if (del) del.onclick = () => {
        close();
        confirmBox('确认删除', '删除后不可恢复，确定继续？', async () => { await onDelete(); });
      };
      const first = form.querySelector('input:not([type=hidden]):not([readonly]),select,textarea');
      if (first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 120);
    },
  });
}

function readDraft(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null');
    if (!d || !d.vals) return null;
    if (Date.now() - (d.t || 0) > 7 * 86400 * 1000) { localStorage.removeItem(key); return null; }
    return d;
  } catch { return null; }
}
function saveDraft(key, d) {
  try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* 忽略 */ }
}
function restoreDraft(form, fields, draft) {
  for (const f of fields) {
    if (f.type === 'static' || f.type === 'hidden') continue;
    const el = form.elements[f.name];
    if (!el) continue;
    if (el instanceof Set) continue;
    const v = draft.vals[f.name];
    if (v == null || v === '') continue;
    if (f.type === 'checkbox') el.checked = !!+v;
    else el.value = v;
  }
}

function fieldHTML(f) {
  if (f.type === 'hidden') return `<input type="hidden" name="${f.name}" value="${esc(f.value ?? '')}">`;
  const v = f.value ?? '';
  const req = f.required ? ' required' : '';
  let ctl = '';
  switch (f.type) {
    case 'money':
      ctl = `<div class="f-amount"><span>¥</span>
        <input type="number" inputmode="decimal" step="0.01" name="${f.name}" value="${esc(v)}" placeholder="0.00"${req}></div>
        ${(f.quick || []).length ? `<div class="quick-amt">${f.quick.map(q =>
        `<button type="button" data-quick="${f.name}" data-val="${q}">+${q}</button>`).join('')}</div>` : ''}`;
      break;
    case 'number':
      ctl = `<input type="number" inputmode="decimal" step="${f.step ?? 'any'}" name="${f.name}"
        value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"${req}
        ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
        ${f.readonly ? ' readonly' : ''}>`;
      break;
    case 'date':
      ctl = `<input type="date" name="${f.name}" value="${esc(v)}"${req}>`;
      break;
    case 'textarea':
      ctl = `<textarea name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}"${req}>${esc(v)}</textarea>`;
      break;
    case 'select':
      ctl = `<select name="${f.name}"${req}><option value="">${esc(f.placeholder || '请选择')}</option>
        ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      break;
    case 'radio':
      ctl = `<div class="radios">${(f.options || []).map(o => `
        <label><input type="radio" name="${f.name}" value="${esc(o.value)}" ${String(o.value) === String(v) ? 'checked' : ''}>
        ${esc(o.label)}</label>`).join('')}</div>`;
      break;
    case 'checkbox':
      ctl = `<div class="radios"><label><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}>
        ${esc(f.checkLabel || f.label)}</label></div>`;
      break;
    case 'static':
      ctl = `<div style="padding:9px 12px;background:var(--bg);border-radius:9px;font-size:14px">${f.html || esc(v)}</div>`;
      break;
    default:
      ctl = `<input type="text" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"${req}
        ${f.readonly ? ' readonly' : ''} ${f.list ? `list="${f.list}"` : ''}>`;
  }
  return `<div class="f ${f.full ? 'full' : ''}" data-f="${f.name}">
    ${f.type === 'checkbox' ? '' : `<span class="f-lb">${esc(f.label || '')}${f.required ? ' <em style="color:var(--danger);font-style:normal">*</em>' : ''}</span>`}
    ${ctl}
    ${f.hint ? `<div class="hint">${f.hint}</div>` : ''}
    <div class="err"></div>
  </div>`;
}

function relink(form) {
  $$('[data-show-if]', form).forEach(el => {
    const [name, val] = el.dataset.showIf.split('=');
    const src = form.elements[name];
    const on = src && String(src.value) === val;
    el.style.display = on ? '' : 'none';
  });
}

function collect(form, fields) {
  let okAll = true;
  for (const f of fields) {
    const box = form.querySelector(`[data-f="${f.name}"]`);
    if (box) box.classList.remove('bad');
    if (f.type === 'static' || f.type === 'hidden') continue;
    let raw;
    if (f.type === 'checkbox') raw = form.elements[f.name].checked;
    else if (f.type === 'radio') raw = form.elements[f.name]?.value ?? '';
    else raw = form.elements[f.name]?.value ?? '';
    if (f.required && (raw === '' || raw == null)) {
      if (box) { box.classList.add('bad'); box.querySelector('.err').textContent = `${f.label}不能为空`; }
      okAll = false;
    } else if (f.type === 'number' || f.type === 'money') {
      if (raw === '') raw = null; else if (f.min != null && +raw < f.min) {
        if (box) { box.classList.add('bad'); box.querySelector('.err').textContent = `不能小于 ${f.min}`; }
        okAll = false;
      }
    }
  }
  if (!okAll) { form.querySelector('.f.bad input,.f.bad select,.f.bad textarea')?.focus(); return false; }
  const out = {};
  for (const f of fields) {
    if (f.type === 'static') continue;
    if (f.type === 'checkbox') { out[f.name] = form.elements[f.name].checked ? 1 : 0; continue; }
    let v = form.elements[f.name]?.value ?? '';
    if (f.type === 'number' || f.type === 'money') v = v === '' ? (f.emptyAs ?? null) : +v;
    else v = typeof v === 'string' ? v.trim() : v;
    out[f.name] = v;
  }
  return out;
}

// ---------- 图表（纯 SVG，无依赖）----------
const PALETTE = ['#1f7a52', '#2b9466', '#4fb489', '#8fd4b4', '#c3e7d5', '#e8f4ee',
  '#c9760b', '#e8a13d', '#e0392f', '#7a8d83'];

export function lineChart(data, { h = 170, keys = [{ k: 'total', c: '#1f7a52', name: '存栏' }], fmt = num, area = true } = {}) {
  if (!data?.length) return emptyBox('暂无数据');
  const W = 320, H = h, PL = 34, PR = 8, PT = 10, PB = 18;
  const all = data.flatMap(d => keys.map(k => +d[k.k] || 0));
  let mx = Math.max(...all, 1), mn = Math.min(...all, 0);
  if (mx === mn) mx = mn + 1;
  const span = mx - mn;
  const X = i => PL + (data.length === 1 ? (W - PL - PR) / 2 : i * (W - PL - PR) / (data.length - 1));
  const Y = v => PT + (H - PT - PB) * (1 - (v - mn) / span);

  let grid = '', ylab = '';
  for (let i = 0; i <= 3; i++) {
    const v = mn + span * i / 3, y = Y(v);
    grid += `<line class="grid" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"/>`;
    ylab += `<text class="axis" x="${PL - 4}" y="${y + 3}" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  let xlab = '';
  const step = Math.max(1, Math.ceil(data.length / 6));
  data.forEach((d, i) => {
    if (i % step === 0 || i === data.length - 1)
      xlab += `<text class="axis" x="${X(i)}" y="${H - 5}" text-anchor="end">${esc(d.label ?? md(d.date ?? d.month ?? d.bucket))}</text>`;
  });

  let paths = '', legend = '';
  keys.forEach((k, ki) => {
    const pts = data.map((d, i) => `${X(i)},${Y(+d[k.k] || 0)}`).join(' ');
    const c = k.c || PALETTE[ki];
    paths += area && keys.length === 1
      ? `<defs><linearGradient id="ag${ki}" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>
         </linearGradient></defs>
         <polygon class="area" fill="url(#ag${ki})" points="${PL},${Y(mn)} ${pts} ${W - PR},${Y(mn)}"/>`
      : '';
    paths += `<polyline class="line" stroke="${c}" points="${pts}"/>`;
    data.forEach((d, i) => { paths += `<circle class="dot" stroke="${c}" cx="${X(i)}" cy="${Y(+d[k.k] || 0)}" r="${data.length > 40 ? 0 : 2.4}"/>`; });
    legend += `<span><i style="background:${c}"></i>${esc(k.name)}</span>`;
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
    ${grid}${ylab}${xlab}${paths}</svg>${keys.length > 1 ? `<div class="glegend">${legend}</div>` : ''}`;
}

export function barChart(data, { h = 170, series = [{ k: 'v', c: '#1f7a52', name: '值' }], fmt = num, label = d => d.label ?? d } = {}) {
  if (!data?.length) return emptyBox('暂无数据');
  const W = 320, H = h, PL = 38, PR = 8, PT = 10, PB = 18;
  const totals = data.map(d => series.reduce((s, k) => s + (+d[k.k] || 0), 0));
  const mx = Math.max(...totals, 1);
  const Y = v => PT + (H - PT - PB) * (1 - v / mx);
  const bw = (W - PL - PR) / data.length;

  let grid = '', ylab = '';
  for (let i = 0; i <= 3; i++) {
    const v = mx * i / 3, y = Y(v);
    grid += `<line class="grid" x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"/>`;
    ylab += `<text class="axis" x="${PL - 4}" y="${y + 3}" text-anchor="end">${fmt(v, 0)}</text>`;
  }
  let bars = '', xlab = '';
  data.forEach((d, i) => {
    let acc = 0;
    series.forEach((k, si) => {
      const v = +d[k.k] || 0; if (!v) return;
      const x = PL + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const y1 = Y(v + acc), y2 = Y(acc);
      bars += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(1, y2 - y1)}" rx="2"
        fill="${k.c || PALETTE[si]}"><title>${esc(label(d))} ${esc(k.name)} ${fmt(v)}</title></rect>`;
      acc += v;
    });
    if (data.length <= 14 || i % Math.ceil(data.length / 8) === 0)
      xlab += `<text class="axis" x="${PL + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(label(d))}</text>`;
  });
  const legend = series.length > 1
    ? `<div class="glegend">${series.map((k, i) => `<span><i style="background:${k.c || PALETTE[i]}"></i>${esc(k.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px">${grid}${ylab}${xlab}${bars}</svg>${legend}`;
}

/** 分组横向条 + 图例 */
export function groupBar(items, { unit = '只', colors } = {}) {
  if (!items?.length) return emptyBox('暂无数据');
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const bars = items.map((it, i) =>
    `<span style="width:${(it.value / total * 100).toFixed(2)}%;background:${it.color || colors?.[i] || PALETTE[i % PALETTE.length]}"
      title="${esc(it.label)} ${num(it.value)}${unit}"></span>`).join('');
  const lg = items.map((it, i) =>
    `<span><i style="background:${it.color || colors?.[i] || PALETTE[i % PALETTE.length]}"></i>${esc(it.label)} ${num(it.value)}</span>`).join('');
  return `<div class="gbar">${bars}</div><div class="glegend">${lg}</div>`;
}

/** 进度条 */
export function progressBar(label, value, max, { color = '#1f7a52', suffix = '' } = {}) {
  const pct = max ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return `<div style="margin-bottom:9px">
    <div class="flex between small" style="margin-bottom:3px">
      <span class="muted">${esc(label)}</span>
      <b class="num">${num(value, 1)}${suffix} / ${num(max, 1)}${suffix}</b></div>
    <div style="height:7px;background:var(--line);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct.toFixed(1)}%;background:${pct > 90 ? 'var(--danger)' : color};border-radius:4px"></div>
    </div></div>`;
}

export const emptyBox = (msg, sub = '') =>
  `<div class="empty"><div class="ico">🐑</div><div class="t">${esc(msg)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div>`;

export const loadingBox = (n = 3) =>
  `<div class="card">${'<div class="skel" style="height:17px;margin-bottom:11px"></div>'.repeat(n)}</div>`;

// ---------- 其它 ----------
export function download(url) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}

export function confirmLogout() {
  confirmBox('退出登录', '退出后需要重新输入账号密码，确定退出吗？', () => {
    store.token = ''; store.user = null; store.perms = {};
    clearSwCache();            // 别让离线缓存里还留着上一个账号的数据
    location.reload();
  }, '退出', false);
}

export const GROUP_COLORS = {
  lamb: '#c3e7d5', youth: '#8fd4b4', young: '#4fb489',
  milking: '#1f7a52', dry: '#7a8d83', buck: '#c9760b', buck_try: '#e8a13d',
};
export const sexBadge = (s) => s === 'm'
  ? '<span class="badge w">公</span>' : '<span class="badge g">母</span>';
export const statusBadge = (s) => ({
  alive: '<span class="badge g">在场</span>', sold: '<span class="badge b">已售</span>',
  dead: '<span class="badge d">死亡</span>', cull: '<span class="badge n">淘汰</span>',
  loan: '<span class="badge w">外借</span>',
}[s] || '');
