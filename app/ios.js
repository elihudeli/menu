'use strict';
/* =====================================================================
   Ели-Худели на iPhone: то же окно программы, но без приложения — сайт (GitHub Pages).
   Этот файл заменяет то, что на Android делают Api.java / Sync.java / Store.java:
   база и настройки — в памяти браузера (IndexedDB), общая база — через облако GitHub,
   окно программы общается с ним так же, как с телефоном (window.EHAndroid.call и /api/…).
   Настройка приходит в ссылке из «Установщика» (#k=…), зашифрованной PIN-кодом.
   ===================================================================== */
(() => {
  const LOCK_STALE = 90, BEAT = 20, POLL = 10, PUSH_GAP = 5, REG_EVERY = 1800, KEEP_AUTO = 12, WIPE_DAYS = 30; // как в sync.py
  const DEFAULT_MODEL = 'gemini-3.5-flash-lite', OPENAI_URL = 'https://api.openai.com/v1';
  const F = window.fetch.bind(window);
  const enc = new TextEncoder(), dec = new TextDecoder();
  const now = () => Date.now() / 1000;
  const pad = n => String(n).padStart(2, '0');
  const stamp = (d = new Date(), sep = 'T', t = ':') => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${sep}${pad(d.getHours())}${t}${pad(d.getMinutes())}${t}${pad(d.getSeconds())}`;
  const nowIso = () => stamp();

  /* ---------------------------------------------------------------- хранилище: IndexedDB, всё держим и в памяти */
  const mem = new Map();
  let idb = null;
  const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function storeOpen() {
    const r = indexedDB.open('eh-office', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    idb = await idbReq(r);
    const tx = idb.transaction('files');
    const keys = await idbReq(tx.objectStore('files').getAllKeys());
    const vals = await idbReq(idb.transaction('files').objectStore('files').getAll());
    keys.forEach((k, i) => mem.set(k, vals[i]));
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* не важно */ }
  }
  const store = {
    read: n => (mem.has(n) ? mem.get(n) : null),
    json(n) { try { return JSON.parse(mem.get(n) || '{}') || {}; } catch { return {}; } },
    async write(n, v) { mem.set(n, v); await idbReq(idb.transaction('files', 'readwrite').objectStore('files').put(v, n)); },
    writeJson(n, o) { return this.write(n, JSON.stringify(o)); },
    async del(n) { mem.delete(n); await idbReq(idb.transaction('files', 'readwrite').objectStore('files').delete(n)); },
  };

  /* ---------------------------------------------------------------- байты: base64, sha, gzip */
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  const sha256 = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const gzip = bytes => pipe(bytes, new CompressionStream('gzip'));
  const gunzip = bytes => pipe(bytes, new DecompressionStream('gzip'));

  /* ---------------------------------------------------------------- ссылка из установщика: #k=соль|iv|шифр, ключ — PIN */
  async function pinKey(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptCfg(cfg, pin) { // вызывается из окна установщика на компьютере
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), enc.encode(JSON.stringify(cfg))));
    const out = new Uint8Array(28 + ct.length);
    out.set(salt); out.set(iv, 16); out.set(ct, 28);
    return b64url(out);
  }
  async function decryptCfg(k, pin) {
    const raw = unb64url(k);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(16, 28) }, await pinKey(pin, raw.subarray(0, 16)), raw.subarray(28));
    return JSON.parse(dec.decode(pt));
  }
  window.EHLink = { encryptCfg, decryptCfg };
  // на компьютере этот файл подключается только ради шифрования ссылки — дальше ничего не делаем
  if (!document.documentElement.hasAttribute('data-ios')) return;

  /* ---------------------------------------------------------------- состояние облака (как Sync.java) */
  class GHError extends Error { constructor(code, msg) { super(code + ': ' + msg); this.code = code; } }
  let local = {}, who = '', reader = false, holdOff = false, running = false, chosen = null;
  let headSha = null, headEnt = null, headState = null;
  let lastBeat = 0, lastPush = 0, lastReg = 0, tokenExp = '', inst = '', role = '';
  const st = { mode: 'off', holder: null, rev: 0, pulled: 0, needMerge: 0, message: '', lastSync: '', updated: 0, published: '' };
  let news = null, dirtyNow = false, seen = { key: null, at: 0 };

  const saveLocal = () => store.writeJson('sync.json', local);
  const secrets = () => store.json('secrets.json');
  const token = () => secrets().githubToken || '';
  const repo = () => secrets().githubRepo || 'elihudeli/office';
  const apiBase = () => secrets().githubApi || 'https://api.github.com';
  const rp = p => `/repos/${repo()}${p}`;
  const baseBytes = () => { const s = store.read('base.json'); return s == null ? null : enc.encode(s); };
  async function localDirty() { const b = baseBytes(); return (b ? await sha256(b) : '') !== (local.hash || ''); }
  const iosVer = () => { const m = navigator.userAgent.match(/OS (\d+)_(\d+)/); return m ? ` · iOS ${m[1]}.${m[2]}` : ''; };
  const dev = () => (/iPad/.test(navigator.userAgent) ? 'iPad' : /iPhone|iPod/.test(navigator.userAgent) ? 'iPhone' : /Macintosh/.test(navigator.userAgent) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'MacBook') : 'Сайт');
  const me = () => ({ machine: local.machine, who: who || '—', pc: dev() + iosVer() });

  async function req(method, path, body, accept) {
    let r;
    try {
      r = await F(path.startsWith('http') ? path : apiBase() + path, {
        method, cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token(), Accept: accept || 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { const x = new Error('Нет связи с GitHub: ' + e.message); x.offline = true; throw x; }
    const exp = r.headers.get('github-authentication-token-expiration');
    if (exp) tokenExp = exp.trim();
    if (accept && r.ok) return new Uint8Array(await r.arrayBuffer());
    const text = await r.text();
    if (!r.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch { /* текст */ } throw new GHError(r.status, m); }
    return text ? JSON.parse(text) : {};
  }
  async function head(branch) {
    try { return (await req('GET', rp('/git/ref/heads/' + branch))).object.sha; } catch (e) { if (e.code === 404 || e.code === 409) return null; throw e; }
  }
  const treeOf = async c => (await req('GET', rp('/git/commits/' + c))).tree.sha;
  async function entries(tree, recursive) {
    const t = await req('GET', rp('/git/trees/' + tree + (recursive ? '?recursive=1' : '')));
    const out = {};
    for (const x of t.tree || []) if (x.type === 'blob') out[x.path] = x.sha;
    return out;
  }
  const blob = sha => req('GET', rp('/git/blobs/' + sha), null, 'application/vnd.github.raw+json');
  const putBlob = async bytes => (await req('POST', rp('/git/blobs'), { content: b64(bytes), encoding: 'base64' })).sha;
  const mkTree = async ent => (await req('POST', rp('/git/trees'), { tree: Object.entries(ent).map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })) })).sha;
  const mkCommit = async (message, tree, parent) => (await req('POST', rp('/git/commits'), { message, tree, parents: parent ? [parent] : [] })).sha;
  function setRef(branch, sha, force, create) {
    return create ? req('POST', rp('/git/refs'), { ref: 'refs/heads/' + branch, sha }) : req('PATCH', rp('/git/refs/heads/' + branch), { sha, force });
  }
  async function ensureRepoReady() {
    try { await req('GET', rp('/git/ref/heads/main')); } catch (e) {
      if (e.code !== 404 && e.code !== 409) throw e;
      await req('PUT', rp('/contents/README.md'), { message: 'Начало', content: b64(enc.encode('# ЕлиХудели — офис\n\nОбщая база (ветка data) и программа (ветка main).\n')) });
    }
  }
  async function readRemote(fresh) {
    const h = await head('data');
    if (!h) { headSha = headEnt = headState = null; return false; }
    if (!fresh && h === headSha) return true;
    const ent = await entries(await treeOf(h));
    headState = ent['state.json'] ? JSON.parse(dec.decode(await blob(ent['state.json']))) : {};
    headSha = h; headEnt = ent;
    return true;
  }
  async function write(state, msg, baseGz, orphan) {
    const ent = { ...(headEnt || {}) };
    ent['state.json'] = await putBlob(enc.encode(JSON.stringify(state)));
    if (baseGz) ent['base.json.gz'] = await putBlob(baseGz);
    const com = await mkCommit(msg, await mkTree(ent), orphan || !headSha ? null : headSha);
    await setRef('data', com, orphan, !headSha);
    headSha = com; headEnt = ent; headState = state;
  }
  async function pull() {
    const raw = await gunzip(await blob(headEnt['base.json.gz']));
    const text = dec.decode(raw);
    JSON.parse(text); // база должна быть целой
    await store.write('base.json', text);
    local.rev = headState.rev || 0; local.hash = await sha256(raw);
    await saveLocal();
    st.pulled++;
  }
  async function remoteBase() {
    if (!await readRemote(false) || !headEnt['base.json.gz']) return null;
    return dec.decode(await gunzip(await blob(headEnt['base.json.gz'])));
  }
  async function push() {
    const raw = baseBytes();
    if (!raw) return false;
    const have = await readRemote(true);
    const state = have ? { ...headState } : {};
    const lk = state.lock;
    if (have && (!lk || lk.machine !== local.machine)) return false;
    if (have && (state.rev || 0) > (local.rev || 0)) { st.needMerge = state.rev; return false; }
    const rev = (state.rev || 0) + 1;
    Object.assign(state, { rev, savedAt: nowIso(), savedBy: who || '—', lock: { ...me(), since: lk ? lk.since || now() : now(), beat: now() } });
    await write(state, `База ${rev} · ${who}`, await gzip(raw), true);
    local.rev = rev; local.hash = await sha256(raw);
    await saveLocal();
    lastPush = lastBeat = now();
    st.lastSync = nowIso();
    return true;
  }

  async function step() {
    try {
      if (local.blocked) { Object.assign(st, { mode: 'blocked', holder: null, message: 'Доступ к программе закрыт управляющей' }); return; }
      if (!token()) { Object.assign(st, { mode: 'off', holder: null, message: '' }); return; }
      await doStep();
      st.message = '';
      dirtyNow = await localDirty();
    } catch (e) {
      if (e instanceof GHError) {
        if ([401, 403, 404].includes(e.code)) Object.assign(st, { mode: 'error', message: `GitHub не пускает в ${repo()}: проверьте ключ доступа (${e.message})` });
        else if (e.code === 422) headSha = null;
        else Object.assign(st, { mode: 'error', message: e.message });
      } else if (e.offline) Object.assign(st, { mode: 'offline', message: e.message });
      else Object.assign(st, { mode: 'error', message: String(e.message || e) });
    }
  }
  async function doStep() {
    if (!await readRemote(false)) {
      await ensureRepoReady();
      const raw = baseBytes();
      if (raw) {
        await write({ rev: 1, savedAt: nowIso(), savedBy: who, lock: { ...me(), since: now(), beat: now() } }, 'Первая база', await gzip(raw), true);
        local.rev = 1; local.hash = await sha256(raw);
        await saveLocal();
        lastPush = lastBeat = now();
      }
      Object.assign(st, { mode: 'owner', holder: me() });
      return;
    }
    let state = headState;
    const moved = state.movedTo || '';
    if (moved && moved !== repo()) {
      if (repo() !== chosen) { await follow(moved); return; }
      state = { ...state }; delete state.movedTo; // вернулись сюда нарочно — пометка устарела
      await write(state, 'Облако снова здесь · ' + who, null, false);
    }
    const lk = state.lock, t = now();
    const mine = !!lk && lk.machine === local.machine;
    const key = lk ? lk.machine + '|' + lk.beat : ''; // «брошена» — сигнал владельца не менялся LOCK_STALE по нашим часам
    if (key !== seen.key) seen = { key, at: t };
    const free = !lk || t - seen.at > LOCK_STALE;
    if (isBlocked(state)) { await blockMe(state, mine); return; }
    if ((state.removed || []).some(b => (b.ids || []).some(id => myIds().has(id)))) { await blockMe(state, mine, 'Вас удалили из программы.'); return; }
    registerMaybe();
    const rrev = state.rev || 0;
    st.rev = rrev;
    if (!(local.rev || 0) && headEnt['base.json.gz']) await pull(); // телефон подключается впервые — берём базу из облака
    if (rrev > (local.rev || 0)) {
      if (await localDirty()) st.needMerge = rrev;
      else { await pull(); st.needMerge = 0; }
    }
    const holderOf = () => ({ ...lk, ago: Math.round(t - seen.at) });
    if (reader && !mine) { Object.assign(st, { mode: 'viewer', holder: free ? null : holderOf() }); return; }
    if (free && !mine && holdOff) { Object.assign(st, { mode: 'viewer', holder: null }); return; }
    if (mine || free) {
      if (!mine || t - lastBeat > BEAT) {
        await write({ ...state, lock: { ...me(), since: mine ? lk.since || t : t, beat: t } }, (mine ? 'Сигнал · ' : 'Программу взял · ') + who, null, false);
        lastBeat = t;
      }
      Object.assign(st, { mode: 'owner', holder: me() });
    } else {
      holdOff = false;
      Object.assign(st, { mode: 'viewer', holder: holderOf() });
      return;
    }
    if (!st.needMerge && await localDirty() && t - lastPush > PUSH_GAP) await push();
    if (!await localDirty()) try { await prepRelease(); } catch { /* не успели — освободится по старинке */ }
  }
  // готовая запись «Программа свободна» поверх текущей: при закрытии вкладки остаётся один запрос — браузер успевает его отправить
  let rel = { key: '', tree: '', commit: '', parent: '' };
  async function prepRelease() {
    if (rel.parent === headSha) return;
    const text = JSON.stringify({ ...headState, lock: null }), key = text + '|' + headEnt['base.json.gz'];
    if (rel.key !== key) rel = { ...rel, key, tree: await mkTree({ ...headEnt, 'state.json': await putBlob(enc.encode(text)) }) }; // сигнал меняет только lock — дерево то же
    rel.commit = await mkCommit('Программа свободна (вкладку закрыли или свернули) · ' + who, rel.tree, headSha);
    rel.parent = headSha;
  }
  function releaseNow() {
    if (st.mode !== 'owner' || !token() || dirtyNow || !rel.commit || rel.parent !== headSha) return;
    try { // без force: если в облаке уже что-то новее, GitHub просто откажет
      F(apiBase() + rp('/git/refs/heads/data'), { method: 'PATCH', keepalive: true, cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: rel.commit, force: false }) }).catch(() => {});
    } catch { /* старый браузер — освободится через полторы минуты */ }
  }

  /* ---------------------------------------------------------------- перенос облака: пометка «переехало» в старом */
  async function markMoved(r) {
    try {
      for (let a = 0; a < 3; a++) {
        if (!await readRemote(true)) return;
        try { await write({ ...headState, movedTo: r }, `Облако переехало: ${r} · ${who || '—'}`, null, false); return; } catch (e) { if (e.code !== 422 || a === 2) throw e; }
      }
    } catch { /* пометка не главное */ }
  }
  async function follow(moved) {
    try { await req('GET', '/repos/' + moved); } catch (e) {
      if (e.offline) throw e;
      throw new Error(`Облако переехало в ${moved}, а ключ этого устройства туда не пускает — попросите новую ссылку в «Установщике»`);
    }
    const sec = secrets(); sec.githubRepo = moved;
    await store.writeJson('secrets.json', sec);
    local.rev = 0; local.hash = ''; await saveLocal(); // база нового облака главнее
    headSha = null;
  }

  /* ---------------------------------------------------------------- устройства и блокировка */
  const myIds = () => new Set([local.machine, inst].filter(Boolean));
  const isBlocked = state => (state.blocked || []).some(b => (b.ids || []).some(id => myIds().has(id)));
  async function registerMaybe() {
    if (!who || now() - lastReg < REG_EVERY) return;
    lastReg = now();
    try {
      const b = await putBlob(enc.encode(JSON.stringify({ ...me(), inst, role, app: 'phone', web: true, seen: nowIso() })));
      for (let a = 0; a < 4; a++) { // поверх последней версии: устройства не затирают друг друга
        const h = await head('devices');
        const ent = h ? await entries(await treeOf(h)) : {};
        ent[local.machine + '.json'] = b;
        try { await setRef('devices', await mkCommit('Устройство · ' + who, await mkTree(ent), h), false, !h); break; } catch (e) {
          if (e.code !== 422) throw e;
          await new Promise(r => setTimeout(r, 500 + 1000 * a));
        }
      }
    } catch { /* список устройств — не главное */ }
  }
  async function remoteState() {
    const h = await head('data');
    if (!h) return {};
    const ent = await entries(await treeOf(h));
    return ent['state.json'] ? JSON.parse(dec.decode(await blob(ent['state.json']))) : {};
  }
  async function devices() {
    const out = [];
    const h = await head('devices');
    if (h) for (const sha of Object.values(await entries(await treeOf(h)))) { try { out.push(JSON.parse(dec.decode(await blob(sha)))); } catch { /* битая запись */ } }
    out.sort((a, b) => String(b.seen || '').localeCompare(String(a.seen || '')));
    return { devices: out, blocked: (await remoteState()).blocked || [], machine: local.machine };
  }
  async function block(ids, label, on, key = 'blocked') {
    const want = new Set((ids || []).map(String).filter(Boolean));
    if (!want.size) throw new Error('Не указано устройство');
    if (on && [...myIds()].some(x => want.has(x))) throw new Error('Своё устройство заблокировать нельзя');
    for (let a = 0; ; a++) {
      if (!await readRemote(true)) throw new Error('Облако ещё пустое');
      const s2 = { ...headState };
      s2[key] = (s2[key] || []).filter(b => !(b.ids || []).some(x => want.has(x)));
      if (on) s2[key].push({ ids: [...want], label: String(label).slice(0, 120), at: nowIso(), by: who || '—' });
      try { await write(s2, (key === 'removed' ? 'Удалён пользователь: ' : on ? 'Заблокировано: ' : 'Разблокировано: ') + label, null, false); return; } catch (e) {
        if (e.code !== 422 || a >= 2) throw e;
        headSha = null;
      }
    }
  }
  async function blockMe(state, mine, why = 'Доступ к программе закрыт управляющей.') {
    try { if (mine) await write({ ...state, lock: null }, 'Программа свободна (устройство заблокировано)', null, false); } catch { /* всё равно стираем */ }
    await wipeAll(why);
  }
  // сайт-версия: заблокировали или удалили — стираем всё (база, ключи, настройка) и возвращаемся к экрану ссылки;
  // метка этой ссылки запоминается — старая ссылка больше не пустит, новая из «Установщика» — пустит
  async function wipeAll(why) {
    const gone = [...new Set([...(store.json('gone.json').inst || []), inst || store.json('local.json').inst].filter(Boolean))];
    for (const k of [...mem.keys()]) await store.del(k);
    await store.writeJson('gone.json', { inst: gone, msg: why });
    location.replace(location.pathname); // без старой ссылки в адресе
    await new Promise(() => {});
  }

  /* ---------------------------------------------------------------- отдать / взять программу, копии базы */
  async function release() {
    if (!token() || st.mode !== 'owner') return;
    try {
      if (await localDirty() && !st.needMerge) await push();
      if (await readRemote(true) && headState.lock && headState.lock.machine === local.machine) await write({ ...headState, lock: null }, 'Программа свободна · ' + who, null, false);
      Object.assign(st, { mode: 'viewer', holder: null });
      holdOff = true;
    } catch { /* сигнал пропадёт сам через минуту */ }
  }
  // «Принудительно освободить базу» — как sync.py force_take: забираем программу у другого сразу
  async function forceTake() {
    if (!token()) throw new Error('Облако не подключено');
    if (reader) throw new Error('Читатель не забирает программу');
    if (await readRemote(true)) {
      const lk = headState.lock || {};
      if (lk.machine !== local.machine) {
        await write({ ...headState, lock: { ...me(), since: now(), beat: now() } }, `Программу забрал принудительно · ${who || '—'} (была у ${lk.who || '—'})`, null, false);
        lastBeat = now();
      }
    }
    holdOff = false;
    await step();
  }
  async function cloudBackup(reason) {
    if (!token()) throw new Error('Облако не подключено');
    const raw = baseBytes();
    if (!raw) throw new Error('Базы нет');
    await ensureRepoReady();
    const h = await head('backups');
    const ent = h ? await entries(await treeOf(h), true) : {};
    const fn = d => stamp(d, '_', '').replace(/^(\d{4}-\d\d-\d\d)_(\d{6})$/, '$1_$2');
    if (reason === 'start') { const ago = fn(new Date(Date.now() - 3600000)); if (Object.keys(ent).some(k => k.startsWith('auto/') && k.slice(5, 22) >= ago)) return ''; }
    const w = (who || '-').split(' · ')[0].replace(/[^\p{L}\p{N}]/gu, '_').slice(0, 30);
    const name = (reason === 'wipe' ? 'wipe/' : 'auto/') + fn(new Date()) + '_' + w + '.json.gz';
    ent[name] = await putBlob(await gzip(raw));
    const autos = Object.keys(ent).filter(k => k.startsWith('auto/')).sort();
    for (const k of autos.slice(0, Math.max(0, autos.length - KEEP_AUTO))) delete ent[k];
    const limit = stamp(new Date(Date.now() - WIPE_DAYS * 86400000)).slice(0, 10);
    for (const k of Object.keys(ent)) if (k.startsWith('wipe/') && k.slice(5, 15) < limit) delete ent[k];
    await setRef('backups', await mkCommit(`Копия базы (${reason}) · ${who || '—'}`, await mkTree(ent), null), true, !h);
    return name;
  }
  async function cloudBackups() {
    const h = await head('backups');
    if (!h) return [];
    return Object.keys(await entries(await treeOf(h), true)).sort().reverse().filter(k => k.endsWith('.json.gz') && k.includes('/')).map(k => {
      const [kind, f] = k.split('/');
      return f.length < 26 ? null : { name: k, kind, at: `${f.slice(0, 10)}T${f.slice(11, 13)}:${f.slice(13, 15)}:${f.slice(15, 17)}`, who: f.slice(18, -8).replace(/_/g, ' ') };
    }).filter(Boolean);
  }
  async function cloudRestore(name) {
    if (st.mode !== 'owner') throw new Error('Восстановить можно, только когда программа у вас');
    const h = await head('backups');
    const ent = h ? await entries(await treeOf(h), true) : {};
    if (!ent[name]) throw new Error('Копия не найдена');
    const text = dec.decode(await gunzip(await blob(ent[name])));
    JSON.parse(text);
    await store.write('base.json', text);
    st.pulled++;
    wake();
  }

  /* ---------------------------------------------------------------- очередь шагов (по одному, как synchronized) и цикл */
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  let wakeUp = null;
  const wake = () => { if (wakeUp) wakeUp(); };
  async function loop() {
    for (;;) {
      if (running) await serial(step);
      await new Promise(r => { wakeUp = r; setTimeout(r, POLL * 1000); });
      wakeUp = null;
    }
  }
  function start() { running = true; holdOff = false; wake(); }
  function stop() { running = false; serial(release); }
  // свернули Safari или ушли на другую вкладку — отдаём программу офису, вернулись — снова работаем
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseNow(); stop(); } else start(); });
  window.addEventListener('pagehide', () => { releaseNow(); stop(); });

  function status() {
    return { ...st, tokenExpires: tokenExp, connected: !!token(), repo: repo(), reader, me: me(), localRev: local.rev || 0, clouds: [], news,
      dirty: !!token() && dirtyNow };
  }

  /* ---------------------------------------------------------------- права на облако — как can_cloud() в app.py */
  function canCloud() {
    if (store.json('local.json').readerOnly) return false;
    const r = store.json('local.json').role || '';
    if (!r || r === 'manager' || r === 'developer') return true;
    const set = store.json('base.json').settings || {};
    const ov = (set.devPerms || {})[local.machine];
    if (ov && 'cloud' in ov) return !!ov.cloud;
    const saved = (set.roles || {})[r];
    return saved ? (saved.perms || []).includes('cloud') : false;
  }

  async function post(cmd, q) {
    switch (cmd) {
      case 'hello': who = String(q.who || ''); reader = !!q.reader || !!store.json('local.json').readerOnly; wake(); break;
      case 'config': {
        if (!canCloud()) throw new Error('Менять облако может только тот, кому управляющая дала право «Облако»');
        const sec = secrets(), r = String(q.repo || repo()).trim().replace(/^\/+|\/+$/g, '');
        if (r !== repo()) { await serial(release); await serial(() => markMoved(r)); local.rev = 0; local.hash = ''; await saveLocal(); }
        chosen = r;
        if (String(q.token || '').trim()) sec.githubToken = String(q.token).trim();
        sec.githubRepo = r;
        await store.writeJson('secrets.json', sec);
        headSha = null; holdOff = false;
        await serial(step);
        if (st.mode === 'error') throw new Error(st.message);
        break;
      }
      case 'off': {
        if (!canCloud()) throw new Error('Менять облако может только тот, кому управляющая дала право «Облако»');
        await serial(release);
        const sec = secrets(); delete sec.githubToken;
        await store.writeJson('secrets.json', sec);
        await serial(step);
        break;
      }
      case 'merged': local.rev = Math.max(+q.rev || 0, local.rev || 0); await saveLocal(); st.needMerge = 0; wake(); break;
      case 'now': wake(); break;
      case 'release': await serial(release); break;
      case 'take': holdOff = false; await serial(step); break;
      case 'force': await serial(forceTake); break;
      case 'devices': return { ...status(), ...await devices() };
      case 'block': await serial(() => block(q.ids, q.label || '', q.on !== false)); break;
      case 'remove': await serial(() => block(q.ids, q.label || '', true, 'removed')); break;
      case 'backup': return { ...status(), name: await serial(() => cloudBackup(q.reason || 'auto')) };
      case 'backups': return { ...status(), backups: await serial(cloudBackups) };
      case 'restore': await serial(() => cloudRestore(String(q.name || ''))); break;
      case 'update': return { ...status(), files: 0 }; // на iPhone программа — сам сайт: новая версия приходит при открытии
      default: throw new Error('На телефоне это недоступно');
    }
    return status();
  }

  /* ---------------------------------------------------------------- ИИ — как Api.java */
  const PROVIDERS = [
    ['gemini', 'geminiKey', 'geminiModel', DEFAULT_MODEL, 'Gemini (Google)'],
    ['openai', 'aiOpenaiKey', 'aiOpenaiModel', 'gpt-5-mini', 'OpenAI-совместимый (ChatGPT, DeepSeek, OpenRouter…)'],
    ['anthropic', 'aiAnthropicKey', 'aiAnthropicModel', 'claude-haiku-5-5', 'Claude (Anthropic)'],
  ];
  const provider = sec => PROVIDERS.find(p => p[0] === sec.aiProvider) || PROVIDERS[0];
  const mask = k => (k ? '…' + k.slice(-4) : '');
  function aiStatus() {
    const sec = secrets(), cur = provider(sec)[0];
    const providers = PROVIDERS.map(([id, kf, mf, dm, name]) => ({ id, name, hasKey: !!sec[kf], masked: mask(sec[kf] || ''), model: sec[mf] || dm, defaultModel: dm }));
    return { ...providers.find(x => x.id === cur), provider: cur, providers, url: sec.aiOpenaiUrl || OPENAI_URL };
  }
  async function aiSave(q) {
    const sec = secrets(), p = PROVIDERS.find(x => x[0] === (q.provider || provider(sec)[0]));
    if (!p) throw new Error('Неизвестный поставщик ИИ');
    if (String(q.key || '').trim()) sec[p[1]] = String(q.key).trim();
    if ('model' in q) { const m = String(q.model || '').trim(); if (m) sec[p[2]] = m; else delete sec[p[2]]; }
    if (p[0] === 'openai' && 'url' in q) sec.aiOpenaiUrl = String(q.url || '').trim().replace(/\/+$/, '') || OPENAI_URL;
    sec.aiProvider = p[0];
    await store.writeJson('secrets.json', sec);
    return aiStatus();
  }
  let lastAi = 0, aiChain = Promise.resolve();
  function ai(prompt) { const p = aiChain.then(() => aiCall(prompt)); aiChain = p.catch(() => {}); return p; }
  async function aiCall(prompt) {
    const sec = secrets(), [id, kf, mf, dm, name] = provider(sec), key = String(sec[kf] || '').trim();
    if (!key) throw new Error(`Ключ ИИ (${name}) не указан — впишите его в «Админ» → «ИИ»`);
    const wait = 4200 - (Date.now() - lastAi); // бесплатный тариф Gemini — не чаще раза в 4,2 секунды
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastAi = Date.now();
    const model = sec[mf] || dm;
    let url, body, headers = { 'Content-Type': 'application/json' };
    if (id === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } };
      headers['x-goog-api-key'] = key;
    } else if (id === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      body = { model, max_tokens: 16000, temperature: 0.2, messages: [{ role: 'user', content: prompt }] };
      Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    } else {
      url = (sec.aiOpenaiUrl || OPENAI_URL) + '/chat/completions';
      body = { model, messages: [{ role: 'user', content: prompt }] };
      headers.Authorization = 'Bearer ' + key;
    }
    let r;
    try { r = await F(url, { method: 'POST', headers, body: JSON.stringify(body) }); } catch (e) { throw new Error(`Нет связи с ${name} (проверьте интернет): ${e.message}`); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${name} ответил ошибкой ${r.status}` + (r.status === 429 ? ' — слишком много запросов, подождите минуту'
      : r.status === 401 || r.status === 403 ? ' — проверьте ключ и модель в «Админ» → «ИИ»' : ''));
    const text = id === 'gemini' ? (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || ''
      : id === 'anthropic' ? (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
        : ((j.choices || [])[0] || {}).message?.content || '';
    if (!text) throw new Error(`${name} вернул пустой ответ, попробуйте ещё раз`);
    return text;
  }

  /* ---------------------------------------------------------------- «сервер» для окна программы: /api/… */
  async function handle(method, path, body, hdrs) {
    const ok = o => [200, JSON.stringify(o)];
    const get = method === 'GET';
    try {
      if (path === '/api/ping') return ok({ ok: true });
      if (path === '/api/db') {
        if (get) return [200, store.read('base.json') || 'null'];
        if (store.json('local.json').readerOnly) return [423, JSON.stringify({ error: 'Эта программа установлена только для чтения — менять базу нельзя' })];
        if (st.mode === 'viewer' && !(hdrs || {})['X-EH-Merge']) return [423, JSON.stringify({ error: `Программа сейчас у ${(st.holder || {}).who || 'другого'} — менять базу может только он` })];
        JSON.parse(body); // не сохраняем битые данные
        await store.write('base.json', body);
        wake();
        return ok({ ok: true, savedAt: nowIso() });
      }
      if (path === '/api/local') {
        const loc = store.json('local.json');
        return ok({ quickPrint: false, backupMinutes: 0, phone: true, role: loc.role || '', operator: loc.operator || '', pin: loc.pin || '', machine: local.machine || '', readerOnly: !!loc.readerOnly });
      }
      if (path === '/api/printer') return ok({ name: '', quick: false });
      if (path === '/api/backups') return ok({ backups: [], dir: '' });
      if (path === '/api/bye' || path === '/api/backup') return ok({ ok: true });
      if (path === '/api/ai/status') return ok(aiStatus());
      if (path === '/api/ai/key') return ok(await aiSave(JSON.parse(body || '{}')));
      if (path === '/api/ai/generate') return ok({ text: await ai(JSON.parse(body || '{}').prompt || '') });
      if (path === '/api/sync/status') return ok(status());
      if (path === '/api/sync/remote') { const s = await serial(remoteBase); return [200, s == null ? 'null' : s]; }
      if (path.startsWith('/api/sync/')) return ok(await post(path.slice(10), body ? JSON.parse(body) : {}));
      return [400, JSON.stringify({ error: 'На телефоне это недоступно — сделайте это в программе на компьютере' })];
    } catch (e) { return [500, JSON.stringify({ error: String(e.message || e) })]; }
  }

  let ready;
  const readyP = new Promise(r => { ready = r; });
  // GET-запросы окна (fetch('/api/…')) и POST через мост — как на Android
  window.fetch = async (url, opts = {}) => {
    const u = typeof url === 'string' ? url : url.url;
    const path = new URL(u, location.href).pathname;
    const i = path.indexOf('/api/');
    if (i < 0) return F(url, opts);
    await readyP;
    const [code, text] = await handle(opts.method || 'GET', path.slice(i), opts.body || null, opts.headers || {});
    return new Response(text, { status: code, headers: { 'Content-Type': 'application/json' } });
  };
  window.EHAndroid = {
    desktop: !/iPhone|iPad|iPod|Android/.test(navigator.userAgent) && matchMedia('(pointer: fine)').matches, // MacBook и другие компьютеры
    call(id, method, url, body, headers) {
      readyP.then(async () => {
        const [code, text] = await handle(method, new URL(url, location.href).pathname.replace(/^.*?(\/api\/)/, '$1'), body || null, JSON.parse(headers || '{}'));
        window.__ehResolve(id, code, text);
      });
    },
  };

  /* ---------------------------------------------------------------- «Что нового»: список изменений, выложенный вместе с сайтом */
  async function loadNews() {
    try {
      const r = await F('changelog.txt', { cache: 'no-store' });
      if (!r.ok) return;
      const fresh = await r.text(), old = store.read('changelog.txt');
      if (old !== null && old !== fresh) {
        const seen = new Set(old.split(/\r?\n/));
        const lines = fresh.split(/\r?\n/).map(x => x.trim()).filter(x => x && !seen.has(x)).slice(-60);
        if (lines.length) { news = { id: (await sha256(enc.encode(fresh))).slice(0, 12), version: '', lines }; await store.writeJson('news.json', news); }
      }
      if (old !== fresh) await store.write('changelog.txt', fresh);
      if (!news) news = store.read('news.json') ? store.json('news.json') : null;
    } catch { /* без «Что нового» */ }
  }

  // новая версия сайта: список изменений на сервере уже не тот, с которым открыли страницу; файлы заранее
  // перекачиваем мимо кэша браузера — иначе после «Обновить» он мог показать старую программу
  async function checkSiteUpdate() {
    if (st.updated) return;
    try {
      const r = await F('changelog.txt', { cache: 'no-store' });
      if (!r.ok || (await r.text()) === store.read('changelog.txt')) return;
      await Promise.all(['index.html', 'app.js', 'access.js', 'finance.js', 'i18n.js', 'qr.js', 'styles.css', 'ios.js'].map(f => F(f, { cache: 'reload' }).catch(() => {})));
      st.updated = 1;
    } catch { /* нет сети — проверим в следующий раз */ }
  }

  /* ---------------------------------------------------------------- первый запуск: ссылка + PIN */
  const standalone = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  function screen(html) {
    let el = document.getElementById('iosGate');
    if (!el) {
      el = document.createElement('div');
      el.id = 'iosGate';
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#f6f7f4);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Montserrat,system-ui,sans-serif';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="max-width:360px;width:100%;text-align:center;line-height:1.5">${html}</div>`;
    return el;
  }
  const LOGO = '<div style="font-size:30px;font-weight:700;margin-bottom:6px">ели-худели</div>';
  function askPin(k) {
    return new Promise(done => {
      const show = (err = '') => {
        const el = screen(`${LOGO}<div style="margin-bottom:16px;color:#666">Введите PIN-код, который вам дали вместе со ссылкой</div>
          <input id="iosPin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" style="font-size:24px;text-align:center;width:180px;padding:10px;border:1px solid #ccc;border-radius:10px;letter-spacing:6px">
          <div style="color:#c0392b;min-height:22px;margin-top:8px">${err}</div>
          <button id="iosGo" style="margin-top:6px;font-size:17px;padding:10px 28px;border:0;border-radius:10px;background:#5da83c;color:#fff">Войти</button>`);
        const inp = el.querySelector('#iosPin');
        const go = async () => {
          el.querySelector('#iosGo').disabled = true;
          try { done(await decryptCfg(k, inp.value.trim())); } catch { show('Неверный PIN-код'); }
        };
        el.querySelector('#iosGo').onclick = go;
        inp.onkeydown = e => { if (e.key === 'Enter') go(); };
        inp.focus();
      };
      show();
    });
  }
  function askInstall() {
    return new Promise(done => {
      const el = screen(`${LOGO}<div style="text-align:left;margin:14px 0">Чтобы программа работала как приложение, добавьте её на экран «Домой»:
          <ol style="padding-left:20px;margin:10px 0"><li>Внизу Safari нажмите <b>«Поделиться»</b> (квадрат со стрелкой вверх).</li>
          <li>Выберите <b>«На экран „Домой“»</b> → <b>«Добавить»</b>.</li><li>Откройте <b>Ели-Худели</b> с экрана «Домой» и введите PIN-код.</li></ol>
          <span style="color:#666;font-size:13px">Важно: программа, открытая с экрана «Домой», и программа в Safari — разные, PIN вводится там, где будете работать.</span></div>
        <button id="iosHere" style="font-size:15px;padding:8px 18px;border:1px solid #ccc;border-radius:10px;background:#fff">Работать здесь, в Safari</button>`);
      el.querySelector('#iosHere').onclick = done;
    });
  }
  async function setup() {
    const kOf = s => (String(s).match(/[#&]k=([\w-]+)/) || [])[1];
    const gone = store.json('gone.json');
    let k = gone.msg ? '' : kOf(location.hash), note = gone.msg ? `${gone.msg} Если вам дали новую ссылку — вставьте её.` : '';
    for (;;) {
    if (!k) { // ярлык открылся без личной части ссылки (или старая больше не действует) — даём вставить ссылку
      k = await new Promise(done => {
        const el = screen(`${LOGO}${note ? `<div style="color:#c0392b;margin-bottom:10px">${note}</div>` : ''}<div style="margin-bottom:12px">Вставьте ссылку, которую вам прислали из «Установщика» (нажмите и удерживайте поле → «Вставить»):</div>
          <textarea id="iosLinkIn" rows="4" style="width:100%;font-size:13px;padding:8px;border:1px solid #ccc;border-radius:10px"></textarea>
          <div id="iosLinkErr" style="color:#c0392b;min-height:20px;margin-top:6px"></div>
          <button id="iosLinkGo" style="font-size:17px;padding:10px 28px;border:0;border-radius:10px;background:#5da83c;color:#fff">Дальше</button>`);
        el.querySelector('#iosLinkGo').onclick = () => {
          const v = kOf(el.querySelector('#iosLinkIn').value);
          if (v) done(v); else el.querySelector('#iosLinkErr').textContent = 'Это не ссылка из «Установщика»';
        };
      });
    }
    if (!standalone() && /iPhone|iPad/.test(navigator.userAgent) && !gone.msg) await askInstall();
    var cfg = await askPin(k);
    if (!(gone.inst || []).includes(cfg.inst)) break;
    k = ''; note = 'Эта ссылка больше не действует.'; // заблокированная / удалённая ссылка
    }
    await store.del('gone.json');
    await store.writeJson('local.json', { role: cfg.role || 'om', roleLocked: true, operator: cfg.operator || '', inst: cfg.inst || '', pin: cfg.pin || '', readerOnly: !!cfg.readerOnly });
    const sec = {};
    for (const [key, v] of Object.entries(cfg)) if (/^(github|gemini|ai)/.test(key) && typeof v === 'string' && v) sec[key] = v;
    await store.writeJson('secrets.json', sec);
    window.__ehPinFresh = true; // PIN только что ввели — программа не спросит его второй раз
  }

  (async () => {
    try {
      if (!window.CompressionStream || !crypto.subtle || !window.indexedDB) {
        screen(`${LOGO}<div>Этот телефон слишком старый для программы: нужен iOS 16.4 или новее.</div>`);
        return;
      }
      await storeOpen();
      if (store.json('sync.json').blocked) await wipeAll('Доступ к программе закрыт управляющей.'); // заблокировали в старой версии — сбрасываем
      if (!store.read('local.json')) await setup();
      document.getElementById('iosGate')?.remove();
      local = store.json('sync.json');
      if (!local.machine) local.machine = [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');
      local.rev = local.rev || 0; local.hash = local.hash || '';
      await saveLocal();
      const loc = store.json('local.json');
      inst = loc.inst || ''; role = loc.role || ''; reader = !!loc.readerOnly;
      st.rev = local.rev;
      await loadNews();
      setInterval(checkSiteUpdate, 10 * 60e3);
      ready();
      start();
      loop();
    } catch (e) {
      screen(`${LOGO}<div style="color:#c0392b">Не удалось запустить программу: ${String(e.message || e)}</div>`);
    }
  })();
})();
