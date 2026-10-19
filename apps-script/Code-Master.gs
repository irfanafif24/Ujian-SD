/*****************************************************************
 *  CODE-MASTER.GS — Server Ujian Sekolah Dasar
 *  Google Apps Script + Google Sheets (gratis, tanpa hosting server)
 *
 *  File ini SATU-SATUNYA file server yang dibutuhkan. Ia mencakup:
 *    1. Data Induk   : akun admin, data siswa, data guru, nilai (UH/UTS/UAS)
 *    2. Ulangan      : daftar pendidik, soal & token, hasil siswa, login dasbor guru
 *
 *  Penyimpanan: 3 sheet otomatis di Google Sheets ini
 *    - Master  : admin, siswa, guru, nilai
 *    - Config  : soal, token, & pengaturan ulangan tiap pendidik
 *    - Results : hasil / progres ujian siswa
 *
 *  Langkah pasang: lihat README.md (bagian "Pasang Server").
 *****************************************************************/

// ====== PENGATURAN (ubah sebelum menjalankan setup) ======
const ADMIN_USER = 'admin';          // username admin awal
const ADMIN_PASS = 'admin12345';     // password admin awal -> GANTI! (hanya dipakai saat pertama kali)
const SPREADSHEET_ID = '';           // kosongkan jika script ditempel lewat Extensions > Apps Script di Google Sheets
// ==========================================================

const VERSION = 'master-1.0';
const SH = { master: 'Master', config: 'Config', results: 'Results' };
const SESSION_TTL = 21600;   // sesi login 6 jam (batas maksimum CacheService)
const MAX_FAIL = 5;          // salah login 5x -> dikunci
const LOCK_SEC = 600;        // kunci 10 menit
const CHUNK = 45000;         // 1 sel Sheets maks 50.000 karakter
const MAX_JSON = 2000000;    // batas ukuran 1 data (~2 MB)
const HDR = 4;               // kolom A-D = key, meta, extra, updated; data mulai kolom E

const cmp_ = (a, b) => String(a).localeCompare(String(b), 'id', { numeric: true });

/* ================= PINTU MASUK WEB APP ================= */

const API_ = {
  // --- Ulangan (siswa & dasbor guru) ---
  getTeachers: (...a) => getTeachers(...a),
  getConfig: (...a) => getConfig(...a),
  resultExists: (...a) => resultExists(...a),
  saveResult: (...a) => saveResult(...a),
  login: (...a) => login(...a),
  logout: (...a) => logout(...a),
  saveConfig: (...a) => saveConfig(...a),
  getResults: (...a) => getResults(...a),
  getRoster: (...a) => getRoster(...a),
  deleteResult: (...a) => deleteResult(...a),
  deleteAllResults: (...a) => deleteAllResults(...a),
  // --- Data induk (admin & guru mapel) ---
  masterLogin: (...a) => masterLogin(...a),
  masterLoad: (...a) => masterLoad(...a),
  masterSaveCore: (...a) => masterSaveCore(...a),
  masterSaveCells: (...a) => masterSaveCells(...a)
};

