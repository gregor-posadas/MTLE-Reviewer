/**
 * MTLE Reviewer: backend (optional, but recommended on an iPhone).
 *
 * Keeps a copy of every answer in this Google Sheet, so a cleared browser or a new phone gets everything back,
 * and the phone and laptop stay in step. Also collects questions flagged as wrong or unclear, her own
 * questions, and settings such as the exam date.
 *
 * Setup (full steps in README.md): paste this file into Extensions > Apps Script of a new Google Sheet,
 * run setup() once (it prints the access code), then deploy as a web app ("Execute as: Me",
 * "Who has access: Anyone") and paste the /exec URL into assets/config.js.
 *
 * The site sends the access code with every request. Nothing here is public: the Sheet stays private,
 * and the web app only answers requests that carry the right code.
 */

var APP_NAME = 'MTLE Reviewer';
var TABS = {
  Reviews: ['id', 'q', 't', 'c', 'ok', 'sure', 'm', 'ms', 'd'],
  Flags: ['id', 'q', 'at', 'reason', 'note', 'status', 'deleted'],
  MyQuestions: ['id', 'at', 'deleted', 'json'],
  Settings: ['id', 'v', 'at'],
  Log: ['timestamp', 'action', 'detail']
};
var MAX_PUSH = 5000;   // answers accepted in one request

/* ------------------------------------------------------------------ setup */

/** Run once from the editor. Creates the tabs and the access code. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', ss.getId());
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureTab(sh, name);
    sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  if (!props.getProperty('ACCESS_CODE')) props.setProperty('ACCESS_CODE', randomCode());
  Logger.log('Access code: ' + props.getProperty('ACCESS_CODE'));
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), then paste the /exec URL into assets/config.js.');
}

function randomCode() {
  var words = ['serum', 'plasma', 'agar', 'giemsa', 'wright', 'eosin', 'kato', 'buffy', 'gram', 'pap', 'ziehl', 'coombs'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(1000 + Math.random() * 9000);
}

/* ------------------------------------------------------------------ web app */

function doGet() {
  return json({ ok: true, service: APP_NAME });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkCode(b.code);
    lock.waitLock(30000);
    switch (b.action) {
      case 'push':   // sent as the page closes; nothing comes back
        return json({ ok: true, added: appendReviews(b.reviews || []) });
      case 'sync':
        var added = appendReviews(b.reviews || []);
        upsertFlags(b.flags || []);
        upsertMine(b.mine || []);
        upsertSettings(b.settings || []);
        if (added) log('sync', added + ' answers');
        return json({ ok: true, added: added, data: payload() });
      default:
        throw new Error('Unknown action.');
    }
  } catch (err) {
    return json({ ok: false, error: err.message, code: err.codeType || '' });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkCode(code) {
  var want = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!want || !code || code !== want) {
    var err = new Error('The access code is wrong.');
    err.codeType = 'code';
    throw err;
  }
}

/* ------------------------------------------------------------------ Sheet */

function sheet(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); ensureTab(sh, name); }
  return sh;
}

function ensureTab(sh, name) {
  var head = TABS[name];
  if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  var cur = sh.getRange(1, 1, 1, head.length).getValues()[0].map(String);
  if (cur.join('|') !== head.join('|')) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
}

function cell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  return v === null || v === undefined ? '' : String(v);
}

function readTable(name) {
  var sh = sheet(name), head = TABS[name];
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  return values.filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = cell(r[i]); });
    return o;
  });
}

function appendRows(name, rows) {
  if (!rows.length) return;
  var sh = sheet(name), head = TABS[name];
  var values = rows.map(function (o) { return head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); }); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, head.length).setNumberFormat('@').setValues(values);
}

/** Inserts or replaces rows by id. */
function writeRows(name, rows) {
  if (!rows.length) return;
  var sh = sheet(name), head = TABS[name];
  var ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var fresh = [];
  rows.forEach(function (o) {
    var row = head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : String(o[h]); });
    var i = ids.indexOf(String(o.id));
    if (i > -1) sh.getRange(i + 2, 1, 1, head.length).setNumberFormat('@').setValues([row]);
    else fresh.push(o);
  });
  appendRows(name, fresh);
}

