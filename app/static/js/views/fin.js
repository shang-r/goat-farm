import {
  api, esc, num, money, wan, store, ok, err, sheet, formSheet, on, POST, PUT, DEL,
  barChart, emptyBox, confirmBox,
  today, thisMonth, monthStart, monthEnd, download,
} from '../core.js';

const money_ = (n, dp = 2) => '¥' + money(n, dp);

const S = { tab: 'list', month: '', year: '', o: null, filter: { account_id: '', category_id: '', direction: '' } };

export async function render(root) {
  const sub = { list: listTab, acct: acctTab, cat: catTab, trans: transTab }[S.tab] || listTab;
  root.innerHTML = `
    <div class="segs">
      <button class="${S.tab === 'list' ? 'on' : ''}" data-t="list">流水</button>
      <button class="${S.tab === 'acct' ? 'on' : ''}" data-t="acct">账户余额</button>
      <button class="${S.tab === 'trans' ? 'on' : ''}" data-t="trans">收支分析</button>
      <button class="${S.tab === 'cat' ? 'on' : ''}" data-t="cat">科目</button>
    </div>
    <div id="fbody"><div class="card"><div class="skel" style="height:17px"></div></div></div>`;
  on(root, 'click', '[data-t]', (e, el) => { S.tab = el.dataset.t; render(root); });
  await sub(root.querySelector('#fbody'));
}

const ref = () => document.querySelector('#fbody');

