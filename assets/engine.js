/* MTLE Reviewer: the study engine.
   Pure logic with no page code, so the same file runs in the browser (window.MTLE) and in the tests (require).

   How scheduling works, in one paragraph:
   every answer is one line in an append-only review log. A question's schedule is rebuilt by replaying its
   lines through FSRS (ts-fsrs, MIT). Wrong = Again, right but unsure = Hard, right and sure = Good.
   The gap before a question comes back is also capped at about 15% of the days left before the exam
   (at most 21 days), so reviews tighten as the exam gets close (Cepeda et al. 2008).
   A question counts as mastered after 2 correct answers in a row (Kerfoot 2010). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../vendor/ts-fsrs.umd.js"));
  else root.MTLE = factory(root.FSRS);
})(this, function (FSRS) {
  "use strict";

  var DAY = 86400000;
  var MANILA = 8 * 3600000;          // Philippine time is UTC+8 all year (no daylight saving)
  var FAST_MS = 10000;               // an image answer under 10 seconds counts as fluent

  var SUBJECTS = [
    { code: "CC", name: "Clinical Chemistry", short: "Clin Chem", weight: 20, day: 1 },
    { code: "MP", name: "Microbiology and Parasitology", short: "Micro/Para", weight: 20, day: 1 },
    { code: "CM", name: "Clinical Microscopy", short: "Clin Micro", weight: 10, day: 1 },
    { code: "HE", name: "Hematology", short: "Hema", weight: 20, day: 2 },
    { code: "BB", name: "Blood Banking and Serology", short: "BB/Sero", weight: 20, day: 2 },
    { code: "HL", name: "Histopath, MT Laws and Ethics", short: "Histo/Laws", weight: 10, day: 2 }
  ];
  var SUBJECT = {};
  SUBJECTS.forEach(function (s) { SUBJECT[s.code] = s; });
  var DIFF_ORDER = { easy: 0, moderate: 1, difficult: 2 };

  var scheduler = FSRS.fsrs(FSRS.generatorParameters({
    request_retention: 0.9,       // above 0.9 the workload climbs steeply (Anki manual)
    enable_fuzz: true,            // spreads reviews so they don't bunch on one day
    enable_short_term: false,     // whole days only: a miss comes back tomorrow, not in 10 minutes
    maximum_interval: 365
  }));

  /* ---------- dates, always in Philippine time ---------- */
  function dayNum(t) { return Math.floor((+new Date(t) + MANILA) / DAY); }
  function dayStart(n) { return n * DAY - MANILA; }
  function isoDay(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : NaN;
  }
  function daysLeft(examDate, now) { return parseDay(examDate) - dayNum(now == null ? Date.now() : now); }
  /* Largest gap between reviews, in days, for a given number of days left before the exam. */
  function gapCap(left) {
    if (!(left > 0)) return 1;
    return Math.max(1, Math.min(21, Math.round(left * 0.15), left));
  }
  function phase(left) {
    if (!(left > 0)) return { key: "after", name: "Exam passed", note: "Set the next exam date under More to keep scheduling." };
    if (left <= 14) return { key: "exam", name: "Exam weeks", note: "No new questions. Reviews come back every 1 to 3 days. Keep your sleep regular." };
    if (left <= 28) return { key: "consolidate", name: "Consolidate", note: "Weekly full mock exams, weakest topics first. Reviews come back within about a week." };
    if (left <= 90) return { key: "build", name: "Build", note: "Mixed practice, image and math drills, a subject mock each month. Reviews come back within about 2 weeks." };
    return { key: "foundation", name: "Foundation", note: "Learn topic by topic, biggest blocks first. Reviews come back within about 3 weeks." };
  }

  /* ---------- small deterministic randomness (same day = same picks) ---------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = typeof seed === "number" ? seed >>> 0 : hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function uid(rand) {
    var r = rand || Math.random, s = "";
    for (var i = 0; i < 12; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(r() * 36));
    return s;
  }

  /* ---------- the question bank ---------- */
  function topicIndex(tos) {
    var idx = {};
    (tos.subjects || []).forEach(function (s) {
      (s.topics || []).forEach(function (t) {
        idx[t.code] = { code: t.code, name: t.name, items: t.items, subject: s.code };
        (t.subtopics || []).forEach(function (st) { idx[st.code] = { code: st.code, name: st.name, items: st.items, subject: s.code, topic: t.code }; });
      });
    });
    return idx;
  }
  function topicOf(code) { return String(code || "").split(".")[0]; }

  /* Image questions are built from the image list: the right category plus look-alikes as the wrong options,
     and each option's notes as its explanation. */
  function imageItems(images, morph) {
    if (!images || !morph || !morph.categories) return [];
    var groupOf = {}, all = Object.keys(morph.categories);
    (morph.groups || []).forEach(function (g) { g.categories.forEach(function (c) { groupOf[c] = g.name; }); });
    return (images.images || []).filter(function (im) { return morph.categories[im.category]; }).map(function (im) {
      var info = morph.categories[im.category], rand = rng("opts:" + im.id);
      var opts = [im.category];
      (info.lookalikes || []).forEach(function (c) { if (opts.length < 4 && morph.categories[c] && opts.indexOf(c) < 0) opts.push(c); });
      var same = shuffle(all.filter(function (c) { return groupOf[c] === groupOf[im.category] && opts.indexOf(c) < 0; }), rand);
      while (opts.length < 4 && same.length) opts.push(same.shift());
      var rest = shuffle(all.filter(function (c) { return opts.indexOf(c) < 0; }), rand);
      while (opts.length < 4 && rest.length) opts.push(rest.shift());
      var whyNot = {};
      for (var i = 1; i < opts.length; i++) whyNot[i] = morph.categories[opts[i]].features;
      var specimen = String(im.detail || "").split(";")[0].trim();
      return {
        id: "IMG-" + im.id, subject: im.subject || "MP", tos: info.tos || "MP-H.1", type: "image",
        difficulty: "moderate", group: groupOf[im.category] || "", category: im.category,
        stem: "What is shown in this image?",
        image: { src: im.url, specimen: specimen, what: im.what, detail: im.detail, credit: im.credit, license: im.license, page: im.page },
        options: opts, answer: 0,
        why: info.features, whyNot: whyNot,
        ref: im.credit + (im.page ? " (" + im.page + ")" : ""), reviewed: false
      };
    });
  }

  /* files: { CC: {...}, MP: {...} } as loaded from data/questions. mine: her own questions. */
  function buildBank(files, images, morph, mine) {
    var items = [];
    Object.keys(files || {}).forEach(function (code) {
      var f = files[code];
      (f.items || []).forEach(function (q) {
        var x = Object.assign({}, q);
        x.subject = f.subject || code;
        x.reviewed = !!f.reviewed || !!q.reviewed;
        items.push(x);
      });
    });
    imageItems(images, morph).forEach(function (q) { items.push(q); });
    (mine || []).forEach(function (q) {
      if (q.deleted || !q.stem || !q.options || q.options.length < 2) return;
      var x = Object.assign({}, q); x.mine = true; x.type = x.type || "mcq"; x.reviewed = true;
      items.push(x);
    });
    var byId = {};
    items.forEach(function (q) { byId[q.id] = q; });
    return { items: items, byId: byId };
  }

  /* ---------- replaying the log into a schedule ---------- */
  function sortLog(list) {
    return list.slice().sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  }
  function ratingFor(e) { return !e.ok ? FSRS.Rating.Again : (e.sure ? FSRS.Rating.Good : FSRS.Rating.Hard); }

  function buildCards(reviews, examDate) {
    var cards = {}, examDay = parseDay(examDate);
    sortLog(reviews || []).forEach(function (e) {
      if (!e || !e.q || !e.t) return;
      var t = new Date(e.t);
      if (isNaN(t)) return;
      var s = cards[e.q];
      if (!s) s = cards[e.q] = { q: e.q, card: FSRS.createEmptyCard(t), n: 0, right: 0, run: 0, fastRun: 0, firstDay: dayNum(t), last: null, lastOk: false, lastSure: false, dueDay: 0 };
      try { s.card = scheduler.next(s.card, t, ratingFor(e)).card; } catch (err) { /* a bad line never breaks the rest */ }
      s.n++;
      if (e.ok) { s.right++; s.run++; s.fastRun = (e.ms && e.ms < FAST_MS) ? s.fastRun + 1 : 0; }
      else { s.run = 0; s.fastRun = 0; }
      s.last = e.t; s.lastOk = !!e.ok; s.lastSure = !!e.sure;
      var d = dayNum(t), left = isNaN(examDay) ? 90 : examDay - d;
      var due = Math.min(dayNum(s.card.due), d + gapCap(left));
      if (!e.ok && e.sure) due = Math.min(due, d + 2);    // a confident miss comes back within 2 days
      s.dueDay = Math.max(d + 1, due);
    });
    return cards;
  }
  function mastered(card, q) {
    if (!card) return false;
    if (q && q.type === "image") return card.fastRun >= 2;
    return card.run >= 2;
  }

  /* ---------- choosing what to study ---------- */
  function subjectWeight(code) { return (SUBJECT[code] || { weight: 10 }).weight; }

  /* New questions, spread across subjects by exam weight (biggest share first), biggest topics first, easier first. */
  function pickNew(bank, cards, n, topics, exclude) {
    if (n <= 0) return [];
    var pools = {};
    bank.items.forEach(function (q) {
      if (cards[q.id] || (exclude && exclude[q.id]) || q.type === "image") return;
      (pools[q.subject] = pools[q.subject] || []).push(q);
    });
    Object.keys(pools).forEach(function (k) {
      pools[k].sort(function (a, b) {
        var ta = (topics && topics[topicOf(a.tos)]) || {}, tb = (topics && topics[topicOf(b.tos)]) || {};
        return ((tb.items || 0) - (ta.items || 0)) || ((DIFF_ORDER[a.difficulty] || 1) - (DIFF_ORDER[b.difficulty] || 1)) || (a.id < b.id ? -1 : 1);
      });
    });
    var taken = {}, out = [];
    while (out.length < n) {
      var best = null, bestScore = -1;
      Object.keys(pools).forEach(function (k) {
        if (!pools[k].length) return;
        var score = subjectWeight(k) / ((taken[k] || 0) + 1);
        if (score > bestScore || (score === bestScore && k < best)) { best = k; bestScore = score; }
      });
      if (!best) break;
      out.push(pools[best].shift());
      taken[best] = (taken[best] || 0) + 1;
    }
    return out;
  }

  /* Reorder so the same subject rarely comes twice in a row (interleaving). */
  function spread(list) {
    var rest = list.slice(), out = [];
    while (rest.length) {
      var prev = out.length ? out[out.length - 1].subject : null, i = 0;
      while (i < rest.length && rest[i].subject === prev) i++;
      out.push(rest.splice(i < rest.length ? i : 0, 1)[0]);
    }
    return out;
  }

  function answeredOn(reviews, day) {
    var o = {};
    (reviews || []).forEach(function (e) { if (dayNum(e.t) === day) o[e.q] = true; });
    return o;
  }

  /* What's on the Today screen. */
  function todayPlan(bank, cards, reviews, opts, now) {
    now = now == null ? Date.now() : now;
    var today = dayNum(now), done = answeredOn(reviews, today);
    var left = daysLeft(opts.examDate, now);
    var due = bank.items.filter(function (q) { var c = cards[q.id]; return c && c.dueDay <= today && !done[q.id]; })
      .sort(function (a, b) { return (cards[a.id].dueDay - cards[b.id].dueDay) || (a.id < b.id ? -1 : 1); });
    var introducedToday = 0;
    Object.keys(cards).forEach(function (k) { if (cards[k].firstDay === today) introducedToday++; });
    var newCap = left <= 14 ? 0 : Math.max(0, (opts.newPerDay == null ? 15 : opts.newPerDay) - introducedToday);
    var fresh = pickNew(bank, cards, newCap, opts.topics);
    return { today: today, due: due, fresh: fresh, introducedToday: introducedToday, newCap: newCap, left: left, doneToday: Object.keys(done).length };
  }

  /* Question of the day: up to 2 questions fixed for the whole day. Something due if there is one, else something new. */
  function pickQod(plan, day, count) {
    var pool = plan.due.concat(plan.fresh), rand = rng("qod:" + day);
    var due = plan.due.slice(0, 6), fresh = plan.fresh.slice(0, 6), out = [];
    var src = shuffle(due, rand).concat(shuffle(fresh, rand));
    for (var i = 0; i < src.length && out.length < (count || 2); i++) if (out.indexOf(src[i].id) < 0) out.push(src[i].id);
    if (!out.length && pool.length) out.push(pool[0].id);
    return out;
  }

  /* The Today session: unanswered question-of-the-day items first, then due reviews mixed with new questions. */
  function todayQueue(plan, qodIds, bank) {
    var seen = {}, out = [];
    (qodIds || []).forEach(function (id) { var q = bank.byId[id]; if (q) { seen[id] = true; out.push(q); } });
    var due = plan.due.filter(function (q) { return !seen[q.id]; });
    var fresh = plan.fresh.filter(function (q) { return !seen[q.id]; });
    var mixed = [], i = 0, j = 0;
    while (i < due.length || j < fresh.length) {
      if (i < due.length) mixed.push(due[i++]);
      if (i < due.length) mixed.push(due[i++]);
      if (j < fresh.length) mixed.push(fresh[j++]);
    }
    return out.concat(spread(mixed));
  }

  /* Mixed practice: from the chosen subjects, by source (all, weak, missed, flagged). */
  function practiceQueue(bank, cards, opt, seed) {
    var rand = rng(seed || Date.now());
    var subs = opt.subjects && opt.subjects.length ? opt.subjects : SUBJECTS.map(function (s) { return s.code; });
    var pool = bank.items.filter(function (q) {
      if (subs.indexOf(q.subject) < 0) return false;
      if (q.type === "image" && !opt.includeImages) return false;
      var c = cards[q.id];
      if (opt.source === "missed") return c && !c.lastOk;
      if (opt.source === "flagged") return opt.flagged && opt.flagged[q.id];
      if (opt.source === "weak") return c && !mastered(c, q);
      if (opt.source === "unseen") return !c;
      return true;
    });
    pool = shuffle(pool, rand);
    // Weakest first: unseen and low-accuracy questions ahead of mastered ones
    pool.sort(function (a, b) { return priority(cards[a.id], a) - priority(cards[b.id], b); });
    return spread(pool.slice(0, opt.size || 20));
  }
  function priority(c, q) {
    if (!c) return 1;
    if (mastered(c, q)) return 3;
    return c.right / c.n < 0.6 ? 0 : 2;
  }

  /* Learn mode: one topic at a time, easy first. */
  function learnQueue(bank, topicCode) {
    return bank.items.filter(function (q) { return q.type !== "image" && (q.tos === topicCode || topicOf(q.tos) === topicCode); })
      .sort(function (a, b) { return ((DIFF_ORDER[a.difficulty] || 1) - (DIFF_ORDER[b.difficulty] || 1)) || (a.tos < b.tos ? -1 : a.tos > b.tos ? 1 : (a.id < b.id ? -1 : 1)); });
  }

  /* Image drill: mixed across the chosen groups, categories not yet fluent first. */
  function drillQueue(bank, cards, groups, size, seed) {
    var rand = rng(seed || Date.now());
    var pool = shuffle(bank.items.filter(function (q) { return q.type === "image" && (!groups || !groups.length || groups.indexOf(q.group) > -1); }), rand);
    pool.sort(function (a, b) { return (mastered(cards[a.id], a) ? 1 : 0) - (mastered(cards[b.id], b) ? 1 : 0); });
    var out = [], lastCat = null, rest = pool.slice(0, size || 20);
    while (rest.length) {   // keep the same category from coming twice in a row
      var i = 0; while (i < rest.length && rest[i].category === lastCat) i++;
      var q = rest.splice(i < rest.length ? i : 0, 1)[0]; out.push(q); lastCat = q.category;
    }
    return out;
  }

  /* Exam simulation: every question in a subject (up to 100), in a fixed random order. */
  function examQueue(bank, subjects, seed) {
    var rand = rng(seed || Date.now()), out = [];
    subjects.forEach(function (code) {
      var list = shuffle(bank.items.filter(function (q) { return q.subject === code && q.type !== "image"; }), rand).slice(0, 100);
      out = out.concat(list);
    });
    return out;
  }
  function examMinutes(n) { return Math.max(5, Math.round(n * 1.2)); }   // the real exam: 100 items in 2 hours

  /* ---------- progress ---------- */
  function subjectStats(bank, cards, reviews, now) {
    now = now == null ? Date.now() : now;
    var since = dayNum(now) - 30, out = {};
    SUBJECTS.forEach(function (s) { out[s.code] = { code: s.code, total: 0, seen: 0, mastered: 0, answers: 0, right: 0, recentN: 0, recentRight: 0 }; });
    bank.items.forEach(function (q) {
      var o = out[q.subject]; if (!o) return;
      o.total++;
      var c = cards[q.id];
      if (c) { o.seen++; if (mastered(c, q)) o.mastered++; }
    });
    (reviews || []).forEach(function (e) {
      var q = bank.byId[e.q]; if (!q || !out[q.subject]) return;
      var o = out[q.subject]; o.answers++; if (e.ok) o.right++;
      if (dayNum(e.t) >= since) { o.recentN++; if (e.ok) o.recentRight++; }
    });
    return out;
  }
  function topicStats(bank, cards, reviews, subject, topics) {
    var out = {};
    bank.items.forEach(function (q) {
      if (q.subject !== subject) return;
      var k = topicOf(q.tos), o = out[k] || (out[k] = { code: k, name: (topics[k] || {}).name || k, tosItems: (topics[k] || {}).items || 0, total: 0, seen: 0, mastered: 0, answers: 0, right: 0 });
      o.total++;
      var c = cards[q.id]; if (c) { o.seen++; if (mastered(c, q)) o.mastered++; }
    });
    (reviews || []).forEach(function (e) {
      var q = bank.byId[e.q]; if (!q || q.subject !== subject) return;
      var o = out[topicOf(q.tos)]; if (o) { o.answers++; if (e.ok) o.right++; }
    });
    return Object.keys(out).sort().map(function (k) { return out[k]; });
  }
  function calibration(reviews) {
    var o = { sureN: 0, sureRight: 0, unsureN: 0, unsureRight: 0, confidentMisses: 0 };
    (reviews || []).forEach(function (e) {
      if (e.m === "exam") return;
      if (e.sure) { o.sureN++; if (e.ok) o.sureRight++; else o.confidentMisses++; }
      else { o.unsureN++; if (e.ok) o.unsureRight++; }
    });
    return o;
  }
  /* Days studied in the current Monday-to-Sunday week (Philippine time). */
  function weekDays(reviews, now) {
    var today = dayNum(now == null ? Date.now() : now);
    var wd = new Date(today * DAY).getUTCDay(), monday = today - ((wd + 6) % 7);
    var days = [];
    for (var i = 0; i < 7; i++) days.push({ day: monday + i, studied: false, future: monday + i > today, today: monday + i === today });
    (reviews || []).forEach(function (e) { var d = dayNum(e.t) - monday; if (d >= 0 && d < 7) days[d].studied = true; });
    return days;
  }
  /* "On track" or "Not yet", from the last 30 days of answers. A rough guide, not a prediction. */
  function readiness(stats) {
    var reasons = [], wSum = 0, wAcc = 0, enough = true;
    SUBJECTS.forEach(function (s) {
      var o = stats[s.code];
      if (!o || o.recentN < 10) { enough = false; reasons.push("Answer at least 10 " + s.name + " questions in a month (" + (o ? o.recentN : 0) + " so far)."); return; }
      var acc = o.recentRight / o.recentN;
      wSum += s.weight; wAcc += acc * s.weight;
      if (acc < 0.6) reasons.push(s.name + " is at " + Math.round(acc * 100) + "%. Aim for 60% or more in every subject.");
    });
    var avg = wSum ? wAcc / wSum : null;
    if (avg != null && avg < 0.75) reasons.unshift("Your weighted average is " + Math.round(avg * 100) + "%. Aim for 75% or more.");
    return { onTrack: enough && reasons.length === 0, average: avg, enough: enough, reasons: reasons };
  }

  /* ---------- merging two devices' logs ---------- */
  function mergeReviews(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (e) { if (e && e.id && !seen[e.id]) { seen[e.id] = true; out.push(e); } });
    return sortLog(out);
  }
  /* Settings and other small records: the newer one wins, by its "at" time. */
  function mergeRecords(a, b) {
    var o = {};
    (a || []).concat(b || []).forEach(function (r) { if (!r || !r.id) return; var cur = o[r.id]; if (!cur || String(r.at || "") > String(cur.at || "")) o[r.id] = r; });
    return Object.keys(o).map(function (k) { return o[k]; });
  }

  return {
    DAY: DAY, SUBJECTS: SUBJECTS, SUBJECT: SUBJECT, FAST_MS: FAST_MS,
    dayNum: dayNum, dayStart: dayStart, isoDay: isoDay, parseDay: parseDay, daysLeft: daysLeft, gapCap: gapCap, phase: phase,
    rng: rng, shuffle: shuffle, uid: uid, hash: hash,
    topicIndex: topicIndex, topicOf: topicOf, imageItems: imageItems, buildBank: buildBank,
    buildCards: buildCards, mastered: mastered, ratingFor: ratingFor,
    pickNew: pickNew, spread: spread, todayPlan: todayPlan, pickQod: pickQod, todayQueue: todayQueue,
    practiceQueue: practiceQueue, learnQueue: learnQueue, drillQueue: drillQueue, examQueue: examQueue, examMinutes: examMinutes,
    subjectStats: subjectStats, topicStats: topicStats, calibration: calibration, weekDays: weekDays, readiness: readiness,
    mergeReviews: mergeReviews, mergeRecords: mergeRecords
  };
});