function doGet() {
  return json_({ data: { ok: true, app: 'Ujian Sekolah Dasar', version: VERSION, info: 'Server aktif. Buka halaman aplikasi (GitHub Pages) untuk memakainya.' } });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API_[req.fn];
    if (!fn) throw new Error('Fungsi tidak dikenal: ' + req.fn);
    out = { data: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { error: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= SETUP & PERAWATAN (jalankan manual dari editor) ================= */

// Jalankan SEKALI: membuat sheet & akun admin awal.
function setup() {
  sheet_(SH.master); sheet_(SH.config); sheet_(SH.results);
  loadCore_();
  Logger.log('Setup selesai. Login admin: ' + ADMIN_USER + ' / ' + ADMIN_PASS + ' (segera ganti di tab Akun).');
}

// Lupa password admin? Ubah ADMIN_USER / ADMIN_PASS di atas lalu jalankan fungsi ini.
function resetAdminPassword() {
  withLock_(() => {
    const c = loadCore_();
    c.admin = newAdmin_(ADMIN_USER, ADMIN_PASS);
    saveCore_(c);
  });
  Logger.log('Akun admin direset menjadi: ' + ADMIN_USER + ' / ' + ADMIN_PASS);
}

// Hapus baris hasil yang sudah ditandai terhapus. Jalankan DI LUAR jam ujian.
function compactResults() {
  withLock_(() => {
    const sh = sheet_(SH.results), last = sh.getLastRow();
    if (last < 2) return;
    const ex = sh.getRange(2, 3, last - 1, 1).getValues();
    let n = 0;
    for (let i = ex.length - 1; i >= 0; i--) if (String(ex[i][0]) === 'deleted') { sh.deleteRow(i + 2); n++; }
    Logger.log('Baris dibersihkan: ' + n);
  });
}

/* ================= PENYIMPANAN: SHEETS SEBAGAI BASIS DATA ================= */

let LOCK_HELD = false;
function withLock_(fn) {
  if (LOCK_HELD) return fn();
  const l = LockService.getScriptLock();
  l.waitLock(20000);
  LOCK_HELD = true;
  try { return fn(); } finally { LOCK_HELD = false; l.releaseLock(); }
}

function ss_() { return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 5).setValues([['key', 'meta', 'extra', 'updated', 'data (JSON, dipecah per 45.000 karakter - jangan diubah manual)']]);
    sh.getRange('A:C').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function findRow_(sh, key) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(key)).matchCase(true).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}

function dataOf_(vals) {
  let s = '';
  for (let i = HDR; i < vals.length; i++) {
    const v = vals[i];
    if (v === '' || v === null || v === undefined) break;
    s += String(v).slice(1);
  }
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function getRow_(sh, key) {
  const row = findRow_(sh, key);
  if (!row) return null;
  const v = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  return { row, key: String(v[0]), meta: String(v[1]), extra: String(v[2]), updated: Number(v[3]) || 0, data: dataOf_(v) };
}

// Tulis / timpa satu baris. Baris tidak pernah digeser (penghapusan memakai "tombstone"), jadi aman dipakai banyak siswa bersamaan.
function putRow_(sh, key, meta, extra, obj) {
  const js = JSON.stringify(obj === undefined ? {} : obj);
  if (js.length > MAX_JSON) throw new Error('Data terlalu besar (maks ~2 MB).');
  const parts = [];
  for (let i = 0; i < js.length; i += CHUNK) parts.push('~' + js.substr(i, CHUNK));
  if (!parts.length) parts.push('~');
  const need = HDR + parts.length;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
  const now = Date.now();
  const write = (row) => {
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
    const width = sh.getMaxColumns();
    const vals = [key, meta, extra, now].concat(parts);
    while (vals.length < width) vals.push('');
    sh.getRange(row, 1, 1, width).setValues([vals]);
  };
  const row = findRow_(sh, key);
  if (row) write(row);
  else withLock_(() => { const r2 = findRow_(sh, key); write(r2 || Math.max(sh.getLastRow(), 1) + 1); });
  return now;
}

function cacheJson_(key, ttl, fn) {
  const c = CacheService.getScriptCache();
  const hit = c.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* abaikan */ } }
  const v = fn();
  try { const s = JSON.stringify(v); if (s.length < 90000) c.put(key, s, ttl); } catch (e) { /* abaikan */ }
  return v;
}

function incRev_(name) { PropertiesService.getScriptProperties().setProperty(name, Date.now() + '.' + Math.floor(Math.random() * 1000)); }
function getRev_(name) { return PropertiesService.getScriptProperties().getProperty(name) || '0'; }

/* ================= SESI & KEAMANAN ================= */

function newSession_(obj) {
  const t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  CacheService.getScriptCache().put('S_' + t, JSON.stringify(obj), SESSION_TTL);
  return t;
}
function session_(token, kind) {
  const v = token ? CacheService.getScriptCache().get('S_' + token) : null;
  if (!v) throw new Error('AUTH');
  const s = JSON.parse(v);
  if (kind && s.kind !== kind) throw new Error('AUTH');
  return s;
}
function isLocked_(id) { return Number(CacheService.getScriptCache().get('F_' + id) || 0) >= MAX_FAIL; }
function addFail_(id) { const c = CacheService.getScriptCache(); c.put('F_' + id, String(Number(c.get('F_' + id) || 0) + 1), LOCK_SEC); }
function clearFail_(id) { CacheService.getScriptCache().remove('F_' + id); }

