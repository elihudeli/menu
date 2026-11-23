/* Роли и доступы, «программа у …» (общая база в GitHub) и страница «Облако».
   Подключается до app.js; пользуется его общими функциями (db, S, toast, render…) уже во время работы. */

/* ---------------------------------------------------------------- доступы */
const PERM_GROUPS = [
  ['Разделы программы', [
    ['v.mine', 'Мои доставки (план курьера)'], ['v.clients', 'Клиенты'], ['v.delivery', 'Доставка'], ['v.packing', 'Фасовка'], ['v.ending', 'Продления'], ['v.stats', 'Статистика'],
    ['v.menu', 'Меню дня'], ['v.menus', 'Меню'], ['v.finance', 'Финансы'], ['v.salary', 'Зарплата'], ['v.incident', 'Неполадки'], ['v.journal', 'Журнал'], ['v.manager', 'Журнал управляющей'], ['v.admin', 'Админ'],
  ]],
  ['Что можно менять', [
    ['clients.edit', 'Клиенты и заказы: создавать, менять, замораживать, останавливать, возврат, удалять'],
    ['clients.address', 'Адрес и телефон клиента'],
    ['clients.shift', 'Время доставки (утро ⇄ вечер) и смены доставки'],
    ['couriers.assign', 'Назначать курьеров: постоянного и временного (замены)'],
    ['couriers', 'Теги для курьеров'],
    ['couriers.list', 'Курьеры: добавлять, переименовывать, удалять'],
    ['couriers.files', 'Скриншоты и Excel для курьеров'],
    ['packing', 'Фасовка: отметки «упаковано», бирки'],
    ['print', 'Печать страниц и меню'],
    ['menu', 'Меню дня, КБЖУ, ИИ-проверка аллергий'],
    ['incident', 'Технические неполадки (сдвиг доставок)'],
    ['finance', 'Финансы: закуп, мелочь, инвентарь'],
    ['salary', 'Зарплата: сотрудники, смены, премии, выдача'],
    ['files', 'Файлы: Excel, загрузка базы, резервные копии'],
    ['admin.lists', 'Админ: программы, сотрудники, курьеры, пометки, этапы'],
    ['admin.settings', 'Админ: настройки и ИИ'],
  ]],
  ['Управление', [
    ['roles', 'Роли и доступы'], ['cloud', 'Облако GitHub: подключать, менять хранилище, отключать'], ['installer', 'Установщик программы'], ['installer.couriers', 'Ссылки iOS / Сайт версии для курьеров'], ['publish', 'Публиковать обновления программы'],
    ['cloud.force', 'Принудительно освобождать базу — забирать программу у другого, не дожидаясь'],
  ]],
];
const ALL_PERMS = PERM_GROUPS.flatMap(([, l]) => l.map(([k]) => k));
const FULL_ROLES = ['manager', 'developer']; // меняют всё и раздают доступы
const ROLE_BASE = {
  om: { name: 'Офис-менеджер', perms: ALL_PERMS.filter(k => !['roles', 'cloud', 'cloud.force', 'installer', 'installer.couriers', 'publish', 'v.manager', 'couriers.assign'].includes(k)) },
  courier: { name: 'Старший курьер', perms: ['v.delivery', 'clients.address', 'clients.shift', 'couriers', 'couriers.assign', 'couriers.files', 'print', 'couriers.list', 'installer.couriers'], add2: ['couriers.list', 'installer.couriers', 'couriers.assign', 'clients.shift'] },
  driver: { name: 'Курьер', perms: ['v.mine'] },
  manager: { name: 'Управляющая', perms: ALL_PERMS, pinKey: 'mgrPin' },
  developer: { name: 'Разработчик', perms: ALL_PERMS, pinKey: 'devPin' },
};
function roleDefs() {
  const saved = (db && db.settings.roles) || {};
  const out = {};
  // add2 — новые права роли: в уже настроенную роль добавляются, пока её доступы не поменяют вручную (v2)
  for (const [id, b] of Object.entries(ROLE_BASE)) out[id] = { id, ...b, ...(saved[id] && !FULL_ROLES.includes(id) ? { perms: saved[id].perms ? uniq([...saved[id].perms, ...(saved[id].v2 ? [] : b.add2 || [])]) : b.perms } : {}), builtin: true };
  for (const [id, r] of Object.entries(saved)) if (!ROLE_BASE[id] && r && r.name) out[id] = { id, name: r.name, perms: r.perms || [], pin: r.pin || '' };
  return out;
}
const roleName = (id = role()) => (roleDefs()[id] || roleDefs().om).name;
// индивидуальные права устройства: управляющая разрешает или ограничивает сверх роли (журнал управляющей → «Устройства»)
const devOverride = () => { const m = typeof S !== 'undefined' && (S.asRole ? S.asRole.machine : S.sync && S.sync.me && S.sync.me.machine); return (m && db && (db.settings.devPerms || {})[m]) || null; };
function can(p) {
  if (!p) return true;
  const id = role();
  if (FULL_ROLES.includes(id)) return true; // управляющей и разработчику права не меняются
  const ov = devOverride();
  if (ov && p in ov) return !!ov[p];
  return (roleDefs()[id] || roleDefs().om).perms.includes(p);
}
const ALWAYS_VIEWS = ['cloud', 'save', 'handoff'];
// вкладки, скрытые для всех (ПКМ по вкладке слева; вернуть — «Программа у вас»)
const NO_HIDE = ['admin', 'manager', 'cloud', 'save', 'handoff'];
const hiddenViews = () => ((typeof db !== 'undefined' && db && db.settings && db.settings.hiddenViews) || []).filter(v => !NO_HIDE.includes(v));
const canView = v => ALWAYS_VIEWS.includes(v) || (!hiddenViews().includes(v) && can('v.' + v));
const firstView = () => ['mine', 'clients', 'delivery', 'packing', 'ending', 'menu', 'stats', 'journal', 'incident', 'finance', 'salary', 'admin'].find(canView) || 'cloud';

// какое право нужно для действия (кнопки data-act) и для поля (data-bind)
const ACT_PERM = {
  newClient: 'clients.edit', newOrder: 'clients.edit', renewOrder: 'clients.edit', editOrder: 'clients.edit',
  findReturners: 'clients.edit', changeProg: 'clients.edit', transferDays: 'clients.edit', freezeOrder: 'clients.edit',
  // время и смены доставки: кто меняет заказы — может всегда, старший курьер — по праву «clients.shift»
  shiftsOrder: () => (can('clients.edit') ? 'clients.edit' : can('clients.shift') ? 'clients.shift' : 'couriers.assign'), flipTime: () => (can('clients.edit') ? 'clients.edit' : 'clients.shift'), skipOrder: 'clients.edit', stopOrder: 'clients.edit', returnOrder: 'clients.edit', deleteOrder: 'clients.edit',
  deleteClient: 'clients.edit', toggleTag: 'clients.edit', pickDays: 'clients.edit', remindNow: 'clients.edit', allowDel: 'clients.edit', mergeCombo: 'clients.edit',
  saveClient: () => (can('clients.edit') ? 'clients.edit' : 'clients.address'),
  bulkSet: d => (d.k === 'courier' ? 'couriers.assign' : 'clients.edit'),
  bulkTag: 'clients.edit',
  dselMove: 'couriers.assign', moveCourier: 'couriers.assign', toggleCtag: 'couriers', aiCtags: 'couriers',
  copyCourier: 'couriers.files', courierBase: 'couriers.files', exportDelivery: 'couriers.files',
  labels: 'packing', exportPacking: 'packing', exportBoth: 'packing',
  pdgPng: 'print', printPage: 'print', printPacking: 'print', menuPrint: 'print', menuPrintAll: 'print',
  exportClients: 'files', clientsTemplate: 'files', exportJson: 'files', exportXlsx: 'files', pickFile: 'files', openFolder: 'files',
  backupNow: 'files', restoreBackup: 'files',
  makeInstaller: 'installer',
  adminAdd: d => listPerm(d), adminRename: d => listPerm(d), adminRemove: d => listPerm(d), courierLink: 'installer.couriers', tagAdd: 'admin.lists', tagDel: 'admin.lists',
  ctagAdd: 'admin.lists', ctagDel: 'admin.lists', comboNew: 'admin.lists', comboDel: 'admin.lists', comboRename: 'admin.lists',
  comboMergeAll: 'admin.lists', comboStgAdd: 'admin.lists', comboStgDel: 'admin.lists',
  aiEditKey: 'admin.settings', aiSaveKey: 'admin.settings', aiPick: 'admin.settings', openMenuFiles: 'admin.settings',
  menuEdit: 'menu', menuGt: 'menu', gtFmt: 'menu', gtSel: 'menu', gtFill: 'menu', aiAllergy: 'menu', cfOk: 'menu', cfRemember: 'menu', menuFillAll: 'menu', aiCalc: 'menu', menuCopyPrev: 'menu', menuPdf: 'menu',
  menuFmtNew: 'menu', menuFmtDel: 'menu', menuMealAdd: 'menu', menuMealDel: 'menu', menuMealMove: 'menu',
  mcMeal: 'menu', mcExtraAdd: 'menu', mcExtraDel: 'menu', mcCalc: 'menu', mcRec: 'menu', mcGrams: 'menu',
  aiAllergens: 'packing', alRevert: 'clients.edit',
  holCalNew: 'admin.lists', holCalDel: 'admin.lists', holDayAdd: 'admin.lists', holDayDel: 'admin.lists', holDayEdit: 'admin.lists',
  courierSubs: 'couriers.assign', subDel: 'couriers.assign', dselSubs: 'couriers.assign', addrKeep: 'clients.address', addrRevert: 'clients.address', addrNew: 'clients.address', addrEdit: 'clients.address', addrDel: 'clients.address', addrApply: 'clients.address', dnKeep: 'couriers.assign', dnNo: 'couriers.assign', dnOk: 'v.delivery',
  incApply: 'incident', incUndo: 'incident',
  tagQuick: d => (d.k === 'ctags' ? 'couriers' : 'clients.edit'),
  groupAdd: 'admin.lists', groupRename: 'admin.lists', groupDel: 'admin.lists', groupPerson: 'admin.lists', groupPersonEdit: 'admin.lists', groupPersonDel: 'admin.lists',
  roleAdd: 'roles', roleDel: 'roles', installerDialog: 'installer', wipeBase: 'roles', devBlock: 'roles', devPin: 'roles', devRemove: 'roles', devUserDel: 'roles', devRestore: 'roles', devPerms: 'roles', cloudRestore: 'files',
  cloudSave: 'cloud', cloudSwitch: 'cloud', cloudForce: 'cloud.force', menuSitePublish: 'cloud', cloudOff: 'cloud', cloudPublish: 'publish',
};
// эти действия ничего не меняют в базе — их можно делать, даже когда программа у другого
const NONMUT = new Set(['mxShift', 'delivNews', 'mxSet', 'rolePreview', 'asExit', 'dselAll', 'addrNewsOk', 'dselClear', 'dcToggle', 'dcAll', 'devicesLoad', 'devBlock', 'devPerms', 'setLang', 'setTheme', 'setZoom', 'theme', 'cloudBackupsLoad', 'cloudBackupNow', 'installerDialog', 'courierLink', 'copyCourier', 'courierBase', 'exportDelivery', 'labels', 'exportPacking', 'exportBoth', 'pdgPng', 'printPage', 'printPacking', 'menuPrint',
  'menuPrintAll', 'menuPdf', 'exportClients', 'clientsTemplate', 'exportJson', 'exportXlsx', 'openFolder', 'backupNow', 'makeInstaller', 'aiEditKey',
  'openMenuFiles', 'cloudSave', 'cloudSwitch', 'cloudForce', 'cloudOff', 'aiPick', 'gtFmt', 'gtSel', 'mcRec', 'cloudPublish']);
