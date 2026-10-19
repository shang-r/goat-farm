import {
  api, esc, num, money, wan, store, ok, sheet, on, barChart, groupBar,
  emptyBox, download, today,
} from '../core.js';

const S = { tab: 'profit', preset: 'month', start: '', end: '' };

const PRESETS = [
  ['month', '本月'], ['last_month', '上月'], ['quarter', '本季'], ['year', '本年'], ['last_30', '近30天'],
];
const PRESET_SQL = { last_month: 'prev_month' };

export async function render(root) {
  const sub = { profit: profitTab, cash: cashTab, sheet: sheetTab, ledger: ledgerTab, ops: opsTab }[S.tab] || profitTab;
  root.innerHTML = `
    <div class="segs">
      <button class="${S.tab === 'profit' ? 'on' : ''}" data-rt="profit">利润表</button>
      <button class="${S.tab === 'cash' ? 'on' : ''}" data-rt="cash">现金流</button>
      <button class="${S.tab === 'sheet' ? 'on' : ''}" data-rt="sheet">资产负债</button>
      <button class="${S.tab === 'ledger' ? 'on' : ''}" data-rt="ledger">科目汇总</button>
      <button class="${S.tab === 'ops' ? 'on' : ''}" data-rt="ops">经营分析</button>
    </div>
    <div id="rbody"><div class="card"><div class="skel" style="height:17px"></div></div></div>`;
  on(root, 'click', '[data-rt]', (e, el) => { S.tab = el.dataset.rt; render(root); });
  await sub(root.querySelector('#rbody'));
}

const ref = () => document.querySelector('#rbody');
const p = () => (PRESET_SQL[S.preset] || S.preset);

function periodBar(extra = '') {
  return `<div class="segs" style="margin-bottom:10px">
    ${PRESETS.map(([k, t]) => `<button class="${S.preset === k ? 'on' : ''}" data-rp="${k}">${t}</button>`).join('')}
  </div>${extra}`;
}

function exportBar(urls) {
  return `<div class="flex gap8 mt12" style="gap:8px">
    ${urls.map(([label, u]) => `<button class="btn grow" data-re="${u}" style="flex:1">⬇ ${esc(label)}</button>`).join('')}
  </div>`;
}