function hash_(salt, pw) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  return d.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function newAdmin_(user, pass) { const salt = Utilities.getUuid(); return { username: user, salt, hash: hash_(salt, pass) }; }

/* ================= DATA INDUK (core) ================= */

function normCore_(c) {
  return {
    admin: c.admin || {},
    students: c.students || [],
    teachers: (c.teachers || []).map(t => Object.assign({}, t, { assigns: t.assigns || [] }))
  };
}
function loadCore_() {
  const sh = sheet_(SH.master);
  const r = getRow_(sh, 'core');
  if (r && r.data && r.data.admin && r.data.admin.username) return normCore_(r.data);
  if (r) throw new Error('Data master rusak. Periksa sheet "Master" baris "core".');
  const c = normCore_({});
  c.admin = newAdmin_(ADMIN_USER, ADMIN_PASS);
  saveCore_(c);
  return c;
}
function saveCore_(c) {
  putRow_(sheet_(SH.master), 'core', '', '', c);
  PropertiesService.getScriptProperties().setProperty('coreRev', String(Date.now()));
}
function coreRev_() { return getRev_('coreRev'); }
function teacherClasses_(t) { return Array.from(new Set((t.assigns || []).map(a => a.cls))).sort(cmp_); }

function rosterOf_(tid, rev, full) {
  return cacheJson_('rost:' + (full ? 'f' : 'n') + ':' + rev + ':' + tid, 600, () => {
    const c = loadCore_(), t = c.teachers.find(x => x.id === tid);
    if (!t) return [];
    const cl = new Set(teacherClasses_(t));
    return c.students.filter(s => cl.has(s.cls))
      .map(s => full ? { nis: s.nis, name: s.name, cls: s.cls, jk: s.jk, ttl: s.ttl } : { name: s.name, cls: s.cls });
  });
}

/* ================= API ULANGAN ================= */

// Daftar pendidik untuk halaman siswa: hanya guru yang punya kelas.
function getTeachers() {
  return cacheJson_('tl:' + coreRev_(), 600, () => loadCore_().teachers
    .filter(t => t.assigns.length)
    .map(t => ({ id: t.id, name: t.name, cls: teacherClasses_(t).join(', ') }))
    .sort((a, b) => cmp_(a.name, b.name)));
}

// Soal + token + daftar siswa (nama & kelas) milik pendidik. Daftar siswa disisipkan otomatis dari Data Induk,
// sehingga siswa memilih Kelas lalu Nama tanpa mencari di seluruh sekolah.
function getConfig(tid, ver) {
  tid = String(tid || '');
  if (!tid) return { exists: false };
  const sh = sheet_(SH.config), cache = CacheService.getScriptCache(), rev = coreRev_();
  let upd = cache.get('cfgv:' + tid), row = null;
  if (upd === null) {
    row = getRow_(sh, tid);
    if (!row) return { exists: false };
    upd = String(row.updated);
    cache.put('cfgv:' + tid, upd, 600);
  }
  const v = upd + '-' + rev;
  if (ver && ver === v) return { exists: true, same: true, ver: v };
  if (!row) row = getRow_(sh, tid);
  if (!row || !row.data) return { exists: false };
  const config = row.data;
  config.roster = rosterOf_(tid, rev, false);
  return { exists: true, ver: v, config };
}

function login(tid, pin) {
  tid = String(tid || '');
  if (isLocked_('t:' + tid)) return { ok: false, error: 'locked' };
  const t = loadCore_().teachers.find(x => x.id === tid);
  if (!t || String(t.password) !== String(pin)) { addFail_('t:' + tid); return { ok: false }; }
  clearFail_('t:' + tid);
  return { ok: true, token: newSession_({ kind: 'exam', tid }), tid };
}

function logout(token) { if (token) CacheService.getScriptCache().remove('S_' + token); return { ok: true }; }