function log(action, detail) {
  try { sheet('Log').appendRow([cell(new Date()), action, String(detail || '').slice(0, 500)]); } catch (e) { /* never block on logging */ }
}

/* ------------------------------------------------------------------ records */

function clean(s, max) { return String(s === undefined || s === null ? '' : s).slice(0, max || 200); }
function isIso(s) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s || '')); }

/** Adds answers the Sheet doesn't have yet. Returns how many were added. */
function appendReviews(list) {
  if (!list || !list.length) return 0;
  var sh = sheet('Reviews');
  var have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0])] = true; });
  var rows = [];
  list.slice(0, MAX_PUSH).forEach(function (e) {
    if (!e || !e.id || !e.q || !isIso(e.t) || have[e.id]) return;
    have[e.id] = true;
    rows.push({ id: clean(e.id, 40), q: clean(e.q, 60), t: clean(e.t, 40), c: Number(e.c) || 0, ok: e.ok ? 1 : 0, sure: e.sure ? 1 : 0, m: clean(e.m, 12), ms: Math.max(0, Math.round(Number(e.ms) || 0)), d: clean(e.d, 40) });
  });
  appendRows('Reviews', rows);
  return rows.length;
}

/** Newer records win. A flag's status is set in the Sheet (open or fixed), so the site never overwrites it. */
function upsertFlags(list) {
  var cur = {};
  readTable('Flags').forEach(function (r) { cur[r.id] = r; });
  var rows = [];
  list.forEach(function (f) {
    if (!f || !f.id || !f.q) return;
    var old = cur[f.id];
    if (old && String(old.at) >= String(f.at || '')) return;
    rows.push({ id: clean(f.id, 40), q: clean(f.q, 60), at: clean(f.at, 40), reason: clean(f.reason, 120), note: clean(f.note, 1000), status: old ? old.status : 'open', deleted: f.deleted ? 'true' : '' });
  });
  writeRows('Flags', rows);
}

function upsertMine(list) {
  var cur = {};
  readTable('MyQuestions').forEach(function (r) { cur[r.id] = r; });
  var rows = [];
  list.forEach(function (q) {
    if (!q || !q.id || String(q.id).indexOf('MY-') !== 0) return;
    var old = cur[q.id];
    if (old && String(old.at) >= String(q.at || '')) return;
    var body = {};
    ['subject', 'tos', 'type', 'difficulty', 'stem', 'options', 'answer', 'why', 'whyNot', 'ref', 'author'].forEach(function (k) { if (q[k] !== undefined) body[k] = q[k]; });
    rows.push({ id: clean(q.id, 40), at: clean(q.at, 40), deleted: q.deleted ? 'true' : '', json: JSON.stringify(body).slice(0, 45000) });
  });
  writeRows('MyQuestions', rows);
}

function upsertSettings(list) {
  var cur = {};
  readTable('Settings').forEach(function (r) { cur[r.id] = r; });
  var rows = [];
  list.forEach(function (s) {
    if (!s || !s.id) return;
    var old = cur[s.id];
    if (old && String(old.at) >= String(s.at || '')) return;
    rows.push({ id: clean(s.id, 40), v: JSON.stringify(s.v === undefined ? null : s.v).slice(0, 2000), at: clean(s.at, 40) });
  });
  writeRows('Settings', rows);
}

function parseJson(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }

function payload() {
  return {
    reviews: readTable('Reviews').map(function (r) {
      return { id: r.id, q: r.q, t: r.t, c: Number(r.c), ok: Number(r.ok), sure: Number(r.sure), m: r.m, ms: Number(r.ms), d: r.d };
    }),
    flags: readTable('Flags').map(function (r) {
      return { id: r.id, q: r.q, at: r.at, reason: r.reason, note: r.note, status: r.status || 'open', deleted: r.deleted === 'true' };
    }),
    mine: readTable('MyQuestions').map(function (r) {
      var q = parseJson(r.json, {});
      q.id = r.id; q.at = r.at; q.deleted = r.deleted === 'true';
      return q;
    }),
    settings: readTable('Settings').map(function (r) { return { id: r.id, v: parseJson(r.v, null), at: r.at }; })
  };
}

/* Lets the tests in tests/backend.test.js load this file in Node. */
if (typeof module !== 'undefined') module.exports = { doPost: doPost, doGet: doGet, setup: setup, TABS: TABS };
