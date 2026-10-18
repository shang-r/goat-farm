import {
  api, esc, num, money, wan, store, ok, sheet, formSheet, on, POST, PUT, DEL, confirmBox,
  barChart, groupBar, emptyBox,
  today, addDays, monthStart, monthEnd, md,
} from '../core.js';

const S = { tab: 'today', gran: 'day', months: 6, o: null, lastPrice: null };

export async function render(root) {
  S.o ||= await api('/api/milk/options');
  const sub = { today: todayTab, trend: trendTab, list: listTab }[S.tab] || todayTab;
  root.innerHTML = `
    <div class="segs">
      <button class="${S.tab === 'today' ? 'on' : ''}" data-t="today">快捷录入</button>
      <button class="${S.tab === 'trend' ? 'on' : ''}" data-t="trend">产量分析</button>
      <button class="${S.tab === 'list' ? 'on' : ''}" data-t="list">明细台账</button>
    </div>
    <div id="mbody"><div class="card"><div class="skel" style="height:17px"></div></div></div>`;
  on(root, 'click', '[data-t]', (e, el) => { S.tab = el.dataset.t; render(root); });
  await sub(root.querySelector('#mbody'));
}

// ---------- 快捷录入 ----------
async function todayTab(root) {
  const t = today();
  const [d, cmp] = await Promise.all([
    api('/api/milk/daily?start=' + addDays(t, -13) + '&end=' + t),
    api('/api/milk/stats?start=' + monthStart() + '&end=' + t + '&gran=day'),
  ]);
  const last7 = d.items.slice(-7);
  const todayRow = d.items.find(x => x.date === t);
  const avg7 = last7.length ? last7.reduce((s, x) => s + x.weight_kg, 0) / last7.length : 0;

  root.innerHTML = `
    <div class="card">
      <div class="card-h"><span class="card-t">📅 今日产量</span>
        <span class="small muted">${t}　${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()]}</span></div>
      <div class="flex" style="align-items:baseline;gap:8px;margin:6px 0 12px">
        <span class="num" style="font-size:40px;font-weight:700;letter-spacing:-1px">${num(todayRow?.weight_kg ?? 0, 1)}</span>
        <span class="muted">kg</span>
        ${todayRow?.milking_heads ? `<span class="badge g" style="margin-left:auto">${todayRow.milking_heads} 头在群</span>` : ''}
      </div>
      ${store.can('milk.write') ? `<div class="btn-row">
        <button class="btn btn-primary" id="qa">＋ 记一笔</button>
        <button class="btn" id="qc">快捷键录入</button>
      </div>` : '<div class="small muted">今天还没有登记</div>'}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">近 7 天</span>
        <span class="small muted">日均 ${num(avg7, 1)} kg</span></div>
      ${last7.length ? barChart(last7.map(x => ({ ...x, label: md(x.date) })), {
      h: 150, series: [{ k: 'weight_kg', c: '#1f7a52', name: '产量kg' }],
      fmt: num,
    }) : emptyBox('近 7 天还没有产奶记录')}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">本月概况</span></div>
      <div class="kpis c3" style="margin-bottom:0">
        <div class="kpi" style="box-shadow:none;background:var(--bg)">
          <div class="kpi-l">累计产量</div><div class="kpi-v" style="font-size:19px">${num(cmp.total_weight, 0)}</div>
          <div class="kpi-d flat">kg</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--bg)">
          <div class="kpi-l">日均单产</div><div class="kpi-v" style="font-size:19px">${num(cmp.per_head_today, 2)}</div>
          <div class="kpi-d flat">kg/头·日</div></div>
        <div class="kpi" style="box-shadow:none;background:var(--bg)">
          <div class="kpi-l">均价</div><div class="kpi-v" style="font-size:19px">${num(cmp.avg_price, 2)}</div>
          <div class="kpi-d flat">元/kg</div></div>
      </div>
      <div class="notice mt12" style="margin-bottom:0">
        目标对照：${cmp.milking_heads} 头泌乳母羊，若单产目标 3.0 kg/头·日，满产日产应为
        <b>${num(cmp.milking_heads * 3, 1)} kg</b>，当前日均 <b>${num(cmp.avg_daily, 1)} kg</b>。
      </div>
    </div>

    ${d.items.length ? `<div class="card">
      <div class="card-h"><span class="card-t">每日汇总</span><span class="small muted">近 14 天</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>日期</th><th>产量kg</th><th>弃奶</th><th>金额</th><th>单产</th><th></th></tr></thead>
        <tbody>${[...d.items].reverse().map(x => `<tr>
          <td>${esc(x.date)}</td><td><b>${num(x.weight_kg, 1)}</b></td>
          <td>${x.discard_kg ? num(x.discard_kg, 1) : '-'}</td>
          <td>${num(x.amount, 0)}</td>
          <td>${x.per_head ? num(x.per_head, 2) : '-'}</td>
          <td><a href="#/milk" data-del="${x.date}" style="color:var(--brand)">明细</a></td>
        </tr>`).join('')}</tbody></table></div>
    </div>` : ''}`;

  const qa = root.querySelector('#qa');
  if (qa) qa.onclick = () => editMilk(null, t);
  const qc = root.querySelector('#qc');
  if (qc) qc.onclick = quickMilk;
}

