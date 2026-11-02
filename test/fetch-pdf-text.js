/* PDF から本文テキストを抜き出す簡易ツール（FlateDecode ストリームを展開して Tj/TJ を拾う）
 * node test/fetch-pdf-text.js <URL> [検索語]
 * 依存パッケージなし（Node の zlib のみ） */
const zlib = require('zlib');

const url = process.argv[2];
const needle = process.argv[3];

/* PDF の 16進/8進エスケープと基本的な文字コードを復元する */
function decodeText(bytes) {
  // UTF-16BE（BOM付き）
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return Buffer.from(bytes.slice(2)).swap16().toString('utf16le');
  }
  return Buffer.from(bytes).toString('latin1');
}

function extract(buf) {
  const out = [];
  // ストリームを総当たりで展開
  let idx = 0;
  while (true) {
    const s = buf.indexOf('stream', idx);
    if (s < 0) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf('endstream', start);
    if (e < 0) break;
    const raw = buf.slice(start, e);
    idx = e + 9;
    let data = null;
    try { data = zlib.inflateSync(raw); } catch (err) {
      try { data = zlib.inflateRawSync(raw); } catch (err2) { continue; }
    }
    const txt = data.toString('latin1');
    if (!/(Tj|TJ)/.test(txt)) continue;
    // (...)Tj と [(..)..]TJ の中身を集める
    for (const m of txt.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(unescapePdf(m[1]));
    for (const m of txt.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
      const parts = [...m[1].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(x => unescapePdf(x[1]));
      out.push(parts.join(''));
    }
    // <16進>Tj
    for (const m of txt.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      const hex = m[1].replace(/\s/g, '');
      const bytes = Buffer.from(hex, 'hex');
      out.push(decodeText(bytes));
    }
  }
  return out;
}
function unescapePdf(s) {
  return s.replace(/\\([nrtbf()\\])/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (m, o) => String.fromCharCode(parseInt(o, 8)));
}

(async () => {
  const res = await fetch(url, { headers: { 'User-Agent': 'local-tax-tool/1.0' } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('取得:', url, buf.length, 'bytes');
  const lines = extract(buf);
  console.log('抽出テキスト片:', lines.length);
  const joined = lines.join('\n');
  if (needle) {
    const hits = joined.split('\n').filter(l => l.includes(needle));
    console.log(`--- 「${needle}」を含む行 (${hits.length}) ---`);
    hits.slice(0, 60).forEach(l => console.log('  ' + l));
  } else {
    console.log(joined.slice(0, 4000));
  }
})();
