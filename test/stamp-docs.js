/* ============================================================================
 * stamp-docs.js — 計算とデータが変わったのに、説明書（docs）が直されないまま残るのを防ぐ
 *
 *   node test/stamp-docs.js            … 今のコードの指紋と、docs に書いてある指紋を比べて表示する
 *   node test/stamp-docs.js --update   … docs/05 と docs/02 を見直して直したあとに実行し、指紋を書き込む
 *
 * 「指紋」は js/calc.js と data/tax-data.js の中身から作る短い文字列。
 * どちらかを1文字でも変えると指紋が変わり、docs に書いてある指紋と合わなくなる。
 * 合わないと test/audit.js（D-8）が失敗するので、docs を見直さずに公開することはできない。
 *
 * 確認日（VERIFIED_AT）の行だけは指紋に含めない。月次の確認で日付を進めただけなら
 * 計算は変わっていないので、docs を見直す必要はないため。
 *
 * docs/06 は node test/report-matrix.js が作り直すときに指紋を書き込むので、ここでは扱わない。
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['js/calc.js', 'data/tax-data.js'];
/* 見直しが必要な docs（現行の仕様・設計を書いたもの） */
const DOCS = ['docs/05-計算方法とまるめの一覧.md', 'docs/02-システム設計書.md'];
const LABEL = '照合したコードの指紋：';

function fingerprint() {
  const h = crypto.createHash('sha256');
  SOURCES.forEach(function (f) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n').filter(function (line) { return !/VERIFIED_AT\s*=/.test(line); }).join('\n');
    h.update(f + '\n' + text + '\n');
  });
  return h.digest('hex').slice(0, 12);
}

/* docs に書いてある指紋を読む（なければ null） */
function stampOf(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = text.match(new RegExp(LABEL + '`([0-9a-f]{12})`'));
  return m ? m[1] : null;
}

function writeStamp(file, fp) {
  const full = path.join(ROOT, file);
  let s = fs.readFileSync(full, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  s = s.replace(/\r\n/g, '\n');
  const line = '> - ' + LABEL + '`' + fp + '`（`js/calc.js` と `data/tax-data.js` の中身から作る。' +
    'この文書をコードと照らして見直したら `node test/stamp-docs.js --update` で書き換える。' +
    'コードと合わないと `node test/audit.js` が失敗する）';
  if (new RegExp('> - ' + LABEL).test(s)) {
    s = s.replace(new RegExp('> - ' + LABEL + '.*'), line);
  } else {
    /* 冒頭の「この文書について」の最後の行の後ろに入れる */
    const i = s.indexOf('> **この文書について');
    if (i < 0) throw new Error(file + ' に「この文書について」がありません');
    let j = s.indexOf('\n', i);
    while (s.slice(j + 1, j + 3) === '> ') j = s.indexOf('\n', j + 1);
    s = s.slice(0, j + 1) + line + '\n' + s.slice(j + 1);
  }
  fs.writeFileSync(full, s.replace(/\n/g, nl));
}

if (require.main === module) {
  const fp = fingerprint();
  const update = process.argv.includes('--update');
  console.log('今のコードの指紋：' + fp);
  DOCS.forEach(function (f) {
    if (update) writeStamp(f, fp);
    const st = stampOf(f);
    console.log((st === fp ? '  一致    ' : '  不一致  ') + f + '（書いてある指紋：' + (st || 'なし') + '）');
  });
  if (!update && DOCS.some(function (f) { return stampOf(f) !== fp; })) {
    console.log('\ncalc.js か tax-data.js が変わっています。docs/05・docs/02 をコードと照らして直してから、');
    console.log('node test/stamp-docs.js --update を実行してください。');
    process.exitCode = 1;
  }
}

module.exports = { fingerprint: fingerprint, stampOf: stampOf, DOCS: DOCS };