// ---------- 利润表 ----------
async function profitTab(root) {
  const [d, trend] = await Promise.all([
    api(`/api/rep/profit?preset=${p()}`),
    api('/api/rep/trend?start=' + new Date().getFullYear() + '-01-01&end=' + today()),
  ]);
  const c = d.current, cp = d.compare;

  root.innerHTML = `
    ${periodBar()}
    <div class="card">
      <div class="card-h"><span class="card-t">${d.start} ~ ${d.end}</span>
        ${cp ? `<span class="small ${c.profit >= cp.profit ? 'txt-in' : 'txt-out'}">
          环比 ${c.profit >= cp.profit ? '+' : ''}${wan(c.profit - cp.profit)}</span>` : ''}</div>
      <div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="kpi-l">营业收入</div>
          <div class="kpi-v" style="font-size:20px;color:var(--up)">${wan(c.total_income)}</div>
          ${cp ? `<div class="kpi-d ${c.total_income >= cp.income ? 'up' : 'down'}">
            ${c.total_income >= cp.income ? '+' : ''}${wan(c.total_income - cp.income)} 环比</div>` : ''}</div>
        <div class="kpi"><div class="kpi-l">营业成本费用</div>
          <div class="kpi-v" style="font-size:20px;color:var(--down)">${wan(c.total_expense)}</div>
          ${cp ? `<div class="kpi-d ${c.total_expense <= cp.expense ? 'up' : 'down'}">
            ${c.total_expense - cp.expense >= 0 ? '+' : ''}${wan(c.total_expense - cp.expense)} 环比</div>` : ''}</div>
      </div>
      <div class="flex" style="align-items:baseline;justify-content:space-between;padding:10px 12px;
        background:${c.profit >= 0 ? 'var(--brand-soft)' : 'var(--danger-soft)'};border-radius:11px">
        <span style="font-size:14px;font-weight:600">${c.profit >= 0 ? '利润总额' : '亏损总额'}</span>
        <span class="num" style="font-size:25px;font-weight:700;color:${c.profit >= 0 ? 'var(--up)' : 'var(--danger)'}">
          ¥ ${money(c.profit)}</span>
      </div>
      ${c.total_income ? `<div class="small muted right mt8">利润率 ${num(c.margin, 1)}%</div>` : ''}
    </div>

    ${plGroup(c.income, '收入', 'pos')}
    ${plGroup(c.expense, '成本费用', 'neg')}

    ${trend.items.length > 1 ? `<div class="card">
      <div class="card-h"><span class="card-t">逐月盈亏</span><span class="small muted">${trend.items[0].month} 起</span></div>
      ${barChart(trend.items.map(x => ({ label: (+x.month.slice(5)) + '月', income: x.income, expense: x.expense })),
    { h: 155, series: [{ k: 'income', c: '#e0392f', name: '收入' }, { k: 'expense', c: '#1f7a52', name: '支出' }], fmt: wan })}
      <div class="tbl-wrap mt12"><table class="tbl">
        <thead><tr><th>月份</th><th>收入</th><th>支出</th><th>利润</th></tr></thead>
        <tbody>${trend.items.slice(-6).reverse().map(x => `<tr><td>${x.month}</td>
          <td class="pos">${num(x.income, 0)}</td><td class="neg">${num(x.expense, 0)}</td>
          <td class="${x.profit >= 0 ? 'pos' : 'neg'}"><b>${num(x.profit, 0)}</b></td></tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    ${exportBar([['导出利润表', `/api/rep/export/profit?preset=${p()}&token=${store.token}`],
    ['导出月报', `/api/rep/export/summary?preset=${p()}&token=${store.token}`]])}`;

  bind(root);
}

function plGroup(groups, title, cls) {
  if (!groups?.length) return '';
  const total = groups.reduce((s, g) => s + g.amount, 0);
  return `<div class="card">
    <div class="card-h"><span class="card-t">${title}明细</span>
      <span class="small muted">合计 ¥${money(total)}</span></div>
    ${groups.map(g => `
      <div class="flex between" style="margin-top:9px">
        <span class="small muted">${esc(g.group)}</span><b class="num small">${money(g.amount)}</b></div>
      ${g.items.map(i => `<div class="dl"><span>${esc(i.name)}
        <span class="muted small">${i.count} 笔</span></span>
        <b class="${cls}">${money(i.amount)}</b></div>`).join('')}
      <div class="hr"></div>`).join('')}
  </div>`;
}

// ---------- 现金流量表 ----------
async function cashTab(root) {
  const d = await api(`/api/rep/cashflow?preset=${p()}`);
  root.innerHTML = `
    ${periodBar()}
    <div class="card">
      <div class="kpis c3" style="margin-bottom:0">
        <div class="kpi" style="box-shadow:none;background:var(--danger-soft)">
          <div class="kpi-l">现金流入</div><div class="kpi-v" style="font-size:18px;color:var(--up)">${wan(d.total_inflow)}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">现金流出</div><div class="kpi-v" style="font-size:18px;color:var(--down)">${wan(d.total_outflow)}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--bg)">
          <div class="kpi-l">净现金流</div>
          <div class="kpi-v" style="font-size:18px;color:${d.net >= 0 ? 'var(--up)' : 'var(--danger)'}">${wan(d.net)}</div></div>
      </div>
      <div class="notice mt12" style="margin-bottom:0">
        本期净现金流 <b>${d.net >= 0 ? '为正' : '为负'}</b>：
        ${d.net >= 0 ? '经营回款大于付现支出，现金在积累。' : '支出大于回款，要关注是否需要赊料或压缩开支。'}
      </div>
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">逐月净现金流</span></div>
      ${d.rows.length ? barChart(d.rows.map(r => ({ label: (+r.month.slice(5)) + '月', net: r.net })),
      { h: 150, series: [{ k: 'net', c: '#2b9466', name: '净额' }], fmt: wan }) : emptyBox('本期无现金流')}
      <div class="tbl-wrap mt12"><table class="tbl">
        <thead><tr><th>月份</th><th>流入</th><th>流出</th><th>净额</th></tr></thead>
        <tbody>${d.rows.map(r => `<tr><td>${r.month}</td><td class="pos">${num(r.inflow, 0)}</td>
          <td class="neg">${num(r.outflow, 0)}</td>
          <td class="${r.net >= 0 ? 'pos' : 'neg'}"><b>${num(r.net, 0)}</b></td></tr>`).join('')}
        <tr class="tot"><td>合计</td><td>${num(d.total_inflow, 0)}</td><td>${num(d.total_outflow, 0)}</td>
          <td>${num(d.net, 0)}</td></tr></tbody></table></div>
    </div>

    ${d.by_account.length ? `<div class="card">
      <div class="card-h"><span class="card-t">各账户净流</span></div>
      ${barChart(d.by_account.map(a => ({ label: a.account, net: a.net })),
      { h: 140, series: [{ k: 'net', c: '#1f7a52', name: '净额' }], fmt: wan, label: d => d.label })}
    </div>` : ''}

    ${d.by_category.length ? `<div class="card">
      <div class="card-h"><span class="card-t">收支柱类明细</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>科目</th><th>方向</th><th>金额</th></tr></thead>
        <tbody>${d.by_category.map(c => `<tr><td>${esc(c.category)}</td>
          <td class="${c.direction === 'income' ? 'pos' : 'neg'}">${c.direction === 'income' ? '收' : '支'}</td>
          <td class="${c.direction === 'income' ? 'pos' : 'neg'}"><b>${money(c.amount, 0)}</b></td></tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}

    ${exportBar([['导出流水明细', `/api/rep/export/txns?preset=${p()}&token=${store.token}`]])}`;
  bind(root);
}

// ---------- 资产负债简表 ----------
async function sheetTab(root) {
  const [bs, ab] = await Promise.all([api('/api/rep/balance-sheet'), api('/api/fin/balances')]);
  root.innerHTML = `
    <div class="card">
      <div class="card-t mb0">截至 ${bs.date}</div>
      <div class="kpis" style="margin-bottom:0;margin-top:10px">
        <div class="kpi"><div class="kpi-l">资产总计</div><div class="kpi-v" style="font-size:20px">${wan(bs.totals.assets)}</div></div>
        <div class="kpi"><div class="kpi-l">负债合计</div><div class="kpi-v" style="font-size:20px">${wan(bs.totals.liabilities)}</div></div>
      </div>
      <div class="flex mt12" style="padding:10px 12px;background:var(--brand-soft);border-radius:11px">
        <span style="font-weight:600">净资产（家底）</span>
        <span class="num grow right" style="font-size:19px;font-weight:700">¥ ${money(bs.totals.net_asset)}</span>
      </div>
      <div class="small muted mt8">
        本年累计经营损益 <b class="num" style="color:${bs.totals.year_profit >= 0 ? 'var(--up)' : 'var(--danger)'}">${money(bs.totals.year_profit)}</b>
        ｜开业至今累计 <b class="num">${money(bs.totals.cum_profit)}</b>
      </div>
    </div>

    <div class="card">
      <div class="card-t mb0">资产</div>
      <div class="mt12">${bs.assets.map(a => `<div class="dl">
        <span>${esc(a.name)}<br><span class="muted small">${esc(a.note)}</span></span>
        <b>${money(a.amount)}</b></div>`).join('')}
        <div class="dl" style="border-top:2px solid var(--brand);padding-top:9px">
          <span style="font-weight:700">资产总计</span><b>${money(bs.totals.assets)}</b></div>
      </div>
    </div>

    <div class="card">
      <div class="card-t mb0">负债</div>
      <div class="mt12">${bs.liabilities.map(a => `<div class="dl">
        <span>${esc(a.name)}<br><span class="muted small">${esc(a.note)}</span></span>
        <b>${money(a.amount)}</b></div>`).join('')}
        <div class="dl" style="border-top:2px solid var(--brand);padding-top:9px">
          <span style="font-weight:700">负债合计</span><b>${money(bs.totals.liabilities)}</b></div>
      </div>
    </div>

    <div class="card">
      <div class="card-t mb0">净资产怎么来的</div>
      <div class="mt12">
        <div class="dl"><span class="muted">资产总计</span><b>${money(bs.totals.assets)}</b></div>
        <div class="dl"><span class="muted">减：负债合计</span><b>-${money(bs.totals.liabilities)}</b></div>
        <div class="dl" style="border-top:2px solid var(--brand);padding-top:9px">
          <span style="font-weight:700">净资产</span><b style="color:var(--brand)">${money(bs.totals.net_asset)}</b></div>
      </div>
      <div class="small muted mt8">
        累计经营利润 ${money(bs.totals.cum_profit)}，在场存栏 ${bs.totals.heads} 只。
        净资产是「还完所有欠款后，场里还值多少钱」，比累计利润更能反映场子的真实家底。
      </div>
    </div>

    <div class="notice">这是<b>管理用简表</b>，不等同于法定财务报表：
      存栏按购入成本估值（未计提折旧）、往来款按实收实付统计。
      如果系统是从中途开始用的，「资产=负债+净资产」会和实际历史有出入，
      所以这里只报净资产、不强行配平。报税/贷款请以正式报表为准。</div>

    <div class="card">
      <div class="card-t mb0">账户余额明细</div>
      <ul class="list mt12">${ab.items.map(a => `<li>
        <div class="li-main"><div class="li-t">${esc(a.name)}<span class="badge n">${esc(a.kind_name)}</span></div></div>
        <div class="li-v">${money(a.balance)}</div></li>`).join('')}</ul>
    </div>

    ${exportBar([['导出月报', `/api/rep/export/summary?preset=${p()}&token=${store.token}`]])}`;
  bind(root);
}

// ---------- 科目余额表 ----------
async function ledgerTab(root) {
  const d = await api(`/api/rep/category-ledger?preset=${p()}`);
  S.ds = d.start; S.de = d.end;
  const groups = {};
  d.items.forEach(i => (groups[i.group_name] ||= []).push(i));

  root.innerHTML = `
    ${periodBar()}
    <div class="card">
      <div class="flex" style="padding:10px 12px;background:var(--brand-soft);border-radius:11px">
        <span style="font-weight:600">${d.start} ~ ${d.end}</span>
        <span class="num grow right" style="font-weight:700;color:${d.total_profit >= 0 ? 'var(--up)' : 'var(--danger)'}">
          ¥ ${money(d.total_profit)}</span>
      </div>
    </div>

    ${d.items.length ? Object.entries(groups).map(([g, items]) => `
      <div class="card">
        <div class="card-h"><span class="card-t">${esc(g)}</span>
          <span class="small muted">${items.length} 个科目 · 点击科目查看明细</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>科目</th><th>收入</th><th>支出</th><th>笔数</th></tr></thead>
          <tbody>${items.map(i => `<tr data-cid="${i.id}" style="cursor:pointer">
            <td>${esc(i.name)}</td>
            <td class="pos">${i.income ? num(i.income, 0) : '-'}</td>
            <td class="neg">${i.expense ? num(i.expense, 0) : '-'}</td>
            <td class="muted">${i.count}</td></tr>`).join('')}
          <tr class="tot"><td>小计</td>
            <td class="pos">${num(items.reduce((s, i) => s + i.income, 0), 0)}</td>
            <td class="neg">${num(items.reduce((s, i) => s + i.expense, 0), 0)}</td>
            <td></td></tr>
          </tbody></table></div>
      </div>`).join('') : emptyBox('该期间没有发生额')}

    ${exportBar([['导出利润表', `/api/rep/export/profit?preset=${p()}&token=${store.token}`]])}`;
  bind(root);
  on(root, 'click', 'tr[data-cid]', async (e, el) => {
    const prev = el.nextElementSibling;
    if (prev && prev.classList.contains('cat-det')) { prev.remove(); return; }
    const cid = el.dataset.cid;
    const name = el.querySelector('td').textContent.trim();
    const row = document.createElement('tr');
    row.className = 'cat-det';
    row.innerHTML = `<td colspan="4"><div class="card" style="margin:6px 0 10px;border-left:3px solid var(--brand)"><div class="skel" style="height:17px"></div></div></td>`;
    el.after(row);
    const d = await api(`/api/fin/txns?category_id=${cid}&start=${S.ds}&end=${S.de}&limit=500`);
    row.innerHTML = `<td colspan="4"><div class="card" style="margin:6px 0 10px;border-left:3px solid var(--brand)">
      <div class="card-h"><span class="card-t">${esc(name)} 明细（${S.ds} ~ ${S.de}）</span>
        <span class="small muted">收入 ${num(d.income, 0)} / 支出 ${num(d.expense, 0)} / ${d.items.length} 笔 · 再点收起</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>日期</th><th>账户</th><th>金额</th><th>备注</th></tr></thead>
        <tbody>${d.items.map(t => `<tr>
          <td>${esc(t.biz_date)}</td>
          <td class="muted">${esc(t.account_name || '')}</td>
          <td class="${t.direction === 'income' ? 'pos' : 'neg'}">${t.direction === 'income' ? '+' : '-'}${num(t.amount, 0)}</td>
          <td class="muted">${esc(t.note || '')}</td></tr>`).join('')}
          ${d.items.length ? '' : '<tr><td colspan=4 class="muted">该期间无明细</td></tr>'}
        </tbody></table></div>
    </div></td>`;
  });
}

// ---------- 经营分析 ----------
async function opsTab(root) {
  const d = await api(`/api/rep/operations?preset=${p()}`);
  root.innerHTML = `
    ${periodBar()}
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">净利润</div>
        <div class="kpi-v" style="font-size:20px;color:${d.profit >= 0 ? 'var(--up)' : 'var(--danger)'}">${wan(d.profit)}</div>
        <div class="kpi-d flat">利润率 ${num(d.margin, 1)}%</div></div>
      <div class="kpi"><div class="kpi-l">总收入</div><div class="kpi-v" style="font-size:20px">${wan(d.income)}</div></div>
    </div>

    <div class="card">
      <div class="card-t mb0">🍼 奶业板块</div>
      <div class="dl mt12"><span class="muted">产奶量</span><b>${num(d.milk.weight_kg, 0)} kg</b></div>
      <div class="dl"><span class="muted">日均产量</span><b>${num(d.milk.avg_daily, 1)} kg</b></div>
      <div class="dl"><span class="muted">在群泌乳母羊</span><b>${d.milk.milking_heads} 头</b></div>
      <div class="dl"><span class="muted">日均单产</span>
        <b style="color:${d.milk.per_head_day >= 3 ? 'var(--down)' : 'var(--warn)'}">${num(d.milk.per_head_day, 2)} kg/头·日</b></div>
      <div class="dl"><span class="muted">平均奶价</span><b>${num(d.milk.avg_price, 2)} 元/kg</b></div>
      <div class="dl"><span class="muted">奶款收入</span><b class="txt-in">¥ ${money(d.milk.amount)}</b></div>
      <div class="dl"><span class="muted">奶款占总收入</span><b>${num(d.milk.share, 0)}%</b></div>
    </div>

    <div class="card">
      <div class="card-t mb0">🌾 成本结构</div>
      <div class="mt12">${groupBar([
    { label: '饲料', value: d.cost.feed },
    { label: '其他成本', value: Math.max(0, d.cost.total - d.cost.feed) },
  ], { unit: '元' })}</div>
      <div class="dl"><span class="muted">总成本费用</span><b class="txt-out">¥ ${money(d.cost.total)}</b></div>
      <div class="dl"><span class="muted">饲料占比</span>
        <b style="color:${d.cost.feed_ratio > 60 ? 'var(--warn)' : 'var(--down)'}">${num(d.cost.feed_ratio, 1)}%</b></div>
      ${d.cost.feed_ratio > 62 ? '<div class="notice mt12" style="margin-bottom:0">饲料占成本 '
      + num(d.cost.feed_ratio, 0) + '%，高于 60% 的健康线，说明料单价偏高或存在浪费，'
      + '可检查库存损耗和采购价格。</div>' : ''}
    </div>

    <div class="card">
      <div class="card-t mb0">🐑 头均效益</div>
      <div class="dl mt12"><span class="muted">在场存栏</span><b>${d.herd.total} 只</b></div>
      <div class="dl"><span class="muted">泌乳母羊</span><b>${d.herd.milking} 只</b></div>
      <div class="dl"><span class="muted">头均收入（按泌乳母羊）</span><b class="txt-in">¥ ${num(d.herd.per_head_revenue, 1)}/天</b></div>
      <div class="dl"><span class="muted">头均成本</span><b class="txt-out">¥ ${num(d.herd.per_head_cost, 1)}/天</b></div>
      <div class="dl"><span class="muted">头均毛利</span>
        <b style="color:${d.herd.per_head_revenue - d.herd.per_head_cost >= 0 ? 'var(--up)' : 'var(--danger)'}">
          ¥ ${num(d.herd.per_head_revenue - d.herd.per_head_cost, 1)}/天</b></div>
      <div class="hr"></div>
      <div class="small muted">估算口径：期间收入 ÷ 泌乳母羊数 ÷ 天数。用于判断「每头羊每天能赚多少」，
        低于 8 元要重点检查饲料成本和产奶量。</div>
    </div>`;
  bind(root);
}

// ---------- 公共绑定 ----------
function bind(root) {
  on(root, 'click', '[data-rp]', (e, el) => {
    S.preset = el.dataset.rp;
    ({ profit: profitTab, cash: cashTab, sheet: sheetTab, ledger: ledgerTab, ops: opsTab })[S.tab](ref());
  });
  on(root, 'click', '[data-re]', (e, el) => {
    download(el.dataset.re);
    ok('正在导出 Excel');
  });
}
