/**
 * uph_poki.js — Offline stub for Poki SDK bindings
 *
 * RetroBowl.js calls these raw functions via gml_Script_poki_init and friends.
 * Without this file (404) the functions are undefined, so poki_init_raw() throws
 * a ReferenceError inside _6i5(), which the _7a6() wrapper swallows — leaving
 * _P96 stuck at 1 forever and spinning the CPU until iOS Safari kills the tab.
 *
 * This stub makes every Poki call a safe no-op so the game boots normally.
 */
(function (w) {
  'use strict';

  /* ── Init ─────────────────────────────────────────────────────────────── */

  /**
   * Called by gml_Script_poki_init.  Return false so the GML "then" callback
   * (gml_Script_gmcallback_poki_closure) is skipped — we're not on Poki, so
   * we don't need Poki's handshake before the game can start.
   */
  w.poki_init_raw = function () { return false; };

  /* ── Ad breaks ────────────────────────────────────────────────────────── */

  /**
   * Commercial / rewarded breaks: immediately invoke the GML callback so the
   * game resumes right away (no actual ad is served outside of poki.com).
   */
  w.poki_commercial_break_raw = function (cb) {
    if (typeof cb === 'function') setTimeout(cb, 0);
  };

  w.poki_rewarded_break_raw = function (cb) {
    if (typeof cb === 'function') setTimeout(cb, 0);
  };

  /**
   * Creates a JS closure that wraps a GML callback for Poki to call.
   * We just return a harmless no-op — it will never be called outside Poki.
   */
  w.poki_script_closure_raw = function (selfObj, otherObj, script, custom) {
    return function () { /* stub — no Poki platform, never called */ };
  };

  /* ── Team / metadata ─────────────────────────────────────────────────── */

  w.poki_get_team_raw = function () { return 0; };
  w.poki_set_team_raw = function (val) { /* no-op */ };

  /* ── Gameplay signals (called directly, not via raw suffix) ──────────── */

  w.poki_happy_time    = function (val)  { /* no-op */ };
  w.poki_gameplay_start = function ()    { /* no-op */ };
  w.poki_gameplay_stop  = function ()    { /* no-op */ };

  /* ── Custom loading bar ───────────────────────────────────────────────── */

  /**
   * eval("poki_loadbar") is called in the _7a6 state-machine case 0 when
   * _em3._vl._cm == "poki_loadbar".  Forward to the standard GM loading-bar
   * function (_if5) so the progress bar still renders during asset loading.
   */
  w.poki_loadbar = function () {
    if (typeof _if5 === 'function') {
      _if5.apply(this, arguments);
    }
  };

}(window));