// ---------- 录入表单 ----------
export function editMilk(m, date) {
  const o = S.o;
  formSheet({
    title: m ? '编辑产奶记录' : '登记产奶量',
    fields: [
      { name: 'biz_date', label: '日期', type: 'date', required: true, value: m?.biz_date || date || today() },
      { name: 'group_code', label: '泌乳分组', type: 'select', value: m?.group_code || '全群',
        options: o.groups.map(g => ({ value: g, label: g })) },
      { name: 'batch', label: '产品批次', type: 'select', required: true, value: m?.batch || '生鲜奶',
        options: o.batches.map(b => ({ value: b, label: b })) },
      { name: 'weight_kg', label: '产量 (kg)', type: 'number', required: true, step: '0.01',
        value: m?.weight_kg, placeholder: '如 386.5' },
      { name: 'discard_kg', label: '弃奶 (kg)', type: 'number', step: '0.01', value: m?.discard_kg,
        hint: '乳房炎、药残等不能销售的奶' },
      { name: 'price', label: '单价 (元/kg)', type: 'number', required: true, step: '0.01',
        value: m?.price ?? S.lastPrice ?? 5 },
      { name: 'shift', label: '班次', type: 'radio', value: m?.shift || '早/晚',
        options: [{ value: '早', label: '早班' }, { value: '晚', label: '晚班' }, { value: '早/晚', label: '全天' }] },
      { name: 'grade', label: '等级', type: 'select', value: m?.grade, placeholder: '不填',
        options: ['优', '良', '合格'].map(v => ({ value: v, label: v })) },
      { name: 'note', label: '备注', value: m?.note },
      { name: '_amt', type: 'static', label: '预计金额',
        html: '<b id="calc" style="font-size:17px;color:var(--brand)">¥ 0.00</b>' },
    ],
    onDelete: m ? async () => { await DEL('/api/milk/' + m.id); ok('已删除'); location.hash = '#/milk'; } : null,
    onSubmit: async (d) => {
      const amt = (+d.weight_kg || 0) * (+d.price || 0);
      if (m) await PUT('/api/milk/' + m.id, d);
      else await POST('/api/milk', d);
      S.lastPrice = +d.price;
      ok(`已保存，金额 ¥${money(amt)}`);
      location.hash = '#/milk';
    },
  });
  setTimeout(() => {
    const f = document.querySelector('#fx');
    if (!f) return;
    const calc = () => {
      const c = f.querySelector('#calc');
      if (c) c.textContent = '¥ ' + money((+f.weight_kg.value || 0) * (+f.price.value || 0));
    };
    f.addEventListener('input', calc); calc();
  }, 60);
}

/** 极简快捷录入：只填产量和单价 */
export async function quickMilk() {
  const o = S.o ||= await api('/api/milk/options');
  const price = S.lastPrice ?? 5;
  formSheet({
    title: '快捷记产奶',
    note: '同一天同批次如果已经记过，会再增加一条记录。',
    submitText: '记下来',
    fields: [
      { name: 'weight_kg', label: '今天产量 (kg)', type: 'number', required: true, step: '0.1',
        placeholder: '如 386.5' },
      { name: 'price', label: '单价 (元/kg)', type: 'number', required: true, step: '0.01', value: price },
      { name: 'batch', label: '批次', type: 'select', value: '生鲜奶',
        options: o.batches.slice(0, 5).map(b => ({ value: b, label: b })) },
    ],
    onSubmit: async (d) => {
      await POST('/api/milk/quick', d);
      S.lastPrice = +d.price;
      ok(`已记 ${d.weight_kg} kg，金额 ¥${money(d.weight_kg * d.price)}`);
      location.hash = '#/milk';
    },
  });
}

