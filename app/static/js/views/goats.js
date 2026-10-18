import {
  api, esc, num, money, store, ok, err, sheet, formSheet, on, PUT,
  today, sexBadge, statusBadge, params,
} from '../core.js';

const S = { q: '', status: 'alive', sex: '', grp: '', barn: '', page: 1, opts: null };

export async function render(root) {
  if (params.p0) return detail(root, +params.p0);

  S.opts ||= await api('/api/goats/options');
  const o = S.opts;
  const qs = new URLSearchParams({ q: S.q, status: S.status, sex: S.sex, group: S.grp,
    barn: S.barn, page: S.page, size: 30 });
  const d = await api('/api/goats?' + qs);

  root.innerHTML = `
    <div class="searchbar">
      <input id="q" type="search" value="${esc(S.q)}" placeholder="搜索耳标号 / 母父编号 / 备注">
      <button class="btn" id="fbtn">筛选</button>
    </div>
    <div class="chips">
      ${[['alive', '在场'], ['sold', '已售'], ['dead', '死亡'], ['cull', '淘汰'], ['loan', '外借'], ['', '全部']]
      .map(([v, t]) => `<button class="chip ${S.status === v ? 'on' : ''}" data-st="${v}">${t}</button>`).join('')}
    </div>
    ${S.sex || S.grp || S.barn ? `<div class="chips">
      ${S.sex ? `<button class="chip on" data-clear="sex">性别:${S.sex === 'f' ? '母' : '公'} ✕</button>` : ''}
      ${S.grp ? `<button class="chip on" data-clear="grp">${esc(o.groups.find(g => g.code === S.grp)?.name || S.grp)} ✕</button>` : ''}
      ${S.barn ? `<button class="chip on" data-clear="barn">${esc(S.barn)} ✕</button>` : ''}
    </div>` : ''}

    <div class="card tight"><div class="flex between small muted">
      <span>共 <b class="num" style="color:var(--ink)">${num(d.total, 0)}</b> 只</span>
      <span>第 ${d.page}/${d.pages} 页</span></div></div>

    <div class="card">
      ${d.items.length ? `<ul class="list">${d.items.map(g => goatRow(g)).join('')}</ul>`
      : `<div class="empty"><div class="ico">🐑</div><div class="t">没有符合条件的羊只</div>
         <div class="s">换个筛选条件，或点右下角建档</div></div>`}
    </div>

    ${d.pages > 1 ? `<div class="pager">
      <button class="btn btn-sm" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>${d.page} / ${d.pages}</span>
      <button class="btn btn-sm" data-pg="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>下一页</button>
    </div>` : ''}

    ${store.can('goat.write') ? `<button class="fab" id="fab">+</button>` : ''}`;

  const q = root.querySelector('#q');
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(() => { S.q = q.value.trim(); S.page = 1; render(root); }, 300); };
  root.querySelector('#fbtn').onclick = () => filterSheet(o, S);
  on(root, 'click', '[data-st]', (e, el) => { S.status = el.dataset.st; S.page = 1; render(root); });
  on(root, 'click', '[data-clear]', (e, el) => { S[el.dataset.clear] = ''; render(root); });
  on(root, 'click', '[data-pg]', (e, el) => { S.page = +el.dataset.pg; render(root); });
  on(root, 'click', '[data-id]', (e, el) => location.hash = '#/goat/' + el.dataset.id);
  const fab = root.querySelector('#fab');
  if (fab) fab.onclick = () => editGoat(null, o, () => render(root));
}

const goatRow = (g) => `
  <li data-id="${g.id}">
    <div class="avatar ${g.sex}">${esc((g.name || g.tag_no).slice(-2))}</div>
    <div class="li-main">
      <div class="li-t">${esc(g.tag_no)}${g.name && g.name !== g.tag_no ? `<span class="muted small" style="font-weight:400">${esc(g.name)}</span>` : ''}
        <span class="badge n">${esc(g.group_name)}</span></div>
      <div class="li-s"><span>${esc(g.age_text)}</span><span>${g.sex === 'm' ? '公' : '母'}</span>
        ${g.barn ? `<span>${esc(g.barn)}</span>` : ''}
        ${g.first_kidding ? '<span class="badge g">已产羔</span>' : ''}</div>
    </div>
    <div style="text-align:right;flex:none">
      <div class="small muted">${g.status === 'alive' ? '' : esc(g.status_name)}</div>
      <span class="li-arrow">›</span>
    </div>
  </li>`;

