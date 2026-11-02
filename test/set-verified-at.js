/* ============================================================================
 * set-verified-at.js — assets/data.js の「最終確認日」を進める
 *
 *   node test/set-verified-at.js            … 今日（日本時間）にする
 *   node test/set-verified-at.js 2026-09-18 … 日付を指定する
 *
 * ■ この1行だけを書き換えます
 *     var VERIFIED_AT = 'YYYY-MM-DD';
 *   次回の確認予定日（NEXT_REVIEW）は data.js が自動で計算するので触りません。
 *
 * ■ なぜ sed ではなく専用スクリプトなのか
 *   この日付は「いつ時点の値か」を利用者に約束する表示です。書き損じても
 *   テストは通ってしまい、誰も気づけません。そこで
 *     ・日付として実在すること
 *     ・未来日でないこと（確認していない日を「確認済み」にしない）
 *     ・今より前に戻さないこと
 *     ・書き換え対象の行がちょうど1つであること
 *   を確かめてから書き、書いたあとに読み直して確認します。
 *
 * ■ 実行したあとは必ず
 *     node test/build-tax-parameters.js   （tax-parameters.json に日付が入るため）
 *   を流してください。忘れると test/audit.js の D-6 が落ちます。
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'assets', 'data.js');
const LINE = /^(\s*var VERIFIED_AT = ')(\d{4}-\d{2}-\d{2})(';.*)$/;

/* 日本時間の今日。UTCで動く CI から呼ばれても日付がずれないようにする。 */
function todayJST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

const target = process.argv[2] || todayJST();

if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
  die(`日付は YYYY-MM-DD で指定してください（受け取った値: ${target}）`);
}
/* 2026-02-31 のような「形は正しいが存在しない日」を弾く */
const parsed = new Date(target + 'T00:00:00Z');
if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== target) {
  die(`存在しない日付です: ${target}`);
}
if (target > todayJST()) {
  die(`未来の日付は入れられません（指定 ${target} / 今日 ${todayJST()}）。\n` +
      '  まだ確認していない日を「確認済み」と表示することになります。');
}

const before = fs.readFileSync(FILE, 'utf8');
const hits = before.split('\n').filter(l => LINE.test(l));
if (hits.length !== 1) {
  die(`VERIFIED_AT の行が ${hits.length} 個見つかりました（1個であるべきです）。` +
      'data.js の書き方が変わっていないか確認してください。');
}

const current = hits[0].match(LINE)[2];
if (current === target) {
  console.log(`変更なし: VERIFIED_AT は既に ${target} です。`);
  process.exit(0);
}
if (target < current) {
  die(`最終確認日は前に戻せません（現在 ${current} → 指定 ${target}）。`);
}

const after = before.split('\n')
  .map(l => (LINE.test(l) ? l.replace(LINE, `$1${target}$3`) : l))
  .join('\n');
fs.writeFileSync(FILE, after);

/* 書いたものを読み直して、意図した1行だけが変わったことを確かめる */
delete require.cache[require.resolve(FILE)];
const D = require(FILE);
if (D.VERIFIED_AT !== target) die('書き換えたのに読み直すと値が違います。中断しました。');
const diff = before.split('\n').filter((l, i) => l !== after.split('\n')[i]);
if (diff.length !== 1) die(`${diff.length} 行が変わりました（1行であるべきです）。`);

console.log(`✔ VERIFIED_AT: ${current} → ${target}`);
console.log(`  次回の確認予定日は ${D.NEXT_REVIEW} になります。`);
console.log('  続けて node test/build-tax-parameters.js を実行してください。');