// ---------- 产量分析 ----------
async function trendTab(root) {
  const s = monthStart(new Date(Date.now() - 179 * 864e5).toISOString().slice(0, 7));
  const [st, cmp, o] = await Promise.all([
    api(`/api/milk/stats?start=${s}&end=${today()}&gran=${S.gran}`),
    api('/api/milk/compare?months=' + S.months),
    S.o ||= api('/api/milk/options'),
  ]);
  const b = st.buckets;
  const maxBucket = b.reduce((m, x) => Math.max(m, x.weight_kg), 0);

  root.innerHTML = `
    <div class="segs" style="margin-bottom:10px">
      ${[['day', '按日'], ['week', '按周'], ['month', '按月']].map(([v, t]) =>
    `<button class="${S.gran === v ? 'on' : ''}" data-g="${v}">${t}</button>`).join('')}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">产量趋势</span>
        <span class="small muted">${b.length} 个${S.gran === 'day' ? '日' : S.gran === 'week' ? '周' : '月'}</span></div>
      ${b.length ? barChart(b.map(x => ({
      label: S.gran === 'month' ? x.bucket.slice(2) : S.gran === 'week' ? x.bucket.slice(5) : md(x.bucket),
      weight_kg: x.weight_kg,
    })), { h: 160, series: [{ k: 'weight_kg', c: '#1f7a52', name: '产量 kg' }], fmt: num })
      : emptyBox('该区间还没有产奶记录')}
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">区间汇总</span>
        <span class="small muted">${st.start} ~ ${st.end}</span></div>
      <div class="kpis" style="margin-bottom:10px">
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">总产量</div><div class="kpi-v">${num(st.total_weight, 0)}<small>kg</small></div></div>
        <div class="kpi" style="box-shadow:none;background:var(--brand-soft)">
          <div class="kpi-l">奶款收入</div><div class="kpi-v">${wan(st.total_amount)}<small>元</small></div></div>
      </div>
      <div class="dl"><span class="muted">日均产量</span><b>${num(st.avg_daily, 1)} kg</b></div>
      <div class="dl"><span class="muted">平均单价</span><b>${num(st.avg_price, 2)} 元/kg</b></div>
      <div class="dl"><span class="muted">在群泌乳母羊</span><b>${st.milking_heads} 头</b></div>
      <div class="dl"><span class="muted">日均单产</span><b>${num(st.per_head_today, 2)} kg/头·日</b></div>
      ${st.buckets.at(-1)?.discard_rate > 3 ? `<div class="notice mt12" style="margin-bottom:0">
        最近一个周期弃奶率 ${num(st.buckets.at(-1).discard_rate, 1)}%，偏高，
        建议检查乳房炎情况和挤奶卫生。</div>` : ''}
    </div>

    ${st.by_batch.length > 1 ? `<div class="card">
      <div class="card-h"><span class="card-t">产品批次结构</span></div>
      ${groupBar(st.by_batch.map((x, i) => ({ label: x.batch, value: x.weight_kg })), { unit: 'kg' })}
      <div class="hr"></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>批次</th><th>产量kg</th><th>收入</th><th>均价</th></tr></thead>
        <tbody>${st.by_batch.map(x => `<tr><td>${esc(x.batch)}</td><td>${num(x.weight_kg, 1)}</td>
          <td>${num(x.amount, 0)}</td><td>${num(x.avg_price, 2)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

    <div class="card">
      <div class="card-h"><span class="card-t">近 ${S.months} 个月对比</span></div>
      <div class="segs" style="margin:0">
        ${[3, 6, 12].map(n => `<button class="${S.months === n ? 'on' : ''}" data-m="${n}">${n}个月</button>`).join('')}
      </div>
      <div class="mt12">${barChart(cmp.items.map(x => ({ label: x.month.slice(2) + '月', weight_kg: x.weight_kg })),
      { h: 140, series: [{ k: 'weight_kg', c: '#2b9466', name: '产量 kg' }], fmt: num })}</div>
      <div class="tbl-wrap mt12"><table class="tbl">
        <thead><tr><th>月份</th><th>产量kg</th><th>金额</th><th>均价</th><th>单产</th></tr></thead>
        <tbody>${cmp.items.map(x => `<tr><td>${x.month}</td><td>${num(x.weight_kg, 0)}</td>
          <td>${num(x.amount, 0)}</td><td>${num(x.avg_price, 2)}</td><td>${num(x.per_head, 2)}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;

  on(root, 'click', '[data-g]', (e, el) => { S.gran = el.dataset.g; trendTab(root); });
  on(root, 'click', '[data-m]', (e, el) => { S.months = +el.dataset.m; trendTab(root); });
}

// ---------- 明细台账 ----------
async function listTab(root) {
  const start = monthStart(), end = monthEnd();
  const [d, o] = await Promise.all([
    api(`/api/milk?start=${start}&end=${end}&limit=300`), S.o ||= api('/api/milk/options'),
  ]);
  root.innerHTML = `
    <div class="card tight"><div class="flex between small">
      <span class="muted">${start} ~ ${end}</span>
      <span class="muted">${d.total} 条 · 合计 ${num(d.items.reduce((s, x) => s + x.weight_kg, 0), 1)} kg</span>
    </div></div>
    <div class="card">
      ${d.items.length ? `<ul class="list">${d.items.map(m => `
        <li data-id="${m.id}">
          <div class="avatar" style="background:var(--brand-soft)">🍼</div>
          <div class="li-main">
            <div class="li-t">${num(m.weight_kg, 1)} kg <span class="badge n">${esc(m.batch)}</span>
              ${m.discard_kg ? `<span class="badge d">弃 ${num(m.discard_kg, 1)}</span>` : ''}</div>
            <div class="li-s"><span>${esc(m.biz_date)}</span><span>${esc(m.group_code)}</span>
              <span>${num(m.price, 2)} 元/kg</span>${m.user_name ? `<span>${esc(m.user_name)}</span>` : ''}</div>
          </div>
          <div class="li-v in">¥${money(m.amount, 0)}</div>
        </li>`).join('')}</ul>`
      : emptyBox('本月还没有产奶记录', '点右下角或去「快捷录入」记一笔')}
    </div>
    ${store.can('milk.write') ? `<button class="fab" id="fab">+</button>` : ''}`;

  const fab = root.querySelector('#fab');
  if (fab) fab.onclick = () => editMilk(null, today());
  on(root, 'click', 'li[data-id]', async (e, el) => {
    const m = d.items.find(x => x.id === +el.dataset.id);
    sheet({
      title: `${m.biz_date} · ${m.batch}`,
      body: `<dl class="kv">
        <dt>产量</dt><dd><b>${num(m.weight_kg, 2)} kg</b></dd>
        <dt>弃奶</dt><dd>${m.discard_kg ? num(m.discard_kg, 2) + ' kg' : '-'}</dd>
        <dt>单价</dt><dd>${num(m.price, 2)} 元/kg</dd>
        <dt>金额</dt><dd style="color:var(--brand);font-weight:650">¥ ${money(m.amount)}</dd>
        <dt>分组</dt><dd>${esc(m.group_code)}</dd>
        <dt>班次</dt><dd>${esc(m.shift || '-')}</dd>
        <dt>录入人</dt><dd>${esc(m.user_name || '-')}</dd>
        <dt>备注</dt><dd>${esc(m.note || '-')}</dd></dl>`,
      footer: store.can('milk.write')
        ? `<button class="btn btn-danger" style="flex:0 0 84px" data-del>删除</button>
           <button class="btn btn-primary" data-ed>编辑</button>` : '',
      onMount(b, close, f) {
        const de = f.querySelector('[data-del]');
        if (de) de.onclick = () => {
          close();
          confirmBox('删除记录', `确定删除 ${m.biz_date} 的这条产奶记录？`, async () => {
            await DEL('/api/milk/' + m.id); ok('已删除'); render(root);
          });
        };
        const ed = f.querySelector('[data-ed]');
        if (ed) ed.onclick = () => { close(); editMilk(m); };
      },
    });
  });
}
