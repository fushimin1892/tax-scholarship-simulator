/* ============================================================================
 * check-cities.js — 超過課税・減税を行う市区町村の取りこぼしを見張る
 *
 *   node test/check-cities.js
 *
 * 総務省「市町村民税及び固定資産税の税率等別市町村数調」（ichiran06_rNN_13.pdf）の
 * 注記に載る「所得割／均等割の超過税率採用団体・標準税率未満採用団体」を読み取り、
 * assets/data.js の CITIES に同じ税率で登録されているかを突き合わせる。
 *
 *   ⚠ 要追加 … 総務省の一覧にあるのに CITIES に登録がない（標準税率で計算されてしまう）
 *   ⚠ 要確認 … 登録はあるが税率が違う／CITIES で特例にしているのに総務省の一覧にない
 *
 * check-updates.js と同じく data.js は書き換えない。総務省の調査は前年4月1日現在の値なので、
 * 追加・修正するときは必ずその自治体の公式ページで今年度の税率と適用期間を確かめてから
 * CITIES に書き、境界のテストを足す。要追加の行には CITIES に書く形の候補を表示する。
 *
 * 必要なもの：pdftotext（poppler-utils）
 * ==========================================================================*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../assets/data.js');
global.window = global;
require('../assets/cities.js');
const CK = global.CityKyuchi;

const BASE = 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/pdf/';
const STD_KIN = D.KINTOWARI.city;

/* 今の令和年度の次の版から順に探し、最初に公表されている版を使う
 * （rNN は調査年度＋1。例：r08 ＝ 令和7年度・令和7年4月1日現在） */
