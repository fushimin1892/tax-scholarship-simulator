/* 47都道府県の市区町村一覧＋生活保護法の級地区分を組み立てて assets/cities.js を生成する
 *   出典: Wikipedia「級地制度」の生ウィキテキスト／MediaWiki API の Category:◯◯県の市町村
 *   実行: node test/build-city-data.js                                          */
const fs = require('fs');
const path = require('path');

const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県',
  '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県',
  '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const WARDS23 = '千代田 中央 港 新宿 文京 台東 墨田 江東 品川 目黒 大田 世田谷 渋谷 中野 杉並 豊島 北 荒川 板橋 練馬 足立 葛飾 江戸川'.split(' ');
const UA = { 'User-Agent': 'local-tax-tool/1.0 (personal use)' };
/* カテゴリに紛れ込む非自治体ページ、および居住実態のない北方領土の村を除外する */
const EXCLUDE = new Set(['彩の国中核都市', '紗那村', '色丹村', '留別村', '留夜別村', '蘂取村']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const rawText = t => fetch('https://ja.wikipedia.org/w/index.php?title=' + encodeURIComponent(t) + '&action=raw', { headers: UA })
  .then(r => r.ok ? r.text() : null);

/* ---------- 級地区分（都道府県ごとに保持して同名市の取り違えを防ぐ） ---------- */
function parseKyuchi(text) {
  const map = {};                       // "都道府県|市区町村名" -> 1 | 2
  const section = (name) => {
    const i = text.indexOf('=== ' + name + ' ===');
    if (i < 0) return '';
    const j = text.indexOf('=== ', i + 5);
    return text.slice(i, j < 0 ? text.length : j);
  };
  const linkLabel = s => {
    const m = s.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    return m ? { target: m[1].trim(), label: (m[2] || m[1]).trim() } : null;
  };

  ['1級地-1', '1級地-2', '2級地-1', '2級地-2'].forEach(name => {
    const rank = name[0] === '1' ? 1 : 2;
    let pref = null;
    for (const line of section(name).split('\n')) {
      if (/^;/.test(line)) {                                   // ;[[都道府県]]:[[市]] または ;[[都道府県]]
        const head = linkLabel(line);
        if (head && PREFS.includes(head.label)) {
          pref = head.label;
          const rest = line.slice(line.indexOf(']]') + 2);      // 同じ行に市町村が続く場合
          const first = linkLabel(rest);
          if (first) add(pref, first, rank, map);
        }
        continue;
      }
      if (/^:+/.test(line) && pref) {
        const it = linkLabel(line);
        if (it) add(pref, it, rank, map);
      }
    }
  });
  return map;
}
function add(pref, item, rank, map) {
  if (item.target === '東京都区部') { map['東京都|特別区（23区）'] = rank; return; }
  const name = item.label.replace(/\s*\(.+?\)\s*$/, '');
  if (/郡$/.test(name)) return;                                 // 郡は見出しなので除外
  if (!/[市区町村]$/.test(name)) return;
  map[pref + '|' + name] = rank;
}

/* ---------- 市区町村一覧（カテゴリから取得） ---------- */
async function fetchCities(pref) {
  const url = 'https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=' +
    encodeURIComponent('Category:' + pref + 'の市町村') + '&cmlimit=500&cmtype=page&format=json';
  let j = null;
  for (let attempt = 0; attempt < 6 && !j; attempt++) {
    if (attempt) await sleep(3000 * attempt);
    const res = await fetch(url, { headers: UA });
    const body = await res.text();
    try { j = JSON.parse(body); } catch (e) { process.stdout.write(' …再試行'); }
  }
  if (!j) throw new Error(pref + ' の取得に失敗しました');
  const members = (j.query && j.query.categorymembers) || [];
  const names = new Set();
  members.forEach(m => {
    const name = m.title.replace(/\s*\(.+?\)\s*$/, '');
    if (!/[市町村]$/.test(name)) return;                        // 「◯◯県の市町村旗一覧」等を除外
    if (/一覧$/.test(name) || /^市町村/.test(name)) return;
    if (EXCLUDE.has(name)) return;
    names.add(name);
  });
  return [...names];
}

(async () => {
  console.log('級地制度を取得中…');
  const kyuchi = parseKyuchi(await rawText('級地制度'));
  const k1 = Object.values(kyuchi).filter(v => v === 1).length;
  const k2 = Object.values(kyuchi).filter(v => v === 2).length;
  console.log(`  1級地 ${k1} 団体 ／ 2級地 ${k2} 団体`);

  const result = {};
  for (const pref of PREFS) {
    let list = await fetchCities(pref);
    if (pref === '東京都') {
      list = list.filter(n => !WARDS23.includes(n.replace(/区$/, '')));
      list.unshift('特別区（23区）');
    }
    list.sort((a, b) => {
      if (a === '特別区（23区）') return -1;          // 東京23区は常に先頭
      if (b === '特別区（23区）') return 1;
      const r = (s) => /市$/.test(s) ? 0 : /区$/.test(s) ? 0 : /町$/.test(s) ? 1 : 2;
      return r(a) - r(b) || a.localeCompare(b, 'ja');
    });
    result[pref] = list.map(n => [n, kyuchi[pref + '|' + n] || 3]);
    const c1 = result[pref].filter(x => x[1] === 1).length, c2 = result[pref].filter(x => x[1] === 2).length;
    console.log(`  ${pref.padEnd(5, '　')} ${String(result[pref].length).padStart(3)}件  1級地${c1} / 2級地${c2}`);
    await sleep(900);
  }

  // 級地表にあるのに一覧側で拾えなかったものを警告（取りこぼし検出）
  const have = new Set(Object.entries(result).flatMap(([p, a]) => a.map(x => p + '|' + x[0])));
  const miss = Object.keys(kyuchi).filter(k => !have.has(k));
  if (miss.length) console.log('\n⚠ 一覧に無い級地指定団体:', miss.join('  '));
  else console.log('\n✔ 級地指定団体はすべて市区町村一覧に含まれています');

  const flat = Object.values(result).flat();
  console.log(`合計 ${flat.length} 団体（1級地 ${flat.filter(x => x[1] === 1).length} / ` +
    `2級地 ${flat.filter(x => x[1] === 2).length} / 3級地 ${flat.filter(x => x[1] === 3).length}）`);

  const body = '/* 自動生成ファイル（編集しないでください）— 生成元: test/build-city-data.js\n' +
    ' * 各都道府県の市区町村名と、生活保護法の級地区分（1／2／3）。\n' +
    ' * 住民税の均等割の非課税限度額はこの級地区分に準じます。\n' +
    ' * 出典: Wikipedia「級地制度」（厚生労働省告示に基づく／平成30年10月1日現在）ほか。\n' +
    ' * 合併・指定替えで変わることがあるため、画面上で級地を手動変更できるようにしてあります。\n */\n' +
    '(function (root) {\n  var CITY_KYUCHI = ' + JSON.stringify(result) + ';\n' +
    '  root.CityKyuchi = CITY_KYUCHI;\n' +
    '  if (typeof module !== "undefined" && module.exports) module.exports = CITY_KYUCHI;\n' +
    '})(typeof globalThis !== "undefined" ? globalThis : this);\n';
  const out = path.join(__dirname, '..', 'assets', 'cities.js');
  fs.writeFileSync(out, body);
  console.log('→', out, Math.round(body.length / 1024) + 'KB');
})();