const BIND_PERM = {
  tagIn: 'clients.edit', ctagIn: 'couriers', dcour: 'couriers.assign', noCourName: 'couriers.list', yandexMaps: 'couriers', sceneHide: 'roles', progKitchen: 'admin.lists',
  holDefault: 'admin.lists', holName: 'admin.lists', holAll: 'admin.lists',
  pack: 'packing', newLbl: 'packing', fmtAi: 'menu', mtarget: 'menu', mdish: 'menu', gMode: 'menu', mrec: 'menu', mcrec: 'menu', mkbju: 'menu', mck: 'menu', mclient: 'menu', mcExtra: 'menu', mfmt: 'menu', mclim: 'menu', mmeal: 'menu', gtxt: 'menu', mgx: 'menu', mcgx: 'menu',
  comboStage: 'admin.lists', remind: 'admin.lists', ctagColor: 'admin.lists', ctagName: 'admin.lists', tagColor: 'admin.lists', tagName: 'admin.lists',
  pcolor: 'admin.lists', contact: 'admin.lists', backupMinutes: 'admin.settings', quickPrint: 'admin.settings', aiSet: 'admin.settings',
  'set.menuUrl': 'admin.settings', 'set.archiveMonths': 'admin.settings', 'set.currency': 'admin.settings', 'set.adminPin': 'roles', handoffNote: 'files',
  permSet: 'roles', roleName: 'roles',
};
const BIND_NONMUT = new Set(['dsel', 'dq', 'mxq', 'mxd', 'quickPrint', 'backupMinutes', 'handoffNote', 'mink', 'mtheme', 'plang']);
// курьеров может менять и старший курьер (право «Курьеры: добавлять, переименовывать, удалять»)
function listPerm(d) { return d.k === 'couriers' && !can('admin.lists') ? 'couriers.list' : 'admin.lists'; }
const permOfAct = (name, d) => { const p = ACT_PERM[name]; return typeof p === 'function' ? p(d || {}) : p; };

let lastGateToast = 0;
function gateToast(msg) {
  if (Date.now() - lastGateToast < 2500) return;
  lastGateToast = Date.now();
  toast(msg, 'bad', 6000);
}
// можно ли сделать это действие: доступ роли + программа не у другого
function gate(perm, mutating) {
  if (perm && !can(perm)) { gateToast(`Нет доступа: роль «${roleName()}» не может это делать. Доступы настраивает управляющая в «Админ» → «Роли и доступы».`); return false; }
  if (mutating && readOnly()) { gateToast(viewerMsg()); return false; }
  return true;
}
// на телефоне нет файлов и установщика — эти кнопки прячем (печать — через окно печати Android)
const PHONE_OFF = new Set(['menuPdf', 'pdgPng', 'exportXlsx', 'exportJson', 'exportClients',
  'clientsTemplate', 'exportDelivery', 'exportPacking', 'exportBoth', 'courierBase', 'pickFile', 'openFolder', 'backupNow', 'restoreBackup',
  'makeInstaller', 'installerDialog', 'courierLink', 'cloudPublish', 'openMenuFiles']);
const isPhone = () => !!window.EHAndroid && !window.EHAndroid.desktop; // ссылка, открытая на MacBook, — вид как на компьютере
// спрятать кнопки и запереть поля, на которые у роли нет доступа
function applyPermsUI(root = document) {
  if (!root.querySelectorAll || typeof db === 'undefined' || !db) return;
  root.querySelectorAll('[data-act]').forEach(el => {
    const p = permOfAct(el.dataset.act, el.dataset);
    if (p) el.classList.toggle('perm-hide', !can(p));
    // Excel «База курьеров» собирается прямо в окне — на телефоне и в сайт-версии он есть (в приложении Android — если оно умеет отдавать файлы)
    const phoneOk = el.dataset.act === 'courierBase' && el.dataset.k === 'xlsx' && canFileHere();
    if (isPhone() && PHONE_OFF.has(el.dataset.act) && !phoneOk) el.classList.add('perm-hide');
  });
  root.querySelectorAll('[data-bind]').forEach(el => {
    const p = BIND_PERM[el.dataset.bind];
    if (p && !can(p)) el.disabled = true;
  });
  root.querySelectorAll('[data-perm]').forEach(el => {
    if (!can(el.dataset.perm)) { if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(el.tagName)) el.disabled = true; else el.classList.add('perm-hide'); }
  });
  const ab = $('#asBtn');
  if (ab) { ab.hidden = !FULL_ROLES.includes(realRole()); ab.classList.toggle('on', !!S.asRole); }
  $$('#nav [data-nav]').forEach(a => { a.hidden = a.id === 'navMgr' ? !canView('manager') : !canView(a.dataset.nav); });
}
function startPermsUI() {
  applyPermsUI();
  new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) applyPermsUI(n); })
    .observe(document.body, { childList: true, subtree: true });
}

/* ---------------------------------------------------------------- читатель: роль без права что-либо менять */
const EDIT_PERMS = ['clients.edit', 'clients.address', 'clients.shift', 'couriers', 'couriers.assign', 'couriers.list', 'packing', 'menu', 'incident', 'finance', 'salary', 'files', 'admin.lists', 'admin.settings', 'roles', 'cloud', 'publish'];
// «Только режим читателя» ставится в установщике и в программе не снимается
const readerOnly = () => !!(typeof S !== 'undefined' && S.local && S.local.readerOnly);
const isReader = () => readerOnly() || !EDIT_PERMS.some(p => can(p));