function getRoster(tid, token) {
  const s = session_(token, 'exam');
  if (String(tid) !== s.tid) throw new Error('AUTH');
  return rosterOf_(s.tid, coreRev_(), true);
}

function saveConfig(token, data) {
  const s = session_(token, 'exam');
  if (!data || typeof data !== 'object') throw new Error('Data tidak valid');
  const c = Object.assign({}, data); delete c.pin; delete c.roster;
  const upd = putRow_(sheet_(SH.config), s.tid, s.tid, '', c);
  CacheService.getScriptCache().put('cfgv:' + s.tid, String(upd), 600);
  return { ok: true, ver: upd + '-' + coreRev_() };
}

function saveResult(uid, p) {
  if (!p || typeof p !== 'object' || !p.id || !p.tid) throw new Error('Data hasil tidak valid');
  const id = String(p.id).slice(0, 120), tid = String(p.tid).slice(0, 80), status = String(p.status || 'progress');
  const sh = sheet_(SH.results), row = findRow_(sh, id);
  if (row) {
    const ex = String(sh.getRange(row, 3).getValue());
    if ((ex === 'done' || ex === 'deleted') && status !== 'done') return { ok: true, ignored: true };
  }
  p.uid = String(uid || p.uid || '');
  putRow_(sh, id, tid, status, p);
  incRev_('rr:' + tid);
  return { ok: true };
}

function resultExists(id) {
  const sh = sheet_(SH.results), row = findRow_(sh, String(id || ''));
  return !!row && String(sh.getRange(row, 3).getValue()) === 'done';
}

function getResults(token, sig) {
  const s = session_(token, 'exam');
  const rev = getRev_('rr:' + s.tid);
  if (sig && sig === rev) return { same: true };
  const sh = sheet_(SH.results), last = sh.getLastRow(), out = [];
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach(v => {
      if (String(v[1]) === s.tid && String(v[2]) !== 'deleted') { const d = dataOf_(v); if (d) out.push(d); }
    });
  }
  return { same: false, sig: rev, results: out };
}

function tombstone_(sh, row, key) {
  const width = sh.getMaxColumns(), vals = [key, '', 'deleted', Date.now(), '~{}'];
  while (vals.length < width) vals.push('');
  sh.getRange(row, 1, 1, width).setValues([vals]);
}

function deleteResult(token, id) {
  const s = session_(token, 'exam');
  const sh = sheet_(SH.results), row = findRow_(sh, String(id || ''));
  if (row && String(sh.getRange(row, 2).getValue()) === s.tid) { tombstone_(sh, row, String(id)); incRev_('rr:' + s.tid); }
  return { ok: true };
}

function deleteAllResults(token) {
  const s = session_(token, 'exam');
  const sh = sheet_(SH.results), last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach((v, i) => {
      if (String(v[1]) === s.tid && String(v[2]) !== 'deleted') tombstone_(sh, i + 2, String(v[0]));
    });
  }
  incRev_('rr:' + s.tid);
  return { ok: true };
}

/* ================= API DATA INDUK ================= */

function masterLogin(u, p) {
  const lu = String(u || '').trim().toLowerCase(), key = 'm:' + lu;
  if (!lu) return { ok: false };
  if (isLocked_(key)) return { ok: false, error: 'locked' };
  const c = loadCore_(), pw = String(p || '');
  if (String(c.admin.username || '').toLowerCase() === lu && c.admin.hash === hash_(c.admin.salt, pw)) {
    clearFail_(key);
    return { ok: true, role: 'admin', user: { id: 'admin', name: 'Administrator' }, token: newSession_({ kind: 'master', role: 'admin', id: 'admin' }) };
  }
  const t = c.teachers.find(x => String(x.username || '').toLowerCase() === lu && String(x.password) === pw);
  if (!t) { addFail_(key); return { ok: false }; }
  clearFail_(key);
  return { ok: true, role: 'guru', user: { id: t.id, name: t.name }, token: newSession_({ kind: 'master', role: 'guru', id: t.id }) };
}