async function fetchLatest() {
  const reiwa = new Date().getFullYear() - 2018;
  for (let r = reiwa + 1; r >= reiwa - 2; r--) {
    const nn = String(r).padStart(2, '0');
    const url = `${BASE}ichiran06_r${nn}/ichiran06_r${nn}_13.pdf`;
    let res;
    try { res = await fetch(url); } catch (e) { console.log(`取得失敗 ${url}（${e.message}）`); continue; }
    if (res.status === 404) { console.log(`未公表 ${url}（404）`); continue; }
    if (!res.ok) { console.log(`取得失敗 ${url}（HTTP ${res.status}）`); continue; }
    return { url, buf: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}

function pdfText(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cities-'));
  const pdf = path.join(dir, 'a.pdf');
  fs.writeFileSync(pdf, buf);
  try { return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* 「（注）◯ 令和◯年4月1日現在の所得割超過税率採用団体」の次の行から、次の（注）までを拾う */
function pickList(section, label, unit) {
  const i = section.indexOf(label);
  if (i < 0) return null;
  const rest = section.slice(section.indexOf('\n', i) + 1);
  const end = rest.search(/（注）|\n\s*\n\s*\n|\(\d\)/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const re = unit === '%'
    ? /([^\s（）0-9]+?[市町村区])\s*([\d.]+)\s*％/g
    : /([^\s（）0-9]+?[市町村区])\s*([\d,]+)\s*円/g;
  const out = [];
  let m;
  while ((m = re.exec(body))) out.push({ name: m[1], value: Number(m[2].replace(/,/g, '')) });
  return out;
}

function sliceBetween(text, from, to) {
  const i = text.search(from);
  if (i < 0) return '';
  const j = text.slice(i + 1).search(to);
  return j < 0 ? text.slice(i) : text.slice(i, i + 1 + j);
}

/* CITIES の登録から、実際に計算に使う市町村民税の税率と均等割を出す */
function appRates() {
  const map = {};
  Object.keys(D.CITIES).forEach(pref => D.CITIES[pref].forEach(c => {
    const stdRate = c.seirei ? 8 : 6;
    map[c.n] = {
      pref, entry: c, stdRate,
      rate: c.fixRate != null ? c.fixRate : stdRate,
      kin: c.fixKin != null ? c.fixKin : STD_KIN + (c.addKin || 0)
    };
  }));
  return map;
}

function prefsOf(name) {
  return Object.keys(CK).filter(p => CK[p].some(x => x[0] === name));
}
function kyuchiOf(pref, name) {
  const hit = (CK[pref] || []).find(x => x[0] === name);
  return hit ? hit[1] : '?';
}

(async () => {
  const got = await fetchLatest();
  if (!got) {
    console.log('\n一致 0 / 要追加 0 / 要確認 0 / 取得失敗 1');
    process.exit(1);
  }
  let text;
  try { text = pdfText(got.buf); } catch (e) {
    console.log(`pdftotext を実行できません（${e.message}）。poppler-utils を入れてください。`);
    console.log('\n一致 0 / 要追加 0 / 要確認 0 / 取得失敗 1');
    process.exit(1);
  }
  const asOf = (text.match(/令和\s*(\d+)\s*年\s*4\s*月\s*1\s*日現在/) || [])[1];
  console.log(`資料: ${got.url}`);
  console.log(`時点: 令和${asOf || '?'}年4月1日現在（前年の調査。今年度の値は自治体の公式ページで確認する）\n`);

  const sec1 = sliceBetween(text, /\(1\)\s*市町村民税所得割/, /\(2\)\s*市町村民税個人均等割/);
  const sec2 = sliceBetween(text, /\(2\)\s*市町村民税個人均等割/, /\(3\)\s*市町村民税法人税割/);
  const lists = {
    rateOver: pickList(sec1, '所得割超過税率採用団体', '%'),
    rateUnder: pickList(sec1, '所得割標準税率未満採用団体', '%'),
    kinOver: pickList(sec2, '均等割超過税率採用団体', '円'),
    kinUnder: pickList(sec2, '均等割標準税率未満採用団体', '円')
  };
  let fail = 0;
  Object.keys(lists).forEach(k => {
    if (!lists[k]) { console.log(`⚠ PDFの書式が変わり ${k} の注記を読み取れない。手で開いて確認する`); fail++; lists[k] = []; }
  });
  /* 「ほか不均一課税団体」が「－」以外なら、一部地域だけ税率が違う団体がある */
  [[sec1, '所得割'], [sec2, '均等割']].forEach(([s, label]) => {
    const row = (s.match(/市\s*町\s*村\s*数[^\n]*/) || [''])[0].trim().split(/\s+/);
    const last = row[row.length - 1];
    if (last && last !== '－' && last !== '-') {
      console.log(`⚠ ${label}に不均一課税団体が ${last} 団体ある。PDFを手で開いて対象を確認する`);
      fail++;
    }
  });

  const app = appRates();
  const rows = [];
  const seen = { rate: new Set(), kin: new Set() };
  const check = (item, kind) => {
    const a = app[item.name];
    seen[kind].add(item.name);
    const unit = kind === 'rate' ? '％' : '円';
    const label = kind === 'rate' ? '所得割' : '均等割';
    if (!a) {
      const prefs = prefsOf(item.name);
      const pref = prefs.length === 1 ? prefs[0] : prefs.join('／') || '不明';
      const field = kind === 'rate' ? `fixRate: ${item.value}` :
        (item.value > STD_KIN ? `addKin: ${item.value - STD_KIN}` : `fixKin: ${item.value}`);
      rows.push(['⚠ 要追加', `${pref} ${item.name}`, `${label} ${item.value.toLocaleString()}${unit}`,
        `CITIES['${prefs[0] || '?'}'] に { n: '${item.name}', ${field}, kyuchi: ${prefs.length === 1 ? kyuchiOf(prefs[0], item.name) : '?'} } を追加（公式ページで今年度の値を確認してから）`]);
      return;
    }
    const v = kind === 'rate' ? a.rate : a.kin;
    if (Math.abs(v - item.value) > 1e-9) {
      rows.push(['⚠ 要確認', `${a.pref} ${item.name}`, `${label} 総務省 ${item.value.toLocaleString()}${unit}／アプリ ${v.toLocaleString()}${unit}`,
        '公式ページで今年度の値を確認して CITIES を直す']);
    } else {
      rows.push(['✅ 一致', `${a.pref} ${item.name}`, `${label} ${item.value.toLocaleString()}${unit}`, '']);
    }
  };
  lists.rateOver.concat(lists.rateUnder).forEach(x => check(x, 'rate'));
  lists.kinOver.concat(lists.kinUnder).forEach(x => check(x, 'kin'));

  /* アプリだけが特例扱いにしている団体（総務省の一覧にない）＝ 制度が終わった可能性 */
  Object.keys(app).forEach(name => {
    const a = app[name];
    if (a.rate !== a.stdRate && !seen.rate.has(name)) {
      rows.push(['⚠ 要確認', `${a.pref} ${name}`, `所得割 アプリ ${a.rate}％（総務省の一覧になし）`, '制度が終わっていないか公式ページで確認する']);
    }
    if (a.kin !== STD_KIN && !seen.kin.has(name)) {
      rows.push(['⚠ 要確認', `${a.pref} ${name}`, `均等割 アプリ ${a.kin.toLocaleString()}円（総務省の一覧になし）`,
        '総務省の調査より新しい改正の可能性もある。公式ページで確認する']);
    }
  });

  rows.forEach(r => console.log(r.filter(Boolean).join(' | ')));
  const n = s => rows.filter(r => r[0] === s).length;
  const add = n('⚠ 要追加'), chk = n('⚠ 要確認');
  console.log(`\n一致 ${n('✅ 一致')} / 要追加 ${add} / 要確認 ${chk + fail} / 取得失敗 0`);
  if (add) console.log('\n要追加の団体は、確認のうえ assets/data.js の CITIES に追加し、test/verify-calc.js に境界のテストを足してください。');
  process.exit(add || chk || fail ? 1 : 0);
})();
