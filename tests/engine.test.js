/* Tests for the study engine and the question files. Run: node --test tests/ */
var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var M = require("../assets/engine.js");

var root = path.join(__dirname, "..");
function load(p) { return JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); }
var CODES = ["CC", "MP", "CM", "HE", "BB", "HL"];
var files = {};
CODES.forEach(function (c) { files[c] = load("data/questions/" + c + ".json"); });
var tos = load("data/tos.json"), images = load("data/images.json"), morph = load("data/morphology.json");
var topics = M.topicIndex(tos);
var bank = M.buildBank(files, images, morph, []);
var EXAM = "2027-03-01";
var T0 = Date.parse("2026-10-06T01:00:00Z");   // 9 AM in Manila
function iso(ms) { return new Date(ms).toISOString(); }

test("the TOS adds up: 6 subjects of 100 items, weights total 100", function () {
  assert.strictEqual(tos.subjects.length, 6);
  var w = 0;
  tos.subjects.forEach(function (s) {
    w += s.weight;
    var sum = s.topics.reduce(function (a, t) { return a + t.items; }, 0);
    assert.strictEqual(sum, 100, s.code + " topics sum to " + sum);
    s.topics.forEach(function (t) {
      if (!t.subtopics || !t.subtopics.length) return;
      var st = t.subtopics.reduce(function (a, x) { return a + x.items; }, 0);
      assert.strictEqual(st, t.items, t.code + " subtopics sum to " + st);
    });
  });
  assert.strictEqual(w, 100);
});

test("every question is well formed", function () {
  var ids = {};
  CODES.forEach(function (c) {
    files[c].items.forEach(function (q) {
      assert.ok(!ids[q.id], "duplicate id " + q.id); ids[q.id] = true;
      assert.strictEqual(q.options.length, 4, q.id + " needs 4 options");
      assert.strictEqual(new Set(q.options).size, 4, q.id + " has duplicate options");
      assert.ok(q.answer >= 0 && q.answer < 4, q.id + " answer out of range");
      assert.ok(topics[q.tos], q.id + " has unknown TOS code " + q.tos);
      assert.strictEqual(topics[q.tos].subject, c, q.id + " TOS code is from another subject");
      assert.ok(q.why && q.why.length > 20, q.id + " needs an explanation");
      var wrong = [0, 1, 2, 3].filter(function (i) { return i !== q.answer; }).map(String).sort();
      assert.deepStrictEqual(Object.keys(q.whyNot).sort(), wrong, q.id + " whyNot must cover exactly the wrong options");
      assert.ok(!/all of the above|none of the above/i.test(q.options.join(" ")), q.id + " uses all/none of the above");
      if (q.type === "math") assert.ok(q.worked && q.worked.steps && q.worked.steps.length, q.id + " math item needs a worked example");
    });
  });
});