function filterSheet(o, S) {
  const body = `<div class="f"><span class="f-lb">性别</span>
      <div class="radios" data-g="sex">${[['', '不限'], ['f', '母羊'], ['m', '公羊']].map(([v, t]) =>
    `<label><input type="radio" name="sex" value="${v}" ${S.sex === v ? 'checked' : ''}>${t}</label>`).join('')}</div></div>
    <div class="f"><span class="f-lb">存栏分组</span>
      <select data-g="grp"><option value="">不限</option>
        ${o.groups.map(g => `<option value="${g.code}" ${S.grp === g.code ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select></div>
    <div class="f"><span class="f-lb">栋舍</span>
      <select data-g="barn"><option value="">不限</option>
        ${(o.barns || []).map(b => `<option value="${esc(b)}" ${S.barn === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
      </select></div>`;
  sheet({
    title: '筛选条件', body,
    footer: `<button class="btn" data-x>取消</button><button class="btn btn-primary" data-ok>确定</button>`,
    onMount(b, close, f) {
      b.querySelectorAll('[data-g]').forEach(el => el.onchange = () => {
        S[el.dataset.g] = el.name === 'sex'
          ? (b.querySelector('input[name=sex]:checked')?.value || '') : el.value;
      });
      b.querySelector('input[name=sex]').closest('.radios').addEventListener('change', () => {
        S.sex = b.querySelector('input[name=sex]:checked')?.value || '';
      });
      f.querySelector('[data-ok]').onclick = () => { close(); S.page = 1; render(document.querySelector('#view')); };
    },
  });
}

// ---------- 建档 / 编辑 ----------
export async function editGoat(g, o, done) {
  o ||= S.opts ||= await api('/api/goats/options');
  const isNew = !g;
  const fields = [
    { name: 'tag_no', label: '耳标号', required: true, value: g?.tag_no, placeholder: '唯一编号，如 A2024-018' },
    { name: 'sex', label: '性别', type: 'radio', required: true, value: g?.sex || 'f',
      options: [{ value: 'f', label: '母羊' }, { value: 'm', label: '公羊' }] },
    { name: 'breed', label: '品种', type: 'select', value: g?.breed || '萨能奶山羊',
      options: o.breeds.map(b => ({ value: b, label: b })) },
    { name: 'birth_date', label: '出生日期', type: 'date', required: true, value: g?.birth_date || today() },
    { name: 'birth_weight', label: '出生体重 (kg)', type: 'number', step: '0.01', value: g?.birth_weight },
    { name: 'source', label: '来源', type: 'radio', value: g?.source || '自繁',
      options: [{ value: '自繁', label: '自繁' }, { value: '外购', label: '外购' }, { value: '赠送', label: '赠送' }] },
    { name: 'buy_price', label: '购入价 (元/只)', type: 'money', value: g?.buy_price || '',
      hint: '外购羊填写，用于存栏资产估值' },
    { name: 'barn', label: '栋舍', value: g?.barn, placeholder: '如 A栋',
      list: 'barnList' },
    { name: 'dam_tag', label: '母羊编号', value: g?.dam_tag, placeholder: '选填' },
    { name: 'sire_tag', label: '父羊编号', value: g?.sire_tag, placeholder: '选填' },
    { name: 'first_kidding', label: '首次产羔日期', type: 'date', value: g?.first_kidding,
      hint: '填了才会算入「经产泌乳」组和单产' },
    { name: 'milk_role', label: '泌乳状态', type: 'select', value: g?.milk_role, placeholder: '未设置',
      options: [{ value: '主力', label: '主力' }, { value: '备用', label: '备用' }, { value: '干奶', label: '干奶' }] },
    { name: 'note', label: '备注', type: 'textarea', value: g?.note, placeholder: '防疫、用药、特征等' },
  ];
  if (!isNew) fields.push({ name: '_status', type: 'hidden', value: '' });

  formSheet({
    title: isNew ? '新建羊只档案' : `编辑 ${g.tag_no}`,
    note: isNew ? '耳标号是这只羊的唯一身份，建议用场里统一的编号规则。' : '',
    fields,
    onSubmit: async (d) => {
      delete d._status;
      if (isNew) await POST('/api/goats', d);
      else await PUT(`/api/goats/${g.id}`, d);
      ok(isNew ? '已建档' : '已保存');
      done?.();
    },
  });
}

// ---------- 详情 ----------
async function detail(root, id) {
  const g = await api('/api/goats/' + id);
  const o = S.opts ||= await api('/api/goats/options');
  const canWrite = store.can('goat.write');

  root.innerHTML = `
    <div class="card">
      <div class="flex" style="gap:12px">
        <div class="avatar ${g.sex}" style="width:52px;height:52px;font-size:20px;border-radius:15px">
          ${esc((g.name || g.tag_no).slice(-2))}</div>
        <div class="grow">
          <div style="font-size:19px;font-weight:700">${esc(g.tag_no)}</div>
          <div class="flex wrap mt8" style="gap:5px">
            ${sexBadge(g.sex)}<span class="badge">${esc(g.group_name)}</span>
            ${statusBadge(g.status)}<span class="badge n">${esc(g.age_text)}</span>
          </div>
        </div>
      </div>
      ${g.status !== 'alive' ? `<div class="notice mt12" style="margin-bottom:0">
        已于 ${esc(g.status_date || '-')} ${esc(g.status_name)}${g.exit_reason ? '：' + esc(g.exit_reason) : ''}
        ${g.exit_price ? `，收入 ${money(g.exit_price)} 元` : ''}</div>` : ''}
    </div>

    <div class="card">
      <div class="card-t mb0">基础信息</div>
      <dl class="kv mt12">
        <dt>品种</dt><dd>${esc(g.breed)}</dd>
        <dt>出生日期</dt><dd>${esc(g.birth_date)}　<span class="muted small">${esc(g.age_text)}</span></dd>
        <dt>出生体重</dt><dd>${g.birth_weight ? g.birth_weight + ' kg' : '<span class="muted">未记录</span>'}</dd>
        <dt>来源</dt><dd>${esc(g.source || '-')}${g.buy_price ? `　${money(g.buy_price)} 元` : ''}</dd>
        <dt>栋舍</dt><dd>${esc(g.barn || '-')}</dd>
        <dt>母羊编号</dt><dd>${g.dam_tag ? esc(g.dam_tag) : '-'}</dd>
        <dt>父羊编号</dt><dd>${g.sire_tag ? esc(g.sire_tag) : '-'}</dd>
        <dt>首次产羔</dt><dd>${g.first_kidding ? esc(g.first_kidding) : '<span class="muted">未产羔</span>'}</dd>
        <dt>泌乳状态</dt><dd>${esc(g.milk_role || '-')}</dd>
        <dt>备注</dt><dd>${esc(g.note || '-')}</dd>
      </dl>
    </div>

    ${g.kids?.length ? `<div class="card">
      <div class="card-t">👶 子女 <small>${g.kids.length} 只</small></div>
      <ul class="list mt8">${g.kids.slice(0, 10).map(k => `<li data-kid="${esc(k.tag_no)}">
        <div class="li-main"><div class="li-t">${esc(k.tag_no)} ${k.sex === 'm' ? '♂' : '♀'}</div>
        <div class="li-s">${esc(k.birth_date)}</div></div>${statusBadge(k.status)}</li>`).join('')}</ul>
    </div>` : ''}

    ${canWrite ? `<div class="card">
      <div class="btn-row">
        <button class="btn btn-primary" id="addev">＋ 记事件</button>
        <button class="btn" id="editg">编辑档案</button>
      </div></div>` : ''}

    <div class="card">
      <div class="card-h"><span class="card-t">📜 事件记录 <small>${g.events.length} 条</small></span></div>
      ${g.events.length ? `<ul class="timeline">${g.events.map(e => `
        <li class="${['death', 'cull', 'sale'].includes(e.type) ? e.type : ''}">
          <div class="tl-t">${esc(e.type_name)}
            ${e.weight ? `<span class="badge n">${e.weight} kg</span>` : ''}
            ${e.amount ? `<span class="badge g">${money(e.amount)} 元</span>` : ''}
            ${e.milk_qty ? `<span class="badge b">${e.milk_qty} kg 奶</span>` : ''}</div>
          <div class="tl-s">${esc(e.event_date)}${e.barn ? ' · ' + esc(e.barn) : ''}${e.note ? ' · ' + esc(e.note) : ''}
            ${e.user_name ? ' · ' + esc(e.user_name) : ''}</div>
        </li>`).join('')}</ul>`
      : '<div class="empty"><div class="s">还没有事件记录</div></div>'}
    </div>`;

  const eb = root.querySelector('#editg');
  if (eb) eb.onclick = () => editGoat(g, o, () => detail(root, id));
  const ab = root.querySelector('#addev');
  if (ab) ab.onclick = () => eventSheet(g, o, () => detail(root, id));
}

// ---------- 事件录入 ----------
export function eventSheet(g, o, done) {
  const types = o.event_types;
  let body = `
    <div class="f"><span class="f-lb">事件类型</span>
      <div class="opt-list" id="etl">${types.map((t, i) => `
        <label><input type="radio" name="et" value="${t.code}" ${i === 0 ? 'checked' : ''}>
          <span>${t.icon} ${esc(t.label)}</span></label>`).join('')}</div></div>
    <div class="f"><span class="f-lb">日期</span>
      <input type="date" id="ed" value="${today()}" max="${today()}"></div>
    <div class="f" id="f-weight"><span class="f-lb">体重 (kg)</span>
      <input type="number" id="i-weight" step="0.01" inputmode="decimal" placeholder="选填"></div>
    <div class="f" id="f-amount"><span class="f-lb">金额 (元)</span>
      <div class="f-amount"><span>¥</span><input type="number" id="i-amount" step="0.01"
        inputmode="decimal" placeholder="0.00"></div></div>
    <div class="f" id="f-milk"><span class="f-lb">当日产奶 (kg)</span>
      <input type="number" id="i-milk" step="0.01" inputmode="decimal" placeholder="选填"></div>
    <div class="f" id="f-barn"><span class="f-lb">转群到栋舍</span>
      <input type="text" id="i-barn" list="barnList" placeholder="如 B栋"></div>
    <div class="f"><span class="f-lb">备注</span>
      <textarea id="i-note" rows="2" placeholder="选填"></textarea></div>
    <div id="kid-block" style="display:none">
      <div class="hr"></div>
      <div class="f-lb" style="font-weight:650;margin-bottom:8px">🐐 同时为羔羊建档（选填）</div>
      <div class="f-grid">
        <div class="f"><span class="f-lb">羔羊耳标号</span><input type="text" id="i-ktag" placeholder="如 A2025-001"></div>
        <div class="f"><span class="f-lb">性别</span>
          <select id="i-ksex"><option value="f">母</option><option value="m">公</option></select></div>
      </div>
      <div class="f"><span class="f-lb">初生体重 (kg)</span>
        <input type="number" id="i-kw" step="0.01" inputmode="decimal" placeholder="选填"></div>
    </div>
    <datalist id="barnList">${o.barns.map(b => `<option value="${esc(b)}">`).join('')}</datalist>`;

  sheet({
    title: `${g.tag_no} · 记事件`, body,
    footer: `<button class="btn" data-x>取消</button><button class="btn btn-primary" data-ok>保存</button>`,
    onMount(b, close, f) {
      const sync = () => {
        const code = b.querySelector('input[name=et]:checked').value;
        const def = types.find(t => t.code === code);
        b.querySelector('#f-weight').style.display = def.fields.includes('weight') ? '' : 'none';
        b.querySelector('#f-amount').style.display = def.fields.includes('amount') ? '' : 'none';
        b.querySelector('#f-milk').style.display = def.fields.includes('milk_qty') ? '' : 'none';
        b.querySelector('#f-barn').style.display = def.fields.includes('barn') ? '' : 'none';
        b.querySelector('#kid-block').style.display = code === 'kidding' ? '' : 'none';
        if (def.fields.includes('amount')) b.querySelector('#i-amount').focus();
      };
      b.addEventListener('change', e => { if (e.target.name === 'et') sync(); });
      sync();
      f.querySelector('[data-ok]').onclick = async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await POST(`/api/goats/${g.id}/events`, {
            event_date: b.querySelector('#ed').value,
            type: b.querySelector('input[name=et]:checked').value,
            weight: +b.querySelector('#i-weight').value || null,
            amount: +b.querySelector('#i-amount').value || 0,
            milk_qty: +b.querySelector('#i-milk').value || null,
            barn: b.querySelector('#i-barn').value.trim(),
            note: b.querySelector('#i-note').value.trim(),
            kid_tag_no: b.querySelector('#i-ktag').value.trim(),
            kid_sex: b.querySelector('#i-ksex').value,
            kid_weight: +b.querySelector('#i-kw').value || null,
          });
          ok('事件已记录');
          close(); done?.();
        } catch (ex) { err(ex.message); btn.disabled = false; }
      };
    },
  });
}
