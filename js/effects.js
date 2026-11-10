/* ============================================================================
 * effects.js — 画面の動き（2026年11月）
 *
 * カーソルを動かすと、カードの上に光の筋がついてくる「スポットライト」だけを
 * ここで扱う。計算には関係しない。
 *   ・マウスなど、ホバーできる機器でだけ動く（タッチ画面では何もしない）
 *   ・動きを減らす設定の端末では何もしない
 *   ・外部のライブラリ・通信は使わない
 * 見た目（アニメーションの時間や色）は css/design.css の「未来感のある動き」で決める。
 * ==========================================================================*/
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (reduce || !fine) return;

  var current = null;
  document.addEventListener('pointermove', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('.card') : null;
    if (current && current !== card) current.classList.remove('spot-on');
    if (!card) { current = null; return; }
    var r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
    card.classList.add('spot-on');
    current = card;
  }, { passive: true });
  document.addEventListener('pointerleave', function () {
    if (current) current.classList.remove('spot-on');
    current = null;
  }, true);
})();