/* ---------------------------------------------------------------- «Админ» → «Роли и доступы» */
function adminRolesTab() {
  const R = roleDefs(), ids = Object.keys(R);
  const col = id => FULL_ROLES.includes(id);
  const rows = PERM_GROUPS.map(([g, list]) => `<tr class="group"><td colspan="${ids.length + 1}">${esc(g)}</td></tr>` + list.map(([k, l]) => `<tr><td>${esc(l)}</td>
      ${ids.map(id => `<td class="center"><input type="checkbox" data-bind="permSet" data-r="${esc(id)}" data-k="${esc(k)}" ${col(id) || R[id].perms.includes(k) ? 'checked' : ''} ${col(id) ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')).join('');
  return `<div class="card"><h2>Роли и доступы</h2>
    <div class="muted small" style="margin-bottom:10px">Отметьте, что видит и что может менять каждая роль. Управляющая и разработчик могут всё — и только они настраивают доступы.
      Изменения действуют сразу на всех компьютерах. Роль закреплена за установленной программой — её выбирают, когда скачивают установщик.
      Роль без права что-либо менять — «читатель»: он только смотрит и никогда не забирает программу у других.</div>
    <div class="table-wrap" style="max-height:none"><table class="t roles-t"><thead><tr><th>Доступ</th>
      ${ids.map(id => `<th class="center">${R[id].builtin ? esc(R[id].name) : `<input class="input" data-bind="roleName" data-r="${esc(id)}" value="${esc(R[id].name)}" style="width:120px;padding:3px 6px">`}
        ${R[id].builtin ? '' : `<div style="margin-top:4px"><button class="btn btn-icon btn-sm btn-red" data-act="roleDel" data-r="${esc(id)}" title="Удалить роль">✕</button></div>`}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row mt"><input class="input" id="roleNewName" placeholder="Новая роль, например «Повар» или «Стажёр»" style="flex:1;max-width:380px">
      <button class="btn btn-green" data-act="roleAdd">+ Добавить роль</button></div></div>`;
}
const ACCESS_ACT = {
  roleAdd: () => {
    const inp = $('#roleNewName');
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    db.settings.roles = db.settings.roles || {};
    db.settings.roles[uid('r_')] = { name, perms: ['v.delivery', 'v.packing'] };
    commit(`Новая роль: ${name}`, 'admin');
  },
  roleDel: d => {
    const r = (db.settings.roles || {})[d.r];
    if (!r) return;
    confirmBox('Удалить роль', `Удалить роль «${esc(r.name)}»? Кто в ней работает, станет офис-менеджером.`, 'Удалить', () => {
      delete db.settings.roles[d.r];
      commit(`Удалена роль: ${r.name}`, 'admin');
    });
  },
  cloudSave: async () => {
    const tok = $('#ghToken').value.trim(), repo = $('#ghRepo').value.trim();
    if (!repo) { toast('Укажите хранилище, например elihudeli/office', 'bad'); return; }
    S.cloudBusy = true; render();
    try {
      S.sync = await api('POST', '/api/sync/config', JSON.stringify({ token: tok, repo }));
      addLog(`Облако подключено: ${repo}`, 'admin');
      toast('Облако подключено ✓', 'ok');
    } catch (e) { toast('Не удалось подключить: ' + e.message, 'bad', 10000); }
    S.cloudBusy = false; render();
  },
  cloudSwitch: d => confirmBox('Сменить облако', `Перейти на облако <b>${esc(d.v)}</b>? Программа в текущем облаке освободится, база этого компьютера сохранится резервной копией, а дальше будет база из нового облака (если оно пустое — туда уйдёт ваша).`,
    'Сменить', async () => {
      S.cloudBusy = true; render();
      try { S.sync = await api('POST', '/api/sync/config', JSON.stringify({ repo: d.v })); addLog(`Облако сменено: ${d.v}`, 'admin'); toast('Облако: ' + d.v, 'ok'); }
      catch (e) { toast('Не удалось: ' + e.message, 'bad', 10000); }
      S.cloudBusy = false; render();
    }),
  menuSitePublish: async () => {
    const repo = $('#msRepo').value.trim(), token = $('#msToken').value.trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) { toast('Укажите хранилище в виде организация/имя', 'bad'); return; }
    S.msBusy = true; render();
    try {
      const r = await api('POST', '/api/menusite', JSON.stringify({ repo, token }));
      S.menuSite = { repo: r.repo, hasKey: true };
      if (r.url !== db.settings.menuUrl) {
        const was = db.settings.menuUrl;
        db.settings.menuUrl = r.url;
        commit(`Адрес страницы меню для QR: ${r.url}`, 'admin');
        toast(`Страница меню выложена: ${r.url}${was ? ' — уже напечатанные QR ведут на старый адрес' : ''}`, 'ok', 12000);
      } else toast('Страница меню обновлена', 'ok');
    } catch (e) { toast('Не удалось: ' + e.message, 'bad', 15000); }
    S.msBusy = false; render();
  },
  cloudOff: () => confirmBox('Отключить облако', 'Этот компьютер перестанет получать и отправлять общую базу. Ключ доступа на нём удалится.', 'Отключить', async () => {
    S.sync = await api('POST', '/api/sync/off', '{}');
    render();
  }),
  cloudRelease: () => confirmBox('Освободить программу', 'Отдать программу: ваши изменения отправятся в облако, и следующий, кто откроет программу, сможет работать. Вы останетесь в режиме просмотра.',
    'Освободить', async () => { S.sync = await api('POST', '/api/sync/release', '{}'); toast('Программа свободна', 'ok'); render(); }),
  installerDialog: () => installerDialog(),
  courierLink: () => installerDialog(true),
  cloudBackupsLoad: async () => {
    try { S.cloudBk = (await api('POST', '/api/sync/backups', '{}')).backups; } catch (e) { toast('Не удалось получить копии: ' + e.message, 'bad'); }
    render();
  },
  cloudBackupNow: async () => {
    try { await api('POST', '/api/sync/backup', JSON.stringify({ reason: 'manual' })); toast('Копия базы сохранена в облаке', 'ok'); ACCESS_ACT.cloudBackupsLoad(); }
    catch (e) { toast('Не удалось: ' + e.message, 'bad'); }
  },
  cloudRestore: d => confirmBox('Восстановить базу', `Поставить базу из облачной копии ${esc(d.v)}? Текущая база сначала сохранится копией на этом компьютере, а потом уйдёт в облако новая.`,
    'Восстановить', async () => {
      try {
        await api('POST', '/api/sync/restore', JSON.stringify({ name: d.v }));
        audit(`Восстановлена база из облачной копии ${d.v}`, { kind: 'restore', sev: 'warn' });
        await reloadFromServer();
        toast('База восстановлена из облака', 'ok');
      } catch (e) { toast('Не удалось: ' + e.message, 'bad', 8000); }
    }),
  setLang: d => { lsSet('eh_lang', d.v); location.reload(); },
  rolePreview: () => openRolePreview(),
  asExit: () => setRolePreview(null),
  setZoom: d => { lsSet('eh_zoom', d.v); applyPhoneZoom(); render(); },
  setTheme: d => { if (document.body.classList.contains('dark') !== (d.v === 'dark')) ACT.theme(); render(); },
  devPerms: d => {
    const dev = ((S.devs || {}).devices || []).find(x => x.machine === d.id);
    if (!dev || FULL_ROLES.includes(dev.role)) return;
    const rid = dev.role, R = roleDefs()[rid];
    const base = k => !!(R && R.perms.includes(k));
    const cur = { ...((db.settings.devPerms || {})[d.id] || {}) };
    const row = ([k, l]) => `<div class="dp-row"><span>${esc(l)}</span><div class="chips">
      ${[['', `Как у роли: ${base(k) ? 'да' : 'нет'}`], ['1', 'Разрешить'], ['0', 'Ограничить']].map(([v, t]) => `<button type="button" class="${(k in cur ? (cur[k] ? '1' : '0') : '') === v ? 'on' : ''}" data-m="set" data-k="${esc(k)}" data-v="${v}">${t}</button>`).join('')}</div></div>`;
    const body = () => `<div class="muted">${esc(dev.who || '—')} · ${esc(dev.pc || '')} · роль: <b>${esc(R ? R.name : rid || '—')}</b>. Здесь права только этого устройства, поверх роли. Изменения дойдут до него вместе с базой.</div>
      ${PERM_GROUPS.map(([g, l]) => `<h3 class="mt">${esc(g)}</h3>${l.map(row).join('')}`).join('')}`;
    openModal({
      wide: true,
      title: 'Права устройства',
      body: `<div id="dpBox">${body()}</div>`,
      foot: '<button class="btn" data-m="clear">Как у роли</button><span style="flex:1"></span><button class="btn" data-act="closeModal">Отмена</button><button class="btn btn-green" data-m="ok">Сохранить</button>',
      onMount(root) {
        const box = root.querySelector('#dpBox');
        root.addEventListener('click', e => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          if (b.dataset.m === 'set') { if (b.dataset.v === '') delete cur[b.dataset.k]; else cur[b.dataset.k] = b.dataset.v === '1'; box.innerHTML = body(); return; }
          if (b.dataset.m === 'clear') { for (const k of Object.keys(cur)) delete cur[k]; box.innerHTML = body(); return; }
          if (readOnly()) { gateToast(viewerMsg()); return; }
          db.settings.devPerms = db.settings.devPerms || {};
          if (Object.keys(cur).length) db.settings.devPerms[d.id] = cur; else delete db.settings.devPerms[d.id];
          db.settings.devPermsAt = localIso();
          closeModal();
          audit(`Права устройства «${dev.who || dev.pc}»: ${Object.keys(cur).length ? `разрешено ${Object.values(cur).filter(Boolean).length}, ограничено ${Object.values(cur).filter(x => !x).length}` : 'как у роли'}`, { kind: 'role', sev: 'warn' });
          commit(`Изменены права устройства: ${dev.who || dev.pc}`);
        });
      },
    });
  },
  devicesLoad: async () => {
    if (S.devsBusy) return;
    S.devsBusy = true;
    render();
    try { S.devs = await api('POST', '/api/sync/devices', '{}'); } catch (e) { toast('Не удалось получить список: ' + e.message, 'bad'); }
    S.devsBusy = false;
    render();
  },
  devPin: d => {
    const dev = ((S.devs || {}).devices || []).find(x => x.machine === d.id);
    if (!dev) return;
    const label = dev.who || dev.pc || '—', has = !!((db.settings.devPins || {})[d.id] || {}).hash;
    const save = (hash, text) => {
      db.settings.devPins = { ...(db.settings.devPins || {}), [d.id]: { hash, at: localIso() } };
      db.settings.devPinsAt = localIso();
      audit(`${text}: ${label}`, { kind: 'admin', sev: 'warn' });
      closeModal();
      commit(`${text}: ${label}`);
    };
    openModal({
      title: `PIN-код · ${label}`,
      body: `<div class="muted">${has ? 'PIN-код задан.' : 'PIN-код здесь не задавали. PIN из установщика, если он был, заменится новым.'} Он дойдёт до устройства вместе с базой.</div>
        <label class="field mt"><span>Новый PIN-код (4–8 цифр)</span><input class="input" name="pin" inputmode="numeric" maxlength="8" autocomplete="off"></label>`,
      foot: `<button class="btn" data-act="closeModal">Отмена</button><button class="btn btn-red" data-m="off">Убрать PIN-код</button><button class="btn btn-green" data-m="ok">Сохранить</button>`,
      onMount(root) {
        const inp = $('[name="pin"]', root);
        setTimeout(() => inp.focus(), 30);
        $('[data-m="off"]', root).addEventListener('click', () => save('', 'Убран PIN-код устройства'));
        $('[data-m="ok"]', root).addEventListener('click', async () => {
          const v = inp.value.trim();
          if (!/^\d{4,8}$/.test(v)) { toast('PIN-код: от 4 до 8 цифр', 'bad'); inp.focus(); return; }
          save(await sha(v), 'Задан PIN-код устройства');
        });
      },
    });
  },
  devRemove: d => {
    db.settings.devRemoved = [...(db.settings.devRemoved || []), { ids: d.ids.split(','), label: d.label, at: localIso(), ...(d.seen !== undefined ? { seen: d.seen } : {}) }];
    db.settings.devRemovedAt = localIso();
    audit(`Устройство удалено из списка: ${d.label}`, { kind: 'admin', sev: 'warn' });
    commit(`Устройство удалено из списка: ${d.label}`);
  },
  devRestore: d => {
    const ids = d.ids.split(','), r = (db.settings.devRemoved || []).find(x => (x.ids || []).some(id => ids.includes(id)));
    if (!r) return;
    db.settings.devRemoved = db.settings.devRemoved.filter(x => x !== r);
    db.settings.devRemovedAt = localIso();
    audit(`Устройство возвращено в список: ${r.label}`, { kind: 'admin', sev: 'warn' });
    commit(`Устройство возвращено в список: ${r.label}`);
  },
  devUserDel: d => { // сайт-версия: закрыть доступ (база и ключи на устройстве сотрутся) и убрать из списка
    const ids = String(d.ids || '').split(',').filter(Boolean);
    confirmBox('Удалить пользователя', `<b>${esc(d.label)}</b><br>Программа на его устройстве сотрётся и вернётся к экрану «Вставьте ссылку», из списка он пропадёт.
      Старая ссылка больше не сработает; вернуть его — новой ссылкой из «Установщика».`,
      'Удалить', async () => {
        try {
          await api('POST', '/api/sync/remove', JSON.stringify({ ids, label: d.label }));
          ACCESS_ACT.devRemove({ ids: ids.join(','), label: d.label });
          toast('Пользователь удалён', 'ok');
          await ACCESS_ACT.devicesLoad();
        } catch (e) { toast('Ошибка: ' + e.message, 'bad', 8000); }
      });
  },
  devBlock: d => {
    const on = !!d.on, ids = String(d.ids || '').split(',').filter(Boolean);
    confirmBox(on ? 'Заблокировать устройство' : 'Разблокировать устройство', on
      ? `<b>${esc(d.label)}</b><br>На этом устройстве программа закроется, база клиентов и ключи с него удалятся. Вернуть доступ можно только новым установщиком.`
      : `<b>${esc(d.label)}</b><br>Снять блокировку? Если база и ключи на устройстве уже стёрты, понадобится новый установщик.`,
    on ? 'Заблокировать' : 'Разблокировать', async () => {
      try {
        await api('POST', '/api/sync/block', JSON.stringify({ ids, label: d.label, on }));
        if (!readOnly()) { audit(`${on ? 'Заблокировано' : 'Разблокировано'} устройство: ${d.label}`, { kind: 'admin', sev: 'warn' }); persist(); }
        toast(on ? 'Устройство заблокировано' : 'Блокировка снята', 'ok');
        await ACCESS_ACT.devicesLoad();
      } catch (e) { toast('Ошибка: ' + e.message, 'bad', 8000); }
    }, on);
  },
  wipeBase: () => openModal({
    title: 'Стереть всю базу',
    body: `<div class="warn">Удалятся все клиенты, заказы, отметки фасовки и меню по дням. Сотрудники, программы, роли, настройки и финансы останутся.</div>
      <div class="muted mt">Перед стиранием вся база сохранится в облаке отдельной копией (№ 13) — она хранится месяц, восстановить можно на странице «Облако».</div>
      <label class="field mt"><span>Чтобы подтвердить, напишите: <b>Да, стереть</b></span><input class="input" id="wipeConfirm" autocomplete="off"></label>`,
    foot: '<button class="btn" data-act="closeModal">Отмена</button><button class="btn btn-red" data-m="wipe">Стереть</button>',
    onMount(root) {
      $('[data-m="wipe"]', root).addEventListener('click', async () => {
        if ($('#wipeConfirm', root).value.trim().toLowerCase() !== 'да, стереть') { toast('Напишите «Да, стереть»', 'bad'); return; }
        if (dirty) await doSave();
        try {
          if ((S.sync || {}).connected) await api('POST', '/api/sync/backup', JSON.stringify({ reason: 'wipe' }));
          else await api('POST', '/api/backup', JSON.stringify({ reason: 'before_wipe' }));
        } catch (e) { toast('Копия не сохранилась — база НЕ стёрта: ' + e.message, 'bad', 10000); return; }
        const now = localIso(), n = db.clients.length;
        for (const x of [...db.clients, ...db.orders]) db.deleted[x.id] = now; // чтобы старые копии на других компьютерах не вернули клиентов
        db.clients = []; db.orders = []; db.packed = {}; db.incidents = []; db.menu.days = {};
        closeModal();
        audit(`СТЁРТА ВСЯ БАЗА (${n} клиентов). Копия — в облаке/на компьютере`, { kind: 'delete', sev: 'warn' });
        commit(`Стёрта вся база (${n} клиентов), копия сохранена`, 'delete');
        toast('База стёрта. Копия сохранена — восстановить можно на странице «Облако».', 'ok', 9000);
      });
    },
  }),
  // программа у другого, а очень нужно: забрать сразу (право «cloud.force»)
  cloudForce: () => {
    const h = S.sync && S.sync.holder;
    confirmBox('Принудительно освободить базу', `Программа сейчас у <b>${esc(h ? holderText(h) : 'другого')}</b>. Забрать её себе прямо сейчас?<br><br>`
      + 'У него программа через несколько секунд перейдёт в просмотр. Что он успел изменить и ещё не отправил, останется у него и уйдёт в облако, когда программа снова будет у него.', 'Забрать себе', async () => {
      try {
        S.sync = await api('POST', '/api/sync/force', '{}');
        toast(S.sync.mode === 'owner' ? 'Программа у вас' : 'Не получилось — попробуйте ещё раз через несколько секунд', S.sync.mode === 'owner' ? 'ok' : 'bad');
      } catch (e) { toast('Не получилось: ' + e.message, 'bad', 6000); }
      render();
    });
  },
  cloudTake: async () => { S.sync = await api('POST', '/api/sync/take', '{}'); toast(S.sync.mode === 'owner' ? 'Программа у вас' : 'Программа сейчас занята', S.sync.mode === 'owner' ? 'ok' : 'bad'); render(); },
  cloudNow: async () => { await api('POST', '/api/sync/now', '{}'); setTimeout(syncTick, 1500); toast('Проверяю облако…', ''); },
  cloudUpdate: async () => {
    try {
      const r = await api('POST', '/api/sync/update', '{}');
      toast(r.files ? `Установлена новая версия (${r.files} файлов) — закройте и откройте программу` : 'У вас последняя версия программы', 'ok', 8000);
    } catch (e) { toast('Ошибка: ' + e.message, 'bad'); }
  },
  cloudPublish: () => confirmBox('Опубликовать обновление', 'Эта версия программы станет у всех: остальные компьютеры поставят её сами при следующей проверке (раз в полчаса или при запуске).',
    'Опубликовать', async () => {
      const note = ($('#pubNote') || {}).value || '';
      const go = async force => {
        const r = await api('POST', '/api/sync/publish', JSON.stringify({ note, force }));
        addLog(`Опубликована версия программы ${r.version}`, 'admin');
        persist();
        toast(`Опубликовано: ${r.files} файлов изменено${r.site ? ' · iOS / Сайт версия тоже обновлена' : ''}`, 'ok', 8000);
        if (r.siteError) toast('iOS / Сайт версию обновить не удалось: ' + r.siteError, 'bad', 15000);
        render();
      };
      try { await go(false); } catch (e) {
        const m = String(e.message).match(/^NEWER:(.*)$/s);
        if (!m) { toast('Не удалось опубликовать: ' + e.message, 'bad', 10000); return; }
        // в облаке программа, опубликованная с другого компьютера, — её изменений здесь нет
        confirmBox('В облаке более новая версия', `После вашей последней публикации программу опубликовали с другого компьютера:<br><b>${esc(m[1].trim())}</b><br><br>
          Её изменений в этой программе нет. Если опубликовать отсюда, они <b>пропадут у всех</b>. Сначала перенесите их сюда (попросите разработчика).`,
          'Всё равно опубликовать', () => go(true).catch(err => toast('Не удалось опубликовать: ' + err.message, 'bad', 10000)));
      }
    }),
};
const ACCESS_BIND = {
  permSet: (_v, el, t) => {
    if (t !== 'change') return;
    const R = roleDefs(), id = el.dataset.r, k = el.dataset.k;
    if (FULL_ROLES.includes(id)) return;
    db.settings.roles = db.settings.roles || {};
    const cur = new Set(R[id].perms);
    if (el.checked) cur.add(k); else cur.delete(k);
    db.settings.roles[id] = { ...(db.settings.roles[id] || {}), ...(R[id].builtin ? {} : { name: R[id].name }), perms: [...cur], v2: true };
    const lbl = PERM_GROUPS.flatMap(([, l]) => l).find(x => x[0] === k)[1];
    audit(`Доступ «${lbl}» для роли «${R[id].name}»: ${el.checked ? 'дан' : 'убран'}`, { kind: 'role' });
    commit(`Доступ «${lbl}» — ${R[id].name}: ${el.checked ? 'да' : 'нет'}`, 'admin');
  },
  roleName: (v, el, t) => {
    if (t !== 'change' || !v.trim()) return;
    const r = (db.settings.roles || {})[el.dataset.r];
    if (r) { const old = r.name; r.name = v.trim(); commit(`Роль «${old}» переименована в «${r.name}»`, 'admin'); }
  },
  rolePin: async (v, el, t) => {
    if (t !== 'change') return;
    const r = (db.settings.roles || {})[el.dataset.r];
    if (!r) return;
    if (v && !/^\d{4,8}$/.test(v)) { toast('PIN — 4–8 цифр', 'bad'); return; }
    r.pin = v ? await sha(v) : '';
    commit(`PIN роли «${r.name}» ${v ? 'изменён' : 'убран'}`, 'admin');
  },
  devPinSet: async (v, _el, t) => {
    if (t !== 'change') return;
    if (!/^\d{4,8}$/.test(v)) { toast('PIN — 4–8 цифр', 'bad'); return; }
    db.settings.devPin = await sha(v);
    audit('PIN разработчика изменён', { kind: 'role' });
    commit('PIN разработчика изменён', 'admin');
    toast('PIN разработчика изменён', 'ok');
  },
};

/* ---------------------------------------------------------------- общая база: «программа у …» */
const readOnly = () => readerOnly() || !!(S.sync && S.sync.mode === 'viewer') || (isReader() && !!(S.sync && S.sync.connected));
const holderWho = h => String((h && h.who) || '').replace(/^[—-]\s*·?\s*/, '').trim();
const holderText = h => (!h ? '—' : holderWho(h) ? `${holderWho(h)}${h.pc ? ' (' + h.pc + ')' : ''}` : h.pc || '—');
const forceOk = () => { const st = (typeof S !== 'undefined' && S.sync) || {}; return st.mode === 'viewer' && !!st.holder && can('cloud.force') && !isReader() && !(window.EHAndroid && window.EHAndroid.print); };
const viewerMsg = () => (isReader() ? 'Вы читатель — в этой программе можно только смотреть. Данные обновляются сами.' : S.sync && !S.sync.holder ? 'Вы освободили программу — чтобы снова работать, нажмите «Взять программу» в «Облаке».'
  : `Сейчас программа у ${holderText(S.sync && S.sync.holder)} — менять базу может только он. Вы в режиме просмотра: данные обновляются сами.`);
async function reloadFromServer() {
  try {
    db = normalize(await api('GET', '/api/db'));
    rebuild();
    render();
  } catch { /* попробуем при следующей проверке */ }
}
async function syncMerge(rev) {
  if (S.merging) return;
  S.merging = true;
  try {
    const remote = await api('GET', '/api/sync/remote');
    if (remote) {
      if (dirty && !readOnly()) await doSave();
      db = normalize(mergeDb(db, normalize(remote)));
      rebuild();
      await api('POST', '/api/db', JSON.stringify(db), { 'X-EH-Merge': '1' });
      await api('POST', '/api/sync/merged', JSON.stringify({ rev }));
      render();
      if (!S.mergedToast) { S.mergedToast = true; toast('Ваши изменения объединены с общей базой из облака', 'ok', 7000); }
    }
  } catch (e) { toast('Не удалось объединить с облаком: ' + e.message, 'bad'); }
  S.merging = false;
}
async function syncTick() {
  let st;
  try { st = await api('GET', '/api/sync/status'); } catch { return; }
  const prev = S.sync;
  S.sync = st;
  if (st.mode === 'blocked') { showBlocked(); return; }
  if (st.pulled !== (prev ? prev.pulled : 0) && !dirty) await reloadFromServer(); // и первая база, пришедшая до первой проверки окна
  if (st.needMerge) await syncMerge(st.needMerge);
  pinCheck();
  if (st.mode === 'owner' && !S.startBackup && ['om', 'manager', 'developer'].includes(realRole())) {
    S.startBackup = true;
    api('POST', '/api/sync/backup', JSON.stringify({ reason: 'start' })).catch(() => { S.startBackup = false; });
  }
  showNews(st.news);
  if (st.updated && !S.updToast) { // новая версия скачалась сама — зелёное окошко «Обновить сейчас»
    S.updToast = true;
    if (window.EHAndroid) updateBox({ title: 'Вышло обновление программы', lines: (st.news && st.news.lines) || [], go: () => location.reload(), later: () => setTimeout(() => { S.updToast = false; }, 30 * 60e3) });
    else checkAppUpdate();
  }
  if (!prev || prev.mode !== st.mode || JSON.stringify(prev.holder) !== JSON.stringify(st.holder)) {
    if (prev && prev.mode === 'viewer' && st.mode === 'owner') toast('Программа теперь у вас — можно работать', 'ok', 6000);
    if (prev && prev.mode === 'owner' && st.mode === 'viewer') toast(viewerMsg(), 'bad', 8000);
    render();
  } else renderOwner();
}
// «Что нового»: после обновления программы каждый сотрудник на этом компьютере видит это окно один раз
function showNews(n) {
  if (!n || !n.id || S.newsShown || $('.modal') || $('#updBox')) return;
  const key = 'eh_news_' + (operator() || 'all');
  if (lsGet(key) === n.id) return;
  S.newsShown = true;
  updateBox({ title: 'Программа обновлена — что нового', note: String(n.version || '').replace(/^\S+\s*/, ''), lines: n.lines || [],
    goText: 'Понятно', go: (_b, close) => { lsSet(key, n.id); close(); } });
}
// устройство заблокировала управляющая — программа закрыта, база и ключи на нём уже стёрты
function showBlocked() {
  if ($('#blockedScreen')) return;
  db = normalize({});
  dirty = false;
  document.body.innerHTML = `<div id="blockedScreen" class="blocked-screen"><div class="blocked-box"><div class="blocked-ico">!</div>
    <h1>Доступ закрыт</h1><p>Управляющая закрыла доступ к программе на этом устройстве. Данные клиентов и ключи с него удалены.</p>
    <p class="muted">Если это ошибка — обратитесь к управляющей.</p></div></div>`;
}

/* ---------------------------------------------------------------- PIN-код входа: один на устройство.
   Задаёт управляющая в журнале (хранится в базе) или вписывается в установщик. PIN из журнала главнее; пустой — PIN убран. */
const PIN_FREQ = [['open', 'При каждом открытии'], ['8', 'Раз в 8 часов'], ['24', 'Раз в день'], ['168', 'Раз в неделю']];
const myMachine = () => (S.local && S.local.machine) || (S.sync && S.sync.me && S.sync.me.machine) || '';
function devPin() {
  const o = (db.settings.devPins || {})[myMachine()];
  return o ? o.hash : (S.local && S.local.pin) || '';
}
const pinFreq = () => lsGet('eh_pin_freq') || 'open';
const pinDue = () => pinFreq() === 'open' || Date.now() - (+lsGet('eh_pin_at') || 0) >= +pinFreq() * 3600e3;
function pinFreqField() {
  if (!devPin()) return '';
  return `<label class="field"><span>Как часто спрашивать PIN-код</span><select class="input" data-bind="pinFreq">
    ${PIN_FREQ.map(([k, l]) => `<option value="${k}" ${pinFreq() === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
// экран входа: пока PIN не введён, программа закрыта; новый PIN из журнала приходит с базой и сюда
function pinGate() {
  if (S.pinWait) return S.pinWait;
  S.pinWait = new Promise(done => {
    const el = document.createElement('div');
    el.id = 'pinGate';
    el.innerHTML = `<div class="pin-box"><b>Ели-Худели</b><div class="pin-say">${esc(trStr('Назовите пароль!'))}</div><div class="pin-nargiz">${NARGIZ_SVG}</div>
      <input class="input" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="PIN">
      <button class="btn btn-green">${esc(trStr('Войти'))}</button><small></small></div>`;
    document.body.append(el);
    const inp = $('input', el), msg = $('small', el);
    let bad = 0, wait = 0;
    const pull = setInterval(async () => {
      try { const d = await api('GET', '/api/db'); db.settings.devPins = (d.settings || {}).devPins; } catch { /* база ещё не отвечает */ }
      if (!devPin()) open();
    }, 10000);
    const open = () => {
      clearInterval(pull);
      lsSet('eh_pin_at', String(Date.now()));
      S.pinKnown = devPin();
      el.remove();
      S.pinWait = null;
      done();
    };
    const go = async () => {
      if (Date.now() < wait) return;
      if (await sha(inp.value.trim()) === devPin()) { open(); return; }
      inp.value = '';
      inp.focus();
      if (++bad < 5) { msg.textContent = trStr('Неверный PIN-код'); return; }
      bad = 0;
      wait = Date.now() + 30000;
      msg.textContent = trStr('Слишком много попыток, подождите 30 секунд');
    };
    $('button', el).addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setTimeout(() => inp.focus(), 30);
  });
  return S.pinWait;
}
// PIN поставили или сменили, пока программа открыта: спрашиваем сразу, не дожидаясь нового открытия
function pinCheck() {
  const h = devPin();
  if (h === S.pinKnown) return;
  S.pinKnown = h;
  if (h) pinGate();
}
// на телефоне открытие — это и возврат в приложение
document.addEventListener('visibilitychange', () => {
  if (!isPhone() || !db) return;
  if (document.hidden) S.hiddenAt = Date.now();
  else if (S.hiddenAt && Date.now() - S.hiddenAt > 60000 && devPin() && pinDue()) pinGate();
});

/* ---------------------------------------------------------------- устройства (для управляющей): кто подключается, блокировка */
const devIds = d => [d.machine, d.inst].filter(Boolean);
// убранное из списка устройство скрыто (заблокированное — остаётся заблокированным); вернуть можно в «Удалённых устройствах».
// Незаблокированное, подключившееся снова после удаления, само возвращается в список
const devGone = (ids, seen = '') => (db.settings.devRemoved || []).some(r => (r.ids || []).some(id => ids.includes(id)) && !(seen && r.seen !== undefined && seen > (r.seen || r.at || '')));
function devRemovedCard() {
  if (!can('roles')) return '';
  // устройство, которое снова подключилось и вернулось в «Устройства», здесь не показываем
  const back = r => r.seen !== undefined && ((S.devs || {}).devices || []).some(d => (r.ids || []).some(id => devIds(d).includes(id)) && d.seen > (r.seen || r.at || ''));
  const list = (db.settings.devRemoved || []).filter(r => !back(r));
  if (!list.length) return '';
  return `<div class="card"><details><summary><h2 style="display:inline">Корзина устройств</h2> <span class="count-pill">${list.length}</span></summary>
    <div class="muted small mt">Убраны из списка «Устройства». Заблокированные остаются заблокированными; незаблокированное устройство, подключившись снова, само вернётся в список. «Вернуть» — показать сейчас.</div>
    ${list.length ? `<div class="table-wrap mt"><table class="t compact"><tbody>${list.map(r => `<tr><td class="name">${esc(r.label || '—')}</td><td class="nowrap">${esc(r.at ? fmtStamp(r.at) : '')}</td>
      <td class="right"><button class="btn btn-sm" data-act="devRestore" data-ids="${esc((r.ids || []).join(','))}">Вернуть</button></td></tr>`).join('')}</tbody></table></div>` : ''}</details></div>`;
}
// iOS / Сайт версия (по ссылке из установщика); старые записи — по названию устройства
const isWebDev = d => !!d.web || /^(iPhone|iPad|MacBook|Сайт)/.test(String(d.pc || ''));
function devicesCard() {
  if (!can('roles')) return '';
  const st = S.sync || {};
  if (!st.connected) return '';
  const D = S.devs;
  const pinBtn = d => `<button class="btn btn-sm" data-act="devPin" data-id="${esc(d.machine)}">PIN${((db.settings.devPins || {})[d.machine] || {}).hash ? ' *' : ''}</button>`;
  const blockedOf = d => (D.blocked || []).find(b => (b.ids || []).some(id => devIds(d).includes(id)));
  const ago = iso => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 2 ? 'сейчас' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : fmtStamp(iso); };
  const rows = !D ? '' : (D.devices || []).filter(d => !devGone(devIds(d), d.seen)).map(d => {
    const b = blockedOf(d), me = d.machine === D.machine;
    const label = `${d.who || '—'} · ${d.pc || ''}`;
    return `<tr class="${b ? 'dev-blocked' : ''}"><td class="name">${esc(d.who || '—')}${me ? ' <span class="muted small">(это устройство)</span>' : ''}</td>
      <td>${esc(roleDefs()[d.role]?.name || d.role || '')}</td><td>${esc(d.pc || '')}</td><td class="nowrap">${d.seen ? esc(ago(d.seen)) : ''}</td>
      <td class="right nowrap">${me ? pinBtn(d) : b ? `<span class="pill">заблокировано</span> <button class="btn btn-sm" data-act="devBlock" data-on="" data-ids="${esc(devIds(d).join(','))}" data-label="${esc(label)}">Разблокировать</button> <button class="btn btn-sm" data-act="devRemove" data-ids="${esc(devIds(d).join(','))}" data-label="${esc(label)}">Удалить</button>`
    : `${pinBtn(d)} ${FULL_ROLES.includes(d.role) ? '<span class="muted small">все права</span> ' : `<button class="btn btn-sm" data-act="devPerms" data-id="${esc(d.machine)}">Права${Object.keys((db.settings.devPerms || {})[d.machine] || {}).length ? ' *' : ''}</button> `}<button class="btn btn-sm btn-red" data-act="devBlock" data-on="1" data-ids="${esc(devIds(d).join(','))}" data-label="${esc(label)}">Заблокировать</button>${isWebDev(d) ? ` <button class="btn btn-sm btn-red" data-act="devUserDel" data-ids="${esc(devIds(d).join(','))}" data-label="${esc(label)}">Удалить пользователя</button>` // сайт-версия: ссылка перестаёт работать
      : ` <button class="btn btn-sm" data-act="devRemove" data-ids="${esc(devIds(d).join(','))}" data-label="${esc(label)}" data-seen="${esc(d.seen || '')}" title="Только убрать строку из списка — устройство не блокируется; подключится снова — вернётся в список">Убрать из списка</button>`}`}</td></tr>`;
  }).join('');
  const orphan = !D ? '' : (D.blocked || []).filter(b => !devGone(b.ids || []) && !(D.devices || []).some(d => (b.ids || []).some(id => devIds(d).includes(id))))
    .map(b => `<tr class="dev-blocked"><td class="name" colspan="3">${esc(b.label || '')}</td><td class="nowrap">${esc(b.at ? fmtStamp(b.at) : '')}</td>
      <td class="right nowrap"><button class="btn btn-sm" data-act="devBlock" data-on="" data-ids="${esc((b.ids || []).join(','))}" data-label="${esc(b.label || '')}">Разблокировать</button> <button class="btn btn-sm" data-act="devRemove" data-ids="${esc((b.ids || []).join(','))}" data-label="${esc(b.label || '')}">Удалить</button></td></tr>`).join('');
  return `<div class="card"><h2>Устройства</h2>
    <div class="muted small">Все компьютеры и телефоны, которые подключались к общей базе. «Заблокировать» — на этом устройстве программа закроется,
      база клиентов и ключи с него удалятся (в течение минуты, как только оно выйдет в интернет). Переустановка тем же установщиком не поможет — нужен новый от управляющей.</div>
    ${D ? `<div class="table-wrap mt"><table class="t compact"><thead><tr><th>Кто</th><th>Роль</th><th>Устройство</th><th>Был</th><th></th></tr></thead>
      <tbody>${rows}${orphan}</tbody></table></div>` : ''}
    <div class="row mt"><button class="btn btn-sm" data-act="devicesLoad" ${S.devsBusy ? 'disabled' : ''}>${S.devsBusy ? 'Загружаю…' : D ? 'Обновить список' : 'Показать устройства'}</button></div></div>`;
}

function syncHello() {
  const nm = operator() || '—', rn = roleName();
  api('POST', '/api/sync/hello', JSON.stringify({ who: nm === rn ? nm : `${nm} · ${rn}`, reader: isReader() })).catch(() => {});
}
function startSync() {
  applyPhoneZoom();
  syncHello();
  syncTick();
  setInterval(syncTick, 8000);
}
// срочное напоминание: ключ доступа к облаку скоро истечёт (дата приходит от GitHub вместе с ответами)
function keyDaysLeft() {
  const t = (S.sync || {}).tokenExpires;
  if (!t) return null;
  const ms = Date.parse(String(t).replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isFinite(ms) ? Math.ceil((ms - Date.now()) / 86400000) : null;
}
function renderKeyBar() {
  const bar = $('#keyBar');
  if (!bar) return;
  const st = S.sync || {}, left = keyDaysLeft();
  const dead = st.mode === 'error' && /ключ|401|Bad credentials/i.test(st.message || '');
  const mgr = can('cloud');
  const soon = left !== null && left <= (mgr ? 30 : 7);
  if (!st.connected || (!soon && !dead)) { bar.hidden = true; return; }
  const when = left !== null ? new Date(Date.parse(String(st.tokenExpires).replace(' UTC', 'Z').replace(' ', 'T'))).toLocaleDateString('ru-RU') : '';
  bar.classList.toggle('urgent', dead || left <= 7);
  bar.innerHTML = dead
    ? '<b>СРОЧНО: ключ доступа к облаку не принимается</b> (истёк или отозван). ' + (mgr ? 'Создайте новый ключ в GitHub и вставьте его на странице «<a data-nav="cloud">Облако</a>», затем выпустите новые установщики.' : 'Сообщите управляющей — без нового ключа общая база не обновляется.')
    : `<b>${left <= 0 ? 'СРОЧНО: ключ доступа к облаку истёк' : left <= 7 ? `СРОЧНО: ключ доступа к облаку истекает через ${left} дн.` : `Ключ доступа к облаку истекает через ${left} дн.`}</b> (${when}). `
      + (mgr ? 'Создайте новый в GitHub заранее и вставьте на странице «<a data-nav="cloud">Облако</a>» — иначе общая база перестанет обновляться на всех компьютерах и телефонах; установщики после смены ключа выпустите заново.' : 'Сообщите управляющей.');
  bar.hidden = false;
}
function renderOwner() {
  renderKeyBar();
  const el = $('#sideOwner');
  if (!el) return;
  const st = S.sync || {};
  const who = h => (holderWho(h) || (h && h.pc) || '…').split(' · ')[0].split(' ')[0];
  const [text, cls] = isReader() ? ['Вы читатель', 'view'] : !st.connected ? ['Облако', 'none'] : st.mode === 'owner' ? [isPhone() ? 'У вас' : 'Программа у вас', 'own']
    : st.mode === 'viewer' ? (st.holder ? ['У: ' + who(st.holder), 'view'] : ['Свободна', 'none'])
      : st.mode === 'offline' ? ['Без сети', 'off'] : st.mode === 'error' ? ['Ошибка облака', 'err'] : ['Свободна', 'none'];
  el.className = 'side-save side-owner ' + cls;
  el.innerHTML = `<span class="so-dot"></span><span class="so-text">${esc(text)}</span>`;
  el.title = readOnly() ? viewerMsg() : st.message || text;
  const bar = $('#roBar');
  // у курьера одна страница «Мои доставки» — ни полосы «читатель», ни нижнего меню не нужно
  const solo = isPhone() && canView('mine') && !['clients', 'delivery', 'packing', 'ending', 'stats', 'menu', 'incident', 'journal', 'admin', 'manager', 'finance', 'salary'].some(canView);
  document.body.classList.toggle('solo', solo);
  if (bar) bar.hidden = !readOnly() || solo;
  if (bar && readOnly()) bar.innerHTML = isReader() ? 'Вы читатель — можно только смотреть. Данные обновляются сами каждые несколько секунд.'
    : !st.holder ? 'Программа свободна — вы её освободили. Чтобы снова работать, нажмите <a data-act="cloudTake">Взять программу</a>.'
      : `Только просмотр — программа у <b>${esc(holderText(st.holder))}</b>. Данные обновляются сами каждые несколько секунд. <a data-nav="cloud">Подробнее</a>${forceOk() ? ' · <a data-act="cloudForce">Принудительно освободить базу</a>' : ''}`;
}

/* ---------------------------------------------------------------- установщик с параметрами */
/* Курьер в установщике и ссылке — по постоянному коду, а не по имени: переименовали Сардора в Улугбека —
   его ссылка работает дальше, и программа зовёт его уже Улугбеком. В настройке хранится «#код|имя на момент выдачи». */
function courierCode(name) {
  const m = db.settings.courierCodes || (db.settings.courierCodes = {});
  let code = Object.keys(m).find(k => m[k] === name);
  if (!code) { code = uid('k'); m[code] = name; db.settings.courierCodesAt = localIso(); persist(); }
  return code;
}
function opResolve(v) {
  const m = /^#(\w+)\|(.*)$/s.exec(v || '');
  if (!m) return v || '';
  return ((typeof db !== 'undefined' && db && db.settings.courierCodes) || {})[m[1]] || m[2];
}
// courierOnly — старший курьер: только ссылка iOS / Сайт версии и только для роли «Курьер»
function installerDialog(courierOnly = false) {
  const R = roleDefs();
  const roles = Object.values(R).filter(r => !courierOnly || r.id === 'driver');
  openModal({
    title: courierOnly ? 'Ссылка для курьера (iOS / Сайт версия)' : 'Скачать установщик',
    body: `<div class="form">
      <label class="field" ${courierOnly ? 'hidden' : ''}><span>Для чего</span><select class="input" name="kind">
        ${courierOnly ? '<option value="ios">iOS / Сайт версия (ссылка)</option>' : '<option value="exe">Компьютер Windows (.exe)</option><option value="apk">Телефон Android (.apk)</option><option value="ios">iOS / Сайт версия (ссылка)</option>'}</select></label>
      <label class="field"><span>Роль (в установленной программе её не поменять)</span><select class="input" name="role">
        ${roles.map(r => `<option value="${esc(r.id)}" ${r.id === (courierOnly ? 'driver' : 'om') ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <label class="field" id="opBox"><span>Имя сотрудника (необязательно)</span><input class="input" name="operator" list="dl-managers" placeholder="например Адема"></label>
      <label class="field" id="courBox" hidden><span>Курьер — ссылка привязана к нему, а не к имени: после переименования продолжит работать</span><select class="input" name="cour">
        <option value="">— выберите —</option>${opts(db.lists.couriers.slice().sort(ruCmp), '')}</select></label>
      <label class="field"><span id="pinLbl">PIN-код для входа (необязательно, 4–8 цифр)</span><input class="input" name="pin" inputmode="numeric" maxlength="8" autocomplete="off"></label>
      <label class="field"><span>Данные</span><select class="input" name="data"><option value="">Пустая программа (база придёт из облака)</option>
        <option value="1">С базой этого компьютера</option></select></label>
      <div class="field full checks"><label><input type="checkbox" name="cloud" ${(S.sync || {}).connected ? 'checked' : ''}> Ключ облака — общая база сразу подключена</label>
        <label><input type="checkbox" name="ai" checked> Ключ ИИ — подсчёт КБЖУ и проверка аллергий</label>
        <label><input type="checkbox" name="reader"> <b>Только режим читателя</b> — смотрит базу, но не забирает программу и ничего не меняет (в программе не снять)</label></div></div>
      <div class="muted small mt">С ключами установщик не отдавайте посторонним: в нём доступ к базе клиентов и к ИИ.</div>
      <div class="muted small mt" id="apkNote" hidden>Готовый .apk — роль, имя и выбранные ключи уже внутри. Отправьте его на телефон (Telegram, почта) и откройте —
        Android спросит разрешение на установку из этого источника. Больше ничего настраивать не нужно.</div>
      <div class="muted small mt" id="iosNote" hidden>iOS / Сайт версия: программа открывается в браузере (iPhone, iPad, MacBook) по личной ссылке. Ссылка зашифрована PIN-кодом (обязателен, 6–8 цифр):
        отправьте ссылку сотруднику, а PIN скажите отдельно — голосом или другим сообщением. Облако подключается всегда.</div>${datalists()}`,
    foot: '<button class="btn" data-act="closeModal">Отмена</button><button class="btn btn-green" data-m="go">Собрать установщик</button>',
    onMount(root) {
      const kind = $('[name="kind"]', root), roleSel = $('[name="role"]', root);
      const roleUi = () => { const drv = roleSel.value === 'driver'; $('#opBox', root).hidden = drv; $('#courBox', root).hidden = !drv; };
      roleSel.addEventListener('change', roleUi);
      roleUi();
      const kindUi = () => {
        const ios = kind.value === 'ios';
        $('#apkNote', root).hidden = kind.value !== 'apk';
        $('#iosNote', root).hidden = !ios;
        $('#pinLbl', root).textContent = ios ? 'PIN-код — обязательно, 6–8 цифр' : 'PIN-код для входа (необязательно, 4–8 цифр)';
        $('[name="data"]', root).closest('.field').hidden = ios;
        if (courierOnly) $$('.checks label', root).forEach(l => { l.hidden = !l.querySelector('[name="reader"]'); });
        if (courierOnly) { const rd = $('[name="reader"]', root); rd.checked = true; rd.disabled = true; } // старший курьер выдаёт только читателя
      };
      kind.addEventListener('change', kindUi);
      kindUi();
      $('[data-m="go"]', root).addEventListener('click', async () => {
        const v = n => $(`[name="${n}"]`, root);
        const id = v('role').value, pin = v('pin').value.trim();
        if (kind.value === 'ios' && !/^\d{6,8}$/.test(pin)) { toast('Для iOS / Сайт версии PIN-код обязателен: от 6 до 8 цифр', 'bad'); v('pin').focus(); return; }
        if (pin && !/^\d{4,8}$/.test(pin)) { toast('PIN-код: от 4 до 8 цифр', 'bad'); v('pin').focus(); return; }
        const cour = v('cour').value;
        if (id === 'driver' && !cour) { toast('Выберите курьера', 'bad'); v('cour').focus(); return; }
        if (courierOnly && (kind.value !== 'ios' || id !== 'driver')) return;
        if (id === 'driver' && !Object.values(db.settings.courierCodes || {}).includes(cour) && readOnly()) { gateToast(viewerMsg()); return; } // код курьера надо сохранить в базе
        const operator = id === 'driver' ? `#${courierCode(cour)}|${cour}`.slice(0, 60) : v('operator').value.trim();
        const opts = { kind: kind.value, role: id, roleName: R[id].name, operator, withData: !!v('data').value, withAi: v('ai').checked, withCloud: v('cloud').checked, pin: pin ? await sha(pin) : '', readerOnly: v('reader').checked };
        closeModal();
        if (courierOnly) { opts.withData = false; opts.withAi = false; opts.withCloud = true; opts.readerOnly = true; }
        if (kind.value === 'ios') { iosLink(opts, pin); return; }
        ACT.makeInstaller({ opts });
      });
    },
  });
}

/* ---------------------------------------------------------------- iPhone: личная ссылка на программу-сайт, зашифрованная PIN-кодом */
async function iosLink(opts, pin) {
  try {
    const base = String(db.settings.menuUrl || '').trim().replace(/\/?$/, '/');
    // программа для iPhone лежит на сайте страницы меню (папка app) — проверяем сам сайт, а не то, откуда его выкладывали
    const has = base.length > 1 && await fetch(base + 'app/ios.js', { method: 'HEAD', cache: 'no-store' }).then(r => r.ok, () => false);
    if (!has) {
      toast(`На странице меню${base.length > 1 ? ' (' + base + ')' : ''} ещё нет iOS / Сайт версии программы. «Облако» → «Страница меню для QR-кодов»: впишите хранилище страницы меню и ключ → «Выложить страницу меню», затем сделайте ссылку снова.`, 'bad', 20000);
      return;
    }
    const cfg = await api('POST', '/api/ioscfg', JSON.stringify(opts));
    const url = base + 'app/#k=' + await window.EHLink.encryptCfg(cfg, pin);
    addLog(`Ссылка iOS / Сайт версия: ${opts.roleName}${opts.operator ? ', ' + opResolve(opts.operator) : ''}${opts.readerOnly ? ', только читатель' : ''}`, 'admin');
    openModal({
      title: 'iOS / Сайт версия — ссылка',
      body: `<div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap">
        <div style="width:200px;background:#fff;padding:6px;border-radius:8px">${QR.svg(url, { ecl: 'L', quiet: 2 })}</div>
        <div style="flex:1;min-width:240px"><textarea class="input" rows="5" readonly style="font-size:11px;word-break:break-all" id="iosUrl">${esc(url)}</textarea>
          <div class="actions"><button class="btn btn-green btn-sm" data-m="copy">Скопировать ссылку</button></div></div></div>
        <ol class="small" style="padding-left:20px;line-height:1.5;margin-top:10px">
          <li>Отправьте ссылку сотруднику (или пусть отсканирует QR камерой iPhone). <b>PIN-код скажите отдельно</b>.</li>
          <li>На iPhone откройте ссылку в <b>Safari</b> → «Поделиться» → <b>«На экран „Домой“»</b>.</li>
          <li>Откройте «Ели-Худели» с экрана «Домой» и введите PIN-код — база придёт из облака.</li></ol>
        <div class="muted small">В ссылке зашифрован ключ к облаку: без PIN-кода она бесполезна. Закрыть доступ — «Управляющая» → «Устройства» → заблокировать.
          Ссылка работает, пока не сменится ключ облака.${opts.readerOnly ? ' <b>Только режим читателя</b> — программу не забирает.' : ''}</div>`,
      foot: '<button class="btn" data-act="closeModal">Готово</button>',
      onMount(root) { $('[data-m="copy"]', root).addEventListener('click', () => { navigator.clipboard.writeText(url).then(() => toast('Ссылка скопирована', 'ok')); }); },
    });
  } catch (e) { toast('Не удалось сделать ссылку: ' + e.message, 'bad', 10000); }
}

/* ---------------------------------------------------------------- страница «Облако» */
// телефон: язык и фон (на компьютере они внизу меню)
function phoneTools() {
  const dark = document.body.classList.contains('dark');
  const L = [['ru', 'Русский'], ['en', 'English'], ['uz', 'Oʻzbek'], ['kk', 'Қазақ']];
  return `<div class="phone-tools"><div class="chips">${L.map(([k, l]) => `<button class="${lang() === k ? 'on' : ''}" data-act="setLang" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="chips"><button class="${dark ? '' : 'on'}" data-act="setTheme" data-v="light">Светлый</button><button class="${dark ? 'on' : ''}" data-act="setTheme" data-v="dark">Тёмный</button></div>
    <div class="chips" title="Меньше — больше помещается на экране">${PHONE_ZOOMS.map(z => `<button class="${phoneZoom() === z ? 'on' : ''}" data-act="setZoom" data-v="${z}">${z}%</button>`).join('')}</div>${pinFreqField()}</div>`;
}
// масштаб на телефоне: меньше — больше помещается в ширину (по умолчанию 90%)
const PHONE_ZOOMS = [75, 80, 90, 100, 110];
const phoneZoom = () => +(lsGet('eh_zoom') || 90);
function applyPhoneZoom() { if (isPhone()) document.body.style.zoom = phoneZoom() / 100; }
/* ---------------------------------------------------------------- пошаговые инструкции: перенос базы и страницы меню */
const guide = (title, steps) => `<details class="guide mt"><summary>${title}</summary><ol>${steps.map(x => `<li>${x}</li>`).join('')}</ol></details>`;
const GH_TOKEN = perms => `Создайте ключ: GitHub → аватар → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.
  Resource owner — ваша организация (если её нет в списке — в настройках организации разрешите fine-grained tokens). Repository access — <b>Only select repositories</b> → это хранилище.
  Permissions → Repository: ${perms}. Срок — подольше: программа сама напомнит, когда ключ будет заканчиваться.`;
const GUIDE_BASE = [
  '<b>Сначала обновите программу у всех в старом облаке</b>: «Опубликовать» внизу этой страницы, и пусть каждый компьютер перезапустит программу. Старая версия не умеет безопасно переходить в другое облако.',
  'На GitHub создайте <b>закрытое</b> (Private) хранилище, лучше пустое — например <code>организация/office</code>.',
  GH_TOKEN('<b>Contents — Read and write</b> и <b>Pages — Read and write</b>') + ' <b>Проще всего один ключ на оба хранилища</b> — базы (office) и страницы меню (menu): тогда страницу меню программа выкладывает тем же ключом.',
  'Попросите всех закрыть программу или нажать «Освободить программу». Переносить нужно с компьютера, где самая свежая база (здесь должно быть «Программа у вас»).',
  'Выше в «Хранилище» впишите <code>организация/имя</code>, в «Ключ» — новый ключ, нажмите «Сохранить». Программа отправит последние изменения в старое облако, отпустит его и положит вашу базу в новое (если новое не пустое — возьмёт базу оттуда, а вашу сохранит резервной копией).',
  'Сразу нажмите <b>«Опубликовать»</b> — в новом облаке появится программа для автообновления и новых установок.',
  'Остальные компьютеры и телефоны <b>перейдут сами</b> в течение минуты: в старом облаке остаётся пометка, куда переехала база. Если их ключ в новое хранилище не пускает, они покажут «Облако переехало…» — тогда на таком компьютере впишите новый ключ («Облако» → «Сохранить»), а телефонам и iOS / Сайт версии выдайте новый установщик или ссылку.',
  'Телефоны: «Админ» → «Установщик программы» → телефон, с галочкой облака — новое приложение поставить поверх старого.',
  'Старое хранилище не удаляйте, пока всё не устоится: в нём последняя база и облачные копии. Вернуться можно одной кнопкой — облака запоминаются (кнопки над полем «Хранилище»).',
];
const GUIDE_MENU = [
  'На GitHub создайте <b>публичное</b> (Public) хранилище — GitHub Pages на бесплатном тарифе работают только у публичных. В нём лежат только файлы страницы, данных клиентов там нет (меню хранится в самом QR-коде).',
  'Название: <code>menu</code> → адрес будет <code>https://организация.github.io/menu/</code>. Или <code>организация.github.io</code> → адрес короче: <code>https://организация.github.io/</code>.',
  GH_TOKEN('<b>Contents — Read and write</b> и <b>Pages — Read and write</b>'),
  'Ниже впишите хранилище и ключ, нажмите <b>«Выложить страницу меню»</b>. Программа положит файлы, включит GitHub Pages и сама подставит новый адрес для QR-кодов.',
  'Первый раз страница открывается через 1–2 минуты. Проверьте: «Меню дня» → любой QR → отсканируйте телефоном.',
  '<b>Уже напечатанные QR-коды ведут на старый адрес</b> — не удаляйте старую страницу, пока такие бумажки в ходу.',
  'После обновлений программы нажмите «Выложить страницу меню» ещё раз — обновятся и страница меню, и iOS / Сайт версия (выложатся только изменённые файлы).',
];
// адрес вида https://организация.github.io/menu/ → хранилище «организация/menu» (страницу выкладывали вручную)
function menuRepoGuess() {
  const m = String(db.settings.menuUrl || '').match(/^https:\/\/([\w-]+)\.github\.io\/([\w.-]*)/i);
  return m ? `${m[1]}/${m[2] || m[1] + '.github.io'}` : '';
}
function menuSiteCard() {
  if (!S.menuSite) { S.menuSite = {}; api('GET', '/api/menusite').then(r => { S.menuSite = r; render(); }).catch(() => {}); }
  const m = S.menuSite;
  return `<div class="card"><h2>Страница меню для QR-кодов</h2>
    <div class="muted small" style="margin-bottom:10px">Отдельное от базы хранилище GitHub Pages: страница, которая рисует карточку меню, когда клиент сканирует QR.
      Сюда же выкладывается iOS / Сайт версия программы (папка app, для iPhone, iPad и MacBook) — ссылки для них делает «Установщик». Данных клиентов здесь нет: база приходит из закрытого облака по личной ссылке.</div>
    <div class="kv"><b>Адрес для QR</b><span>${esc(db.settings.menuUrl || '— (в QR будет меню текстом)')}</span>
      <b>Хранилище</b><span>${esc(m.repo || 'не подключено из программы')}</span></div>
    <div class="form mt"><label class="field full"><span>Хранилище страницы меню</span><input class="input" id="msRepo" value="${esc(m.repo || menuRepoGuess())}" placeholder="организация/menu"></label>
      <label class="field full"><span>Ключ доступа</span><input class="input" type="password" id="msToken" autocomplete="off" placeholder="${m.hasKey ? 'свой ключ задан — впишите новый, чтобы заменить' : 'пусто — ключ облака (если ему дан доступ и к этому хранилищу)'}"></label></div>
    <div class="actions"><button class="btn btn-green" data-act="menuSitePublish" ${S.msBusy ? 'disabled' : ''}>${S.msBusy ? 'Выкладываю…' : 'Выложить страницу меню'}</button></div>
    ${guide('Как перенести или подключить страницу меню — пошагово', GUIDE_MENU)}</div>`;
}
function viewCloud() {
  const st = S.sync || {};
  const ago = s => (s == null ? '' : s < 60 ? `${s} сек назад` : `${Math.round(s / 60)} мин назад`);
  const state = readerOnly() ? '<div class="warn"><b>Только режим читателя.</b> Программа установлена только для просмотра: база приходит из облака сама, программу вы не забираете и ничего не меняете.</div>'
    : isReader() ? '<div class="warn"><b>Вы читатель.</b> В этой программе можно только смотреть: база приходит из облака сама, а программу у других вы не забираете.</div>'
    : !st.connected ? '<div class="preview">Облако не подключено — программа работает только на этом компьютере.</div>'
    : st.mode === 'owner' ? `<div class="preview"><b>Программа у вас</b> — вы меняете общую базу, остальные видят её для просмотра.</div>`
      : st.mode === 'viewer' && !st.holder ? `<div class="preview"><b>Программа свободна.</b> Вы её освободили — нажмите «Взять программу», чтобы снова работать.</div>`
      : st.mode === 'viewer' ? `<div class="warn"><b>Программа у ${esc(holderText(st.holder))}</b>${st.holder && st.holder.ago != null ? ` · сигнал ${ago(st.holder.ago)}` : ''}.
          Пока он работает, у вас только просмотр. Когда он закроет программу (или его компьютер выключится — примерно через полторы минуты), программа сама перейдёт к вам.</div>`
        : st.mode === 'offline' ? `<div class="warn"><b>Нет интернета.</b> Можно работать — изменения сохранятся здесь и уйдут в облако, когда появится связь.</div>`
          : st.mode === 'error' ? `<div class="warn"><b>Облако:</b> ${esc(st.message || '')}</div>` : '<div class="preview">Программа свободна — подключаюсь…</div>';
  return `<div class="page-head"><h1>Программа и общая база</h1><div class="sub">смен больше нет — работает тот, у кого программа</div></div>
  ${isPhone() ? `<div class="card"><h2>Язык, фон и масштаб</h2>${phoneTools()}</div>` : pinFreqField() ? `<div class="card"><h2>PIN-код входа</h2><div class="form">${pinFreqField()}</div></div>` : ''}
  <div class="grid2">
    <div class="card"><h2>Сейчас</h2>${state}
      <div class="kv mt"><b>Вы</b><span>${esc(operator() || '—')}${operator() === roleName() ? '' : ' · ' + esc(roleName())}${st.me ? ` · ${esc(st.me.pc)}` : ''}</span>
        ${st.connected ? `<b>Хранилище</b><span>${esc(st.repo || '')}</span><b>Версия базы</b><span>${st.rev || 0}${st.dirty ? ' · есть неотправленные изменения' : ''}</span>
        <b>Последняя отправка</b><span>${st.lastSync ? fmtStamp(st.lastSync) : '—'}</span>` : ''}</div>
      <div class="actions">${st.mode === 'owner' ? '<button class="btn" data-act="cloudRelease">Освободить программу</button>' : ''}
        ${st.mode === 'viewer' && !st.holder ? '<button class="btn btn-green" data-act="cloudTake">Взять программу</button>' : ''}
        ${forceOk() ? '<button class="btn btn-red" data-act="cloudForce" title="Забрать программу себе сразу, не дожидаясь, пока он закроет">⚡ Принудительно освободить базу</button>' : ''}
        ${st.connected ? '<button class="btn" data-act="cloudNow">↻ Проверить сейчас</button><button class="btn" data-act="cloudUpdate">Проверить обновление программы</button>' : ''}</div></div>
    ${hiddenViews().length ? `<div class="card"><h2>Скрытые вкладки</h2><div class="muted small" style="margin-bottom:8px">скрываются правой кнопкой мыши по вкладке слева</div>
      ${hiddenViews().map(v => `<div class="dl-sum-row">${esc(TAB_NAMES[v] || v)}<button class="btn btn-sm" data-act="showTab" data-v="${esc(v)}">Показать</button></div>`).join('')}</div>` : ''}
    ${can('cloud') ? `<div class="card"><h2>Подключение к GitHub</h2>
      <div class="muted small" style="margin-bottom:10px">Закрытое хранилище организации ЕлиХудели и ключ доступа к нему. Ключ хранится только на этом компьютере.</div>
      ${(st.clouds || []).length > 1 ? `<div class="chips wrap" style="margin-bottom:10px">${st.clouds.map(r => `<button class="${r === st.repo ? 'on' : ''}" data-act="cloudSwitch" data-v="${esc(r)}" ${S.cloudBusy || r === st.repo ? 'disabled' : ''}>${esc(r)}</button>`).join('')}</div>` : ''}
      <div class="form"><label class="field full"><span>Хранилище (впишите другое — облако сменится; ключи от прежних запоминаются)</span><input class="input" id="ghRepo" value="${esc(st.repo || 'elihudeli/office')}"></label>
        <label class="field full"><span>Ключ доступа (fine-grained token)</span><input class="input" type="password" id="ghToken" autocomplete="off" placeholder="${st.connected ? 'ключ задан — впишите новый, чтобы заменить' : 'github_pat_…'}"></label></div>
      <div class="actions"><button class="btn btn-green" data-act="cloudSave" ${S.cloudBusy ? 'disabled' : ''}>${S.cloudBusy ? 'Подключаю…' : st.connected ? 'Сохранить' : 'Подключить облако'}</button>
        ${st.connected ? '<button class="btn btn-red" data-act="cloudOff">Отключить</button>' : ''}</div>
      ${guide('Как перенести базу в другое хранилище — пошагово', GUIDE_BASE)}</div>` : ''}
    ${can('cloud') && !isPhone() ? menuSiteCard() : ''}
    ${can('publish') && st.connected ? `<div class="card"><h2>Обновление программы для всех</h2>
      <div class="muted small" style="margin-bottom:10px">Публикует программу с этого компьютера. Остальные поставят её сами (при запуске и раз в полчаса), база при этом не трогается.
        ${st.published ? `Последняя публикация: ${esc(st.published)}.` : ''}</div>
      <div class="row"><input class="input" id="pubNote" placeholder="что нового (необязательно)" style="flex:1"><button class="btn btn-green" data-act="cloudPublish">Опубликовать</button></div></div>` : ''}
    ${st.connected && ['om', 'manager', 'developer'].includes(role()) ? `<div class="card"><h2>Копии базы в облаке</h2>
      <div class="muted small" style="margin-bottom:10px">Сохраняются сами, когда офис-менеджер, управляющая или разработчик начинает работу (последние 12),
        и перед «Стереть всю базу» (хранится месяц).</div>
      ${S.cloudBk ? (S.cloudBk.length ? `<table class="t compact"><tbody>${S.cloudBk.map(b => `<tr><td class="nowrap">${fmtStamp(b.at)}</td>
        <td>${b.kind === 'wipe' ? '<b>перед стиранием</b>' : esc(b.who)}</td>
        <td class="right">${st.mode === 'owner' ? `<button class="btn btn-sm" data-act="cloudRestore" data-v="${esc(b.name)}">Восстановить</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">Копий пока нет</div>') : ''}
      <div class="actions"><button class="btn" data-act="cloudBackupsLoad">${S.cloudBk ? 'Обновить список' : 'Показать копии'}</button>
        <button class="btn" data-act="cloudBackupNow">Сохранить копию сейчас</button></div></div>` : ''}
    ${can('files') ? `<div class="card"><h2>Файлы</h2>
      <div class="muted small" style="margin-bottom:10px">Копия базы файлом — на всякий случай или чтобы перенести без интернета.</div>
      <div class="actions"><button class="btn" data-act="exportXlsx">Сохранить базу в Excel</button><button class="btn" data-act="exportJson">JSON</button>
        <button class="btn" data-act="pickFile">Загрузить файл</button></div></div>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- заставка: минута без движения — сцена с Асифом и коллегами */
const SAVER_MS = 60000;
let saverTimer = 0;
function showSaver() {
  if ($('#saver') || document.hidden || isPhone()) return; // на телефоне заставки нет — она закрывала бы всё окно
  const el = document.createElement('div');
  el.id = 'saver';
  el.className = 'saver no-print';
  el.innerHTML = `<div class="saver-in">${asifHtml()}</div><div class="saver-hint">Пошевелите мышью — заставка исчезнет</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  startAsif();
}
function hideSaver() {
  const el = $('#saver');
  if (!el) return;
  el.remove();
  clearInterval(S.asifTimer);
  cancelAnimationFrame(S.scRaf);
}
function idleReset() {
  hideSaver();
  clearTimeout(saverTimer);
  saverTimer = setTimeout(showSaver, SAVER_MS);
}
// кнопка «Назад» на телефоне: закрыть окно или вернуться к первому разделу
window.ehBack = () => {
  if (MODALS.length) { closeModal(); return true; }
  if (S.view !== firstView()) { go(firstView()); return true; }
  return false;
};
function startSaver() {
  if (isPhone()) return;
  for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) document.addEventListener(ev, idleReset, { passive: true, capture: true });
  idleReset();
}

/* ---------------------------------------------------------------- «Мои доставки»: курьер сразу видит свой план */
// отметки «доставлено» — личные, для удобства курьера: хранятся на его устройстве, последние 3 дня
function mineMarks() {
  try { return JSON.parse(lsGet('eh_mine_done') || '{}') || {}; } catch { return {}; }
}
const mineDone = d => mineMarks()[isoOf(d)] || [];
function viewMine() {
  const cour = db.lists.couriers.includes(operator()) ? operator() : (S.mineCour || '');
  const D = TODAY + (S.mineDay || 0), t = S.mineTime || 'утро';
  // утром курьер везёт пакеты вчерашней фасовки, вечером — сегодняшней
  const all = cour ? [...deliveriesOn(D - 1).filter(r => r.o.time === 'утро'), ...deliveriesOn(D).filter(r => r.o.time === 'вечер')].filter(r => r.o.courier === cour) : [];
  const list = all.filter(r => r.o.time === t).sort((a, b) => ruCmp(a.cl.address, b.cl.address));
  const mapUrl = a => (String(a).match(/https?:\/\/\S+/) || [''])[0];
  const done = mineDone(D);
  const cards = list.map((r, i) => {
    const addr = String(r.cl.address || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    const map = mapUrl(r.cl.address);
    const tel = String(r.cl.phone || '').replace(/[^\d+]/g, '').slice(0, 13);
    return `<div class="mine-row ${done.includes(r.pid) ? 'done' : ''}"><label class="mine-chk"><input type="checkbox" data-bind="mineDone" data-d="${D}" data-id="${esc(r.pid)}" ${done.includes(r.pid) ? 'checked' : ''}><span>${i + 1}</span></label>
      <div class="mine-main"><div class="mine-top"><b class="mine-name">${esc(r.cl.name)}</b><span class="pill">${esc(progLabel(r.prog))}</span></div>
        ${rowTags(r).length ? `<div class="mine-tags">${rowTags(r).map(tg => `<span style="background:${tg.color};color:${isDarkColor(tg.color) ? '#fff' : '#111'}">${esc(tg.name)}</span>`).join('')}</div>` : ''}
        <div class="mine-addr">${esc(addr || '—')}</div>
        ${r.o.note ? `<div class="mine-note">${esc(r.o.note)}</div>` : ''}
        <div class="mine-act">${tel ? `<a class="btn btn-sm btn-green" href="tel:${esc(tel)}">${esc(phoneShort(r.cl.phone))}</a>` : ''}
          ${map ? `<a class="btn btn-sm" href="${esc(map)}" target="_blank" rel="noopener">Карта</a>` : ''}</div></div></div>`;
  }).join('');
  return `${document.body.classList.contains('solo') ? `<details class="phone-set" ${S.psOpen ? 'open' : ''} ontoggle="S.psOpen = this.open"><summary>Язык, фон и масштаб</summary>${phoneTools()}</details>` : ''}<div class="page-head"><h1>Мои доставки</h1><div class="sub">${cour && cour === operator() ? esc(cour) + ' · ' : ''}${esc(fmtLong(D))}</div></div>
    ${db.lists.couriers.includes(operator()) ? '' : `<div class="row" style="margin-bottom:10px"><span class="muted">Курьер:</span>
      <select class="input" data-bind="mineCour" style="max-width:220px"><option value="">— выберите —</option>${opts(db.lists.couriers, cour)}</select></div>`}
    <div class="chips" style="margin-bottom:8px">${[[0, 'Сегодня'], [1, 'Завтра']].map(([v, l]) => `<button class="${(S.mineDay || 0) === v ? 'on' : ''}" data-act="mineDay" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="chips" style="margin-bottom:12px">${['утро', 'вечер'].map(x => `<button class="${t === x ? 'on' : ''}" data-act="mineTime" data-v="${x}">${x === 'утро' ? 'Утро' : 'Вечер'} · ${all.filter(r => r.o.time === x).length}</button>`).join('')}</div>
    ${cour && list.length ? `<div class="mine-count">Доставлено: <b id="mineCount">${list.filter(r => done.includes(r.pid)).length}</b> из ${list.length}</div>` : ''}
    ${!cour ? '<div class="card empty">Выберите курьера</div>' : cards ? `<div class="mine-list">${cards}</div>` : '<div class="card empty">Доставок нет</div>'}`;
}
Object.assign(ACCESS_ACT, {
  mineDay: d => { S.mineDay = +d.v; render(); },
  mineTime: d => { S.mineTime = d.v; render(); },
});
Object.assign(ACCESS_BIND, {
  mineCour: (v, _el, t) => { if (t === 'change') { S.mineCour = v; render(); } },
  mineDone: (_v, el, t) => {
    if (t !== 'change') return;
    const m = mineMarks(), iso = isoOf(+el.dataset.d), l = (m[iso] || []).filter(x => x !== el.dataset.id);
    if (el.checked) l.push(el.dataset.id);
    m[iso] = l;
    for (const k of Object.keys(m)) if (dn(k) < TODAY - 2) delete m[k];
    lsSet('eh_mine_done', JSON.stringify(m));
    el.closest('.mine-row').classList.toggle('done', el.checked);
    $('#mineCount').textContent = $$('.mine-row.done').length; // без перерисовки: список остаётся на месте
  },
});

/* ---------------------------------------------------------------- «👁 Проверить права»: глазами роли или сотрудника */
function setRolePreview(v) {
  S.asRole = v;
  $('#asBar')?.remove();
  if (v) {
    const bar = document.createElement('div');
    bar.id = 'asBar';
    bar.className = 'as-bar no-print';
    bar.innerHTML = `👁 Так видит: <b>${esc(v.label)}</b>${v.label === roleName(v.role) ? '' : ' · ' + esc(roleName(v.role))}<button class="btn btn-sm" data-act="asExit">Выйти из просмотра</button>`;
    document.body.appendChild(bar);
  }
  if (!canView(S.view)) S.view = firstView();
  render();
  applyPermsUI();
}
function openRolePreview() {
  if (!FULL_ROLES.includes(realRole())) return;
  const R = roleDefs(), roles = Object.values(R).filter(r => !FULL_ROLES.includes(r.id));
  const devs = ((S.devs && S.devs.devices) || []).filter(d => d.role && !FULL_ROLES.includes(d.role) && !devGone(devIds(d)));
  openModal({
    title: 'Проверить, как выглядят права',
    body: `<div class="muted small" style="margin-bottom:10px">Программа на этом окне покажет только то, что видит и может выбранная роль или сотрудник
      (с его личными правами из «Устройств»). Ничего не меняется — выйти можно кнопкой вверху.</div>
      <h3>Роль</h3><div class="chips" style="flex-wrap:wrap">${roles.map(r => `<button data-m="role" data-r="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div>
      <h3 class="mt">Сотрудник (журнал управляющей → «Устройства»)</h3>
      ${devs.length ? `<div class="chips" style="flex-wrap:wrap">${devs.map((d, i) => `<button data-m="dev" data-i="${i}">${esc(d.who || '—')} <span class="muted small">${esc(R[d.role]?.name || d.role)} · ${esc(d.pc || '')}</span></button>`).join('')}</div>`
    : `<div class="muted small">Список сотрудников ещё не загружен. <a data-m="load">Загрузить</a></div>`}`,
    foot: '<button class="btn" data-act="closeModal">Закрыть</button>',
    onMount(root) {
      root.addEventListener('click', async e => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'load') {
          b.textContent = 'Загружаю…';
          try { S.devs = await api('POST', '/api/sync/devices', '{}'); } catch (err) { toast('Не удалось получить список: ' + err.message, 'bad'); return; }
          closeModal(); openRolePreview(); return;
        }
        closeModal();
        if (b.dataset.m === 'role') setRolePreview({ role: b.dataset.r, machine: '', label: R[b.dataset.r].name });
        else { const d = devs[+b.dataset.i]; setRolePreview({ role: d.role, machine: d.machine, label: d.who || '—' }); }
      });
    },
  });
}
