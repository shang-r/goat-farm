import {
  api, esc, num, lineChart, groupBar, progressBar, GROUP_COLORS, on,
} from '../core.js';

const S = { tab: 'now', days: 60, o: null };

export async function render(root) {
  S.o ||= await api('/api/goats/options');
  root.innerHTML = `
    <div class="segs">
      <button class="${S.tab === 'now' ? 'on' : ''}" data-t="now">当前存栏</button>
      <button class="${S.tab === 'trend' ? 'on' : ''}" data-t="trend">动态变化</button>
      <button class="${S.tab === 'age' ? 'on' : ''}" data-t="age">日龄结构</button>
      <button class="${S.tab === 'alert' ? 'on' : ''}" data-t="alert">饲养预警</button>
    </div>
    <div id="hbody"><div class="card"><div class="skel" style="height:17px;margin-bottom:11px"></div>
      <div class="skel" style="height:17px"></div></div></div>`;

  on(root, 'click', '[data-t]', (e, el) => { S.tab = el.dataset.t; render(root); });
  const body = root.querySelector('#hbody');
  if (S.tab === 'now') return nowTab(body);
  if (S.tab === 'trend') return trendTab(body);
  if (S.tab === 'age') return ageTab(body);
  return alertTab(body);
}

// ---------- 当前存栏 ----------
async function nowTab(root) {
  const [sum, trend] = await Promise.all([
    api('/api/herd/summary'), api('/api/herd/trend?days=30'),
  ]);
  const items = sum.matrix.filter(m => m.total > 0);
  const ratio = sum.total ? sum.milk_heads / sum.total * 100 : 0;

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">在场存栏</div><div class="kpi-v">${num(sum.total, 0)}<small>只</small></div>
        <div class="kpi-d flat">母 ${sum.female} · 公 ${sum.male}</div></div>
      <div class="kpi"><div class="kpi-l">泌乳母羊</div><div class="kpi-v">${num(sum.milking_heads, 0)}<small>只</small></div>
        <div class="kpi-d ${ratio >= 55 ? 'up' : 'down'}">占 ${num(ratio, 0)}%</div></div>
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">近 30 天存栏变化</span>
        <span class="small ${trend.change_30d >= 0 ? 'txt-in' : 'txt-out'}">
          ${trend.change_30d >= 0 ? '+' : ''}${trend.change_30d} 只</span></div>
      ${lineChart(trend.series, { fmt: num, h: 150 })}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">分组构成</span></div>
      ${groupBar(items.map(i => ({ label: i.name, value: i.total, color: GROUP_COLORS[i.code] })), { unit: '只' })}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">明细</span>
        <span class="card-more" data-go="all">在场全部 ›</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>分组</th><th>母</th><th>公</th><th>合计</th><th>占比</th></tr></thead>
        <tbody>${items.map(i => `<tr>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:3px;
            background:${GROUP_COLORS[i.code]};margin-right:6px"></span>${esc(i.name)}</td>
          <td>${i.f || '-'}</td><td>${i.m || '-'}</td><td><b>${i.total}</b></td>
          <td>${num(sum.total ? i.total / sum.total * 100 : 0, 1)}%</td></tr>`).join('')}
          <tr class="tot"><td>合计</td><td>${sum.female}</td><td>${sum.male}</td>
            <td>${sum.total}</td><td>100%</td></tr>
        </tbody></table></div>
    </div>

    ${sum.barns.length ? `<div class="card">
      <div class="card-h"><span class="card-t">栋舍分布</span></div>
      ${sum.barns.map(b => progressBar(b.name, b.count, sum.barns[0].count, { suffix: ' 只' })).join('')}
    </div>` : ''}`;

  root.querySelector('[data-go]').onclick = () => { location.hash = '#/goats'; };
}

// ---------- 动态变化 ----------
async function trendTab(root) {
  const [mv, trend] = await Promise.all([
    api('/api/herd/movements?days=30'), api('/api/herd/trend?days=' + S.days),
  ]);
  root.innerHTML = `
    <div class="segs" style="margin-bottom:10px">
      ${[30, 90, 180, 365].map(d => `<button class="${S.days === d ? 'on' : ''}" data-d="${d}">${d}天</button>`).join('')}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">存栏量趋势</span>
        <span class="small ${trend.change_30d >= 0 ? 'txt-in' : 'txt-out'}">
          区间变化 ${trend.change_30d >= 0 ? '+' : ''}${trend.change_30d} 只</span></div>
      ${lineChart(trend.series, { fmt: num, h: 160 })}
      <div class="flex between small muted mt8">
        <span>${trend.start}</span><span>期末 ${trend.series.at(-1)?.total ?? 0} 只</span><span>${trend.end}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">近 30 天进出</span></div>
      <div class="kpis c3" style="margin-bottom:0">
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">入场</div><div class="kpi-v" style="font-size:20px">${mv.in_count}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--danger-soft)">
          <div class="kpi-l">离场</div><div class="kpi-v" style="font-size:20px">${mv.out_count}</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--bg)">
          <div class="kpi-l">净增</div>
          <div class="kpi-v" style="font-size:20px;color:${mv.in_count - mv.out_count >= 0 ? 'var(--up)' : 'var(--down)'}">
            ${mv.in_count - mv.out_count >= 0 ? '+' : ''}${mv.in_count - mv.out_count}</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">变动明细</span></div>
      ${mv.items.length ? `<ul class="list">${mv.items.slice(0, 80).map(m => `
        <li data-id="${m.id}">
          <div class="avatar" style="background:${m.io === 'in' ? 'var(--brand-soft)' : 'var(--warn-soft)'};
            color:${m.io === 'in' ? 'var(--brand)' : 'var(--warn)'}">${m.io === 'in' ? '＋' : '－'}</div>
          <div class="li-main">
            <div class="li-t">${esc(m.tag_no)}<span class="badge n">${esc(m.type_name)}</span></div>
            <div class="li-s"><span>${esc(m.d)}</span><span>${esc(m.age_text)}</span>
              ${m.barn ? `<span>${esc(m.barn)}</span>` : ''}</div>
          </div>
          ${m.amount ? `<div class="li-v in">${money(m.amount)}</div>` : ''}
        </li>`).join('')}</ul>`
      : `<div class="empty"><div class="ico">📋</div><div class="s">近 30 天没有存栏变动记录</div></div>`}
    </div>`;

  on(root, 'click', '[data-d]', (e, el) => { S.days = +el.dataset.d; trendTab(root); });
  on(root, 'click', 'li[data-id]', (e, el) => location.hash = '#/goat/' + el.dataset.id);
}

// ---------- 日龄结构 ----------
async function ageTab(root) {
  const [m, sum] = await Promise.all([api('/api/herd/age-matrix'), api('/api/herd/summary')]);
  const max = Math.max(...m.buckets.map(b => b.total), 1);
  root.innerHTML = `
    <div class="card">
      <div class="card-h"><span class="card-t">日龄结构矩阵</span><span class="small muted">母 / 公</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>日龄段</th><th>母</th><th>公</th><th>合计</th><th style="width:34%">分布</th></tr></thead>
        <tbody>${m.buckets.map(b => `<tr>
          <td>${esc(b.label)}</td><td>${b.f || '-'}</td><td>${b.m || '-'}</td><td><b>${b.total}</b></td>
          <td><div style="height:8px;background:var(--line);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${(b.total / max * 100).toFixed(1)}%;background:var(--brand)"></div></div></td>
        </tr>`).join('')}
        <tr class="tot"><td>合计</td><td>${sum.female}</td><td>${sum.male}</td><td>${sum.total}</td><td></td></tr>
        </tbody></table></div>
    </div>

    <div class="card">
      <div class="card-t mb0">结构解读</div>
      <div class="mt12">
        ${advice(m, sum)}
      </div>
    </div>`;
}

function advice(m, sum) {
  const at = (label) => m.buckets.find(b => b.label === label)?.total || 0;
  const youngGoats = at('0-2月') + at('2-4月') + at('4-6月');
  const adult = at('1-1.5年') + at('1.5-3年') + at('3年以上');
  const youngRatio = sum.total ? youngGoats / sum.total * 100 : 0;
  const maleRatio = sum.total ? sum.male / sum.total * 100 : 0;
  const tips = [];
  if (sum.total < 1) return '<li>还没有在场羊只，先去「羊只」建档。</li>';
  if (youngRatio < 25)
    tips.push(`后备羊偏少（0-6 月龄占 ${num(youngRatio, 0)}%），<b>后备不足</b>，明年的可售羊和产奶规模会缩水，建议多留母羔。`);
  else if (youngRatio > 55)
    tips.push(`后备羊偏多（0-6 月龄占 ${num(youngRatio, 0)}%），短期不产奶却要吃料，<b>注意现金流</b>，可考虑分批出栏。`);
  if (maleRatio > 12)
    tips.push(`公羊占比 ${num(maleRatio, 0)}% 偏高（正常 5%-8%），多余公羊育肥出栏可降成本。`);
  if (maleRatio < 4 && sum.total > 20)
    tips.push(`公羊占比仅 ${num(maleRatio, 0)}%，注意留足种公羊，1 只种公羊可配 25-30 只母羊。`);
  if (adult > 0) {
    const r = sum.milking_heads / adult * 100;
    if (r < 70)
      tips.push(`经产泌乳羊只占成年羊 ${num(r, 0)}%，空怀或未产羔偏多，<b>配种工作要跟上</b>，可看「饲养预警」里的待配种名单。`);
  }
  if (!tips.length) tips.push('群结构基本合理，保持现有留种比例即可。');
  return `<ul class="small" style="margin:0;padding-left:18px;line-height:1.9;color:var(--ink2)">`
    + tips.map(t => `<li>${t}</li>`).join('') + '</ul>';
}

// ---------- 饲养预警 ----------
async function alertTab(root) {
  const a = await api('/api/herd/alerts');
  const groups = [
    ['待配种', '🐑', '日龄已够但没有产羔记录', 'b'],
    ['产羔临近', '🤰', '距上次产羔 120-150 天', 'w'],
    ['待断奶', '🌾', '75-100 日龄未断奶', 'n'],
    ['久未称重', '⚖', '超过 90 天没称重', 'w'],
    ['种公羊不足', '♂', '母公比例超过 25:1', 'd'],
  ];
  const total = groups.reduce((s, g) => s + (a[g[0]]?.length || 0), 0);

  root.innerHTML = `
    <div class="card tight"><div class="flex between small">
      <span class="muted">共 <b style="color:${total ? 'var(--warn)' : 'var(--down)'}">${total}</b> 条待处理</span>
      <span class="muted">数据截至今天</span></div></div>
    ${groups.map(([key, icon, desc, cls]) => {
    const list = a[key] || [];
    return `<div class="card">
        <div class="card-h"><span class="card-t">${icon} ${key}
          ${list.length ? `<span class="badge ${cls}">${list.length}</span>` : '<span class="badge g">正常</span>'}</span>
          <span class="small muted">${desc}</span></div>
        ${list.length ? `<ul class="list">${list.slice(0, 12).map(x => {
      if (key === '种公羊不足')
        return `<li><div class="li-main"><div class="li-t">母 ${x.female} 只 / 公 ${x.male} 只，比例 ${x.ratio}:1</div>
            <div class="li-s">建议再留 ${x.suggest} 只种公羊</div></div></li>`;
      const g2 = x.age_days != null ? '' : '';
      return `<li data-id="${x.id}" style="cursor:pointer">
            <div class="avatar ${x.sex}">${esc(x.tag_no.slice(-2))}</div>
            <div class="li-main"><div class="li-t">${esc(x.tag_no)}</div>
              <div class="li-s">${esc(x.barn || '未分栏')}${x.gap ? ` · 已 ${x.gap} 天` : ''}${x.last_weigh ? ` · 上次称重 ${esc(x.last_weigh)}` : ''}</div></div>
            <span class="li-arrow">›</span></li>`;
    }).join('')}</ul>` : '<div class="small muted" style="padding:4px 0">暂无</div>'}
      </div>`;
  }).join('')}`;

  on(root, 'click', 'li[data-id]', (e, el) => location.hash = '#/goat/' + el.dataset.id);
}
