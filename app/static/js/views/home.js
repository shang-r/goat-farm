import { api, esc, num, wan, money, delta, store } from '../core.js';

const S = { p: 'home' };

export async function render(root) {
  const d = await api('/api/dashboard');
  const h = d.herd, m = d.milk, w = d.money;

  root.innerHTML = `
    ${d.todos.length ? `<div class="card tight" style="padding:4px 12px">
      ${d.todos.map(t => `<a class="flex" href="${t.go}" style="padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px">
        <span style="font-size:15px">${t.icon}</span><span class="grow">${esc(t.text)}</span>
        <span style="color:var(--line2)">›</span></a>`).join('')}
    </div>` : ''}

    <!-- 钱 -->
    <div class="card-h"><span class="card-t">💰 资金与经营</span>
      <a class="card-more" href="#/rep">报表 ›</a></div>
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-l">账户总余额</div>
        <div class="kpi-v">${wan(w.cash_total)}<small>元</small></div>
        <div class="kpi-d flat">应收 ${wan(w.receivable)} · 应付 ${wan(w.payable)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-l">本月净利润</div>
        <div class="kpi-v" style="color:${w.month_profit >= 0 ? 'var(--up)' : 'var(--down)'}">${wan(w.month_profit)}<small>元</small></div>
        ${delta(w.month_profit, w.prev_profit, '元', 0)}
      </div>
    </div>
    <div class="kpis c3">
      <div class="kpi"><div class="kpi-l">本月收入</div><div class="kpi-v" style="font-size:17px">${wan(w.month_income)}</div></div>
      <div class="kpi"><div class="kpi-l">本月支出</div><div class="kpi-v" style="font-size:17px">${wan(w.month_expense)}</div></div>
      <div class="kpi"><div class="kpi-l">本年累计</div><div class="kpi-v" style="font-size:17px;color:${w.year_profit >= 0 ? 'var(--up)' : 'var(--down)'}">${wan(w.year_profit)}</div></div>
    </div>

    <!-- 羊 -->
    <div class="card-h"><span class="card-t">🐑 存栏</span>
      <a class="card-more" href="#/herd">存栏统计 ›</a></div>
    <div class="kpis c3">
      <div class="kpi"><div class="kpi-l">在场总数</div><div class="kpi-v">${num(h.total, 0)}<small>只</small></div>
        <div class="kpi-d ${h.delta_day > 0 ? 'up' : h.delta_day < 0 ? 'down' : 'flat'}">
          ${h.delta_day > 0 ? '+' : ''}${h.delta_day} 较昨日</div></div>
      <div class="kpi"><div class="kpi-l">泌乳母羊</div><div class="kpi-v">${num(h.milking, 0)}<small>只</small></div>
        <div class="kpi-d flat">占 ${num(h.total ? h.milking / h.total * 100 : 0, 0)}%</div></div>
      <div class="kpi"><div class="kpi-l">本月进出</div>
        <div class="kpi-v" style="font-size:17px">+${h.born_month} / -${h.out_month}</div>
        <div class="kpi-d flat">出生 / 离场</div></div>
    </div>

    <!-- 奶 -->
    <div class="card-h"><span class="card-t">🍼 产奶</span>
      <a class="card-more" href="#/milk">产奶统计 ›</a></div>
    <div class="kpis c3">
      <div class="kpi"><div class="kpi-l">本月产量</div><div class="kpi-v">${num(m.month_kg, 0)}<small>kg</small></div>
        ${delta(m.month_kg, m.prev_kg, 'kg', 0)}</div>
      <div class="kpi"><div class="kpi-l">今日产量</div><div class="kpi-v">${num(m.today_kg, 1)}<small>kg</small></div>
        <div class="kpi-d flat">月均 ${num(m.per_head, 2)} kg/头·日</div></div>
      <div class="kpi"><div class="kpi-l">奶款收入</div><div class="kpi-v">${wan(m.month_amount)}<small>元</small></div>
        <div class="kpi-d flat">占月收入 ${num(m.month_amount / (w.month_income || 1) * 100, 0)}%</div></div>
    </div>

    <!-- 最近流水 -->
    ${d.recent.length ? `<div class="card">
      <div class="card-h"><span class="card-t">🧾 最近记账</span>
        <a class="card-more" href="#/fin">全部 ›</a></div>
      <ul class="list">${d.recent.map(r => `
        <li>
          <div class="avatar" style="${r.direction === 'income' ? 'background:var(--danger-soft);color:var(--up)' : ''}">
            ${r.direction === 'income' ? '收' : '支'}</div>
          <div class="li-main">
            <div class="li-t">${esc(r.cat)}${r.note ? ` <span class="muted small" style="font-weight:400">${esc(r.note)}</span>` : ''}</div>
            <div class="li-s"><span>${esc(r.biz_date)}</span><span>${esc(r.acct)}</span>${r.usr ? `<span>${esc(r.usr)}</span>` : ''}</div>
          </div>
          <div class="li-v ${r.direction === 'income' ? 'in' : 'out'}">${r.direction === 'income' ? '+' : '−'}${money(r.amount)}</div>
        </li>`).join('')}</ul>
    </div>` : `<div class="card">${quickStart(store)}</div>`}`;

  root.insertAdjacentHTML('beforeend', `
    ${store.can('milk.write') ? `<button class="fab" data-act="quick-milk" aria-label="快速记产奶">🍼</button>` : ''}`);

  const fab = root.querySelector('[data-act="quick-milk"]');
  if (fab) fab.onclick = () => import('./milk.js').then(m => m.quickMilk());
  document.title = `羊场管家 · ${h.total}只`;
}

function quickStart(store) {
  return `<div class="empty"><div class="ico">🌱</div>
    <div class="t">还没有记账数据</div>
    <div class="s">从「产奶」录入每天的产量，<br>再到「记账」登记奶款，系统会自动生成利润表。</div>
    <div class="btn-row mt12" style="max-width:280px;margin-left:auto;margin-right:auto">
      <a class="btn btn-primary" href="#/milk">记产奶</a>
      <a class="btn" href="#/fin">记一笔</a>
    </div></div>`;
}
