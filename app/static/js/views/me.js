import {
  api, esc, store, ok, err, sheet, formSheet, on, POST, PUT, download,
  confirmLogout,
} from '../core.js';

export async function render(root) {
  const me = store.user || {};
  const perms = store.perms || {};
  const settings = await api('/api/settings');
  const isAdmin = perms['sys.write'];

  root.innerHTML = `
    <div class="card">
      <div class="flex" style="gap:12px">
        <div class="avatar" style="width:52px;height:52px;font-size:24px;border-radius:16px">
          ${esc((me.full_name || me.username || '?').slice(0, 1))}</div>
        <div class="grow">
          <div style="font-size:18px;font-weight:700">${esc(me.full_name || me.username)}</div>
          <div class="flex wrap mt8" style="gap:5px">
            <span class="badge">${esc(me.role_name || me.role)}</span>
            <span class="badge n">${esc(me.username)}</span>
          </div>
        </div>
      </div>
      <div class="btn-row mt12">
        <button class="btn" id="chpwd">修改密码</button>
        <button class="btn" id="logout">退出登录</button>
      </div>
    </div>

    <div class="card">
      <div class="card-t mb0">我的权限</div>
      <div class="flex wrap mt12" style="gap:6px">
        ${Object.entries(perms).map(([k, v]) => `<span class="badge ${v ? 'g' : 'n'}">
          ${esc(PERM_CN[k] || k)} ${v ? '✓' : '✕'}</span>`).join('')}
      </div>
      <div class="small muted mt12">如果某个模块显示 ✕，是角色权限限制，
        需要管理员在下面「人员管理」里调整。</div>
    </div>

    <div class="card">
      <div class="card-t mb0">⚙ 场里参数</div>
      <div class="mt12">
        <div class="f"><span class="f-lb">养殖场名称</span>
          <input id="s_name" value="${esc(settings.items.farm_name || '')}" ${isAdmin ? '' : 'readonly'}></div>
        <div class="f-grid">
          <div class="f"><span class="f-lb">负责人</span>
            <input id="s_owner" value="${esc(settings.items.owner || '')}" ${isAdmin ? '' : 'readonly'}></div>
          <div class="f"><span class="f-lb">生鲜奶参考价 元/kg</span>
            <input type="number" step="0.01" id="s_price" value="${esc(settings.items.milk_sell_price || '')}" ${isAdmin ? '' : 'readonly'}></div>
        </div>
        <div class="f"><span class="f-lb">单产目标 kg/头·日</span>
          <input type="number" step="0.1" id="s_target" value="${esc(settings.items.milking_target_kg || '')}" ${isAdmin ? '' : 'readonly'}>
          <div class="hint">用于看板上的目标对照</div></div>
        ${isAdmin ? `<button class="btn btn-primary btn-block" id="saveS">保存参数</button>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-h"><span class="card-t">📊 数据导出</span><span class="small muted">Excel 格式</span></div>
      <div class="flex wrap" style="gap:8px">
        <button class="btn btn-sm" data-dl="/api/rep/export/herd">存栏档案</button>
        <button class="btn btn-sm" data-dl="/api/rep/export/milk?preset=year">产奶记录(年)</button>
        <button class="btn btn-sm" data-dl="/api/rep/export/txns?preset=year">流水(年)</button>
        <button class="btn btn-sm" data-dl="/api/rep/export/profit?preset=year">利润表(年)</button>
        <button class="btn btn-sm" data-dl="/api/rep/export/summary?preset=month">经营月报</button>
      </div>
    </div>

    ${isAdmin ? `<div class="card">
      <div class="card-h"><span class="card-t">👥 人员管理</span>
        <span class="card-more" id="adduser">＋ 新增</span></div>
      <ul class="list" id="ulist"><li><div class="skel" style="height:17px"></div></li></ul>
    </div>
    <div class="card">
      <div class="card-h"><span class="card-t">💾 数据备份</span></div>
      <div class="small muted">整个系统的数据都在服务器上的 <code>data/farm.db</code> 一个文件里。
        复制走就是完整备份。</div>
      <button class="btn btn-block mt12" id="backup">📋 复制数据库路径</button>
    </div>` : ''}

    <div class="card">
      <div class="card-t mb0">📱 添加到手机桌面</div>
      <div class="small muted mt12" style="line-height:1.9">
        <b>iPhone：</b>Safari 打开本页面 → 底部分享按钮 → 「添加到主屏幕」<br>
        <b>安卓：</b>Chrome / 夸克 打开 → 右上角菜单 → 「添加到主屏幕」<br>
        添加后有独立图标，打开就是全屏，和 App 一样，不用再找网址。
      </div>
    </div>

    <div class="small muted right" style="padding:0 4px 8px">
      羊场管家 v1.0 · 数据存储 SQLite</div>`;

  root.querySelector('#chpwd').onclick = changePwd;
  root.querySelector('#logout').onclick = () => confirmLogout();

  root.querySelector('#saveS')?.addEventListener('click', async () => {
    try {
      await PUT('/api/settings', { items: {
        farm_name: root.querySelector('#s_name').value,
        owner: root.querySelector('#s_owner').value,
        milk_sell_price: root.querySelector('#s_price').value,
        milking_target_kg: root.querySelector('#s_target').value,
      } });
      ok('已保存');
    } catch (e) { err(e.message); }
  });

  root.querySelector('#backup')?.addEventListener('click', async () => {
    try {
      const h = await api('/api/health');
      const p = h.db;
      try { await navigator.clipboard.writeText(p); ok('已复制：' + p); }
      catch { sheet({ title: '数据库位置', body: `<code style="word-break:break-all">${esc(p)}</code>` }); }
    } catch (e) { err(e.message); }
  });

  on(root, 'click', '[data-dl]', (e, el) => {
    download(el.dataset.dl + (el.dataset.dl.includes('?') ? '&' : '?') + 'token=' + store.token);
    ok('正在导出 Excel');
  });

  if (isAdmin) {
    loadUsers(root);
    root.querySelector('#adduser').onclick = () => userSheet(null, () => loadUsers(root));
  }
}

const PERM_CN = {
  'goat.read': '查看羊只', 'goat.write': '编辑羊只', 'milk.read': '查看产奶',
  'milk.write': '录入产奶', 'fin.read': '查看账目', 'fin.write': '记账/改账',
  'rep.read': '查看报表', 'sys.write': '系统管理',
};
const ROLES = [
  { value: 'admin', label: '管理员（全部权限）' },
  { value: 'boss', label: '场长（除系统管理外全部）' },
  { value: 'keeper', label: '饲养员（羊只+产奶，不碰钱）' },
  { value: 'finance', label: '会计（钱和报表，羊只只读）' },
];

async function loadUsers(root) {
  const ul = root.querySelector('#ulist');
  if (!ul) return;
  try {
    const d = await api('/api/auth/users');
    ul.innerHTML = d.items.map(u => `<li data-uid="${u.id}">
      <div class="avatar ${u.role === 'keeper' ? 'm' : 'f'}">${esc((u.full_name || u.username).slice(0, 1))}</div>
      <div class="li-main"><div class="li-t">${esc(u.full_name || u.username)}
        ${!u.active ? '<span class="badge d">已停用</span>' : ''}</div>
        <div class="li-s"><span>${esc(u.username)}</span><span>${esc(u.role_name)}</span>
          ${u.last_login_at ? `<span>${esc(u.last_login_at.slice(5, 16))}</span>` : ''}</div>
      </div>
      <span class="li-arrow">›</span></li>`).join('');
    on(ul, 'click', 'li[data-uid]', (e, el) => {
      const u = d.items.find(x => x.id === +el.dataset.uid);
      userSheet(u, () => loadUsers(root));
    });
  } catch (e) { ul.innerHTML = `<li class="small muted">${esc(e.message)}</li>`; }
}

function userSheet(u, done) {
  formSheet({
    title: u ? `编辑 ${u.username}` : '新增人员',
    note: u ? '' : '初始密码给他本人，首次登录后建议让本人修改。',
    fields: [
      { name: 'username', label: '登录账号', required: true, value: u?.username, placeholder: '英文/数字' },
      { name: 'full_name', label: '姓名', value: u?.full_name },
      { name: 'role', label: '角色权限', type: 'select', required: true, value: u?.role || 'keeper',
        options: ROLES },
      { name: 'phone', label: '手机号', value: u?.phone },
      { name: 'password', label: u ? '重置密码' : '初始密码', required: !u,
        value: '', placeholder: u ? '留空表示不改' : '至少 4 位' },
    ],
    onSubmit: async (d) => {
      if (!d.password) delete d.password;
      if (u) await PUT('/api/auth/users/' + u.id, d);
      else await POST('/api/auth/users', d);
      ok('已保存'); done?.();
    },
    extraFooter: u && u.active ? `<button class="btn btn-danger" style="flex:0 0 84px" data-off>停用</button>` : '',
  });
  setTimeout(() => {
    const f = document.querySelector('.sheet-f [data-off]');
    if (f) f.onclick = async () => {
      const { DEL } = await import('../core.js');
      try { await DEL('/api/auth/users/' + u.id); ok('已停用'); done?.(); }
      catch (e) { err(e.message); }
    };
  }, 50);
}

function changePwd() {
  formSheet({
    title: '修改密码',
    fields: [
      { name: 'old_password', label: '原密码', type: 'password', required: true },
      { name: 'new_password', label: '新密码', type: 'password', required: true },
      { name: 'new_password2', label: '确认新密码', type: 'password', required: true },
    ],
    onSubmit: async (d) => {
      if (d.new_password !== d.new_password2) throw new Error('两次输入的新密码不一致');
      await POST('/api/auth/password',
        { old_password: d.old_password, new_password: d.new_password });
      ok('密码已修改');
    },
  });
}
