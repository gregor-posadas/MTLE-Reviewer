/* Tests for apps-script/Code.gs with a small in-memory stand-in for the Google services. Run: node --test tests/ */
var test = require("node:test");
var assert = require("node:assert");
var path = require("path");

function fakeGoogle() {
  var sheets = {}, props = {};
  function makeSheet(name) {
    var rows = [];
    var sh = {
      name: name, rows: rows,
      getLastRow: function () { return rows.length; },
      getMaxColumns: function () { return 26; },
      insertColumnsAfter: function () {},
      setFrozenRows: function () {},
      appendRow: function (r) { rows.push(r.map(String)); },
      deleteRow: function (r) { rows.splice(r - 1, 1); },
      getRange: function (r, c, nr, nc) {
        return {
          getValues: function () {
            var out = [];
            for (var i = 0; i < (nr || 1); i++) { var row = rows[r - 1 + i] || []; var o = []; for (var j = 0; j < (nc || 1); j++) o.push(row[c - 1 + j] === undefined ? "" : row[c - 1 + j]); out.push(o); }
            return out;
          },
          setValues: function (vals) { vals.forEach(function (v, i) { var row = rows[r - 1 + i] || (rows[r - 1 + i] = []); v.forEach(function (x, j) { row[c - 1 + j] = String(x); }); }); return this; },
          setNumberFormat: function () { return this; },
          setFontWeight: function () { return this; }
        };
      }
    };
    return sh;
  }
  var ss = {
    getId: function () { return "sheet-1"; },
    getSheetByName: function (n) { return sheets[n] || null; },
    insertSheet: function (n) { sheets[n] = makeSheet(n); return sheets[n]; },
    getSheets: function () { return Object.keys(sheets).map(function (k) { return sheets[k]; }); },
    deleteSheet: function (s) { delete sheets[s.name]; }
  };
  global.SpreadsheetApp = { getActive: function () { return ss; }, openById: function () { return ss; } };
  global.PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = v; } }; } };
  global.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  global.ContentService = { MimeType: { JSON: "json" }, createTextOutput: function (s) { return { body: s, setMimeType: function () { return this; } }; } };
  global.Logger = { log: function () {} };
  global.Utilities = { formatDate: function (d) { return d.toISOString(); } };
  return { sheets: sheets, props: props };
}

function loadGs() {
  var p = path.join(__dirname, "..", "apps-script", "Code.gs");
  var src = require("fs").readFileSync(p, "utf8");
  var m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports;
}
function post(gs, body) { return JSON.parse(gs.doPost({ postData: { contents: JSON.stringify(body) } }).body); }

test("setup makes the tabs and an access code", function () {
  var g = fakeGoogle(), gs = loadGs();
  gs.setup();
  ["Reviews", "Flags", "MyQuestions", "Settings", "Log"].forEach(function (t) { assert.ok(g.sheets[t], t); });
  assert.match(g.props.ACCESS_CODE, /^[a-z]+-\d{4}$/);
});

test("a wrong code is refused", function () {
  var g = fakeGoogle(), gs = loadGs(); gs.setup();
  var r = post(gs, { action: "sync", code: "nope" });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, "code");
});

test("sync stores answers once and returns them to the other device", function () {
  var g = fakeGoogle(), gs = loadGs(); gs.setup();
  var code = g.props.ACCESS_CODE;
  var e1 = { id: "a1", q: "CC-0001", t: "2026-10-06T01:00:00.000Z", c: 2, ok: 1, sure: 1, m: "today", ms: 8000, d: "phone" };
  var r1 = post(gs, { action: "sync", code: code, reviews: [e1] });
  assert.strictEqual(r1.ok, true); assert.strictEqual(r1.added, 1);
  var r2 = post(gs, { action: "sync", code: code, reviews: [e1, { id: "a2", q: "HE-0003", t: "2026-10-06T02:00:00.000Z", c: 0, ok: 0, sure: 1, m: "today", ms: 5000, d: "laptop" }] });
  assert.strictEqual(r2.added, 1, "the repeat is skipped");
  assert.strictEqual(r2.data.reviews.length, 2);
  assert.deepStrictEqual(r2.data.reviews[0], e1);
  var p = post(gs, { action: "push", code: code, reviews: [{ id: "bad", q: "X", t: "not a date" }] });
  assert.strictEqual(p.added, 0, "malformed answers are ignored");
});

test("flags keep the status set in the Sheet; settings and her questions: newer wins", function () {
  var g = fakeGoogle(), gs = loadGs(); gs.setup();
  var code = g.props.ACCESS_CODE;
  post(gs, { action: "sync", code: code, flags: [{ id: "f1", q: "CC-0002", at: "2026-10-06T01:00:00Z", reason: "Answer key", note: "", status: "open" }] });
  g.sheets.Flags.rows[1][5] = "fixed";   // Gregor marks it fixed in the Sheet
  var r = post(gs, { action: "sync", code: code, flags: [{ id: "f1", q: "CC-0002", at: "2026-10-06T03:00:00Z", reason: "Answer key", note: "page 12", status: "open" }],
    settings: [{ id: "examDate", v: "2027-03-04", at: "2026-10-06T01:00:00Z" }],
    mine: [{ id: "MY-1", at: "2026-10-06T01:00:00Z", subject: "CC", tos: "CC-C.1", stem: "Q?", options: ["a", "b", "c", "d"], answer: 1, why: "w" }] });
  assert.strictEqual(r.data.flags[0].status, "fixed");
  assert.strictEqual(r.data.flags[0].note, "page 12");
  var r2 = post(gs, { action: "sync", code: code, settings: [{ id: "examDate", v: "2027-01-01", at: "2026-10-05T01:00:00Z" }] });
  assert.strictEqual(r2.data.settings[0].v, "2027-03-04", "the older setting does not win");
  assert.strictEqual(r2.data.mine[0].stem, "Q?");
  assert.deepStrictEqual(r2.data.mine[0].options, ["a", "b", "c", "d"]);
});

test("removed answers leave the Sheet, are reported to other devices, and can't come back", function () {
  var g = fakeGoogle(), gs = loadGs(); gs.setup();
  var code = g.props.ACCESS_CODE;
  function ans(id) { return { id: id, q: "CC-0001", t: "2026-10-06T01:00:00.000Z", c: 0, ok: 1, sure: 1, m: "qod", ms: 5000, d: "laptop" }; }
  post(gs, { action: "sync", code: code, reviews: [ans("t1"), ans("t2"), ans("keep")] });
  var r = post(gs, { action: "sync", code: code, removed: ["t1", "t2"] });
  assert.deepStrictEqual(r.data.reviews.map(function (e) { return e.id; }), ["keep"]);
  assert.deepStrictEqual(r.data.removed.sort(), ["t1", "t2"]);
  var again = post(gs, { action: "sync", code: code, reviews: [ans("t1")] });
  assert.strictEqual(again.added, 0, "a device that still has t1 can't bring it back");
  assert.strictEqual(again.data.reviews.length, 1);
});
