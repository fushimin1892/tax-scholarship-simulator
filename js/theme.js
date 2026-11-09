/* ============================================================================
 * theme.js — 画面の配色（端末に合わせる／ライト／ダーク）
 *
 * <head> で読み込んで、最初の描画より前に <html data-theme> を決める。
 * こうしないと、ダークを選んでいる人に一瞬だけ白い画面が出てしまう。
 *
 * 保存するのは配色の設定だけ（キー1つ）。収入・控除などの入力内容は
 * このサイトでは一切保存しない。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var KEY = 'tk-theme';               // 保存するのはこのキーだけ
  var MODES = ['auto', 'light', 'dark'];
  var listeners = [];

  /* localStorage はプライベートモード等で例外を投げることがあるので必ず包む */
  function read() {
    try {
      var v = root.localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) { return 'auto'; }
  }
  function write(mode) {
    try {
      if (mode === 'auto') root.localStorage.removeItem(KEY);
      else root.localStorage.setItem(KEY, mode);
    } catch (e) { /* 保存できなくても動作に影響はない */ }
  }

  var mql = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  function systemIsDark() { return !!(mql && mql.matches); }

  /* mode（利用者の選択）から、実際に適用する配色を決めて <html> に反映する */
  function apply(mode) {
    var el = root.document.documentElement;
    if (mode === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', mode);
  }

  var current = read();
  apply(current);

  /* 「端末に合わせる」のときだけ、OSの設定変更に追従する */
  if (mql) {
    var onChange = function () {
      if (current === 'auto') { apply('auto'); notify(); }
    };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }

  function notify() {
    var eff = effective();
    listeners.forEach(function (fn) { try { fn(current, eff); } catch (e) { /* noop */ } });
  }
  function effective() { return current === 'auto' ? (systemIsDark() ? 'dark' : 'light') : current; }

  root.TaxTheme = {
    /** 利用者が選んでいる設定（'auto' | 'light' | 'dark'） */
    get: function () { return current; },
    /** 実際に表示されている配色（'light' | 'dark'） */
    effective: effective,
    /** 設定を変える */
    set: function (mode) {
      if (MODES.indexOf(mode) < 0) mode = 'auto';
      current = mode;
      apply(mode);
      write(mode);
      notify();
      return mode;
    },
    /** 設定が変わったときに呼ばれる関数を登録する */
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    MODES: MODES
  };
})(typeof window !== 'undefined' ? window : this);