// ---------- 流水 ----------
async function listTab(root) {
  S.month ||= thisMonth();
  const [acc, cats] = await Promise.all([
    S.o ||= api('/api/fin/accounts'),
    api('/api/fin/categories'),
  ]);
  const qs = new URLSearchParams({ start: monthStart(S.month), end: monthEnd(S.month), limit: 300 });
  Object.entries(S.filter).forEach(([k, v]) => { if (v !== '' && v != null) qs.set(k, v); });
  const d = await api('/api/fin/txns?' + qs);

  const catName = (id) => cats.items.flatMap(c => c._group ? [] : [c]).find(c => c.id === +id)?.name || '';

  root.innerHTML = `
    <div class="segs" style="margin-bottom:10px">
      ${monthsAround(S.month).map(m => `<button class="${S.month === m ? 'on' : ''}" data-m="${m}">${m.slice(5)}月</button>`).join('')}
    </div>
    <div class="card tight">
      <div class="kpis c3" style="margin-bottom:0">
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">收入</div><div class="kpi-v" style="font-size:18px;color:var(--up)">${wan(d.income)}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">支出</div><div class="kpi-v" style="font-size:18px;color:var(--down)">${wan(d.expense)}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">结余</div>
          <div class="kpi-v" style="font-size:18px;color:${d.net >= 0 ? 'var(--up)' : 'var(--down)'}">${wan(d.net)}</div></div>
      </div>
    </div>

    <div class="chips">
      <button class="chip ${!S.filter.account_id ? 'on' : ''}" data-clr="account_id">全部账户</button>
      ${acc.items.filter(a => a.active).slice(0, 5).map(a =>
    `<button class="chip ${String(S.filter.account_id) === String(a.id) ? 'on' : ''}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}
      <button class="chip ${!S.filter.direction ? 'on' : ''}" data-clr="direction">全部方向</button>
      <button class="chip ${S.filter.direction === 'income' ? 'on' : ''}" data-dir="income">只看收</button>
      <button class="chip ${S.filter.direction === 'expense' ? 'on' : ''}" data-dir="expense">只看支</button>
    </div>

    <div class="card">
      ${d.items.length ? `<ul class="list">${d.items.map(t => `
        <li data-id="${t.id}">
          <div class="avatar" style="background:${t.direction === 'income' ? 'var(--danger-soft);color:var(--up)' : 'var(--brand-soft);color:var(--down)'}">
            ${t.direction === 'income' ? '收' : '支'}</div>
          <div class="li-main">
            <div class="li-t">${esc(t.category_name)}
              ${!t.affect ? '<span class="badge n">不计损益</span>' : ''}
              ${t.group_name ? `<span class="badge n">${esc(t.group_name)}</span>` : ''}</div>
            <div class="li-s"><span>${esc(t.biz_date)}</span><span>${esc(t.account_name)}</span>
              ${t.counterparty ? `<span>${esc(t.counterparty)}</span>` : ''}
              ${t.note ? `<span>${esc(t.note.slice(0, 14))}</span>` : ''}</div>
          </div>
          <div class="li-v ${t.direction === 'income' ? 'in' : 'out'}">${t.direction === 'income' ? '+' : '−'}${money(t.amount)}</div>
        </li>`).join('')}</ul>`
      : emptyBox('本月还没有记账', '点右下角记一笔')}
    </div>

    ${d.total > d.items.length ? `<div class="small muted right">仅显示前 ${d.items.length} 条，共 ${d.total} 条</div>` : ''}

    <div class="flex gap8 mt12">
      <button class="btn grow" id="exp">⬇ 导出本月明细</button>
    </div>

    ${store.can('fin.write') ? `<button class="fab" id="fab">+</button>` : ''}`;

  on(root, 'click', '[data-m]', (e, el) => { S.month = el.dataset.m; listTab(root); });
  on(root, 'click', '[data-acc]', (e, el) => { S.filter.account_id = el.dataset.acc; listTab(root); });
  on(root, 'click', '[data-dir]', (e, el) => { S.filter.direction = el.dataset.dir; listTab(root); });
  on(root, 'click', '[data-clr]', (e, el) => { S.filter[el.dataset.clr] = ''; listTab(root); });
  root.querySelector('#exp').onclick = () => {
    download(`/api/rep/export/txns?start=${monthStart(S.month)}&end=${monthEnd(S.month)}&token=${store.token}`);
    ok('正在导出 Excel');
  };
  const fab = root.querySelector('#fab');
  if (fab) fab.onclick = () => addTxn(() => listTab(root));
  on(root, 'click', 'li[data-id]', (e, el) => {
    const t = d.items.find(x => x.id === +el.dataset.id);
    detailSheet(t, () => listTab(root));
  });
}

function monthsAround(m) {
  const out = [];
  const [y, mo] = m.split('-').map(Number);
  for (let i = 2; i >= -2; i--) {
    const t = new Date(y, mo - 1 + i, 1);
    out.push(t.toLocaleDateString('sv-SE').slice(0, 7));
  }
  return out;
}

// ---------- 记一笔 ----------
export async function addTxn(done, preset = {}) {
  const [acc, cats] = await Promise.all([
    api('/api/fin/accounts'), api('/api/fin/categories'),
  ]);
  const dir = preset.direction || 'expense';
  const flat = cats.items.filter(c => !c._group && c.kind === dir);

  formSheet({
    title: '记一笔',
    fields: [
      { name: 'biz_date', label: '日期', type: 'date', required: true, value: preset.biz_date || today() },
      { name: 'direction', label: '方向', type: 'radio', required: true, value: dir,
        options: [{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }] },
      { name: 'amount', label: '金额 (元)', type: 'money', required: true,
        quick: [100, 500, 1000, 5000] },
      { name: 'category_id', label: '收支科目', type: 'select', required: true,
        value: preset.category_id || '',
        options: flat.map(c => ({ value: c.id, label: `${c.group_name} / ${c.name}` })),
        placeholder: '请选择科目' },
      { name: 'account_id', label: '资金账户', type: 'select', required: true,
        value: preset.account_id || acc.items.find(a => a.is_money && a.active)?.id || '',
        options: acc.items.filter(a => a.active).map(a => ({ value: a.id, label: `${a.name}（余 ${money(a.balance, 0)}）` })) },
      { name: 'counterparty', label: '对方', value: '', placeholder: '如：xx饲料厂 / 张老板' },
      { name: 'note', label: '摘要', type: 'textarea', rows: 2, placeholder: '买了什么、为什么花' },
      { name: 'affect', label: '计入利润表', type: 'select', value: 1,
        options: [{ value: 1, label: '计入（正常经营收支）' }, { value: 0, label: '不计入（借款、转账、收回应收等往来款）' }],
        hint: '往来款只影响账户余额，不影响利润' },
    ],
    onSubmit: async (d) => {
      d.amount = Math.abs(+d.amount);
      d.affect = +d.affect;
      await POST('/api/fin/txns', d);
      ok(`已记账 ¥${money(d.amount)}`);
      done?.();
    },
  });
}

function detailSheet(t, done) {
  sheet({
    title: `${t.biz_date} · ${t.category_name}`,
    body: `<dl class="kv">
      <dt>金额</dt><dd style="font-size:18px;font-weight:700;color:${t.direction === 'income' ? 'var(--up)' : 'var(--down)'}">
        ${t.direction === 'income' ? '+' : '−'} ¥ ${money(t.amount)}</dd>
      <dt>账户</dt><dd>${esc(t.account_name)}</dd>
      <dt>科目分类</dt><dd>${esc(t.group_name || '-')}</dd>
      <dt>对方</dt><dd>${esc(t.counterparty || '-')}</dd>
      <dt>摘要</dt><dd>${esc(t.note || '-')}</dd>
      <dt>计入损益</dt><dd>${t.affect ? '是' : '否'}</dd>
      <dt>经手人</dt><dd>${esc(t.user_name || '-')}</dd></dl>`,
    footer: store.can('fin.write')
      ? `<button class="btn btn-danger" style="flex:0 0 84px" data-del ${t.link_type ? 'disabled' : ''}>删除</button>
         <button class="btn btn-primary" data-ed>编辑</button>` : '',
    onMount(b, close, f) {
      const de = f.querySelector('[data-del]');
      if (de) de.onclick = () => {
        close();
        confirmBox('删除流水', `删除 ${t.biz_date} 的「${t.category_name}」¥${money(t.amount)}？`, async () => {
          try { await DEL('/api/fin/txns/' + t.id); ok('已删除'); done?.(); }
          catch (e) { err(e.message); }
        });
      };
      const ed = f.querySelector('[data-ed]');
      if (ed) ed.onclick = async () => {
        close();
        const [acc, cats] = await Promise.all([api('/api/fin/accounts'), api('/api/fin/categories')]);
        const flat = cats.items.filter(c => !c._group && c.kind === t.direction);
        formSheet({
          title: '编辑流水',
          fields: [
            { name: 'biz_date', label: '日期', type: 'date', required: true, value: t.biz_date },
            { name: 'amount', label: '金额 (元)', type: 'money', required: true, value: t.amount },
            { name: 'category_id', label: '科目', type: 'select', required: true, value: t.category_id,
              options: flat.map(c => ({ value: c.id, label: `${c.group_name} / ${c.name}` })) },
            { name: 'account_id', label: '账户', type: 'select', required: true, value: t.account_id,
              options: acc.items.filter(a => a.active).map(a => ({ value: a.id, label: a.name })) },
            { name: 'counterparty', label: '对方', value: t.counterparty },
            { name: 'note', label: '摘要', type: 'textarea', rows: 2, value: t.note },
          ],
          onSubmit: async (d) => {
            await PUT('/api/fin/txns/' + t.id,
              { ...d, direction: t.direction, amount: Math.abs(+d.amount) });
            ok('已保存'); done?.();
          },
        });
      };
    },
  });
}

// ---------- 账户余额 ----------
async function acctTab(root) {
  const d = await api('/api/fin/balances');
  root.innerHTML = `
    <div class="card">
      <div class="card-t mb0">净资产头寸</div>
      <div class="flex mt12" style="align-items:baseline;gap:6px">
        <span class="num" style="font-size:30px;font-weight:700">¥ ${money(d.money_total + d.receivable - d.payable)}</span>
      </div>
      <div class="small muted">现金类 ${money(d.money_total, 0)} ＋ 应收 ${money(d.receivable, 0)} − 应付 ${money(d.payable, 0)}</div>
    </div>

    ${['is_money', 'receivable', 'payable'].map(kind => {
    const list = d.items.filter(a => kind === 'is_money' ? a.is_money : a.kind === kind);
    if (!list.length) return '';
    return `<div class="card">
        <div class="card-h"><span class="card-t">${kind === 'is_money' ? '💵 资金账户' : kind === 'receivable' ? '📥 应收账款' : '📤 应付账款'}</span>
          ${store.can('fin.write') ? `<span class="card-more" data-add="${kind}">＋ 新增</span>` : ''}</div>
        <ul class="list">${list.map(a => `
          <li>
            <div class="li-main">
              <div class="li-t">${esc(a.name)}<span class="badge n">${esc(a.kind_name)}</span></div>
              <div class="li-s"><span>期初 ${money_(a.opening_balance)}</span>
                <span class="txt-in">收 ${money_(a.income)}</span>
                <span class="txt-out">支 ${money_(a.expense)}</span></div>
            </div>
            <div class="li-v" style="color:${a.balance >= 0 ? 'var(--ink)' : 'var(--danger)'}">${money_(a.balance)}</div>
          </li>`).join('')}</ul>
      </div>`;
  }).join('')}

    ${store.can('fin.write') ? `<div class="btn-row mt12">
      <button class="btn" id="tr">⇄ 账户对转</button>
      <button class="btn" id="op">📥 改期初余额</button>
    </div>` : ''}
    <div class="notice mt12">余额公式：期初 + 收入 − 支出（应付账户相反）。
      <b>应收</b>记销售形成应收，回款时在应收账户记一笔「应收收回」（不计损益），同时在银行账户记一笔收入。</div>`;

  on(root, 'click', '[data-add]', (e, el) => editAccount(null, el.dataset.add, () => acctTab(root)));
  root.querySelector('#tr')?.addEventListener('click', () => transferSheet(() => acctTab(root)));
  root.querySelector('#op')?.addEventListener('click', () => openingSheet(d, () => acctTab(root)));
}

function editAccount(a, kind, done) {
  const K = { is_money: 'cash', receivable: 'receivable', payable: 'payable' };
  formSheet({
    title: a ? '编辑账户' : '新增账户',
    fields: [
      { name: 'name', label: '账户名称', required: true, value: a?.name, placeholder: '如：农商行基本户' },
      { name: 'kind', label: '类型', type: 'select', required: true, value: a?.kind || K[kind] || 'cash',
        options: [{ value: 'cash', label: '现金' }, { value: 'bank', label: '银行' },
          { value: 'wechat', label: '微信/支付宝' }, { value: 'other', label: '其他' },
          { value: 'receivable', label: '应收（客户欠款）' }, { value: 'payable', label: '应付（供应商欠款）' }] },
      { name: 'note', label: '备注', value: a?.note },
    ],
    onSubmit: async (d) => {
      if (a) await PUT('/api/fin/accounts/' + a.id, d);
      else await POST('/api/fin/accounts', { ...d, opening_balance: 0, opening_date: today() });
      ok('已保存'); done?.();
    },
  });
}

function openingSheet(d, done) {
  const money = d.items.filter(a => a.is_money);
  sheet({
    title: '修改期初余额',
    body: `<div class="notice i">期初余额是你开始用这个系统那天，账户里的钱。之后所有余额都由流水自动累加。</div>
      <div class="opt-list">${money.map(a => `
        <label data-acct="${a.id}" style="cursor:pointer">
          <span>${esc(a.name)}</span>
          <span class="meta">当前 ${money_(a.balance)}</span>
        </label>`).join('')}</div>
      <div class="f mt12" id="of" style="display:none">
        <span class="f-lb">新的期初余额 (元)</span>
        <div class="f-amount"><span>¥</span><input type="number" step="0.01" id="ov" inputmode="decimal"></div>
        <div class="hint">当前该账户余额 <b id="cur"></b> 元，改为期初后余额会同步变化。</div>
      </div>`,
    onMount(b, close) {
      b.addEventListener('click', e => {
        const l = e.target.closest('[data-acct]');
        if (!l) return;
        const a = d.items.find(x => x.id === +l.dataset.acct);
        b.querySelector('#of').style.display = '';
        b.querySelector('#ov').value = a.opening_balance;
        b.querySelector('#cur').textContent = money_(a.balance);
        b.querySelector('#ov').onchange = async () => {
          await PUT(`/api/fin/accounts/${a.id}/opening`,
            { opening_balance: +b.querySelector('#ov').value || 0, opening_date: a.opening_date });
          ok('期初余额已更新'); close(); done?.();
        };
      });
    },
  });
}

async function transferSheet(done) {
  const acc = (await api('/api/fin/accounts')).items.filter(a => a.is_money && a.active);
  formSheet({
    title: '账户对转',
    note: '现金存银行、银行转到微信等。只改变钱在哪个账户，不影响利润表。',
    fields: [
      { name: 'biz_date', label: '日期', type: 'date', required: true, value: today() },
      { name: 'from_account_id', label: '从哪个账户转出', type: 'select', required: true,
        options: acc.map(a => ({ value: a.id, label: `${a.name}（${money(a.balance, 0)}）` })) },
      { name: 'to_account_id', label: '转到哪个账户', type: 'select', required: true,
        options: acc.map(a => ({ value: a.id, label: a.name })) },
      { name: 'amount', label: '金额 (元)', type: 'money', required: true, quick: [500, 1000, 5000, 10000] },
      { name: 'note', label: '摘要', value: '内部对转' },
    ],
    onSubmit: async (d) => {
      await POST('/api/fin/transfer', d);
      ok('已对转'); done?.();
    },
  });
}

// ---------- 收支分析 ----------
async function transTab(root) {
  S.year ||= new Date().getFullYear();
  const [m, d] = await Promise.all([
    api('/api/fin/monthly?year=' + S.year),
    api('/api/fin/txns?start=' + S.year + '-01-01&end=' + S.year + '-12-31&limit=1'),
  ]);
  const yearTotals = m.items.reduce((s, x) => ({
    income: s.income + x.income, expense: s.expense + x.expense, profit: s.profit + x.profit,
  }), { income: 0, expense: 0, profit: 0 });

  root.innerHTML = `
    <div class="segs" style="margin-bottom:10px">
      ${[new Date().getFullYear(), new Date().getFullYear() - 1].map(y =>
    `<button class="${S.year === y ? 'on' : ''}" data-y="${y}">${y} 年</button>`).join('')}
    </div>
    <div class="card">
      <div class="card-h"><span class="card-t">逐月收支柱状图</span></div>
      ${barChart(m.items.map(x => ({ label: (+x.month.slice(5)) + '月', income: x.income, expense: x.expense })),
    { h: 165, series: [{ k: 'income', c: '#e0392f', name: '收入' }, { k: 'expense', c: '#1f7a52', name: '支出' }], fmt: wan })}
    </div>
    <div class="card">
      <div class="card-t mb0">${S.year} 年合计</div>
      <div class="dl mt12"><span class="muted">总收入</span><b class="txt-in">¥ ${money(yearTotals.income)}</b></div>
      <div class="dl"><span class="muted">总支出</span><b class="txt-out">¥ ${money(yearTotals.expense)}</b></div>
      <div class="dl"><span class="muted">净利润</span>
        <b style="color:${yearTotals.profit >= 0 ? 'var(--up)' : 'var(--down)'}">¥ ${money(yearTotals.profit)}</b></div>
    </div>
    <div class="card">
      <div class="card-h"><span class="card-t">逐月明细</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>月份</th><th>收入</th><th>支出</th><th>利润</th></tr></thead>
        <tbody>${m.items.map(x => `<tr><td>${x.month}</td>
          <td class="pos">${x.income ? num(x.income, 0) : '-'}</td>
          <td class="neg">${x.expense ? num(x.expense, 0) : '-'}</td>
          <td class="${x.profit >= 0 ? 'pos' : 'neg'}">${x.profit ? num(x.profit, 0) : '-'}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;
  on(root, 'click', '[data-y]', (e, el) => { S.year = +el.dataset.y; transTab(root); });
}

// ---------- 科目管理 ----------
async function catTab(root) {
  const d = await api('/api/fin/categories');
  const order = [...new Set(d.items.filter(c => c._group).map(c => c._group))];

  root.innerHTML = `
    ${store.can('fin.write') ? `<div class="btn-row mb0">
      <button class="btn btn-primary" id="addc">＋ 新增科目</button>
    </div><div style="height:12px"></div>` : ''}
    ${order.map(gn => `
      <div class="card">
        <div class="card-h"><span class="card-t">${esc(gn)}</span></div>
        <ul class="list">${d.items.filter(c => !c._group && c.group_name === gn).map(c => `
          <li><div class="li-main"><div class="li-t">${esc(c.name)}
            ${c.kind === 'income' ? '<span class="badge r">收</span>' : '<span class="badge g">支</span>'}
            ${!c.affect ? '<span class="badge n">不计损益</span>' : ''}</div></div></li>`).join('')}</ul>
      </div>`).join('')}
    <div class="notice">「不计损益」的科目用于借款还款、内部转账、应收收回等<b>只动钱不动利润</b>的往来业务。
      想新增自己的科目（比如「青贮玉米」「冷链费」），点上面的按钮加。</div>`;

  root.querySelector('#addc')?.addEventListener('click', () => {
    formSheet({
      title: '新增收支科目',
      fields: [
        { name: 'name', label: '科目名称', required: true, placeholder: '如：青贮玉米' },
        { name: 'kind', label: '方向', type: 'radio', required: true, value: 'expense',
          options: [{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }] },
        { name: 'group_name', label: '归入分类', type: 'select', required: true, value: '生产费用',
          options: ['饲料', '防疫医疗', '繁殖', '生产费用', '管理费用', '主营业务', '其他收益', '资金往来', '其他']
            .map(g => ({ value: g, label: g })) },
        { name: 'affect', label: '是否计入利润表', type: 'radio', value: 1,
          options: [{ value: 1, label: '计入' }, { value: 0, label: '不计入' }] },
      ],
      onSubmit: async (d) => {
        d.affect = +d.affect;
        await POST('/api/fin/categories', d);
        ok('已新增科目'); catTab(root);
      },
    });
  });
}
