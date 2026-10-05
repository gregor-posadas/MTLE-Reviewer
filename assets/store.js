/* MTLE Reviewer: storage on this device.
   IndexedDB holds the review log and a few small records (settings, flags, her own questions).
   If IndexedDB isn't available (some private-browsing modes), it falls back to localStorage,
   and if that fails too, to memory for this visit only. Every call returns a Promise. */
(function () {
  "use strict";

  var NAME = "mtle-reviewer", VERSION = 1, LS = "mt.db.";
  var memory = { reviews: {}, kv: {} };
  var mode = "memory", dbp = null;

  function req(r) { return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, no) {
      if (!window.indexedDB) { no(new Error("no indexedDB")); return; }
      var r;
      try { r = window.indexedDB.open(NAME, VERSION); } catch (e) { no(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains("reviews")) db.createObjectStore("reviews", { keyPath: "id" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "k" });
      };
      r.onsuccess = function () { mode = "idb"; ok(r.result); };
      r.onerror = function () { no(r.error); };
      r.onblocked = function () { no(new Error("blocked")); };
    }).catch(function () {
      try { window.localStorage.setItem(LS + "test", "1"); window.localStorage.removeItem(LS + "test"); mode = "local"; } catch (e) { mode = "memory"; }
      return null;
    });
    return dbp;
  }
  function lsGet(k) { try { return JSON.parse(window.localStorage.getItem(LS + k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }

  function tx(db, store, rw) { return db.transaction(store, rw ? "readwrite" : "readonly").objectStore(store); }

  var Store = {
    mode: function () { return mode; },
    ready: function () { return open(); },
    allReviews: function () {
      return open().then(function (db) {
        if (db) return req(tx(db, "reviews").getAll());
        if (mode === "local") return lsGet("reviews") || [];
        return Object.keys(memory.reviews).map(function (k) { return memory.reviews[k]; });
      });
    },
    addReviews: function (list) {
      if (!list || !list.length) return Promise.resolve();
      return open().then(function (db) {
        if (db) {
          return new Promise(function (ok, no) {
            var t = db.transaction("reviews", "readwrite"), s = t.objectStore("reviews");
            list.forEach(function (e) { s.put(e); });
            t.oncomplete = function () { ok(); }; t.onerror = function () { no(t.error); };
          });
        }
        if (mode === "local") {
          var cur = lsGet("reviews") || [], ids = {};
          cur.forEach(function (e, i) { ids[e.id] = i; });
          list.forEach(function (e) { if (ids[e.id] != null) cur[ids[e.id]] = e; else cur.push(e); });
          lsSet("reviews", cur); return;
        }
        list.forEach(function (e) { memory.reviews[e.id] = e; });
      });
    },
    clearReviews: function () {
      return open().then(function (db) {
        if (db) return req(tx(db, "reviews", true).clear());
        if (mode === "local") lsSet("reviews", []); else memory.reviews = {};
      });
    },
    get: function (k) {
      return open().then(function (db) {
        if (db) return req(tx(db, "kv").get(k)).then(function (r) { return r ? r.v : null; });
        if (mode === "local") return lsGet("kv." + k);
        return memory.kv[k] == null ? null : memory.kv[k];
      });
    },
    set: function (k, v) {
      return open().then(function (db) {
        if (db) return req(tx(db, "kv", true).put({ k: k, v: v }));
        if (mode === "local") lsSet("kv." + k, v); else memory.kv[k] = v;
      });
    },
    /* Ask the browser not to clear this site's data on its own. Safari still clears it after
       7 days without a visit, which is why the Sheet keeps a copy. */
    persist: function () {
      try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) { /* ignore */ }
      return Promise.resolve(false);
    }
  };
  window.MTStore = Store;
})();
