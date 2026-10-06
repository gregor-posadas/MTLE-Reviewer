/* MTLE Reviewer: the site.
   Questions come from data/questions/*.json, data/images.json and data/morphology.json.
   Answers are kept on this device (assets/store.js) and, once apiUrl is set in assets/config.js,
   copied to a Google Sheet through the Apps Script web app (apps-script/Code.gs) so nothing is lost
   and the phone and laptop stay in step. Scheduling lives in assets/engine.js.
   Same design and building blocks as the Classes Hub. */
(function () {
  "use strict";

  var cfg = window.MT_CONFIG || {};
  var M = window.MTLE, DB = window.MTStore;
  var main = document.getElementById("main");
  var BUILD = "20261006051424";
  var LETTERS = "ABCDEFGH";
  var CODES = ["CC", "MP", "CM", "HE", "BB", "HL"];

  var DEFAULTS = {
    examDate: cfg.examDate || "2027-03-01", examDateConfirmed: !!cfg.examDateConfirmed,
    newPerDay: 15, sessionSize: 20, goalDays: 5,
    shortcuts: true, breaks: true, focusTip: true, myQuestions: false, showRefs: false, motion: "auto"
  };

  var state = {
    ready: false, files: {}, tos: null, topics: {}, images: null, morph: null,
    bank: { items: [], byId: {} }, reviews: [], cards: {}, settings: {}, flags: [], mine: [], visuals: [], vizById: {},
    qod: null, session: null, exam: null, lastSync: null, syncError: "", syncing: false,
    diag: null, removedPending: []
  };

  /* ---------- small helpers ---------- */
  var ls = {
    get: function (k) { try { return window.localStorage.getItem("mt." + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem("mt." + k, v); } catch (e) { /* private mode */ } },
    del: function (k) { try { window.localStorage.removeItem("mt." + k); } catch (e) { /* ignore */ } }
  };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Question text: **bold** for the one key finding, and 10^12 as a superscript. Nothing else is interpreted. */
  function fmt(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(\d)\^(-?\d+)/g, "$1<sup>$2</sup>");
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + "%" : "–"; }
  function newTab() { return '<span class="sr"> (opens in a new tab)</span>'; }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("is-on");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("is-on"); }, 3200);
  }
  function getJSON(url) {
    return fetch(url + "?v=" + BUILD, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Couldn't load " + url + " (" + r.status + ").");
      return r.json();
    });
  }
  var deviceId = ls.get("device") || ("dev-" + M.uid());
  ls.set("device", deviceId);

  /* ---------- dates, always in Philippine time ---------- */
  var TZ = "Asia/Manila";
  function fmtDate(d, opts) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, opts)).format(d); }
  function longToday() { return fmtDate(new Date(), { weekday: "long", month: "long", day: "numeric" }); }
  function fmtTime(d) { return fmtDate(d, { hour: "numeric", minute: "2-digit" }); }
  function dayLabel(n) { return fmtDate(new Date(M.dayStart(n) + 12 * 3600000), { weekday: "short", month: "short", day: "numeric" }); }
  function examLabel() {
    var n = M.parseDay(setting("examDate"));
    return isNaN(n) ? "not set" : fmtDate(new Date(n * M.DAY + 12 * 3600000), { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function today() { return M.dayNum(Date.now()); }
  function daysLeft() { return M.daysLeft(setting("examDate"), Date.now()); }
  function inDays(n) { return n <= 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"; }

  /* ---------- settings (kept per key with the time they changed, so two devices merge cleanly) ---------- */
  function setting(k) { var s = state.settings[k]; return s && s.v !== undefined && s.v !== null && s.v !== "" ? s.v : DEFAULTS[k]; }
  function setSetting(k, v) {
    state.settings[k] = { v: v, at: new Date().toISOString() };
    DB.set("settings", state.settings);
    if (k === "examDate" || k === "myQuestions") rebuild();
    if (k === "motion") applyMotion();
    syncSoon(3000);
  }

  /* ---------- motion (More > Settings > Animations) ----------
     "auto" follows the device's reduce-motion setting, "on" always animates, "off" never does. The result is one class on
     <html>, motion-on or motion-off, that every animation in styles.css keys off; motion driven from here asks motionOff().
     The choice is also kept in localStorage so the page head can set the class before the first paint. The no-anim class
     (tools/render-visuals.js) counts as off. */
  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function motionChoice() {
    var v = state.settings.motion ? setting("motion") : ls.get("motion");
    return v === "on" || v === "off" ? v : "auto";
  }
  function motionOff() { var c = document.documentElement.classList; return c.contains("motion-off") || c.contains("no-anim"); }
  function applyMotion() {
    var m = motionChoice(), off = m === "off" || (m === "auto" && !!(reduceQuery && reduceQuery.matches)), c = document.documentElement.classList;
    c.toggle("motion-off", off); c.toggle("motion-on", !off);
    ls.set("motion", m);
    if (off) {   // anything still waiting to fade in shows now
      if (revealIO) { revealIO.disconnect(); revealIO = null; }
      main.querySelectorAll(".rv").forEach(function (el) { el.classList.remove("rv", "rv-in"); });
      main.classList.remove("pg-in", "nav-in", "q-in", "is-checked-now");
    }
  }
  if (reduceQuery) {
    if (reduceQuery.addEventListener) reduceQuery.addEventListener("change", applyMotion);
    else if (reduceQuery.addListener) reduceQuery.addListener(applyMotion);
  }
  applyMotion();
  document.addEventListener("touchstart", function () {}, { passive: true });   // lets iOS Safari show :active (the press feedback)
  /* Scroll without the smooth scrolling that html gets when animations are on (page changes jump straight to the top) */
  function jumpScroll(x, y) {
    var r = document.documentElement;
    r.style.scrollBehavior = "auto"; window.scrollTo(x, y); r.style.scrollBehavior = "";
  }
  function jumpTo(el) {
    var r = document.documentElement;
    r.style.scrollBehavior = "auto"; el.scrollIntoView(); r.style.scrollBehavior = "";
  }

  /* ---------- shapes: colour always comes with a shape and a word ---------- */
  function shape(key, cls) {
    var s = '<svg class="' + (cls || "st__shape") + '" viewBox="0 0 18 18" aria-hidden="true" focusable="false">';
    if (key === "ok") s += '<circle cx="9" cy="9" r="8.5" fill="var(--ok)"/><path d="M5 9.4l2.6 2.6L13 6.6" fill="none" stroke="var(--paper)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    else if (key === "bad") s += '<circle cx="9" cy="9" r="8.5" fill="var(--bad)"/><path d="M6 6l6 6M12 6l-6 6" stroke="var(--paper)" stroke-width="2.4" stroke-linecap="round"/>';
    else if (key === "done") s += '<circle cx="9" cy="9" r="8.5" fill="var(--ink)"/><path d="M5 9.4l2.6 2.6L13 6.6" fill="none" stroke="var(--paper)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    else if (key === "unsure") s += '<circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--ink)" stroke-width="2.5"/><path d="M9 1.5a7.5 7.5 0 0 1 0 15z" fill="var(--ink)"/>';
    else if (key === "warn") s += '<path d="M9 1.2L17.2 16.4H0.8Z" fill="var(--bad)"/><path d="M9 6.5v4.6" stroke="var(--paper)" stroke-width="2.2" stroke-linecap="round"/><circle cx="9" cy="13.6" r="1.2" fill="var(--paper)"/>';
    else s += '<circle cx="9" cy="9" r="7.5" fill="none" stroke="var(--ink)" stroke-width="2.5"/>';
    return s + "</svg>";
  }
  function badge(key, word) { return '<span class="st">' + shape(key) + esc(word) + "</span>"; }

  /* ---------- the bank and the schedule ---------- */
  function rebuild() {
    state.bank = M.buildBank(state.files, state.images, state.morph, setting("myQuestions") ? state.mine : []);
    state.cards = M.buildCards(state.reviews, setting("examDate"));
  }
  function subjectName(code) { return (M.SUBJECT[code] || { name: code }).name; }
  function topicName(code) { var t = state.topics[code] || state.topics[M.topicOf(code)]; return t ? t.name : code; }
  function flaggedMap() { var o = {}; state.flags.forEach(function (f) { if (f.status !== "fixed" && !f.deleted) o[f.q] = true; }); return o; }

  function plan() {
    return M.todayPlan(state.bank, state.cards, state.reviews, { examDate: setting("examDate"), newPerDay: +setting("newPerDay"), topics: state.topics }, Date.now());
  }
  /* Question of the day: chosen once per day and kept, so it doesn't change when the page reloads. */
  function qodIds(p) {
    if (state.qod && state.qod.day === p.today) return state.qod.ids.filter(function (id) { return state.bank.byId[id]; });
    var ids = M.pickQod(p, p.today, 2);
    if (!ids.length) ids = M.pickNew(state.bank, state.cards, 2, state.topics, answeredToday()).map(function (q) { return q.id; });
    state.qod = { day: p.today, ids: ids };
    DB.set("qod", state.qod);
    return state.qod.ids;
  }
  function answeredToday() {
    var t = today(), o = {};
    state.reviews.forEach(function (e) { if (M.dayNum(e.t) === t) o[e.q] = e; });
    return o;
  }

  /* ---------- recording an answer ---------- */
  function record(q, chosen, ok, sure, mode, ms) {
    var e = { id: M.uid(), q: q.id, t: new Date().toISOString(), c: chosen, ok: ok ? 1 : 0, sure: sure ? 1 : 0, m: mode, ms: Math.max(0, Math.round(ms || 0)), d: deviceId, s: 0 };
    state.reviews.push(e);
    DB.addReviews([e]).catch(function () { toast("Couldn't save that answer on this device."); });
    state.cards = M.buildCards(state.reviews, setting("examDate"));
    if (state.reviews.length === 1) DB.persist();
    syncSoon(20000);
    return e;
  }

  /* ---------- talking to the Sheet (optional) ---------- */
  var busyCount = 0;
  function busy(on, msg) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    var bar = document.getElementById("busy"), txt = document.getElementById("busy-text");
    if (bar) bar.hidden = busyCount === 0;
    if (txt) txt.textContent = busyCount > 0 ? (msg || "Syncing") : "";
  }
  function apiPost(body, quiet) {
    body.code = ls.get("code") || "";
    if (!quiet) busy(true, "Syncing");
    return fetch(cfg.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!quiet) busy(false); if (!j.ok) { var e = new Error(j.error || "The Sheet said no."); e.code = j.code; throw e; } return j; },
        function (err) { if (!quiet) busy(false); throw err; });
  }
  function strip(e) { return { id: e.id, q: e.q, t: e.t, c: e.c, ok: e.ok, sure: e.sure, m: e.m, ms: e.ms, d: e.d }; }
  function settingsRecords() { return Object.keys(state.settings).map(function (k) { return { id: k, v: state.settings[k].v, at: state.settings[k].at }; }); }

  var syncTimer = null;
  function syncSoon(ms) {
    if (!cfg.apiUrl || !ls.get("code")) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { sync(true).catch(function () { /* shown in the footer */ }); }, ms || 0);
  }
  function sync(quiet) {
    if (!cfg.apiUrl) return Promise.resolve(false);
    if (state.syncing) return Promise.resolve(false);
    state.syncing = true;
    var out = state.reviews.filter(function (e) { return !e.s; }).map(strip);
    var removing = state.removedPending.slice();
    return apiPost({ action: "sync", reviews: out, removed: removing, flags: state.flags, mine: state.mine, settings: settingsRecords() }, quiet).then(function (j) {
      var d = j.data || {}, sent = {};
      out.forEach(function (e) { sent[e.id] = true; });
      var remote = (d.reviews || []).map(function (e) { e.s = 1; return e; });
      var local = state.reviews.map(function (e) { if (sent[e.id]) e.s = 1; return e; });
      var before = state.reviews.length;
      state.reviews = M.mergeReviews(local, remote);
      // Answers removed on any device (test runs) are dropped here too
      var gone = {}, dropped = [];
      (d.removed || []).concat(removing).forEach(function (id) { gone[id] = true; });
      state.reviews = state.reviews.filter(function (e) { if (gone[e.id]) { dropped.push(e.id); return false; } return true; });
      if (dropped.length) DB.deleteReviews(dropped);
      state.removedPending = state.removedPending.filter(function (id) { return removing.indexOf(id) < 0; });
      DB.set("removedPending", state.removedPending);
      state.flags = M.mergeRecords(state.flags, d.flags || []);
      var status = {};   // a flag's status (open or fixed) is set in the Sheet
      (d.flags || []).forEach(function (f) { status[f.id] = f.status; });
      state.flags.forEach(function (f) { if (status[f.id]) f.status = status[f.id]; });
      state.mine = M.mergeRecords(state.mine, d.mine || []);
      (d.settings || []).forEach(function (r) {
        var cur = state.settings[r.id];
        if (!cur || String(r.at || "") > String(cur.at || "")) state.settings[r.id] = { v: r.v, at: r.at };
      });
      applyMotion();
      state.lastSync = new Date(); state.syncError = ""; state.syncing = false;
      return Promise.all([DB.addReviews(state.reviews), DB.set("flags", state.flags), DB.set("mine", state.mine), DB.set("settings", state.settings), DB.set("lastSync", state.lastSync.toISOString())])
        .then(function () { rebuild(); showStatus(); return state.reviews.length !== before || dropped.length > 0; });
    }, function (err) {
      state.syncing = false;
      state.syncError = err.code === "code" ? "The access code was refused." : "Couldn't reach the Sheet. Answers are still saved on this device.";
      showStatus();
      throw err;
    });
  }
  /* Leaving the page: send anything not yet copied, without waiting for an answer. */
  function beacon() {
    if (!cfg.apiUrl || !ls.get("code") || !navigator.sendBeacon) return;
    var out = state.reviews.filter(function (e) { return !e.s; }).map(strip);
    if (!out.length) return;
    try { navigator.sendBeacon(cfg.apiUrl, new Blob([JSON.stringify({ action: "push", code: ls.get("code"), reviews: out })], { type: "text/plain;charset=utf-8" })); } catch (e) { /* next sync sends them */ }
  }

  function showStatus() {
    var fs = document.getElementById("foot-status"), n = document.getElementById("notice");
    var unsynced = state.reviews.filter(function (e) { return !e.s; }).length;
    if (!cfg.apiUrl) fs.textContent = "Answers are saved in this browser. " + plural(state.reviews.length, "answer") + " so far.";
    else if (state.lastSync) fs.textContent = "Saved on this device and in the Sheet. Last synced " + (M.dayNum(state.lastSync) === today() ? "today" : dayLabel(M.dayNum(state.lastSync))) + " at " + fmtTime(state.lastSync) + (unsynced ? ". " + plural(unsynced, "answer") + " waiting to sync." : ".");
    else fs.textContent = "Saved on this device. Not synced yet.";
    if (state.syncError && cfg.apiUrl) { n.innerHTML = "<p>" + badge("warn", "Sync") + " " + esc(state.syncError) + ' <a href="#/more/sync">Sync settings</a></p>'; n.hidden = false; }
    else { n.hidden = true; n.innerHTML = ""; }
  }

  /* ---------- loading ---------- */
  function loadData() {
    return Promise.all([getJSON("data/tos.json"), getJSON("data/images.json").catch(function () { return { images: [] }; }), getJSON("data/morphology.json").catch(function () { return null; })]
      .concat(CODES.map(function (c) { return getJSON("data/questions/" + c + ".json").catch(function () { return { subject: c, items: [] }; }); }))
      .concat(CODES.map(function (c) { return getJSON("data/visuals/" + c + ".json").catch(function () { return { visuals: [] }; }); })))
      .then(function (r) {
        state.tos = r[0]; state.topics = M.topicIndex(r[0]); state.images = r[1]; state.morph = r[2];
        CODES.forEach(function (c, i) { state.files[c] = r[3 + i]; });
        state.visuals = []; state.vizById = {};
        CODES.forEach(function (c, i) { (r[3 + CODES.length + i].visuals || []).forEach(function (v) { if (v && v.id && v.steps && v.steps.length) { state.visuals.push(v); state.vizById[v.id] = v; } }); });
      });
  }
  function loadLocal() {
    return Promise.all([DB.allReviews(), DB.get("settings"), DB.get("flags"), DB.get("mine"), DB.get("qod"), DB.get("lastSync"), DB.get("diag"), DB.get("removedPending")]).then(function (r) {
      state.diag = r[6] || null; state.removedPending = r[7] || [];
      state.reviews = M.mergeReviews(r[0] || [], []);
      state.settings = r[1] || {}; state.flags = r[2] || []; state.mine = r[3] || []; state.qod = r[4] || null;
      state.lastSync = r[5] ? new Date(r[5]) : null;
    });
  }
  function restoreRuns() {
    try { state.session = JSON.parse(ls.get("session") || "null"); } catch (e) { state.session = null; }
    try { state.exam = JSON.parse(ls.get("exam") || "null"); } catch (e) { state.exam = null; }
  }
  function saveSession() { if (state.session) ls.set("session", JSON.stringify(state.session)); else ls.del("session"); }
  function saveExam() { if (state.exam) ls.set("exam", JSON.stringify(state.exam)); else ls.del("exam"); }

  /* ================================================================== views */

  function head(title, sub, crumb) {
    return '<div class="head">' + (crumb ? '<a class="crumb" href="' + crumb[0] + '">' + esc(crumb[1]) + "</a>" : "") +
      '<h1 tabindex="-1">' + esc(title) + "</h1>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>";
  }
  function countdownText() {
    var left = daysLeft();
    if (isNaN(left)) return "Set your exam date under More.";
    var est = setting("examDateConfirmed") ? "" : " (estimate)";
    if (left < 0) return "The exam date " + esc(examLabel()) + " has passed. Set the next one under More.";
    return plural(left, "day") + " to the exam on " + esc(examLabel()) + est;
  }

  /* ---------- Today ---------- */
  function viewToday() {
    var p = plan(), ids = qodIds(p), done = answeredToday(), left = p.left, ph = M.phase(left);
    var qodLeft = ids.filter(function (id) { return !done[id]; });
    var queue = M.todayQueue(p, qodLeft, state.bank);
    var size = Math.min(+setting("sessionSize"), queue.length);
    var html = '<div class="wrap">' + head("Today", esc(longToday()) + " · " + countdownText());

    if (setting("focusTip")) html += '<p class="tip"><span>Studying on your phone? Turn on Do Not Disturb first, so nothing interrupts you.</span><button type="button" class="btn btn--quiet btn--sm" data-act="hide-tip">Got it, hide this</button></p>';
    if (ph.key === "exam") html += '<p class="tip"><span><b>Exam weeks.</b> ' + esc(ph.note) + ' <a href="#/more/calm">Two-minute exercises for exam nerves</a></span></p>';

    html += '<div class="today-grid"><div>';
    if (!state.diag) html += '<section class="qod qod--diag" aria-labelledby="diag-h"><p class="qod__label">Start here</p><h2 class="qod__title" id="diag-h">A 15-minute diagnostic</h2>' +
      "<p>18 questions, 3 from each subject. It shows where you stand and starts your review schedule.</p>" +
      '<div class="actions" style="margin-top:4px"><a class="btn btn--solid" href="#/diagnostic">Take the diagnostic</a><button type="button" class="btn btn--quiet" data-act="diag-skip">Skip it</button></div></section><div style="height:24px"></div>';
    // Question of the day
    html += '<section class="qod" aria-labelledby="qod-h"><p class="qod__label">Question of the day</p>';
    if (!ids.length) {
      html += '<h2 class="qod__title" id="qod-h">Nothing left to ask</h2><p>You\'ve seen every question in the bank and nothing is due. New questions will show up here when they\'re added.</p>';
    } else if (!qodLeft.length) {
      html += '<h2 class="qod__title" id="qod-h">' + shape("done", "verdict__shape") + " Done for today</h2><p>Tomorrow brings a new one.</p>";
    } else {
      html += '<h2 class="qod__title" id="qod-h">' + (qodLeft.length === ids.length ? plural(ids.length, "question") : plural(qodLeft.length, "question") + " left") + "</h2>";
    }
    if (ids.length) {
      html += '<ul class="qod__list">' + ids.map(function (id) {
        var q = state.bank.byId[id], e = done[id];
        var st = e ? (e.ok ? badge("ok", "Correct") : badge("bad", "Missed")) : badge("todo", "Not answered");
        return "<li>" + st + "<span>" + esc(subjectName(q.subject)) + "</span></li>";
      }).join("") + "</ul>";
      if (qodLeft.length) html += '<div><button type="button" class="btn btn--solid" data-act="start-qod">Answer ' + (qodLeft.length === 1 ? "it" : "them") + " now</button></div>";
    }
    html += "</section>";

    // The session
    html += '<section class="section" aria-labelledby="sess-h" style="padding-top:32px"><h2 id="sess-h">Today\'s session</h2>' +
      '<div class="plan" style="margin-top:16px"><div><b>' + p.due.length + "</b><span>" + (p.due.length === 1 ? "review due" : "reviews due") + "</span></div>" +
      "<div><b>" + p.fresh.length + "</b><span>" + (p.fresh.length === 1 ? "new question" : "new questions") + "</span></div>" +
      "<div><b>" + p.doneToday + "</b><span>answered today</span></div></div>";
    if (queue.length) {
      html += "<p class=\"muted\">One question at a time. " + (queue.length > size ? "This round has " + size + " of the " + queue.length + " waiting today." : "That's everything for today.") + "</p>" +
        '<div class="actions"><button type="button" class="btn btn--solid" data-act="start-today">Start ' + (p.doneToday ? "another round" : "today's session") + " (" + size + ")</button></div>";
    } else {
      html += '<p class="lead" style="margin-top:8px">' + shape("done") + " You're done for today.</p><p class=\"muted\">Nothing else is due. Rest, or try some <a href=\"#/practice\">extra practice</a>.</p>";
    }
    if (p.left <= 14 && p.left > 0) html += '<p class="section__note">No new questions in the last 2 weeks, only reviews.</p>';
    else if (!p.fresh.length && p.newCap > 0) html += '<p class="section__note">Every question in the bank has been introduced. New ones appear as they\'re added.</p>';
    html += "</section></div>";

    // Side: progress bars, week goal and phase
    html += '<div>' + todayProgress();
    var wk = M.weekDays(state.reviews, Date.now()), studied = wk.filter(function (d) { return d.studied; }).length, goal = +setting("goalDays");
    html += '<section class="section" aria-labelledby="week-h"><h2 id="week-h">This week</h2><p style="margin-top:12px"><b>' + studied + " of " + goal + " days</b>" + (studied >= goal ? " · goal met" : "") + "</p>" +
      '<ul class="week" aria-label="Days studied this week">' + wk.map(function (d) {
        var name = fmtDate(new Date(M.dayStart(d.day) + 12 * 3600000), { weekday: "short" });
        return '<li class="' + (d.studied ? "is-on" : "") + (d.future ? " is-future" : "") + (d.today ? " is-today" : "") + '"><i aria-hidden="true"></i><span>' + esc(name.charAt(0)) + '</span><span class="sr">' + esc(name) + ": " + (d.studied ? "studied" : d.future ? "coming up" : "not studied") + "</span></li>";
      }).join("") + "</ul><p class=\"section__note\">Rest days are part of the plan. The goal is a number of days, not a streak.</p></section>" +
      '<section class="section" aria-labelledby="phase-h"><h2 id="phase-h">Phase: ' + esc(ph.name) + "</h2>" + phaseLine() + "<p style=\"margin-top:12px\" class=\"muted\">" + esc(ph.note) + "</p></section></div>";
    html += "</div></div>";
    return html;
  }

  /* ---------- sessions: one question per screen ---------- */
  function startSession(mode, list, title, back, replace, intro) {
    if (!list.length) { toast("No questions match that."); return; }
    state.session = {
      mode: mode, title: title, back: back || "#/", ids: list.map(function (q) { return q.id; }),
      orders: {}, i: 0, picked: null, reveal: null, answers: [], started: Date.now(), lastBreak: Date.now(), shownAt: 0,
      stage: mode === "math" ? "worked" : "ask", pause: false,
      intro: (intro || []).map(function (v) { return v.id; }), introI: 0
    };
    list.forEach(function (q) { state.session.orders[q.id] = M.shuffle(q.options.map(function (_, i) { return i; }), Math.random); });
    saveSession();
    if (location.hash === "#/s") route(); else if (replace) location.replace("#/s"); else location.hash = "#/s";
  }
  function currentQ() { var s = state.session; return s ? state.bank.byId[s.ids[s.i]] : null; }

  function metaLine(q) {
    var bits = ["<span>" + esc(subjectName(q.subject)) + "</span>", "<span>" + esc(topicName(q.tos)) + "</span>"];
    if (q.difficulty) bits.push("<span>" + esc(q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)) + "</span>");
    if (q.mine) bits.push('<span class="tag tag--quiet">My question</span>');
    else if (!q.reviewed) bits.push('<span class="tag tag--quiet" title="Written for this site and not yet checked by a licensed RMT">Unreviewed draft</span>');
    return '<p class="quiz__meta">' + bits.join("") + "</p>";
  }
  function figure(q, revealed) {
    if (!q.image) return "";
    var im = q.image;
    // Both captions share one grid cell and the hidden one keeps its space, so checking the answer (which shows the
    // longer caption) never pushes the options down.
    var after = "<span>" + esc(im.what) + (im.detail ? " · " + esc(im.detail) : "") + '</span><span>Image: <a href="' + esc(im.page || im.src) + '" target="_blank" rel="noopener">' + esc(im.credit || "Source") + newTab() + "</a> (" + esc(im.license || "") + ")</span>";
    var before = "<span>" + esc(im.specimen || "Microscope image") + "</span><span>Image: " + esc(im.credit || "") + "</span>";
    var cap = '<span class="specimen__cap' + (revealed ? "" : " is-off") + '">' + after + '</span><span class="specimen__cap' + (revealed ? " is-off" : "") + '">' + before + "</span>";
    return '<figure class="specimen"><button type="button" data-act="zoom" aria-label="Open the image larger"><img src="' + esc(im.src) + '" alt="Microscope image: ' + esc(im.specimen || "specimen") + '" loading="eager" decoding="async" onerror="this.closest(\'figure\').classList.add(\'specimen--broken\');this.replaceWith(document.createTextNode(\'The image did not load. Check your connection; the question still counts if you skip it.\'))"></button><figcaption>' + cap + "</figcaption></figure>";
  }
  function optionRows(q, order, picked, reveal, readOnly) {
    return '<ol class="opts">' + order.map(function (orig, di) {
      var letter = LETTERS.charAt(di), cls = "opt", st = "", why = "";
      if (reveal) {
        if (orig === q.answer) { cls += " is-right"; st = shape("ok") + '<span class="sr">' + (reveal.chosen === orig ? "Your answer, correct" : "Correct answer") + "</span>"; }
        else if (orig === reveal.chosen) { cls += " is-wrong"; st = shape("bad") + '<span class="sr">Your answer, incorrect</span>'; }
        else cls += " is-dim";
      }
      return '<li><button type="button" class="' + cls + '" data-act="pick" data-i="' + di + '" aria-pressed="' + (picked === di && !reveal ? "true" : "false") + '"' + (reveal || readOnly ? " disabled" : "") + ">" +
        '<span class="opt__key" aria-hidden="true">' + letter + '</span><span><span class="sr">' + letter + ". </span>" + fmt(q.options[orig]) + "</span>" +
        '<span class="opt__state">' + st + "</span></button>" + why + "</li>";
    }).join("") + "</ol>";
  }
  /* The explanation panel: beside the question on a laptop, below the options on a phone.
     The options never move when it appears; only their highlight changes. */
  function explainPanel(q, order, reveal, mode, opts) {
    opts = opts || {};
    var right = order.indexOf(q.answer), html = opts.verdict === false ? "" : verdictHtml(q, reveal, mode);
    html += '<section class="xp" aria-label="Explanation"><h2 class="xp__h"><span class="xp__key xp__key--ok" aria-hidden="true">' + LETTERS.charAt(right) + "</span>Why " + LETTERS.charAt(right) + " is right</h2>" +
      '<p class="xp__p">' + fmt(q.why) + "</p>";
    var others = order.map(function (orig, di) { return { orig: orig, di: di }; }).filter(function (x) { return x.orig !== q.answer; });
    others.sort(function (a, b) { return (b.orig === reveal.chosen) - (a.orig === reveal.chosen); });   // her wrong choice first
    var items = others.map(function (x) {
      var t = q.whyNot && (q.whyNot[x.orig] || q.whyNot[String(x.orig)]);
      if (!t) return "";
      var mine = x.orig === reveal.chosen;
      return '<li class="' + (mine ? "is-mine" : "") + '"><span class="xp__key' + (mine ? " xp__key--bad" : "") + '" aria-hidden="true">' + LETTERS.charAt(x.di) + '</span><p><span class="sr">Option ' + LETTERS.charAt(x.di) + ". </span>" + (mine ? "<b>Your answer.</b> " : "") + fmt(t) + "</p></li>";
    }).join("");
    if (items) html += '<h2 class="xp__h">Why the others are wrong</h2><ul class="xp__list">' + items + "</ul>";
    html += "</section>" + relatedVizHtml(q);
    if (setting("showRefs") && q.ref) html += '<p class="ref">Reference: ' + esc(q.ref) + "</p>";
    html += '<p class="xp__flag"><button type="button" class="btn btn--quiet btn--sm" data-act="flag" data-q="' + esc(q.id) + '">Flag a problem with this question</button></p>';
    return html;
  }
  function kbd(k) { return setting("shortcuts") ? '<span class="kbd" aria-hidden="true">' + k + "</span>" : ""; }

  function viewSession() {
    var s = state.session;
    if (!s) return null;
    if (s.i >= s.ids.length) return viewDone();
    var q = currentQ();
    if (!q) { s.i++; saveSession(); return viewSession(); }
    var n = s.ids.length, top = '<div class="quiz__top"><span class="quiz__count">' + esc(s.title) + " · " + (s.i + 1) + " of " + n + '</span><button type="button" class="btn btn--quiet btn--sm" data-act="end">End session</button>' +
      '<div class="quiz__bar" aria-hidden="true"><i class="seg" style="width:' + Math.round(Math.max(0, s.i - 1) / n * 100) + '%" data-w="' + (s.i / n * 100).toFixed(1) + '"></i></div></div>';

    if (s.pause) {
      return '<div class="wrap"><div class="quiz">' + top + '<div class="pause"><h1 tabindex="-1">Time for a 5-minute break</h1><p>You\'ve studied for 25 minutes. Stand up, look at something far away, get some water. Short fixed breaks keep focus up for longer.</p>' +
        '<div class="actions"><button type="button" class="btn btn--solid" data-act="resume">Continue studying</button><button type="button" class="btn" data-act="end">Stop for now</button></div></div></div></div>';
    }
    if (s.intro && s.introI < s.intro.length && state.vizById[s.intro[s.introI]]) {
      var iv = state.vizById[s.intro[s.introI]], last = s.introI + 1 >= s.intro.length;
      return '<div class="wrap"><div class="quiz">' + top + '<p class="quiz__meta">Before the questions: ' + (s.intro.length > 1 ? "picture " + (s.introI + 1) + " of " + s.intro.length : "a picture of the topic") + "</p>" +
        '<h1 class="stem" tabindex="-1">' + esc(iv.title) + "</h1>" + vizHtml(iv, { title: false }) +
        '<div class="nextbar"><button type="button" class="btn btn--quiet btn--sm" data-act="intro-skip">Skip to the questions</button><button type="button" class="btn btn--solid" data-act="intro-next">' + (last ? "Start the questions" : "Next picture") + "</button></div></div></div>";
    }
    if (s.stage === "worked" && q.worked) {
      var w = q.worked;
      return '<div class="wrap"><div class="quiz">' + top + metaLine(q) + '<div class="worked"><h1 tabindex="-1" class="stem" style="margin:0 0 8px">Worked example</h1><p>' + fmt(w.problem) + "</p><ol>" +
        (w.steps || []).map(function (x) { return "<li>" + fmt(x) + "</li>"; }).join("") + '</ol><p class="worked__result">' + fmt(w.result) + "</p></div>" +
        '<div class="nextbar"><span class="muted small">Read it through, then try a similar one.</span><button type="button" class="btn btn--solid" data-act="try">Now try one' + kbd("Enter") + "</button></div></div></div>";
    }
    if (!s.shownAt) { s.shownAt = Date.now(); }
    var order = s.orders[q.id] || q.options.map(function (_, i) { return i; });
    var html = '<div class="wrap"><div class="quiz quiz--split">' + top + '<div class="qgrid"><div class="qmain">' + metaLine(q) + '<h1 class="stem" tabindex="-1">' + fmt(q.stem) + "</h1>" + figure(q, !!s.reveal) +
      optionRows(q, order, s.picked, s.reveal, false);
    if (!s.reveal) {
      var dis = s.picked == null ? " disabled" : "";
      html += '<div class="checkbar"><button type="button" class="btn btn--solid" data-act="check" data-sure="1"' + dis + ">Check" + kbd("S") + "<small>I'm sure</small></button>" +
        '<button type="button" class="btn" data-act="check" data-sure="0"' + dis + ">Check" + kbd("N") + "<small>Not sure</small></button></div>" +
        '<p class="section__note"><span class="pick-hint"' + (s.picked == null ? "" : " hidden") + ">Choose an answer, then say how sure you are. </span>" + '<button type="button" class="btn btn--quiet btn--sm" data-act="dunno">I don\'t know</button></p>';
      if (s.mode === "drill") html += '<p class="section__note">Answer quickly: an image counts as learned after 2 correct answers in under 10 seconds.</p>';
      html += '</div><aside class="qside qside--empty" aria-hidden="true"><p>The answer and the explanation appear here after you check.</p></aside></div>';
    } else {
      html += '<div class="nextbar"><button type="button" class="btn btn--sm xp-jump" data-act="xp-jump">See why ↓</button>' +
        '<button type="button" class="btn btn--solid" data-act="next" id="next-btn">' + (s.i + 1 >= n ? "Finish" : "Next question") + kbd("Enter") + "</button></div></div>" +
        '<aside class="qside" id="xp">' + explainPanel(q, order, s.reveal, s.mode) + "</aside></div>";
    }
    return html + "</div></div>";
  }
  function verdictHtml(q, r, mode) {
    var card = state.cards[q.id], nextTxt = "";
    if (card) nextTxt = "It comes back " + inDays(card.dueDay - today()) + ".";
    var secs = r.ms ? Math.round(r.ms / 1000) : 0;
    if (r.ok) {
      var extra = mode === "drill" ? (r.ms < M.FAST_MS ? "Fluent: " + secs + " seconds. " : "Right, but it took " + secs + " seconds. Speed comes with repeats. ") : (r.sure ? "" : "You weren't sure, so it comes back sooner. ");
      return '<div class="verdict verdict--ok" role="status"><span class="verdict__word">' + shape("ok", "verdict__shape") + "Correct</span><p>" + esc(extra + nextTxt) + "</p></div>";
    }
    var msg = r.chosen === -1 ? "No problem. Read why, then it comes back soon. " : r.sure ? "A confident miss. These are the ones feedback fixes best. " : "";
    return '<div class="verdict verdict--bad" role="status"><span class="verdict__word">' + shape("bad", "verdict__shape") + (r.chosen === -1 ? "Not answered" : "Incorrect") + "</span><p>" + esc(msg + nextTxt) + "</p></div>";
  }

  function check(sure, dunno) {
    var s = state.session, q = currentQ();
    if (!s || !q || s.reveal) return;
    if (!dunno && s.picked == null) return;
    var order = s.orders[q.id], chosen = dunno ? -1 : order[s.picked], ok = chosen === q.answer;
    var ms = Date.now() - (s.shownAt || Date.now());
    record(q, chosen, ok, !!sure && !dunno, s.mode, ms);
    s.reveal = { chosen: chosen, ok: ok, sure: !!sure && !dunno, ms: ms };
    s.answers.push({ q: q.id, ok: ok, chosen: chosen, sure: !!sure && !dunno });
    saveSession(); route._checked = true; refresh();
    var nb = document.getElementById("next-btn"); if (nb) nb.focus({ preventScroll: true });
  }
  /* Choosing an option updates the buttons in place (no re-render), so the selected state can ease in and focus stays put */
  function showPick() {
    var s = state.session, opts = main.querySelectorAll('.opts [data-act="pick"]');
    if (!s || !opts.length) { refresh(); return; }
    opts.forEach(function (b) { b.setAttribute("aria-pressed", s.picked === +b.getAttribute("data-i") ? "true" : "false"); });
    main.querySelectorAll('[data-act="check"]').forEach(function (b) { b.disabled = s.picked == null; });
    var hint = main.querySelector(".pick-hint"); if (hint) hint.hidden = s.picked != null;
  }
  function next() {
    var s = state.session; if (!s || !s.reveal) return;
    s.i++; s.picked = null; s.reveal = null; s.shownAt = 0;
    var nq = currentQ(); s.stage = s.mode === "math" && nq && nq.worked ? "worked" : "ask";
    if (setting("breaks") && s.i < s.ids.length && Date.now() - s.lastBreak > 25 * 60000) s.pause = true;
    saveSession(); route._moved = true; route();
    if (s.i >= s.ids.length) syncSoon(0);
  }

  function viewDone() {
    var s = state.session, right = s.answers.filter(function (a) { return a.ok; }).length, n = s.answers.length;
    var misses = s.answers.filter(function (a) { return !a.ok; });
    var p = plan(), more = M.todayQueue(p, [], state.bank).length;
    var tomorrow = state.bank.items.filter(function (q) { var c = state.cards[q.id]; return c && c.dueDay === today() + 1; }).length;
    if (s.mode === "diag") return viewDiagResult(s);
    var html = '<div class="wrap"><div class="quiz">' + head(n ? "Done: " + right + " of " + n + " correct" : "Session ended", esc(s.title) + (n ? " · " + pct(right, n) + " right" : ""));
    if (n) html += scoreBar(right, n) + '<div style="height:16px"></div>';
    if (misses.length) {
      html += '<section class="section"><h2>Look again at what you missed</h2><ul class="result-list">' + misses.map(function (a) {
        var q = state.bank.byId[a.q]; if (!q) return "";
        return '<li><a href="#/q/' + esc(q.id) + '">' + shape("bad") + '<span><span class="result-list__t">' + fmt(q.stem.length > 140 ? q.stem.slice(0, 137) + "…" : q.stem) + "</span><small>" + esc(subjectName(q.subject)) + " · " + esc(topicName(q.tos)) + "</small></span></a></li>";
      }).join("") + "</ul></section>";
    }
    html += '<section class="section"><h2>Next</h2><p style="margin-top:12px">' + (tomorrow ? plural(tomorrow, "review") + " due tomorrow." : "Nothing due tomorrow yet.") + "</p>";
    if (s.mode === "today" && more) html += '<p class="muted">' + plural(more, "question") + ' still waiting today.</p><div class="actions"><button type="button" class="btn btn--solid" data-act="start-today">Start another round</button><a class="btn" href="#/">Back to Today</a></div>';
    else html += '<div class="actions"><a class="btn btn--solid" href="' + esc(s.back || "#/") + '">' + (s.back === "#/practice" ? "Back to Practice" : "Back to Today") + "</a></div>";
    html += "</section></div></div>";
    return html;
  }

  /* A single question, answer shown (from lists of misses or flags) */
  function viewQuestion(id) {
    var q = state.bank.byId[id];
    if (!q) return '<div class="wrap">' + head("Question not found", "It may have been removed or renamed.", ["#/", "Today"]) + "</div>";
    var hist = state.reviews.filter(function (e) { return e.q === id; }), card = state.cards[id];
    var last = hist[hist.length - 1];
    var info = hist.length ? "Answered " + plural(hist.length, "time") + ", " + hist.filter(function (e) { return e.ok; }).length + " correct." + (card ? " Next review " + inDays(card.dueDay - today()) + "." : "") : "Not answered yet.";
    var order = q.options.map(function (_, i) { return i; }), rv = { chosen: last && !last.ok ? last.c : q.answer };
    return '<div class="wrap"><div class="quiz quiz--split"><a class="crumb" href="javascript:history.back()">Back</a><div class="qgrid"><div class="qmain">' + metaLine(q) + '<h1 class="stem" tabindex="-1">' + fmt(q.stem) + "</h1>" + figure(q, true) +
      optionRows(q, order, null, rv, true) + '<p class="section__note">' + esc(info) + (last && !last.ok ? " Your last answer is marked." : "") + "</p></div>" +
      '<aside class="qside">' + explainPanel(q, order, rv, "review", { verdict: false }) + "</aside></div></div></div>";
  }

  /* ---------- Practice ---------- */
  function subjectChips(name) {
    return '<fieldset class="chips"><legend>Subjects</legend>' + M.SUBJECTS.map(function (s) {
      return '<label class="chip-check"><input type="checkbox" name="' + name + '" value="' + s.code + '" checked><span>' + esc(s.short) + "</span></label>";
    }).join("") + "</fieldset>";
  }
  function sizeSelect(id, def) {
    return '<div class="field"><label for="' + id + '">How many</label><select id="' + id + '" name="size">' + [10, 20, 40].map(function (n) { return "<option" + (n === def ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></div>";
  }
  function viewPractice() {
    var groups = (state.morph && state.morph.groups) || [], mathN = state.bank.items.filter(function (q) { return q.type === "math"; }).length;
    var imgN = state.bank.items.filter(function (q) { return q.type === "image"; }).length;
    var html = '<div class="wrap">' + head("Practice", "Extra practice on top of today's session. Every answer here also counts toward your schedule.") + '<div class="modes">';
    html += '<section class="mode"><h2>Mixed practice</h2><p>Questions from several subjects, mixed together. Mixing topics is harder in the moment and better for the exam.</p><form data-form="mixed">' + subjectChips("subj") +
      '<div class="two"><div class="field"><label for="src">Which questions</label><select id="src" name="source"><option value="all">Weakest first</option><option value="weak">Not yet mastered</option><option value="missed">Missed last time</option><option value="unseen">Never seen</option><option value="flagged">Flagged by you</option></select></div>' + sizeSelect("msize", 20) + "</div>" +
      '<label class="toggle"><input type="checkbox" name="images"> Include image questions</label><div><button class="btn btn--solid" type="submit">Start mixed practice</button></div></form></section>';
    html += '<section class="mode"><h2>Learn a topic</h2><p>One topic at a time, easier questions first. Good for a first pass before mixing.</p><ul class="topic-list">' + M.SUBJECTS.map(function (s) {
      var n = state.bank.items.filter(function (q) { return q.subject === s.code && q.type !== "image"; }).length;
      return '<li><a href="#/learn/' + s.code + '"><b>' + esc(s.name) + "</b><small>" + plural(n, "question") + "</small></a></li>";
    }).join("") + "</ul></section>";
    html += '<section class="mode"><h2>Image drill</h2><p>Identify parasites from CDC images, look-alikes mixed together. ' + plural(imgN, "image") + ".</p><form data-form=\"drill\">" +
      '<fieldset class="chips"><legend>Groups</legend>' + groups.map(function (g, i) { return '<label class="chip-check"><input type="checkbox" name="grp" value="' + esc(g.name) + '" checked><span>' + esc(g.name) + "</span></label>"; }).join("") + "</fieldset>" +
      sizeSelect("dsize", 20) + '<div><button class="btn btn--solid" type="submit">Start image drill</button></div></form></section>';
    if (state.visuals.length) html += '<section class="mode"><h2>Visual explainers</h2><p>' + plural(state.visuals.length, "diagram") + ' you step through at your own pace: pathways, cascades, life cycles, procedures. They also open before the questions in Learn a topic.</p><div><a class="btn btn--solid" href="#/visuals">Browse the diagrams</a></div></section>';
    html += '<section class="mode"><h2>Lab math</h2><p>For each calculation, a worked example first, then a similar problem to solve. ' + plural(mathN, "problem") + '.</p><div><button type="button" class="btn btn--solid" data-act="start-math">Start lab math</button></div></section>';
    html += '<section class="mode"><h2>Mock exam</h2><p>Paper-style: a question booklet and a separate answer sheet, timed, with no feedback until you hand it in.</p><div><a class="btn btn--solid" href="#/exam">Set up a mock exam</a></div></section>';
    html += "</div></div>";
    return html;
  }
  function viewLearn(code) {
    var s = M.SUBJECT[code];
    if (!s) return viewPractice();
    var tp = state.tos.subjects.filter(function (x) { return x.code === code; })[0] || { topics: [] };
    var html = '<div class="wrap">' + head("Learn: " + s.name, "Pick a topic. Numbers show the exam's item count for the topic and how many questions the bank has.", ["#/practice", "Practice"]);
    html += '<ul class="topic-list" style="max-width:var(--read)">' + tp.topics.map(function (t) {
      var list = M.learnQueue(state.bank, t.code), seen = list.filter(function (q) { return state.cards[q.id]; }).length;
      return "<li>" + (list.length ? '<a href="#/learn/' + code + "/" + esc(t.code) + '" data-act="learn-topic" data-s="' + code + '" data-t="' + esc(t.code) + '">' : '<a aria-disabled="true">') + "<b>" + esc(t.name) + "</b><small>" + t.items + " exam items · " + (list.length ? list.length + " in bank, " + seen + " seen" : "none in bank yet") + "</small></a></li>";
    }).join("") + "</ul></div>";
    return html;
  }

  /* ---------- Paper-style mock exam ---------- */
  function viewExamSetup() {
    if (state.exam && !state.exam.done) return '<div class="wrap">' + head("Mock exam in progress", "You have a mock exam that isn't handed in yet.", ["#/practice", "Practice"]) + '<div class="actions"><a class="btn btn--solid" href="#/exam/run">Go back to it</a><button type="button" class="btn btn--danger" data-act="exam-discard">Discard it</button></div></div>';
    var opts = M.SUBJECTS.map(function (s) {
      var n = state.bank.items.filter(function (q) { return q.subject === s.code && q.type !== "image"; }).length;
      return '<label class="check"><input type="radio" name="which" value="' + s.code + '"' + (s.code === "CC" ? " checked" : "") + "> " + esc(s.name) + " · " + Math.min(n, 100) + " questions, " + M.examMinutes(Math.min(n, 100)) + " minutes</label>";
    });
    var d1 = ["CC", "MP", "CM"], d2 = ["HE", "BB", "HL"];
    function cnt(list) { return list.reduce(function (a, c) { return a + Math.min(100, state.bank.items.filter(function (q) { return q.subject === c && q.type !== "image"; }).length); }, 0); }
    opts.push('<label class="check"><input type="radio" name="which" value="D1"> Day 1: Clinical Chemistry, Micro/Para, Clinical Microscopy · ' + cnt(d1) + " questions, " + M.examMinutes(cnt(d1)) + " minutes</label>");
    opts.push('<label class="check"><input type="radio" name="which" value="D2"> Day 2: Hematology, Blood Banking, Histopath/Laws · ' + cnt(d2) + " questions, " + M.examMinutes(cnt(d2)) + " minutes</label>");
    return '<div class="wrap">' + head("Mock exam", "Like the real MTLE: a booklet of questions and a separate answer sheet to shade. The real exam has 100 questions per subject in 2 hours, so the timer here gives 1.2 minutes per question.", ["#/practice", "Practice"]) +
      '<form class="stack" data-form="exam"><fieldset class="checks"><legend>What to take</legend>' + opts.join("") + "</fieldset>" +
      '<p class="muted small">The bank is smaller than the real exam for now, so a mock uses every question for that subject. On a phone, the answer row for the question you\'re reading sits at the bottom of the screen. A laptop shows the whole answer sheet beside the booklet.</p>' +
      '<div><button class="btn btn--solid" type="submit">Start the mock exam</button></div></form></div>';
  }
  function startExam(which) {
    var subs = which === "D1" ? ["CC", "MP", "CM"] : which === "D2" ? ["HE", "BB", "HL"] : [which];
    var list = M.examQueue(state.bank, subs, Date.now());
    if (!list.length) { toast("No questions for that yet."); return; }
    var orders = {};
    list.forEach(function (q) { orders[q.id] = M.shuffle(q.options.map(function (_, i) { return i; }), Math.random); });
    state.exam = { which: which, subjects: subs, ids: list.map(function (q) { return q.id; }), orders: orders, answers: {}, marks: {}, started: Date.now(), minutes: M.examMinutes(list.length), done: false };
    saveExam(); location.hash = "#/exam/run";
  }
  function examRemaining() { var x = state.exam; return x ? Math.max(0, x.started + x.minutes * 60000 - Date.now()) : 0; }
  function clock(ms) { var t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  function sheetRow(i, compact) {
    var x = state.exam, id = x.ids[i], q = state.bank.byId[id], k = q.options.length, a = x.answers[id];
    var b = "";
    for (var j = 0; j < k; j++) b += '<button type="button" class="bubble" data-act="bubble" data-n="' + i + '" data-k="' + j + '" aria-pressed="' + (a === j ? "true" : "false") + '" aria-label="Question ' + (i + 1) + ", answer " + LETTERS.charAt(j) + '">' + LETTERS.charAt(j) + "</button>";
    return '<li class="sheet__row" data-row="' + i + '"><span>' + (i + 1) + "</span>" + b + '<button type="button" class="mark" data-act="mark" data-n="' + i + '" aria-pressed="' + (x.marks[id] ? "true" : "false") + '" aria-label="Mark question ' + (i + 1) + ' to come back to" title="Mark to come back to">?</button></li>';
  }
  function viewExamRun() {
    var x = state.exam;
    if (!x || x.done) { location.hash = x && x.done ? "#/exam/result" : "#/exam"; return ""; }
    var answered = Object.keys(x.answers).length;
    var html = '<div class="exambar"><div class="exambar__in"><span><b>Mock exam</b> · <span id="exam-count">' + answered + " of " + x.ids.length + ' answered</span></span><span class="exambar__time" id="exam-time" role="timer" aria-label="Time left">' + clock(examRemaining()) + '</span><button type="button" class="btn btn--sm" data-act="exam-submit">Hand in</button></div></div>';
    html += '<div class="wrap"><h1 class="sr" tabindex="-1">Mock exam booklet</h1><div class="paper"><ol class="booklet">' + x.ids.map(function (id, i) {
      var q = state.bank.byId[id], order = x.orders[id];
      if (!q) return "";
      return '<li id="bq-' + i + '" data-bq="' + i + '"><p><span class="booklet__n">' + (i + 1) + ".</span>" + fmt(q.stem) + "</p><ol>" + order.map(function (orig, j) { return "<li><b>" + LETTERS.charAt(j) + ".</b><span>" + fmt(q.options[orig]) + "</span></li>"; }).join("") + "</ol></li>";
    }).join("") + "</ol>";
    html += '<aside class="sheet" id="sheet" aria-label="Answer sheet"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2>Answer sheet</h2><button type="button" class="btn btn--sm" data-act="sheet-close" id="sheet-close">Close</button></div><p class="muted small">Shade one letter per number. "?" marks a question to come back to.</p><ol class="sheet__rows">' +
      x.ids.map(function (_, i) { return sheetRow(i); }).join("") + "</ol></aside></div></div>";
    html += '<div class="dock" id="dock"><div class="dock__in"><ol class="sheet__rows" id="dock-row" style="margin:0">' + sheetRow(0) + '</ol><button type="button" class="btn btn--sm" data-act="sheet-open">Whole sheet</button></div></div>';
    return html;
  }
  var examTick = null, examIO = null;
  function wireExam() {
    clearInterval(examTick);
    if (examIO) { examIO.disconnect(); examIO = null; }
    if (!state.exam || state.exam.done || location.hash !== "#/exam/run") return;
    examTick = setInterval(function () {
      var el = document.getElementById("exam-time");
      if (!el || !state.exam) { clearInterval(examTick); return; }
      var r = examRemaining(); el.textContent = clock(r);
      if (r <= 0) { clearInterval(examTick); finishExam(true); }
    }, 1000);
    var sc = document.getElementById("sheet-close"); if (sc && window.matchMedia("(min-width: 960px)").matches) sc.hidden = true;
    if ("IntersectionObserver" in window) {
      examIO = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = +e.target.getAttribute("data-bq"), dock = document.getElementById("dock-row");
          if (dock && dock.firstChild && +dock.firstChild.getAttribute("data-row") !== i) dock.innerHTML = sheetRow(i);
          document.querySelectorAll(".sheet .sheet__row").forEach(function (r) { r.classList.toggle("is-current", +r.getAttribute("data-row") === i); });
        });
      }, { rootMargin: "-30% 0px -60% 0px" });
      document.querySelectorAll("[data-bq]").forEach(function (el) { examIO.observe(el); });
    }
  }
  function shadeBubble(i, k) {
    var x = state.exam, id = x.ids[i];
    if (x.answers[id] === k) delete x.answers[id]; else x.answers[id] = k;
    saveExam();
    document.querySelectorAll('.bubble[data-n="' + i + '"]').forEach(function (b) { b.setAttribute("aria-pressed", x.answers[id] === +b.getAttribute("data-k") ? "true" : "false"); });
    var c = document.getElementById("exam-count"); if (c) c.textContent = Object.keys(x.answers).length + " of " + x.ids.length + " answered";
  }
  function toggleMark(i) {
    var x = state.exam, id = x.ids[i];
    if (x.marks[id]) delete x.marks[id]; else x.marks[id] = 1;
    saveExam();
    document.querySelectorAll('.mark[data-n="' + i + '"]').forEach(function (b) { b.setAttribute("aria-pressed", x.marks[id] ? "true" : "false"); });
  }
  function finishExam(timeUp) {
    var x = state.exam; if (!x || x.done) return;
    clearInterval(examTick);
    var started = x.started;
    x.ids.forEach(function (id, i) {
      var q = state.bank.byId[id]; if (!q) return;
      var k = x.answers[id], chosen = k == null ? -1 : x.orders[id][k];
      record(q, chosen, chosen === q.answer, !x.marks[id] && chosen !== -1, "exam", 0);
    });
    x.done = true; x.finished = Date.now(); x.timeUp = !!timeUp; x.elapsed = Date.now() - started;
    saveExam(); syncSoon(0);
    location.hash = "#/exam/result";
    if (timeUp) toast("Time's up. Your answer sheet was handed in.");
  }
  function viewExamResult() {
    var x = state.exam;
    if (!x || !x.done) { location.hash = "#/exam"; return ""; }
    var per = {}, wrong = [];
    x.ids.forEach(function (id) {
      var q = state.bank.byId[id]; if (!q) return;
      var k = x.answers[id], chosen = k == null ? -1 : x.orders[id][k], ok = chosen === q.answer;
      var o = per[q.subject] || (per[q.subject] = { n: 0, r: 0 }); o.n++; if (ok) o.r++;
      if (!ok) wrong.push({ q: q, chosen: chosen });
    });
    var wSum = 0, wAcc = 0, low = [];
    Object.keys(per).forEach(function (c) { var acc = per[c].r / per[c].n; wSum += M.SUBJECT[c].weight; wAcc += acc * M.SUBJECT[c].weight; if (acc < 0.5) low.push(subjectName(c)); });
    var avg = wSum ? wAcc / wSum : 0, pass = avg >= 0.75 && !low.length;
    var html = '<div class="wrap">' + head("Mock exam result", (x.timeUp ? "Time ran out. " : "") + "Taken " + esc(dayLabel(M.dayNum(x.started))) + ", " + Math.round(x.elapsed / 60000) + " minutes.", ["#/practice", "Practice"]);
    html += '<section class="ready" style="margin-bottom:32px"><p class="muted">Weighted average</p><p class="score-big">' + Math.round(avg * 100) + "%</p><p>" +
      (pass ? badge("ok", "Meets the passing rule") : badge("bad", "Below the passing rule")) + '</p><p class="small muted">The MTLE passing rule: a weighted average of 75% or more, with no subject below 50% (RA 5527 Sec. 19). A mock this size is only a rough guide.</p></section>';
    html += '<table class="ttable"><thead><tr><th>Subject</th><th class="n">Correct</th><th class="n">Score</th></tr></thead><tbody>' + Object.keys(per).map(function (c) {
      return "<tr><td>" + esc(subjectName(c)) + '</td><td class="n" data-label="Correct">' + per[c].r + " of " + per[c].n + '</td><td class="n" data-label="Score">' + pct(per[c].r, per[c].n) + "</td></tr>";
    }).join("") + "</tbody></table>";
    if (wrong.length) html += '<section class="section" style="margin-top:32px"><h2>Review your misses (' + wrong.length + ')</h2><ul class="result-list">' + wrong.map(function (w) {
      return '<li><a href="#/q/' + esc(w.q.id) + '">' + shape(w.chosen === -1 ? "todo" : "bad") + '<span><span class="result-list__t">' + fmt(w.q.stem.length > 140 ? w.q.stem.slice(0, 137) + "…" : w.q.stem) + "</span><small>" + esc(subjectName(w.q.subject)) + (w.chosen === -1 ? " · left blank" : "") + "</small></span></a></li>";
    }).join("") + "</ul></section>";
    html += '<div class="actions" style="margin-top:24px"><button type="button" class="btn btn--solid" data-act="exam-new">Set up another mock exam</button><a class="btn" href="#/">Back to Today</a></div></div>';
    return html;
  }

  /* ---------- Progress ---------- */
  function phaseRoute() {
    var ex = M.parseDay(setting("examDate")), t = today();
    if (isNaN(ex)) return "";
    var stops = [
      { name: "Foundation", from: ex - 400, to: ex - 91 }, { name: "Build", from: ex - 90, to: ex - 29 },
      { name: "Consolidate", from: ex - 28, to: ex - 15 }, { name: "Exam weeks", from: ex - 14, to: ex - 1 }, { name: "Exam", from: ex, to: ex }
    ];
    return '<div class="route"><h2>Study phases</h2><ol>' + stops.map(function (s, i) {
      var past = t > s.to, now = t >= s.from && t <= s.to;
      var when = i === 0 ? "Until " + dayLabel(s.to) : i === 4 ? dayLabel(s.from) : dayLabel(s.from) + " to " + dayLabel(s.to);
      return '<li class="' + (past ? "is-past" : now ? "is-next" : "") + '"><span class="stop" aria-hidden="true"></span><span><span class="when">' + esc(s.name) + (now ? " (now)" : "") + '</span><span class="what">' + esc(when) + "</span></span></li>";
    }).join("") + "</ol></div>";
  }
  function viewProgress() {
    var stats = M.subjectStats(state.bank, state.cards, state.reviews, Date.now()), rd = M.readiness(stats), cal = M.calibration(state.reviews);
    var html = '<div class="wrap">' + head("Progress", countdownText()) + phaseRoute();
    html += '<section class="ready" aria-labelledby="rd-h"><p class="muted small" id="rd-h">Readiness, from the last 30 days of answers</p><p class="ready__word">' + (rd.onTrack ? shape("ok", "verdict__shape") + "On track" : shape("unsure", "verdict__shape") + "Not yet") + "</p>" +
      (rd.average != null ? "<p>Weighted average: <b>" + Math.round(rd.average * 100) + "%</b> (the exam needs 75%).</p>" : "") +
      (rd.reasons.length ? "<ul>" + rd.reasons.slice(0, 4).map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" : "<p>Keep the daily sessions going and add a mock exam each week.</p>") +
      '<p class="small muted">A rough guide from your practice, not a prediction of the result.</p></section>';
    html += '<section class="section" style="padding-top:32px"><h2>By subject</h2><div class="key"><span><i class="k-m"></i>Mastered (2 right in a row)</span><span><i class="k-s"></i>Seen, still learning</span></div><div class="meters">' + M.SUBJECTS.map(function (s) {
      var o = stats[s.code], m = o.total ? o.mastered / o.total * 100 : 0, sn = o.total ? o.seen / o.total * 100 : 0;
      return '<div class="meter"><p class="meter__label"><a href="#/progress/' + s.code + '"><b>' + esc(s.name) + "</b></a> · " + s.weight + "% of the exam</p>" +
        bar([{ w: m, cls: "ok" }, { w: sn - m, cls: "seen" }], s.name + ": " + o.mastered + " of " + o.total + " mastered, " + o.seen + " seen") +
        '<p class="meter__meta">' + o.mastered + " of " + o.total + " mastered · " + o.seen + " seen · " + (o.answers ? pct(o.right, o.answers) + " right over " + plural(o.answers, "answer") : "no answers yet") + "</p></div>";
    }).join("") + "</div></section>";
    html += '<section class="section"><h2>Answers per day</h2>' + activityChart() + "</section>";
    if (state.diag && state.diag.results) html += '<section class="section"><h2>Your diagnostic</h2><p style="margin-top:12px">' + esc(diagSummary()) + '</p><p class="section__note"><a href="#/diagnostic">Take it again</a></p></section>';
    html += '<section class="section"><h2>How sure, and how right</h2><div class="calib" style="margin-top:16px"><div><b>' + pct(cal.sureRight, cal.sureN) + "</b><span>right when you were sure (" + cal.sureN + ")</span></div><div><b>" + pct(cal.unsureRight, cal.unsureN) + "</b><span>right when you weren't sure (" + cal.unsureN + ")</span></div><div><b>" + cal.confidentMisses + "</b><span>confident misses, each brought back within 2 days</span></div></div>" +
      '<p class="section__note">If "sure" is right much more often than "not sure", your sense of what you know is working. Confident misses are worth a second look: feedback corrects them best.</p></section>';
    var imgs = state.bank.items.filter(function (q) { return q.type === "image"; }).length, mine = state.bank.items.filter(function (q) { return q.mine; }).length;
    var unseen = state.bank.items.filter(function (q) { return !state.cards[q.id] && q.type !== "image"; }).length;
    html += '<section class="section"><h2>The question bank</h2><p style="margin-top:12px">' + plural(state.bank.items.length, "question") + ": " + (state.bank.items.length - imgs - mine) + " written, " + imgs + " image" + (mine ? ", " + mine + " of your own" : "") + ". " + plural(unseen, "question") + " not seen yet.</p>" +
      '<p class="section__note">The real exam has 600 items. The bank keeps growing; the daily session adds new questions as they arrive.</p></section></div>';
    return html;
  }
  function viewProgressSubject(code) {
    var s = M.SUBJECT[code]; if (!s) return viewProgress();
    var rows = M.topicStats(state.bank, state.cards, state.reviews, code, state.topics);
    var html = '<div class="wrap">' + head(s.name, s.weight + "% of the exam. Topics with their exam item counts.", ["#/progress", "Progress"]);
    html += '<table class="ttable"><thead><tr><th>Topic</th><th class="n">Exam items</th><th class="n">In bank</th><th class="n">Mastered</th><th class="n">Right</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td><a href="#/learn/' + code + "/" + esc(r.code) + '">' + esc(r.name) + '</a></td><td class="n" data-label="Exam items">' + r.tosItems + '</td><td class="n" data-label="In bank">' + r.total + '</td><td class="n" data-label="Mastered">' + r.mastered + '</td><td class="n" data-label="Right">' + (r.answers ? pct(r.right, r.answers) : "–") + "</td></tr>";
    }).join("") + "</tbody></table><p class=\"section__note\">Tap a topic to study it.</p></div>";
    return html;
  }

  /* ---------- More: settings, sync, backup, my questions, flags, exam nerves, how it works, credits ---------- */
  function sel(name, label, values, cur, note) {
    return '<div class="field"><label for="set-' + name + '">' + esc(label) + '</label><select id="set-' + name + '" data-setting="' + name + '">' + values.map(function (v) {
      return '<option value="' + v[0] + '"' + (String(v[0]) === String(cur) ? " selected" : "") + ">" + esc(v[1]) + "</option>";
    }).join("") + "</select>" + (note ? "<small>" + note + "</small>" : "") + "</div>";
  }
  function tog(name, label) { return '<label class="toggle"><input type="checkbox" data-setting="' + name + '"' + (setting(name) ? " checked" : "") + "> " + esc(label) + "</label>"; }
  function viewMore() {
    var html = '<div class="wrap">' + head("More", 'Settings, sync, your own questions and how the site works. <a href="#settings">Settings</a> · <a href="#sync">Sync</a> · <a href="#mine">My questions</a> · <a href="#flags">Flags</a> · <a href="#calm">Exam nerves</a> · <a href="#how">How it works</a> · <a href="#credits">Credits</a>');
    // Settings
    html += '<section class="section" id="settings"><h2 tabindex="-1">Settings</h2><div class="stack" style="margin-top:16px">' +
      '<div class="field"><label for="set-examDate">Exam date (first day)</label><input type="date" id="set-examDate" data-setting="examDate" value="' + esc(setting("examDate")) + '"><small>' + (setting("examDateConfirmed") ? "Confirmed." : "An estimate until PRC publishes the 2027 schedule, expected around November 2026.") + "</small></div>" +
      tog("examDateConfirmed", "This date is confirmed by PRC") +
      sel("newPerDay", "New questions per day", [[0, "0 (reviews only)"], [5, "5"], [10, "10"], [15, "15"], [20, "20"], [30, "30"]], setting("newPerDay"), "In the last 2 weeks before the exam there are no new questions.") +
      sel("sessionSize", "Questions per round", [[10, "10"], [20, "20"], [30, "30"], [40, "40"]], setting("sessionSize")) +
      sel("goalDays", "Weekly goal", [[3, "3 days"], [4, "4 days"], [5, "5 days"], [6, "6 days"], [7, "7 days"]], setting("goalDays")) +
      sel("motion", "Animations", [["auto", "Match this device"], ["on", "On"], ["off", "Off"]], motionChoice(), "“Match this device” follows the Reduce Motion setting on the phone or laptop.") +
      tog("breaks", "Suggest a 5-minute break every 25 minutes") +
      tog("focusTip", "Show the Do Not Disturb tip on Today") +
      tog("shortcuts", "Keyboard shortcuts on a laptop (A to D or 1 to 4 to answer, S sure, N not sure, Enter next)") +
      tog("showRefs", "Show the textbook reference under each explanation") +
      "</div></section>";
    // Sync
    var unsynced = state.reviews.filter(function (e) { return !e.s; }).length;
    html += '<section class="section" id="sync"><h2 tabindex="-1">Sync and backup</h2><div class="stack" style="margin-top:16px">';
    if (cfg.apiUrl) html += "<p>Answers are saved on this device and copied to the Google Sheet, so a new phone or a cleared browser can get everything back. " +
      (state.lastSync ? "Last synced " + esc(dayLabel(M.dayNum(state.lastSync))) + " at " + esc(fmtTime(state.lastSync)) + ". " : "Not synced yet. ") + (unsynced ? plural(unsynced, "answer") + " waiting." : "") + "</p>" +
      '<div class="actions"><button type="button" class="btn btn--solid" data-act="sync-now">Sync now</button><button type="button" class="btn btn--quiet" data-act="forget-code">Forget the access code on this device</button></div>';
    else html += "<p>Answers are saved only in this browser for now. Safari clears a site's data after 7 days without a visit, so keep a backup file now and then, or connect the Google Sheet (steps in the README).</p>";
    html += '<div class="actions"><button type="button" class="btn" data-act="export">Download a backup file</button><label class="btn" for="import-file">Restore from a backup file</label><input type="file" id="import-file" accept="application/json,.json" class="sr"></div>' +
      '<p class="small muted">' + plural(state.reviews.length, "answer") + " on this device. Restoring merges the file with what's here; nothing is deleted.</p>";
    var mineHere = state.reviews.filter(function (e) { return e.d === deviceId; }).length;
    html += '<h3 style="margin-top:16px">Remove test answers</h3><p>Removes the answers made in this browser (' + plural(mineHere, "answer") + "), here and in the Sheet. Other devices drop them the next time they sync. Use it to clear test runs.</p>" +
      '<div><button type="button" class="btn btn--danger" data-act="remove-device"' + (mineHere ? "" : " disabled") + ">Remove " + plural(mineHere, "answer") + " from this browser</button></div></div></section>";
    // My questions
    var mine = state.mine.filter(function (q) { return !q.deleted; });
    html += '<section class="section" id="mine"><h2 tabindex="-1">My questions</h2><div class="stack" style="margin-top:16px"><p>Write your own questions, for example from your review center notes. They stay in your browser and the Sheet, never on the public website.</p>' +
      tog("myQuestions", "Use my questions in sessions and practice");
    if (setting("myQuestions")) {
      html += (mine.length ? '<ul class="result-list">' + mine.map(function (q) {
        return '<li><a href="#/my/' + esc(q.id) + '">' + shape("todo") + '<span><span class="result-list__t">' + esc(q.stem.length > 120 ? q.stem.slice(0, 117) + "…" : q.stem) + "</span><small>" + esc(subjectName(q.subject)) + " · " + esc(topicName(q.tos)) + "</small></span></a></li>";
      }).join("") + "</ul>" : '<p class="muted">None yet.</p>') + '<div><a class="btn btn--solid" href="#/my/new">Write a question</a></div>';
    }
    html += "</div></section>";
    // Flags
    var flags = state.flags.filter(function (f) { return !f.deleted; });
    html += '<section class="section" id="flags"><h2 tabindex="-1">Flagged questions</h2><div class="stack" style="margin-top:16px"><p>Questions you marked as wrong or unclear. ' + (cfg.apiUrl ? "They go to the Sheet so they can be fixed." : "") + "</p>" +
      (flags.length ? '<ul class="result-list">' + flags.map(function (f) {
        var q = state.bank.byId[f.q];
        return '<li><a href="#/q/' + esc(f.q) + '">' + (f.status === "fixed" ? shape("done") : shape("warn")) + '<span><span class="result-list__t">' + esc(f.reason) + (f.note ? ": " + esc(f.note) : "") + "</span><small>" + esc(f.q) + (q ? " · " + esc(subjectName(q.subject)) : "") + " · " + (f.status === "fixed" ? "fixed" : "open") + "</small></span></a></li>";
      }).join("") + "</ul>" : '<p class="muted">Nothing flagged.</p>') + "</div></section>";
    // Exam nerves
    html += '<section class="section" id="calm"><h2 tabindex="-1">Exam nerves: two short exercises</h2><div class="stack" style="margin-top:16px">' +
      '<p class="small muted">Low cost, mixed evidence: one classroom study found writing about worries before an exam helped anxious students, but a lab version did not replicate. Use them if they help.</p>' +
      "<p><b>Reframe the nerves.</b> A racing heart before an exam is your body getting ready to perform, not a sign you'll fail. People told this before a test did better in one study (Jamieson et al. 2010).</p>" +
      '<form class="writing" data-form="writing"><div class="field"><label for="worry">Write about your worries for 2 minutes</label><textarea id="worry" placeholder="Nothing here is saved."></textarea><small>Nothing you type here is saved or sent anywhere.</small></div><div class="actions"><button type="submit" class="btn">Start a 2-minute timer</button><span class="timer" id="worry-timer" role="timer" aria-live="off"></span></div></form></div></section>';
    // How it works
    html += '<section class="section" id="how"><h2 tabindex="-1">How it works</h2><div class="stack" style="margin-top:16px">' +
      "<p><b>Answering beats rereading.</b> Testing yourself, with an explanation after each answer, gives much better long-term memory than reviewing notes (Roediger &amp; Karpicke 2006; Larsen et al. 2009).</p>" +
      "<p><b>Spacing.</b> Each question comes back on a schedule set by FSRS, a spaced-repetition method. A miss comes back tomorrow; a sure, correct answer waits longer. The longest gap is about 15% of the days left before the exam, so reviews come closer together as the exam nears (Cepeda et al. 2008).</p>" +
      "<p><b>A little every day.</b> The question of the day follows trials where daily emailed questions beat the same questions sent all at once (Kerfoot et al. 2007, 2009).</p>" +
      "<p><b>Sure or not sure.</b> Saying how sure you are lets the site treat lucky guesses as not yet learned, and bring back confident misses within 2 days.</p>" +
      "<p><b>Mixed topics and images.</b> Mixing look-alike topics and seeing many different images of each parasite helps you tell them apart (Kornell &amp; Bjork 2008; Brunmair &amp; Richter 2019).</p>" +
      "<p><b>Mastered</b> means 2 correct answers in a row. For images, 2 correct answers in under 10 seconds each.</p>" +
      '<p><b>About the questions.</b> Every question is original, written for this site to match the Board\'s Table of Specifications (Res. No. 13, s. 2023). They are drafts that haven\'t been checked by a licensed RMT yet, marked "Unreviewed draft". If one looks wrong, use "Flag a problem" and trust your textbook.</p></div></section>';
    // Credits
    html += '<section class="section" id="credits"><h2 tabindex="-1">Credits and licenses</h2><ul class="cred">' +
      '<li><b>Parasite images:</b> <a href="https://www.cdc.gov/dpdx/" target="_blank" rel="noopener">CDC DPDx' + newTab() + "</a>, public domain. Use of these images does not imply endorsement by CDC.</li>" +
      "<li><b>Exam blueprint:</b> Board of Medical Technology Resolution No. 13, s. 2023 (Table of Specifications), and RA 5527 and related laws. Philippine government works have no copyright (RA 8293 Sec. 176).</li>" +
      '<li><b>Scheduling:</b> <a href="https://github.com/open-spaced-repetition/ts-fsrs" target="_blank" rel="noopener">ts-fsrs' + newTab() + "</a>, MIT License.</li>" +
      "<li><b>Typeface:</b> Aptos Display where it's installed (Microsoft), otherwise your device's system font.</li>" +
      "<li><b>Questions:</b> original, written for this site. No questions are copied from reviewers, books or past exams.</li></ul></section></div>";
    return html;
  }

  function topicOptions(subject, cur) {
    var s = (state.tos.subjects || []).filter(function (x) { return x.code === subject; })[0];
    if (!s) return "";
    return s.topics.map(function (t) {
      return '<optgroup label="' + esc(t.name) + '">' + (t.subtopics && t.subtopics.length ? t.subtopics : [t]).map(function (st) {
        return '<option value="' + esc(st.code) + '"' + (st.code === cur ? " selected" : "") + ">" + esc(st.code + " " + st.name) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
  }
  function viewMyQuestion(id) {
    var q = id === "new" ? { subject: "CC", tos: "", stem: "", options: ["", "", "", ""], answer: 0, why: "", ref: "" } : state.mine.filter(function (x) { return x.id === id; })[0];
    if (!q) return '<div class="wrap">' + head("Not found", "That question isn't here.", ["#/more/mine", "More"]) + "</div>";
    var html = '<div class="wrap">' + head(id === "new" ? "Write a question" : "Edit your question", "Four options, one correct. Explain why, in your own words.", ["#/more/mine", "My questions"]);
    html += '<form class="stack" data-form="mine" data-id="' + esc(id) + '"><div class="two"><div class="field"><label for="mq-s">Subject</label><select id="mq-s" name="subject">' + M.SUBJECTS.map(function (s) { return '<option value="' + s.code + '"' + (s.code === q.subject ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="mq-t">Topic</label><select id="mq-t" name="tos">' + topicOptions(q.subject, q.tos) + "</select></div></div>" +
      '<div class="field"><label for="mq-stem">Question</label><textarea id="mq-stem" name="stem" required style="min-height:110px">' + esc(q.stem) + "</textarea></div>" +
      '<fieldset class="checks"><legend>Options (choose the correct one)</legend>' + [0, 1, 2, 3].map(function (i) {
        return '<div class="field" style="grid-template-columns:auto 1fr;align-items:center;gap:12px"><input type="radio" name="answer" value="' + i + '" aria-label="Option ' + LETTERS.charAt(i) + ' is correct"' + (q.answer === i ? " checked" : "") + ' style="width:24px;height:24px;accent-color:var(--ink)"><input type="text" name="opt' + i + '" aria-label="Option ' + LETTERS.charAt(i) + '" value="' + esc(q.options[i] || "") + '" required></div>';
      }).join("") + "</fieldset>" +
      '<div class="field"><label for="mq-why">Why the answer is right</label><textarea id="mq-why" name="why" style="min-height:90px">' + esc(q.why || "") + "</textarea></div>" +
      '<div class="field"><label for="mq-ref">Reference (optional)</label><input type="text" id="mq-ref" name="ref" value="' + esc(q.ref || "") + '"></div>' +
      '<div class="actions"><button type="submit" class="btn btn--solid">Save question</button>' + (id !== "new" ? '<button type="button" class="btn btn--danger" data-act="mine-delete" data-id="' + esc(id) + '">Delete this question</button>' : "") + "</div></form></div>";
    return html;
  }

  /* ---------- gate (only when the Sheet is connected) ---------- */
  function viewGate(msg) {
    return '<div class="wrap"><form class="gate" id="gate"><h1 tabindex="-1">Enter your access code</h1><p>It\'s in the Apps Script log from setup, and under Script properties as ACCESS_CODE. You only need it once on each device.</p>' +
      '<div class="field"><label for="code">Access code</label><input id="code" type="password" autocomplete="current-password" required></div>' +
      (msg ? '<p class="error" role="alert">' + esc(msg) + "</p>" : "") + '<div class="actions"><button class="btn btn--solid" type="submit">Continue</button><button class="btn btn--quiet" type="button" data-act="skip-gate">Use without syncing for now</button></div></form></div>';
  }

  /* ---------- visual explainers: step-through diagrams ---------- */
  var vizSeq = 0;
  /* Diagram markup comes from this repository, but it's cleaned anyway: shapes and text only. */
  function cleanSvg(svg) {
    return String(svg || "").replace(/<\s*(script|foreignObject|iframe|object|embed|image|a)\b[\s\S]*?(<\/\s*\1\s*>|\/>)/gi, "")
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|xlink:href)\s*=\s*("[^"]*"|'[^']*')/gi, function (m, a, v) { return /^["']#/.test(v) ? m : ""; })
      .replace(/javascript:/gi, "");
  }
  function vizHtml(v, opts) {
    opts = opts || {};
    var id = "viz" + (++vizSeq), n = v.steps.length, stage;
    if (v.type === "image") stage = '<img src="' + esc(v.src) + '" alt="' + esc(v.title) + '. ' + esc(v.alt || "") + '" loading="lazy" decoding="async">';
    else stage = '<svg viewBox="' + esc(v.viewBox || "0 0 360 300") + '" role="img" aria-labelledby="' + id + '-t ' + id + '-c" focusable="false"><title id="' + id + '-t">' + esc(v.title) + "</title>" + cleanSvg(v.svg) + "</svg>";
    var dots = "";
    for (var i = 0; i < n; i++) dots += '<i class="viz__dot"></i>';
    var credit = v.type === "image"
      ? 'Figure: <a href="' + esc(v.page || v.src) + '" target="_blank" rel="noopener">' + esc(v.credit || "Source") + newTab() + "</a>" + (v.license ? " (" + esc(v.license) + ")" : "") + ". Captions written for this site."
      : esc(v.source || "Original diagram.");
    return '<figure class="viz" id="' + id + '" data-viz="' + esc(v.id) + '" data-step="0" tabindex="-1">' +
      (opts.title === false ? "" : '<h2 class="viz__title">' + esc(v.title) + "</h2>") +
      '<div class="viz__stage' + (v.type === "image" ? " viz__stage--img" : "") + '">' + stage + "</div>" +
      '<div class="viz__panel"><p class="viz__count"></p><p class="viz__cap" id="' + id + '-c" aria-live="polite"></p>' +
      '<div class="viz__nav"><button type="button" class="btn btn--sm" data-act="viz-prev">‹ Back</button><span class="viz__dots" aria-hidden="true">' + dots + '</span><button type="button" class="btn btn--solid btn--sm" data-act="viz-next">Next ›</button></div></div>' +
      (v.alt ? '<details class="viz__alt"><summary>Describe the whole diagram in words</summary><p>' + esc(v.alt) + "</p></details>" : "") +
      (opts.source === false ? "" : '<p class="viz__src">' + credit + "</p>") + "</figure>";
  }
  function vizApply(fig, step, animate) {
    var v = state.vizById[fig.getAttribute("data-viz")]; if (!v) return;
    var n = v.steps.length;
    step = (step + n) % n;   // Next on the last step starts over
    fig.setAttribute("data-step", step);
    var st = v.steps[step], controlled = {}, show = {}, hl = {};
    v.steps.forEach(function (x) { (x.show || []).forEach(function (k) { controlled[k] = true; }); });
    (st.show || []).forEach(function (k) { show[k] = true; });
    (st.hl || []).forEach(function (k) { hl[k] = true; });
    fig.querySelectorAll("svg [data-k]").forEach(function (el) {
      var k = el.getAttribute("data-k"), wasOff = el.classList.contains("is-off"), off = !!controlled[k] && !show[k];
      el.classList.toggle("is-off", off);
      el.classList.toggle("is-hl", !!hl[k]);
      el.classList.remove("is-new");
      if (animate && !off && (wasOff || hl[k]) && !motionOff()) { void el.getBoundingClientRect(); el.classList.add("is-new"); }
    });
    fig.querySelector(".viz__count").textContent = "Step " + (step + 1) + " of " + n;
    var cap = fig.querySelector(".viz__cap");
    cap.innerHTML = fmt(st.caption);
    cap.classList.remove("is-swap");
    if (animate && !motionOff()) { void cap.offsetWidth; cap.classList.add("is-swap"); }
    fig.querySelectorAll(".viz__dot").forEach(function (d, i) { d.classList.toggle("is-on", i === step); d.classList.toggle("is-past", i < step); });
    var prev = fig.querySelector('[data-act="viz-prev"]'), nxt = fig.querySelector('[data-act="viz-next"]');
    prev.disabled = step === 0;
    nxt.textContent = step === n - 1 ? "Start over" : "Next ›";
  }
  function wireViz() { main.querySelectorAll(".viz").forEach(function (f) { vizApply(f, +f.getAttribute("data-step") || 0, false); }); }
  function relatedVizHtml(q) {
    var v = M.relatedVisual(q, state.visuals);
    if (!v) return "";
    return '<details class="viz-inline"><summary>' + shapeEye() + "See it as a diagram: " + esc(v.title) + "</summary>" + vizHtml(v, { title: false, source: setting("showRefs") }) + "</details>";
  }
  function shapeEye() { return '<svg class="st__shape" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><rect x="1.5" y="3" width="15" height="12" fill="none" stroke="var(--ink)" stroke-width="2"/><path d="M4 12l3.5-4 3 3 2-2 2.5 3" fill="none" stroke="var(--ink)" stroke-width="1.8"/></svg>'; }
  function viewVisuals() {
    var html = '<div class="wrap">' + head("Visual explainers", "Diagrams you step through one idea at a time. Tap Next, or use the arrow keys on a laptop.", ["#/practice", "Practice"]);
    M.SUBJECTS.forEach(function (s) {
      var list = state.visuals.filter(function (v) { return v.subject === s.code; });
      if (!list.length) return;
      html += '<section class="section"><h2>' + esc(s.name) + '</h2><ul class="topic-list" style="max-width:var(--read)">' + list.map(function (v) {
        return '<li><a href="#/visual/' + esc(v.id) + '"><b>' + esc(v.title) + "</b><small>" + (v.type === "image" ? "Life cycle · " : "") + plural(v.steps.length, "step") + "</small></a></li>";
      }).join("") + "</ul></section>";
    });
    return html + "</div>";
  }
  function viewVisual(id) {
    var v = state.vizById[id];
    if (!v) return '<div class="wrap">' + head("Diagram not found", "It may have been renamed.", ["#/visuals", "Visual explainers"]) + "</div>";
    var topic = (v.tos || [])[0], qs = topic ? M.learnQueue(state.bank, M.topicOf(topic)) : [];
    var html = '<div class="wrap"><div class="quiz">' + head(v.title, esc(subjectName(v.subject)) + (topic ? " · " + esc(topicName(topic)) : ""), ["#/visuals", "Visual explainers"]) + vizHtml(v, { title: false });
    if (qs.length) html += '<div class="actions" style="margin-top:20px"><a class="btn btn--solid" href="#/learn/' + esc(v.subject) + "/" + esc(M.topicOf(topic)) + '" data-act="learn-topic" data-s="' + esc(v.subject) + '" data-t="' + esc(M.topicOf(topic)) + '">Practice this topic (' + qs.length + ")</a></div>";
    return html + "</div></div>";
  }

  /* ---------- the diagnostic ---------- */
  function viewDiagIntro() {
    var list = M.diagnosticQueue(state.bank, state.topics);
    return '<div class="wrap"><div class="quiz">' + head("A short diagnostic", "Before the daily routine starts: " + list.length + " questions, 3 from each subject, about 15 minutes.") +
      '<div class="stack"><p>It shows which subjects to start with, and it starts your review schedule: these questions come back over the next days, just like any other.</p>' +
      "<p>Answer as you would on the exam. When you don't know, tap <b>I don't know</b> instead of guessing. That makes the result more useful.</p>" +
      '<p class="muted small">You see the explanation after each question. There is no time limit.</p>' +
      '<div class="actions"><button type="button" class="btn btn--solid" data-act="diag-start">Start the diagnostic</button><button type="button" class="btn btn--quiet" data-act="diag-skip">Skip for now</button></div></div></div></div>';
  }
  function viewDiagResult(s) {
    var res = {}, missedTopic = {};
    s.answers.forEach(function (a) {
      var q = state.bank.byId[a.q]; if (!q) return;
      var o = res[q.subject] || (res[q.subject] = { n: 0, r: 0 }); o.n++; if (a.ok) o.r++;
      else if (!missedTopic[q.subject]) missedTopic[q.subject] = M.topicOf(q.tos);
    });
    if (!state.diag || state.diag.status !== "done" || state.diag.at < new Date(s.started).toISOString()) {
      state.diag = { status: "done", at: new Date().toISOString(), results: res }; DB.set("diag", state.diag);
    }
    var right = s.answers.filter(function (a) { return a.ok; }).length, n = s.answers.length;
    var order = M.SUBJECTS.filter(function (x) { return res[x.code]; }).sort(function (a, b) {
      var ra = res[a.code].r / res[a.code].n, rb = res[b.code].r / res[b.code].n; return (ra - rb) || (b.weight - a.weight);
    });
    var html = '<div class="wrap"><div class="quiz">' + head("Diagnostic: " + right + " of " + n, n ? pct(right, n) + " right. Here's where you stand by subject." : "Ended early.");
    html += '<section class="section"><h2>By subject</h2><div class="meters" style="grid-template-columns:1fr">' + M.SUBJECTS.map(function (x) {
      var o = res[x.code]; if (!o) return "";
      return '<div class="meter"><p class="meter__label"><b>' + esc(x.name) + "</b> · " + o.r + " of " + o.n + "</p>" + scoreBar(o.r, o.n, true) + "</div>";
    }).join("") + "</div>" + scoreKey() + "</section>";
    var weak = order.filter(function (x) { return res[x.code].r < res[x.code].n; }).slice(0, 3);
    if (weak.length) html += '<section class="section"><h2>Where to start</h2><ul class="result-list">' + weak.map(function (x) {
      var tp = missedTopic[x.code];
      return '<li><a href="#/learn/' + x.code + (tp ? "/" + esc(tp) : "") + '">' + shape("todo") + '<span><span class="result-list__t">' + esc(x.name) + (tp ? ": " + esc(topicName(tp)) : "") + "</span><small>" + res[x.code].r + " of " + res[x.code].n + " right · " + x.weight + "% of the exam · learn this topic</small></span></a></li>";
    }).join("") + '</ul><p class="section__note">Three questions per subject is a quick look, not a verdict. The daily sessions cover every subject anyway.</p></section>';
    html += '<section class="section"><h2>Next</h2><p style="margin-top:12px">These questions are now on your schedule. From tomorrow, Today brings reviews plus new questions.</p><div class="actions"><a class="btn btn--solid" href="#/">Go to Today</a></div></section></div></div>';
    return html;
  }
  function diagSummary() {
    var r = state.diag.results || {}, parts = [];
    M.SUBJECTS.forEach(function (x) { if (r[x.code]) parts.push(x.short + " " + r[x.code].r + "/" + r[x.code].n); });
    return "Taken " + dayLabel(M.dayNum(state.diag.at)) + ": " + parts.join(", ") + ".";
  }

  /* ---------- visuals: bars, the phase line, the activity chart ---------- */
  /* A bar made of segments. Widths start at 0 and grow when the bar scrolls into view (at once when animations are off). */
  function bar(parts, label) {
    return '<div class="meter__bar" role="img" aria-label="' + esc(label) + '">' + parts.filter(function (p) { return p.w > 0.05; }).map(function (p) {
      return '<i class="seg seg--' + p.cls + '" style="width:0" data-w="' + Math.max(0, Math.min(100, p.w)).toFixed(1) + '"></i>';
    }).join("") + "</div>";
  }
  function scoreBar(right, n, small) {
    var wrong = n - right;
    return '<div class="' + (small ? "" : "scorebar") + '">' + bar([{ w: right / n * 100, cls: "ok" }, { w: wrong / n * 100, cls: "miss" }], right + " right, " + wrong + " missed") + (small ? "" : scoreKey()) + "</div>";
  }
  function scoreKey() { return '<div class="key"><span><i class="k-m"></i>Right</span><span><i class="k-x"></i>Missed or not answered</span></div>'; }

  /* Today: how far along the bank she is, overall (weighted by exam share) and per subject */
  function todayProgress() {
    var st = M.subjectStats(state.bank, state.cards, state.reviews, Date.now()), wM = 0, wS = 0, wT = 0;
    M.SUBJECTS.forEach(function (x) { var o = st[x.code]; if (!o.total) return; wT += x.weight; wM += x.weight * o.mastered / o.total; wS += x.weight * o.seen / o.total; });
    var om = wT ? wM / wT * 100 : 0, os = wT ? wS / wT * 100 : 0;
    var html = '<section class="section" aria-labelledby="prog-h"><h2 id="prog-h">Your progress</h2><div class="overall"><p class="overall__n"><b>' + Math.round(om) + "%</b> mastered</p><p class=\"muted small\">" + Math.round(os) + "% seen · weighted by each subject's share of the exam</p>" +
      bar([{ w: om, cls: "ok" }, { w: os - om, cls: "seen" }], "Overall: " + Math.round(om) + "% mastered, " + Math.round(os) + "% seen") + "</div>";
    html += '<ul class="minimeters">' + M.SUBJECTS.map(function (x) {
      var o = st[x.code], m = o.total ? o.mastered / o.total * 100 : 0, sn = o.total ? o.seen / o.total * 100 : 0;
      return '<li><a href="#/progress/' + x.code + '"><span class="minimeters__name">' + esc(x.short) + '</span><span class="minimeters__n">' + o.mastered + "/" + o.total + "</span></a>" + bar([{ w: m, cls: "ok" }, { w: sn - m, cls: "seen" }], x.name + ": " + o.mastered + " of " + o.total + " mastered, " + o.seen + " seen") + "</li>";
    }).join("") + '</ul><div class="key"><span><i class="k-m"></i>Mastered</span><span><i class="k-s"></i>Seen, still learning</span></div><p style="margin-top:8px"><a href="#/progress">See all your progress</a></p></section>';
    return html;
  }

  /* Today: the road to exam day, phases to scale, with a marker for today */
  function phaseLine() {
    var ex = M.parseDay(setting("examDate")), t = today();
    if (isNaN(ex) || ex <= t) return "";
    var first = state.reviews.length ? M.dayNum(state.reviews[0].t) : t, start = Math.min(first, t, ex - 120);
    var segs = [["Foundation", start, ex - 91], ["Build", ex - 90, ex - 29], ["Consolidate", ex - 28, ex - 15], ["Exam weeks", ex - 14, ex - 1]].filter(function (x) { return x[2] >= x[1]; });
    var total = ex - start, now = null, next = null;
    var html = '<div class="road" role="img" aria-label="' + esc(phaseAria(segs, t, ex)) + '"><div class="road__bar">' + segs.map(function (x, i) {
      var cls = t > x[2] ? "is-past" : t >= x[1] ? "is-now" : "";
      if (cls === "is-now") { now = x; next = segs[i + 1]; }
      return '<span class="road__seg ' + cls + '" style="flex-grow:' + (x[2] - x[1] + 1) + '"></span>';
    }).join("") + '</div><span class="road__today' + ((t - start) / total < 0.12 ? " is-start" : (t - start) / total > 0.88 ? " is-end" : "") + '" style="left:' + ((t - start) / total * 100).toFixed(1) + '%"><span>Today</span></span></div>' +
      '<div class="road__ends"><span>' + esc(dayLabel(start)) + "</span><span>Exam " + esc(dayLabel(ex)) + "</span></div>";
    if (now) html += '<p class="small" style="margin-top:8px"><b>' + esc(now[0]) + "</b> until " + esc(dayLabel(now[2])) + (next ? ", then " + esc(next[0]) + "." : ".") + "</p>";
    return html;
  }
  function phaseAria(segs, t, ex) {
    var cur = segs.filter(function (x) { return t >= x[1] && t <= x[2]; })[0];
    return "Study phases: " + segs.map(function (x) { return x[0]; }).join(", ") + ". Now in " + (cur ? cur[0] : "the last stretch") + ", " + plural(ex - t, "day") + " to the exam.";
  }

  /* Progress: answers per day for the last 14 days, right (solid blue) and missed (hatched orange) stacked */
  function activityChart() {
    var t = today(), days = [], max = 0;
    for (var i = 13; i >= 0; i--) days.push({ day: t - i, r: 0, w: 0 });
    state.reviews.forEach(function (e) { var k = M.dayNum(e.t) - (t - 13); if (k >= 0 && k < 14) { if (e.ok) days[k].r++; else days[k].w++; } });
    days.forEach(function (d) { max = Math.max(max, d.r + d.w); });
    if (!max) return '<p class="muted" style="margin-top:12px">No answers in the last 2 weeks yet.</p>';
    var top = Math.max(5, Math.ceil(max / 5) * 5);
    var cols = days.map(function (d) {
      var name = fmtDate(new Date(M.dayStart(d.day) + 12 * 3600000), { weekday: "narrow" }), tot = d.r + d.w;
      var label = dayLabel(d.day) + ": " + (tot ? d.r + " right, " + d.w + " missed" : "no answers");
      return '<div class="col' + (d.day === t ? " is-today" : "") + '" title="' + esc(label) + '"><span class="col__plot"><span class="col__stack seg" style="height:0" data-h="' + (tot / top * 100).toFixed(1) + '">' +
        (d.w ? '<i class="col__miss" style="flex-grow:' + d.w + '"></i>' : "") + (d.r ? '<i class="col__ok" style="flex-grow:' + d.r + '"></i>' : "") + '</span></span><span class="col__lab">' + esc(name) + "</span></div>";
    }).join("");
    var table = '<table class="sr"><caption>Answers per day</caption><thead><tr><th>Day</th><th>Right</th><th>Missed</th></tr></thead><tbody>' + days.map(function (d) { return "<tr><td>" + esc(dayLabel(d.day)) + "</td><td>" + d.r + "</td><td>" + d.w + "</td></tr>"; }).join("") + "</tbody></table>";
    return '<figure class="chart"><div class="chart__plot" aria-hidden="true"><span class="chart__top">' + top + '</span><span class="chart__zero">0</span><div class="cols">' + cols + "</div></div>" +
      '<figcaption class="key"><span><i class="k-m"></i>Right</span><span><i class="k-x"></i>Missed</span><span>Last 14 days, today on the right</span></figcaption>' + table + "</figure>";
  }

  /* Grow bars and columns into place when they scroll into view. */
  var barIO = null;
  function fillBars(instant) {
    if (barIO) { barIO.disconnect(); barIO = null; }
    var set = function (box) {
      box.querySelectorAll("[data-w]").forEach(function (el) { el.style.width = el.getAttribute("data-w") + "%"; });
      box.querySelectorAll("[data-h]").forEach(function (el) { el.style.height = el.getAttribute("data-h") + "%"; });
    };
    var boxes = main.querySelectorAll(".meter__bar, .quiz__bar, .chart");
    if (instant || motionOff() || !("IntersectionObserver" in window)) { boxes.forEach(set); return; }
    barIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (!e.isIntersecting) return; barIO.unobserve(e.target); requestAnimationFrame(function () { requestAnimationFrame(function () { set(e.target); }); }); });
    }, { threshold: 0.3 });
    boxes.forEach(function (b) { barIO.observe(b); });
  }

  /* Reveal on scroll, the same "gentle reveal" as the hubs: blocks below the fold fade up a few pixels as they scroll
     into view. Blocks already on screen show at once, keyboard focus shows a block right away, and with animations off
     (More > Settings, or the device asking for reduced motion) there is no effect. Never used on the question screen or a
     running mock exam. */
  var revealIO = null;
  function reveal() {
    if (revealIO) { revealIO.disconnect(); revealIO = null; }
    if (!("IntersectionObserver" in window) || motionOff()) return;
    var LIST = "ul.result-list, ul.topic-list, .modes, .meters, ul.minimeters";
    var picked = [];
    main.querySelectorAll(".section, .today-grid > div, .wrap > .ready, .wrap > .route").forEach(function (sec) {
      Array.prototype.forEach.call(sec.children, function (c) {
        if (c.matches(LIST)) Array.prototype.push.apply(picked, c.children);
        else if (!c.matches(".section")) picked.push(c);
      });
    });
    main.querySelectorAll(".modes > .mode").forEach(function (m) { if (picked.indexOf(m) < 0) picked.push(m); });
    var vh = window.innerHeight, pending = [];
    picked.forEach(function (el) { if (el.getBoundingClientRect().top >= vh * 0.95) { el.classList.add("rv"); pending.push(el); } });
    if (!pending.length) return;
    document.documentElement.classList.add("rv-on");
    function done(el) { el.classList.remove("rv", "rv-in"); el.style.removeProperty("--rv-d"); }
    function show(el, delay) {
      if (!el.classList.contains("rv") || el.classList.contains("rv-in")) return;
      if (delay) el.style.setProperty("--rv-d", delay + "ms");
      el.classList.add("rv-in");
      setTimeout(function () { done(el); }, 900 + (delay || 0));
    }
    revealIO = new IntersectionObserver(function (es) {
      var n = 0;
      es.forEach(function (e) { if (!e.isIntersecting) return; revealIO.unobserve(e.target); show(e.target, Math.min(n++, 4) * 70); });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
    pending.forEach(function (el) { revealIO.observe(el); });
  }
  /* Numbers on Today, Progress and the mock-exam result count up briefly when they first show, and again when they've
     changed since the last visit (for example "answered today" after a session). The final value is always what's in
     the page; only the count is animated, and not at all with animations off. */
  var countIO = null, countSeen = {};
  var COUNT_SEL = ".plan b, .overall__n b, .minimeters__n, .calib b, .ready p > b, .score-big";
  function countUp() {
    if (countIO) { countIO.disconnect(); countIO = null; }
    if (motionOff() || !window.requestAnimationFrame) return;
    var vh = window.innerHeight, later = [];
    main.querySelectorAll(COUNT_SEL).forEach(function (el, i) {
      var m = /^(\d+)(\D.*)?$/.exec(el.textContent), key = route._key + "#" + i;
      if (!m) return;
      var to = +m[1], from = countSeen[key] == null ? 0 : countSeen[key];
      countSeen[key] = to;
      if (from === to) return;
      var job = { el: el, from: from, to: to, rest: m[2] || "" };
      if (el.getBoundingClientRect().top < vh) countRun(job); else later.push(job);
    });
    if (!later.length || !("IntersectionObserver" in window)) return;
    countIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        countIO.unobserve(e.target);
        later.forEach(function (j) { if (j.el === e.target) countRun(j); });
      });
    }, { threshold: 0.5 });
    later.forEach(function (j) { countIO.observe(j.el); });
  }
  function countRun(j) {
    var el = j.el, final = el.textContent, t0 = 0, dur = 600;
    if (getComputedStyle(el).display === "inline") {   // keep the words after the number still while it counts
      el.style.minWidth = el.getBoundingClientRect().width + "px"; el.style.display = "inline-block";
    }
    el.textContent = j.from + j.rest;
    function frame(now) {
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / dur);
      if (p < 1 && !motionOff() && document.contains(el)) {
        el.textContent = Math.round(j.from + (j.to - j.from) * (1 - Math.pow(1 - p, 3))) + j.rest;
        requestAnimationFrame(frame);
      } else { el.textContent = final; el.style.display = ""; el.style.minWidth = ""; }
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest(".rv"); if (el) { if (revealIO) revealIO.unobserve(el); el.classList.remove("rv", "rv-in"); } });
  window.addEventListener("beforeprint", function () { main.querySelectorAll(".rv").forEach(function (el) { el.classList.remove("rv", "rv-in"); }); });

  /* ================================================================== router */
  function route() {
    var h = location.hash.replace(/^#\/?/, "").split("/");
    var view = h[0] || "today";
    // In-page anchors like #settings on the More page
    if (/^[a-z]+$/.test(view) && ["settings", "sync", "mine", "flags", "calm", "how", "credits"].indexOf(view) > -1) { location.replace("#/more/" + view); return; }
    var nav = { s: "today", q: "", learn: "practice", exam: "practice", my: "more", diagnostic: "today", visuals: "practice", visual: "practice" }[view];
    nav = nav === undefined ? view : nav;
    document.querySelectorAll("[data-nav]").forEach(function (a) { if (a.getAttribute("data-nav") === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (!state.ready) return;
    var html, title = "MTLE Reviewer";
    if (view === "s") { html = viewSession(); if (html === null) { location.replace("#/"); return; } title = state.session ? state.session.title : title; }
    else if (view === "q") { html = viewQuestion(h[1]); title = "Question"; }
    else if (view === "practice") { html = viewPractice(); title = "Practice"; }
    else if (view === "diagnostic") { html = viewDiagIntro(); title = "Diagnostic"; }
    else if (view === "visuals") { html = viewVisuals(); title = "Visual explainers"; }
    else if (view === "visual") { html = viewVisual(h[1]); title = state.vizById[h[1]] ? state.vizById[h[1]].title : "Visual explainer"; }
    else if (view === "learn") {
      if (h[2]) { var list = M.learnQueue(state.bank, h[2]); if (!list.length) { location.replace("#/learn/" + h[1]); return; } startSession("learn", list, "Learn: " + topicName(h[2]), "#/learn/" + h[1], true, M.visualsForTopic(state.visuals, h[2])); return; }
      html = viewLearn(h[1]); title = "Learn";
    }
    else if (view === "exam") { html = h[1] === "run" ? viewExamRun() : h[1] === "result" ? viewExamResult() : viewExamSetup(); title = "Mock exam"; }
    else if (view === "progress") { html = h[1] ? viewProgressSubject(h[1]) : viewProgress(); title = "Progress"; }
    else if (view === "more") { html = viewMore(); title = "More"; }
    else if (view === "my") { html = viewMyQuestion(h[1] || "new"); title = "My question"; }
    else { html = viewToday(); }
    document.title = title === "MTLE Reviewer" ? title : title + " | MTLE Reviewer";
    var quiet = !!route._keepFocus, checked = !!route._checked;
    route._keepFocus = false; route._checked = false;
    // How the change is shown: "load" (first page), "page" (another page), "step" (the next screen of a session),
    // "scroll" (another section of More), or "" (re-drawn in place, e.g. after checking an answer: nothing moves)
    var key = view === "more" ? "more" : view + "/" + (h[1] || ""), prev = route._key;
    route._key = key;
    var how = quiet ? "" : !prev ? "load" : prev !== key ? "page" : view === "s" ? "step" : view === "more" ? "scroll" : "";
    var animate = !motionOff();
    var useVT = animate && how === "page" && typeof document.startViewTransition === "function" && document.visibilityState === "visible";
    var paint = function () {
      var cl = main.classList;
      cl.toggle("nav-in", animate && (how === "load" || how === "page"));
      cl.toggle("pg-in", animate && (how === "load" || (how === "page" && !useVT)));
      cl.toggle("q-in", animate && how === "step");
      cl.toggle("is-checked-now", animate && checked);
      main.innerHTML = html;
      main.setAttribute("aria-busy", "false");
      if (view === "exam" && h[1] === "run") wireExam(); else { clearInterval(examTick); if (examIO) { examIO.disconnect(); examIO = null; } }
      var h1 = main.querySelector("h1");
      if (route._moved && h1 && !quiet) h1.focus({ preventScroll: true });
      route._moved = true;
      if (!quiet) {
        var sec = view === "more" && h[1] ? document.getElementById(h[1]) : null;
        if (how === "scroll" && animate) { if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" }); else window.scrollTo({ top: 0, behavior: "smooth" }); }
        else if (sec) jumpTo(sec);
        else jumpScroll(0, 0);
        if (sec) { var hd = sec.querySelector("h2"); if (hd) hd.focus({ preventScroll: true }); }
      }
      cl.toggle("hidden-kbd", !setting("shortcuts"));
      fillBars(quiet);
      wireViz();
      if (!quiet && view !== "s" && !(view === "exam" && h[1] === "run")) reveal();
      if (!quiet && how !== "step") countUp();
    };
    // A different page: with the View Transitions API the old page fades out as the new one eases in. If another
    // change arrives before the transition draws, the newest one is the one drawn (route._paint).
    if (useVT) {
      route._paint = paint;
      try {
        var vt = document.startViewTransition(function () { var f = route._paint; route._paint = null; if (f) f(); });
        [vt.ready, vt.finished, vt.updateCallbackDone].forEach(function (p) { if (p && p.catch) p.catch(function () { /* skipped: fine */ }); });
      } catch (e) { route._paint = null; paint(); }
    } else { route._paint = null; paint(); }
  }
  function refresh() { var y = window.scrollY; route._keepFocus = true; route(); jumpScroll(0, y); }
  window.addEventListener("hashchange", function () { route._moved = true; route(); });

  /* ================================================================== events */
  function flagDialog(qid) {
    openDialog('<form><div class="dlg__head"><h2>Flag a problem</h2><button type="button" data-close aria-label="Close">×</button></div><div class="dlg__body">' +
      '<div class="field"><label for="fl-r">What\'s wrong?</label><select id="fl-r" name="reason"><option>The answer key looks wrong</option><option>The question is unclear</option><option>A typo or formatting problem</option><option>Outdated or not how PH labs do it</option><option>The image is wrong or didn\'t load</option><option>Something else</option></select></div>' +
      '<div class="field"><label for="fl-n">Note (optional)</label><textarea id="fl-n" name="note" style="min-height:90px"></textarea><small>For example, what your textbook says and the page.</small></div></div>' +
      '<div class="dlg__foot"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--solid">Save the flag</button></div></form>', function (v) {
      state.flags.push({ id: "fl-" + M.uid(), q: qid, at: new Date().toISOString(), reason: v.reason, note: v.note || "", status: "open" });
      DB.set("flags", state.flags); syncSoon(0); toast("Flagged. Thanks: it'll be checked.");
    });
  }
  function openDialog(html, onSubmit, cls) {
    var opener = document.activeElement, dlg = document.createElement("dialog");
    if (cls) dlg.className = cls;
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    var close = function () { dlg.close(); };
    dlg.addEventListener("close", function () { if (dlg.parentNode) dlg.remove(); if (opener && document.contains(opener)) opener.focus(); });
    dlg.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", close); });
    var form = dlg.querySelector("form");
    if (form && onSubmit) form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(form), vals = {};
      fd.forEach(function (v, k) { vals[k] = v; });
      if (onSubmit(vals, dlg) !== false) close();
    });
    dlg.showModal();
    return dlg;
  }
  function zoom() {
    var q = state.session && currentQ(); var img = main.querySelector(".specimen img"); if (!img) return;
    var d = openDialog('<div class="dlg__head"><h2>Image</h2><span><button type="button" data-act-z="2x" aria-pressed="false" style="margin-right:8px">2×</button><button type="button" data-close aria-label="Close">×</button></span></div><div class="dlg__body"><img src="' + esc(img.getAttribute("src")) + '" alt="' + esc(img.getAttribute("alt")) + '"></div>', null, "zoom");
    var b = d.querySelector("[data-act-z]");
    b.addEventListener("click", function () { var on = d.classList.toggle("is-2x"); b.setAttribute("aria-pressed", on ? "true" : "false"); });
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]"); if (!el) return;
    var act = el.getAttribute("data-act"), s = state.session;
    if (el.tagName === "A" && act.indexOf("learn") === 0) e.preventDefault();
    if (act === "learn-topic") { var lq = M.learnQueue(state.bank, el.getAttribute("data-t")); startSession("learn", lq, "Learn: " + topicName(el.getAttribute("data-t")), "#/learn/" + el.getAttribute("data-s"), false, M.visualsForTopic(state.visuals, el.getAttribute("data-t"))); return; }
    if (act === "pick") { if (!s || s.reveal) return; var i = +el.getAttribute("data-i"); s.picked = s.picked === i ? null : i; saveSession(); showPick(); var b = main.querySelector('[data-act="pick"][data-i="' + i + '"]'); if (b && b !== document.activeElement) b.focus({ preventScroll: true }); }
    else if (act === "check") check(el.getAttribute("data-sure") === "1", false);
    else if (act === "dunno") check(false, true);
    else if (act === "next") next();
    else if (act === "xp-jump") { var xp = document.getElementById("xp"); if (xp) xp.scrollIntoView({ block: "start", behavior: motionOff() ? "auto" : "smooth" }); }
    else if (act === "intro-next") { s.introI++; s.shownAt = 0; saveSession(); route._moved = true; route(); }
    else if (act === "intro-skip") { s.introI = s.intro.length; s.shownAt = 0; saveSession(); route._moved = true; route(); }
    else if (act === "viz-prev" || act === "viz-next") { var fig = el.closest(".viz"); if (fig) vizApply(fig, +fig.getAttribute("data-step") + (act === "viz-next" ? 1 : -1), true); }
    else if (act === "try") { s.stage = "ask"; s.shownAt = 0; saveSession(); route._moved = true; route(); }
    else if (act === "resume") { s.pause = false; s.lastBreak = Date.now(); saveSession(); route(); }
    else if (act === "end") {
      if (!s) return;
      if (!s.answers.length) { state.session = null; saveSession(); location.hash = s.back || "#/"; return; }
      s.ids = s.ids.slice(0, s.reveal ? s.i + 1 : s.i); s.i = s.ids.length; s.pause = false; saveSession(); route(); syncSoon(0);
    }
    else if (act === "zoom") zoom();
    else if (act === "flag") flagDialog(el.getAttribute("data-q"));
    else if (act === "hide-tip") { setSetting("focusTip", false); refresh(); }
    else if (act === "start-qod") {
      var p = plan(), done = answeredToday(), ids = qodIds(p).filter(function (id) { return !done[id]; });
      startSession("qod", ids.map(function (id) { return state.bank.byId[id]; }), "Question of the day", "#/");
    }
    else if (act === "start-today") {
      var p2 = plan(), done2 = answeredToday(), q2 = qodIds(p2).filter(function (id) { return !done2[id]; });
      startSession("today", M.todayQueue(p2, q2, state.bank).slice(0, +setting("sessionSize")), "Today's session", "#/");
    }
    else if (act === "start-math") startSession("math", M.spread(M.shuffle(state.bank.items.filter(function (q) { return q.type === "math"; }), Math.random)), "Lab math", "#/practice");
    else if (act === "exam-submit") {
      var x = state.exam, blank = x.ids.length - Object.keys(x.answers).length;
      openDialog('<form><div class="dlg__head"><h2>Hand in your answer sheet?</h2><button type="button" data-close aria-label="Close">×</button></div><div class="dlg__body"><p>' + (blank ? plural(blank, "question") + " still blank. " : "Every question is answered. ") + "You'll see your score and the explanations next.</p></div>" +
        '<div class="dlg__foot"><button type="button" class="btn" data-close>Keep working</button><button type="submit" class="btn btn--solid">Hand it in</button></div></form>', function () { finishExam(false); });
    }
    else if (act === "bubble") shadeBubble(+el.getAttribute("data-n"), +el.getAttribute("data-k"));
    else if (act === "mark") toggleMark(+el.getAttribute("data-n"));
    else if (act === "sheet-open") { var sh = document.getElementById("sheet"); sh.classList.add("is-open"); var cb = document.getElementById("sheet-close"); cb.hidden = false; cb.focus(); }
    else if (act === "sheet-close") { document.getElementById("sheet").classList.remove("is-open"); }
    else if (act === "exam-discard") { state.exam = null; saveExam(); refresh(); }
    else if (act === "exam-new") { state.exam = null; saveExam(); location.hash = "#/exam"; }
    else if (act === "sync-now") { el.classList.add("is-working"); sync(false).then(function () { toast("Synced."); refresh(); }, function () { toast("Couldn't sync. Answers are safe on this device."); el.classList.remove("is-working"); }); }
    else if (act === "forget-code") { ls.del("code"); toast("Forgotten on this device."); start(); }
    else if (act === "skip-gate") { ls.set("skipGate", "1"); state.ready = true; route(); }
    else if (act === "export") exportBackup();
    else if (act === "diag-skip") { state.diag = { status: "skipped", at: new Date().toISOString() }; DB.set("diag", state.diag); if (location.hash === "#/" || location.hash === "") refresh(); else location.hash = "#/"; }
    else if (act === "diag-start") startSession("diag", M.diagnosticQueue(state.bank, state.topics), "Diagnostic", "#/");
    else if (act === "remove-device") {
      var mineIds = state.reviews.filter(function (e) { return e.d === deviceId; }).map(function (e) { return e.id; });
      if (!mineIds.length) return;
      openDialog('<form><div class="dlg__head"><h2>Remove ' + plural(mineIds.length, "answer") + '?</h2><button type="button" data-close aria-label="Close">×</button></div><div class="dlg__body"><p>Every answer made in this browser is removed here and in the Sheet. Other devices drop them when they next sync. Answers made on other devices stay.</p><p>This can\'t be undone.</p></div>' +
        '<div class="dlg__foot"><button type="button" class="btn" data-close>Keep them</button><button type="submit" class="btn btn--danger">Remove ' + plural(mineIds.length, "answer") + "</button></div></form>", function () {
        var gone = {}; mineIds.forEach(function (id) { gone[id] = true; });
        state.reviews = state.reviews.filter(function (e) { return !gone[e.id]; });
        state.removedPending = state.removedPending.concat(mineIds);
        state.qod = null; DB.set("qod", null);
        Promise.all([DB.deleteReviews(mineIds), DB.set("removedPending", state.removedPending)]).then(function () {
          rebuild(); showStatus(); refresh(); toast("Removed " + plural(mineIds.length, "answer") + ".");
          if (cfg.apiUrl && ls.get("code")) sync(true).catch(function () {});
        });
      });
    }
    else if (act === "mine-delete") {
      var id = el.getAttribute("data-id");
      openDialog('<form><div class="dlg__head"><h2>Delete this question?</h2><button type="button" data-close aria-label="Close">×</button></div><div class="dlg__body"><p>Your answers to it stay in your history.</p></div><div class="dlg__foot"><button type="button" class="btn" data-close>Keep it</button><button type="submit" class="btn btn--danger">Delete the question</button></div></form>', function () {
        state.mine.forEach(function (q) { if (q.id === id) { q.deleted = true; q.at = new Date().toISOString(); } });
        DB.set("mine", state.mine); rebuild(); syncSoon(0); location.hash = "#/more/mine"; toast("Deleted.");
      });
    }
  });

  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.id === "gate") {
      e.preventDefault();
      ls.set("code", document.getElementById("code").value.trim());
      sync(false).then(function () { state.ready = true; if (!state.diag) location.hash = "#/diagnostic"; route(); }, function (err) {
        if (err.code === "code") { ls.del("code"); main.innerHTML = viewGate("That code didn't work. Check ACCESS_CODE in the Apps Script project's Script properties."); }
        else { state.ready = true; route(); toast("Couldn't reach the Sheet. Practising on this device for now."); }
      });
      return;
    }
    var kind = f.getAttribute("data-form"); if (!kind) return;
    e.preventDefault();
    var fd = new FormData(f);
    if (kind === "mixed") {
      var subs = fd.getAll("subj");
      startSession("mixed", M.practiceQueue(state.bank, state.cards, { subjects: subs, source: fd.get("source"), size: +fd.get("size"), includeImages: !!fd.get("images"), flagged: flaggedMap() }, Date.now()), "Mixed practice", "#/practice");
    } else if (kind === "drill") {
      startSession("drill", M.drillQueue(state.bank, state.cards, fd.getAll("grp"), +fd.get("size"), Date.now()), "Image drill", "#/practice");
    } else if (kind === "exam") {
      startExam(fd.get("which"));
    } else if (kind === "writing") {
      var end = Date.now() + 120000, tEl = document.getElementById("worry-timer");
      clearInterval(f._t);
      f._t = setInterval(function () { var r = end - Date.now(); if (!document.contains(tEl)) { clearInterval(f._t); return; } tEl.textContent = r > 0 ? clock(r) : "Done. You can clear the box."; if (r <= 0) clearInterval(f._t); }, 250);
    } else if (kind === "mine") {
      var id = f.getAttribute("data-id"), now = new Date().toISOString();
      var rec = { id: id === "new" ? "MY-" + M.uid() : id, subject: fd.get("subject"), tos: fd.get("tos"), type: "mcq", difficulty: "moderate",
        stem: String(fd.get("stem") || "").trim(), options: [0, 1, 2, 3].map(function (i) { return String(fd.get("opt" + i) || "").trim(); }),
        answer: +(fd.get("answer") || 0), why: String(fd.get("why") || "").trim(), whyNot: {}, ref: String(fd.get("ref") || "").trim(), author: cfg.ownerName || "me", at: now };
      if (!rec.stem || rec.options.some(function (o) { return !o; })) { toast("Fill in the question and all four options."); return; }
      state.mine = state.mine.filter(function (q) { return q.id !== rec.id; }).concat([rec]);
      DB.set("mine", state.mine); rebuild(); syncSoon(0); toast("Saved."); location.hash = "#/more/mine";
    }
  });

  document.addEventListener("change", function (e) {
    var el = e.target;
    if (el.id === "mq-s") { document.getElementById("mq-t").innerHTML = topicOptions(el.value, ""); return; }
    if (el.id === "import-file") { importBackup(el.files && el.files[0]); return; }
    var k = el.getAttribute && el.getAttribute("data-setting"); if (!k) return;
    var v = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" && el.value !== "" && !isNaN(+el.value) ? +el.value : el.value;
    if (k === "examDate" && isNaN(M.parseDay(v))) { toast("That date isn't valid."); return; }
    setSetting(k, v); toast("Saved."); if (k === "myQuestions" || k === "shortcuts" || k === "showRefs") refresh();
  });

  /* Keyboard: A-D or 1-4 to choose, S sure, N not sure, Enter next. Can be turned off in Settings. */
  document.addEventListener("keydown", function (e) {
    var vf = e.target.closest && e.target.closest(".viz");
    if (vf && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); vizApply(vf, +vf.getAttribute("data-step") + (e.key === "ArrowRight" ? 1 : -1), true); return;
    }
    if (!setting("shortcuts") || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || document.querySelector("dialog[open]")) return;
    if (location.hash !== "#/s" || !state.session) return;
    var s = state.session, k = e.key.toLowerCase(), q = currentQ();
    if (s.pause) return;
    if (s.stage === "worked" && q && q.worked) { if (k === "enter") { e.preventDefault(); s.stage = "ask"; s.shownAt = 0; saveSession(); route(); } return; }
    if (!s.reveal && q) {
      var idx = "abcd".indexOf(k); if (idx < 0) idx = "1234".indexOf(k);
      if (idx > -1 && idx < q.options.length) { e.preventDefault(); s.picked = idx; saveSession(); showPick(); return; }
      if (k === "s" && s.picked != null) { e.preventDefault(); check(true); return; }
      if (k === "n" && s.picked != null) { e.preventDefault(); check(false); return; }
    } else if (s.reveal && k === "enter" && tag !== "button") { e.preventDefault(); next(); }
  });

  /* ---------- backup files ---------- */
  function exportBackup() {
    var data = { app: "mtle-reviewer", version: 1, exportedAt: new Date().toISOString(), reviews: state.reviews.map(strip), flags: state.flags, mine: state.mine, settings: settingsRecords() };
    var blob = new Blob([JSON.stringify(data)], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mtle-backup-" + M.isoDay(today()) + ".json";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Backup downloaded.");
  }
  function importBackup(file) {
    if (!file) return;
    file.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || d.app !== "mtle-reviewer") throw new Error("not ours");
      var before = state.reviews.length;
      state.reviews = M.mergeReviews(state.reviews, (d.reviews || []).map(function (e) { e.s = 0; return e; }));
      state.flags = M.mergeRecords(state.flags, d.flags || []);
      var status = {};   // a flag's status (open or fixed) is set in the Sheet
      (d.flags || []).forEach(function (f) { status[f.id] = f.status; });
      state.flags.forEach(function (f) { if (status[f.id]) f.status = status[f.id]; }); state.mine = M.mergeRecords(state.mine, d.mine || []);
      (d.settings || []).forEach(function (r) { var cur = state.settings[r.id]; if (!cur || String(r.at || "") > String(cur.at || "")) state.settings[r.id] = { v: r.v, at: r.at }; });
      applyMotion();
      return Promise.all([DB.addReviews(state.reviews), DB.set("flags", state.flags), DB.set("mine", state.mine), DB.set("settings", state.settings)]).then(function () {
        rebuild(); syncSoon(0); toast("Restored " + plural(state.reviews.length - before, "answer") + "."); refresh();
      });
    }).catch(function () { toast("That file isn't an MTLE Reviewer backup."); });
  }

  /* ---------- light and dark mode ---------- */
  function effectiveTheme() {
    var set = document.documentElement.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function paintToggle() {
    var b = document.getElementById("theme-toggle"), next = effectiveTheme() === "dark" ? "light" : "dark";
    b.textContent = next === "light" ? "Light mode" : "Dark mode";
    b.setAttribute("aria-label", "Switch to " + next + " mode");
  }
  var themeFadeT = null;
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var next = effectiveTheme() === "dark" ? "light" : "dark", r = document.documentElement;
    if (!motionOff()) {   // colours cross-fade for a moment instead of snapping; only during the switch, so nothing else slows down
      r.classList.add("theme-fade"); void r.offsetWidth;
      clearTimeout(themeFadeT); themeFadeT = setTimeout(function () { r.classList.remove("theme-fade"); }, 450);
    }
    r.setAttribute("data-theme", next);
    ls.set("theme", next); paintToggle();
  });
  if (window.matchMedia) { try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintToggle); } catch (e) { /* old browsers */ } }
  paintToggle();

  /* ---------- stay on the newest version (same approach as the hubs) ---------- */
  var lastCheck = 0;
  function checkVersion(onLoad) {
    if (BUILD.indexOf("__") === 0) return;
    lastCheck = Date.now();
    fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.v || j.v === BUILD) return;
      var tried = null; try { tried = sessionStorage.getItem("mt.reloadedFor"); } catch (e) { /* ignore */ }
      if (onLoad && tried !== j.v) { refreshTo(j.v); return; }
      var n = document.getElementById("update-notice");
      if (!n) { n = document.createElement("div"); n.id = "update-notice"; n.className = "notice"; n.setAttribute("role", "status"); document.getElementById("notice").before(n); }
      n.innerHTML = '<p><b>New questions or fixes are ready.</b> <button type="button" class="btn btn--quiet" id="reload-new">Reload to get them</button></p>';
      document.getElementById("reload-new").addEventListener("click", function () { refreshTo(j.v); });
    }).catch(function () { /* offline: keep going */ });
  }
  function refreshTo(v) {
    try { sessionStorage.setItem("mt.reloadedFor", v); } catch (e) { /* ignore */ }
    var urls = ["./", "index.html", "assets/app.js?v=" + v, "assets/engine.js?v=" + v, "assets/store.js?v=" + v, "assets/styles.css?v=" + v, "assets/config.js?v=" + v];
    Promise.all(urls.map(function (u) { return fetch(u, { cache: "reload" }).catch(function () {}); })).then(function () { location.reload(); });
  }
  var lastSyncTry = Date.now();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { beacon(); return; }
    if (Date.now() - lastCheck > 5 * 60000) checkVersion(false);
    if (cfg.apiUrl && ls.get("code") && Date.now() - lastSyncTry > 10 * 60000) {
      lastSyncTry = Date.now();
      sync(true).then(function (changed) { if (changed && location.hash.indexOf("#/s") !== 0 && location.hash.indexOf("#/exam/run") !== 0) refresh(); }).catch(function () {});
    }
  });
  window.addEventListener("pagehide", beacon);

  /* ---------- start ---------- */
  function start() {
    restoreRuns();
    return Promise.all([loadData(), loadLocal()]).then(function () {
      rebuild();
      applyMotion();
      showStatus();
      if (cfg.apiUrl && !ls.get("code") && !ls.get("skipGate")) { state.ready = false; main.innerHTML = viewGate(""); main.setAttribute("aria-busy", "false"); return; }
      state.ready = true;
      route();
      if (cfg.apiUrl && ls.get("code")) {
        sync(true).then(function (changed) { if (changed && location.hash.indexOf("#/s") !== 0 && location.hash.indexOf("#/exam/run") !== 0) refresh(); }, function (err) {
          if (err.code === "code") { ls.del("code"); state.ready = false; main.innerHTML = viewGate("The saved access code stopped working. Enter the current one."); }
        });
      }
    }).catch(function (e) {
      main.innerHTML = '<div class="wrap"><div class="head"><h1 tabindex="-1">Couldn\'t load the questions</h1><p>' + esc(e.message || "Something went wrong.") + ' Check your connection, then reload the page.</p><div class="actions"><button class="btn btn--solid" type="button" onclick="location.reload()">Reload</button></div></div></div>';
      main.setAttribute("aria-busy", "false");
    });
  }
  checkVersion(true);
  start();
})();