test("image questions use real categories and four different options", function () {
  var imgs = bank.items.filter(function (q) { return q.type === "image"; });
  assert.strictEqual(imgs.length, images.images.length);
  imgs.forEach(function (q) {
    assert.strictEqual(q.options.length, 4, q.id);
    assert.strictEqual(new Set(q.options).size, 4, q.id);
    assert.strictEqual(q.options[q.answer], q.category);
    assert.ok(/^https:\/\//.test(q.image.src), q.id + " image must be https");
    assert.ok(!/egg|larva|cyst|troph|ring|gametocyte|microfilaria|band|trypomastigote/i.test(q.image.specimen), q.id + " specimen text gives the answer away: " + q.image.specimen);
  });
});

test("gap cap shrinks as the exam gets close", function () {
  assert.strictEqual(M.gapCap(150), 21);
  assert.strictEqual(M.gapCap(60), 9);
  assert.strictEqual(M.gapCap(14), 2);
  assert.strictEqual(M.gapCap(1), 1);
  assert.strictEqual(M.gapCap(-5), 1);
});

test("days are counted in Philippine time", function () {
  // 11:30 PM Oct 5 in Manila is 15:30 UTC; 12:30 AM Oct 6 is 16:30 UTC
  assert.strictEqual(M.dayNum("2026-10-05T15:30:00Z") + 1, M.dayNum("2026-10-05T16:30:00Z"));
  assert.strictEqual(M.daysLeft(EXAM, Date.parse("2027-02-28T17:00:00Z")), 0);   // 1 AM Mar 1 in Manila
});

test("new questions follow exam weights and skip images", function () {
  var plan = M.todayPlan(bank, {}, [], { examDate: EXAM, newPerDay: 10, topics: topics }, T0);
  assert.strictEqual(plan.fresh.length, 10);
  var count = {};
  plan.fresh.forEach(function (q) { count[q.subject] = (count[q.subject] || 0) + 1; assert.notStrictEqual(q.type, "image"); });
  ["CC", "MP", "HE", "BB"].forEach(function (c) { assert.strictEqual(count[c], 2, c); });
  ["CM", "HL"].forEach(function (c) { assert.strictEqual(count[c], 1, c); });
});

test("no new questions in the last 2 weeks", function () {
  var plan = M.todayPlan(bank, {}, [], { examDate: EXAM, newPerDay: 15, topics: topics }, Date.parse("2027-02-20T01:00:00Z"));
  assert.strictEqual(plan.fresh.length, 0);
});

test("a miss comes back tomorrow; a sure right answer waits longer; never past the cap", function () {
  var q = bank.items[0];
  var miss = M.buildCards([{ id: "a", q: q.id, t: iso(T0), ok: 0, sure: 0 }], EXAM)[q.id];
  assert.strictEqual(miss.dueDay - M.dayNum(T0), 1);
  var log = [{ id: "a", q: q.id, t: iso(T0), ok: 1, sure: 1 }, { id: "b", q: q.id, t: iso(T0 + 3 * M.DAY), ok: 1, sure: 1 }];
  var good = M.buildCards(log, EXAM)[q.id];
  var gap = good.dueDay - M.dayNum(T0 + 3 * M.DAY);
  assert.ok(gap > 1 && gap <= M.gapCap(M.daysLeft(EXAM, T0 + 3 * M.DAY)), "gap " + gap);
  assert.ok(M.mastered(good, q));
});

test("a confident miss returns within 2 days", function () {
  var q = bank.items[1];
  var log = [];
  for (var i = 0; i < 5; i++) log.push({ id: "r" + i, q: q.id, t: iso(T0 + i * 20 * M.DAY), ok: 1, sure: 1 });
  log.push({ id: "x", q: q.id, t: iso(T0 + 101 * M.DAY), ok: 0, sure: 1 });
  var c = M.buildCards(log, "2027-12-01")[q.id];
  assert.ok(c.dueDay - M.dayNum(T0 + 101 * M.DAY) <= 2);
  assert.ok(!M.mastered(c, q));
});

test("image mastery needs fast answers", function () {
  var q = bank.items.filter(function (x) { return x.type === "image"; })[0];
  var slow = M.buildCards([{ id: "a", q: q.id, t: iso(T0), ok: 1, sure: 1, ms: 15000 }, { id: "b", q: q.id, t: iso(T0 + M.DAY), ok: 1, sure: 1, ms: 15000 }], EXAM)[q.id];
  assert.ok(!M.mastered(slow, q));
  var fast = M.buildCards([{ id: "a", q: q.id, t: iso(T0), ok: 1, sure: 1, ms: 4000 }, { id: "b", q: q.id, t: iso(T0 + M.DAY), ok: 1, sure: 1, ms: 5000 }], EXAM)[q.id];
  assert.ok(M.mastered(fast, q));
});

test("today's queue puts the question of the day first and interleaves subjects", function () {
  var plan = M.todayPlan(bank, {}, [], { examDate: EXAM, newPerDay: 15, topics: topics }, T0);
  var qod = M.pickQod(plan, plan.today, 2);
  assert.strictEqual(qod.length, 2);
  assert.deepStrictEqual(M.pickQod(plan, plan.today, 2), qod, "same day, same picks");
  var queue = M.todayQueue(plan, qod, bank);
  assert.deepStrictEqual(queue.slice(0, 2).map(function (q) { return q.id; }), qod);
  var repeats = 0;
  for (var i = 3; i < queue.length; i++) if (queue[i].subject === queue[i - 1].subject) repeats++;
  assert.ok(repeats <= 2, "too many same-subject repeats: " + repeats);
});

test("answered questions leave today's plan and show up as due later", function () {
  var plan = M.todayPlan(bank, {}, [], { examDate: EXAM, newPerDay: 5, topics: topics }, T0);
  var log = plan.fresh.map(function (q, i) { return { id: "r" + i, q: q.id, t: iso(T0 + i * 60000), ok: i % 2, sure: 1 }; });
  var cards = M.buildCards(log, EXAM);
  var after = M.todayPlan(bank, cards, log, { examDate: EXAM, newPerDay: 5, topics: topics }, T0 + 3600000);
  assert.strictEqual(after.fresh.length, 0, "today's new quota is used up");
  assert.strictEqual(after.due.length, 0, "nothing due again the same day");
  var tomorrow = M.todayPlan(bank, cards, log, { examDate: EXAM, newPerDay: 5, topics: topics }, T0 + M.DAY);
  assert.ok(tomorrow.due.length >= 2, "the misses are due tomorrow");
});

test("merging two devices keeps every answer once, in time order", function () {
  var a = [{ id: "1", q: "x", t: "2026-10-06T01:00:00Z" }, { id: "2", q: "x", t: "2026-10-06T03:00:00Z" }];
  var b = [{ id: "2", q: "x", t: "2026-10-06T03:00:00Z" }, { id: "3", q: "y", t: "2026-10-06T02:00:00Z" }];
  assert.deepStrictEqual(M.mergeReviews(a, b).map(function (e) { return e.id; }), ["1", "3", "2"]);
  var r = M.mergeRecords([{ id: "s", v: 1, at: "2026-10-06T01:00:00Z" }], [{ id: "s", v: 2, at: "2026-10-06T02:00:00Z" }]);
  assert.strictEqual(r[0].v, 2);
});

test("readiness says not yet without enough answers, and on track with strong ones", function () {
  var empty = M.readiness(M.subjectStats(bank, {}, [], T0));
  assert.strictEqual(empty.onTrack, false);
  var log = [], n = 0;
  bank.items.filter(function (q) { return q.type !== "image"; }).forEach(function (q) {
    for (var k = 0; k < 3; k++) log.push({ id: "r" + (n++), q: q.id, t: iso(T0 + k * M.DAY), ok: k > 0 ? 1 : 0, sure: 1 });
  });
  var stats = M.subjectStats(bank, M.buildCards(log, EXAM), log, T0 + 3 * M.DAY);
  var r = M.readiness(stats);
  assert.ok(Math.abs(r.average - 2 / 3) < 0.01);
  assert.strictEqual(r.onTrack, false, "67% is below 75%");
});

test("exam queue is capped at 100 per subject and has no images", function () {
  var q = M.examQueue(bank, ["CC", "HE"], 1);
  assert.ok(q.length <= 200);
  assert.ok(q.every(function (x) { return x.type !== "image" && (x.subject === "CC" || x.subject === "HE"); }));
  assert.strictEqual(M.examMinutes(100), 120);
});

test("her own questions join the bank only when switched on, and deleted ones stay out", function () {
  var mine = [{ id: "MY-1", subject: "CC", tos: "CC-C.1", stem: "Q?", options: ["a", "b", "c", "d"], answer: 1, why: "because" }, { id: "MY-2", deleted: true, subject: "CC", stem: "x", options: ["a", "b"] }];
  var b2 = M.buildBank(files, images, morph, mine);
  assert.ok(b2.byId["MY-1"] && b2.byId["MY-1"].mine);
  assert.ok(!b2.byId["MY-2"]);
});

test("the diagnostic has 3 questions per subject, no images, subjects taking turns", function () {
  var d = M.diagnosticQueue(bank, topics);
  assert.strictEqual(d.length, 18);
  assert.strictEqual(new Set(d.map(function (q) { return q.id; })).size, 18);
  assert.ok(d.every(function (q) { return q.type !== "image"; }));
  assert.deepStrictEqual(d.slice(0, 6).map(function (q) { return q.subject; }), ["CC", "MP", "CM", "HE", "BB", "HL"]);
  ["CC", "MP", "CM", "HE", "BB", "HL"].forEach(function (c) {
    var mine = d.filter(function (q) { return q.subject === c; });
    assert.strictEqual(mine.length, 3, c);
    assert.strictEqual(new Set(mine.map(function (q) { return q.difficulty; })).size, 3, c + " should mix easy, moderate and difficult");
  });
  assert.deepStrictEqual(M.diagnosticQueue(bank, topics).map(function (q) { return q.id; }), d.map(function (q) { return q.id; }), "same set every time");
});

test("visual explainers are well formed and safe", function () {
  var ids = {}, all = [];
  CODES.forEach(function (c) {
    var p = path.join(root, "data/visuals/" + c + ".json");
    if (!fs.existsSync(p)) return;
    JSON.parse(fs.readFileSync(p, "utf8")).visuals.forEach(function (v) { all.push(v); });
  });
  assert.ok(all.length >= 30, "expected at least 30 visuals, found " + all.length);
  all.forEach(function (v) {
    assert.ok(!ids[v.id], "duplicate visual id " + v.id); ids[v.id] = true;
    assert.ok(CODES.indexOf(v.subject) > -1, v.id + " subject");
    assert.ok(v.id.indexOf(v.subject.toLowerCase() + "-") === 0, v.id + " id should start with its subject code");
    assert.ok(v.steps.length >= 3 && v.steps.length <= 7, v.id + " needs 3-7 steps");
    (v.tos || []).forEach(function (t) { assert.ok(topics[t], v.id + " unknown TOS " + t); });
    (v.keywords || []).forEach(function (k) { assert.ok(k.length >= 4 && k === k.toLowerCase(), v.id + " keyword " + k); });
    v.steps.forEach(function (s) { assert.ok(s.caption && s.caption.length > 20, v.id + " caption"); });
    if (v.type === "image") { assert.ok(/^https:\/\//.test(v.src), v.id + " src"); return; }
    var vb = String(v.viewBox).split(/\s+/).map(Number);
    assert.strictEqual(vb[2], 360, v.id + " viewBox width"); assert.ok(vb[3] <= 640, v.id + " viewBox height");
    assert.ok(!/<script|<foreignObject|<image|\son[a-z]+\s*=|javascript:/i.test(v.svg), v.id + " has unsafe markup");
    var keys = {};
    v.svg.replace(/data-k="([^"]+)"/g, function (m, k) { keys[k] = true; });
    v.steps.forEach(function (s) { (s.show || []).concat(s.hl || []).forEach(function (k) { assert.ok(keys[k], v.id + " step refers to missing key " + k); }); });
    v.svg.replace(/(fill|stroke)="#[0-9a-f]{3,6}"/gi, function (m, a, off, str) {
      var open = str.lastIndexOf("<", off), tag = str.slice(open, str.indexOf(">", off));
      assert.ok(/v-real/.test(tag), v.id + " hard-coded colour outside v-real: " + tag.slice(0, 80));
    });
  });
});