function gradeRows_(pred) {
  const sh = sheet_(SH.master), last = sh.getLastRow();
  if (last < 2) return [];
  const out = [];
  sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues().forEach((v, i) => {
    const k = String(v[0]);
    if (k.indexOf('grades:') === 0 && pred(k.slice(7))) out.push({ row: i + 2, key: k.slice(7), data: dataOf_(v) || {} });
  });
  return out;
}

function masterLoad(token) {
  const s = session_(token, 'master');
  const c = loadCore_();
  if (s.role === 'admin') {
    const grades = {};
    gradeRows_(() => true).forEach(g => { grades[g.key] = g.data; });
    return { admin: { username: c.admin.username }, students: c.students, teachers: c.teachers, grades };
  }
  const me = c.teachers.find(t => t.id === s.id);
  if (!me) return { admin: {}, students: [], teachers: [], grades: {} };
  const cl = new Set(me.assigns.map(a => a.cls)), keys = new Set(me.assigns.map(a => a.cls + '||' + a.mapel)), grades = {};
  gradeRows_(k => keys.has(k)).forEach(g => { grades[g.key] = g.data; });
  return {
    admin: {},
    students: c.students.filter(x => cl.has(x.cls)),
    teachers: [{ id: me.id, name: me.name, username: me.username, assigns: me.assigns }],
    grades
  };
}

function masterSaveCore(token, jsonStr) {
  const s = session_(token, 'master');
  if (s.role !== 'admin') return { ok: false, error: 'forbidden' };
  const d = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  if (!d || !Array.isArray(d.students) || !Array.isArray(d.teachers)) return { ok: false, error: 'data tidak valid' };
  return withLock_(() => {
    const c = loadCore_();
    c.students = d.students.map(x => ({ id: String(x.id), nis: x.nis || '', name: String(x.name || ''), cls: String(x.cls || ''), jk: x.jk || '', ttl: x.ttl || '' }));
    c.teachers = d.teachers.map(t => ({
      id: String(t.id), name: String(t.name || ''), username: String(t.username || ''), password: String(t.password || ''),
      assigns: (t.assigns || []).map(a => ({ cls: String(a.cls), mapel: String(a.mapel) }))
    }));
    if (d.admin && d.admin.username) {
      const pw = d.admin.password;
      c.admin = pw ? newAdmin_(String(d.admin.username), pw) : Object.assign({}, c.admin, { username: String(d.admin.username) });
    }
    saveCore_(c);
    // buang nilai milik siswa yang sudah dihapus
    const ids = new Set(c.students.map(x => x.id));
    gradeRows_(() => true).forEach(g => {
      let changed = false;
      Object.keys(g.data).forEach(sid => { if (!ids.has(sid)) { delete g.data[sid]; changed = true; } });
      if (changed) putRow_(sheet_(SH.master), 'grades:' + g.key, '', '', g.data);
    });
    return { ok: true };
  });
}

function masterSaveCells(token, key, cellsJson) {
  const s = session_(token, 'master');
  key = String(key || '');
  if (!key) return { ok: false, error: 'kunci kosong' };
  if (s.role !== 'admin') {
    const me = loadCore_().teachers.find(t => t.id === s.id);
    if (!me || !me.assigns.some(a => a.cls + '||' + a.mapel === key)) return { ok: false, error: 'forbidden' };
  }
  const cells = typeof cellsJson === 'string' ? JSON.parse(cellsJson) : cellsJson;
  if (!Array.isArray(cells)) return { ok: false, error: 'data tidak valid' };
  return withLock_(() => {
    const sh = sheet_(SH.master), r = getRow_(sh, 'grades:' + key), g = (r && r.data) || {};
    cells.forEach(c => {
      const sid = String(c.sid), col = String(c.col);
      if (c.val === null || c.val === undefined) {
        if (g[sid]) { delete g[sid][col]; if (!Object.keys(g[sid]).length) delete g[sid]; }
      } else if (typeof c.val === 'number' && isFinite(c.val)) {
        (g[sid] = g[sid] || {})[col] = c.val;
      }
    });
    putRow_(sh, 'grades:' + key, '', '', g);
    return { ok: true };
  });
}
