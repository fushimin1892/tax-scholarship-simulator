/* ============================================================================
 * check-updates.js — 公表資料を取りに行って、収録値とズレていないか見張る
 *
 *   node test/check-updates.js            … 全件
 *   node test/check-updates.js 国税庁      … 分類で絞り込み
 *
 * ■ このスクリプトは data.js を書き換えません（意図的に）
 *
 * 税額計算のデータを自動で書き換えるのは危険です。実際に次のことが起きます。
 *   ・国税庁の改正資料PDFはCIDフォントでテキストが取れない
 *   ・県の公式サイトはWAFでスクリプトからのアクセスを拒否することがある
 *   ・1ページに改正前後・法人/個人・複数年度が併記され、数値だけ拾うと前年の値を掴む
 *   ・URLも表記も毎年変わる
 * 誤った値が自動で入り、テストもその値で通ってしまうと誰も気づけません。
 * そこで「見つけて知らせる」までを自動にし、直すかどうかは人が決めます。
 *
 * 使い方の想定
 *   年に数回（1月・4月・6月・10月）これを流し、⚠ が出た項目だけ
 *   一次資料を自分で開いて確認し、assets/data.js を直す。
 * ==========================================================================*/
const D = require('../assets/data.js');

const only = process.argv[2];

/* ------------------------------------------------------------------
 * 監視対象。value は「本文に出てくるはずの数字」。
 * 取得できるHTMLページだけを対象にしている（PDFは抽出できないため）。
 * ----------------------------------------------------------------*/
const WATCH = [
  { cat: '国税庁', name: '基礎控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm',
    expect: () => [D.INCOME_TAX[2025].basic[0][1], D.INCOME_TAX[2025].basic[4][1]],
    note: '令和7年分の特例加算95万円と本則58万円' },
  { cat: '国税庁', name: '給与所得控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm',
    expect: () => [D.INCOME_TAX[2025].salaryMin, D.INCOME_TAX[2025].salaryMinCap],
    note: '最低保障65万円と適用上限190万円' },
  { cat: '国税庁', name: '所得税の税率', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm',
    expect: () => D.INCOME_TAX_BRACKETS.filter(b => b[2] > 0).map(b => b[2]),
    note: '速算表の控除額' },
  { cat: '国税庁', name: '特定親族特別控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm',
    expect: () => D.TOKUTEI_SHINZOKU.map(r => r[1]),
    note: '所得税の控除額の階段' },
  { cat: '国税庁', name: '扶養控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm',
    expect: () => [D.DEPENDENT_DEDUCTION.general[0], D.DEPENDENT_DEDUCTION.specific[0],
      D.DEPENDENT_DEDUCTION.oldOther[0], D.DEPENDENT_DEDUCTION.oldLiving[0]],
    note: '38万・63万・48万・58万' },
  { cat: '国税庁', name: '配偶者控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1191.htm',
    expect: () => [D.SPOUSE_DEDUCTION.normal[0][1], D.SPOUSE_DEDUCTION.old[0][1]],
    note: '38万・48万' },
  { cat: '国税庁', name: '生命保険料控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1140.htm',
    expect: () => [D.INSURANCE.lifeCategoryCapIncome, D.INSURANCE.lifeTotalCapIncome],
    note: '区分上限4万円・合計上限12万円' },
  /* 住民税の額は国税庁のページには載らないので、所得税分だけを見る */
  { cat: '国税庁', name: '地震保険料控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1145.htm',
    expect: () => [D.INSURANCE.quakeIncomeMax], note: '所得税の上限5万円' },
  /* 速算表は「収入×割合−控除額」の形なので、控除額のほうを見る */
  { cat: '国税庁', name: '公的年金等の課税関係', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1600.htm',
    expect: () => [D.PENSION_DEDUCTION.steps[0][2]],
    note: '速算表の控除額 27.5万円（このページに載るのはここまで。残りは別表）' },
  { cat: '国税庁', name: '退職所得', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1420.htm',
    expect: () => [D.RETIREMENT.perYearUnder20, D.RETIREMENT.min,
      D.RETIREMENT.base20, D.RETIREMENT.perYearOver20],
    note: '40万・80万・800万・70万' },
  { cat: '国税庁', name: '医療費控除', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1120.htm',
    expect: () => [100000, 2000000], note: '足切り10万円・上限200万円' },
  { cat: '国税庁', name: '山林所得', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1480.htm',
    expect: () => [D.FOREST.specialDeduction], note: '特別控除50万円' },

  { cat: '総務省', name: '森林環境税', url: 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/04000067.html',
    expectText: ['森林環境税'],
    manualNote: '税額（年額1,000円）はページ本文に出てこない（図表・PDF）。' +
      '金額そのものは test/verify-prefectures.js が自治体ページで毎回確認している',
    note: 'ページの存在と制度名だけ確認' },

  { cat: 'JASSO', name: '在学採用の家計基準', url: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kakei/zaigaku.html',
    expect: () => D.JASSO.kubun.filter(k => k.hi > 100).map(k => k.hi),
    note: '25,600円・51,300円・154,500円' },
  { cat: 'JASSO', name: '多子世帯支援', url: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kakei/r7tashikakudai/index.html',
    expectText: ['所得制限なく'], note: '多子世帯は所得制限なく授業料等減免' },
  { cat: 'JASSO', name: '給付奨学金の支給額', url: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kingaku.html',
    expect: () => [D.JASSO.monthly['大学・短期大学・専修学校（専門課程）']['国公立'][1],
      D.JASSO.monthly['大学・短期大学・専修学校（専門課程）']['私立'][1]],
    note: '第Ⅰ区分の自宅外 国公立66,700円・私立75,800円' },
  /* このページは本文がJavaScriptで描画されるため、取得しても中身が読めない。
   * 「確認できた」ふりをせず、最初から手で見る項目として扱う。 */
  { cat: 'JASSO', name: '第一種の家計基準', url: 'https://www.jasso.go.jp/shogakukin/about/taiyo/taiyo_1shu/kakei/zaigaku.html',
    manualOnly: true,
    manualNote: '本文がJavaScriptで描画されるため取得しても読めない。' +
      '家計基準の目安（189,400円）は公表時期に手でページを開いて確認する' },

  { cat: '国保', name: '軽減判定（新潟市）', url: 'https://www.niigata.lg.jp/kurashi/hoken/kokuho/hokenryo/henko.html',
    expect: () => [D.KOKUHO.base, D.KOKUHO.per5, D.KOKUHO.per2],
    note: '43万・31万・57万', alt: 'https://www.city.niigata.lg.jp/kurashi/hoken/kokuho/hokenryo/henko.html' },
  { cat: '国保', name: '賦課限度額（山口市）', url: 'https://www.city.yamaguchi.lg.jp/soshiki/59/102500.html',
    expect: () => [D.KOKUHO.limits.total, D.KOKUHO.limits.child],
    note: '113万円・子ども子育て3万円' }
];

/* 全角を半角に直す（自治体・省庁のページは全角表記が多い） */
const toHalf = (s) => s
  .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[，、]/g, ',').replace(/　/g, ' ');

const stripTags = (html) => toHalf(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'))
  .replace(/\s+/g, ' ');

/* 本文に「その数字」が出てくるか。円表記・万円表記・カンマ有無のゆれを吸収する */
function hasNumber(text, v) {
  const plain = String(v);
  const comma = v.toLocaleString('en-US');
  const man = v % 10000 === 0 ? String(v / 10000) + '万' : null;
  const manDeci = v % 1000 === 0 && v >= 10000 ? (v / 10000).toString() + '万' : null;
  return [plain, comma, man, manDeci].filter(Boolean).some(s => text.indexOf(s) >= 0);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (tax-simulator update checker)' }, redirect: 'follow'
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  let html = buf.toString('utf8');
  if (/charset=["']?(shift_jis|sjis|windows-31j)/i.test(html.slice(0, 2000))) {
    html = new TextDecoder('shift_jis').decode(buf);
  } else if (/charset=["']?euc-jp/i.test(html.slice(0, 2000))) {
    html = new TextDecoder('euc-jp').decode(buf);
  }
  return stripTags(html);
}

(async () => {
  const targets = WATCH.filter(w => !only || w.cat.indexOf(only) >= 0 || w.name.indexOf(only) >= 0);
  let same = 0, differ = 0, failed = 0;
  const needsEyes = [];

  console.log('公表資料の見張り（' + new Date().toLocaleDateString('ja-JP') + '）');
  console.log('※ このスクリプトは data.js を書き換えません。⚠ が出た項目だけ一次資料を開いて確認してください。\n');
  console.log('分類 | 項目 | 判定 | 内容');
  console.log('-----|------|------|------');

  for (const wch of targets) {
    // 自動では読めないと分かっているものは、取りに行かず手動確認欄に回す
    if (wch.manualOnly) {
      console.log(`${wch.cat} | ${wch.name} | — 手で確認 | ${wch.manualNote.slice(0, 40)}…`);
      continue;
    }
    let text = null, err = null;
    for (const u of [wch.url, wch.alt].filter(Boolean)) {
      try { text = await fetchText(u); break; } catch (e) { err = e.message; }
    }
    if (!text || text.length < 300) {
      failed++;
      needsEyes.push(`${wch.cat}／${wch.name}：ページを取得できませんでした（${err || '本文が短い'}）\n    → ${wch.url}`);
      console.log(`${wch.cat} | ${wch.name} | ⚠ 取得失敗 | ${err || '本文が短い'}`);
      await new Promise(r => setTimeout(r, 400));
      continue;
    }
    let missing = [];
    if (wch.expectText) {
      missing = wch.expectText.filter(s => text.indexOf(s) < 0);
    } else {
      missing = wch.expect().filter(v => !hasNumber(text, v));
    }
    if (missing.length === 0) {
      same++;
      console.log(`${wch.cat} | ${wch.name} | ✅ 変更なし | ${wch.note}`);
    } else {
      differ++;
      needsEyes.push(`${wch.cat}／${wch.name}：収録値がページ本文に見当たりません\n` +
        `    見つからなかった値：${missing.join(', ')}\n` +
        `    収録値の意味：${wch.note}\n    → ${wch.url}`);
      console.log(`${wch.cat} | ${wch.name} | ⚠ 要確認 | 見つからず：${missing.join(', ')}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n' + '='.repeat(70));
  console.log(`変更なし ${same} / 要確認 ${differ} / 取得失敗 ${failed}`);

  /* 金額が画像やPDFにあってページ本文から拾えないものは、
   * 「確認できた」ふりをせず、手で見る項目として毎回並べる。 */
  const manual = targets.filter(w => w.manualNote);
  if (manual.length) {
    console.log('\n■ 自動では金額を確認できない項目（公表時期に手で開いてください）');
    manual.forEach(w => {
      console.log(`\n  ・${w.cat}／${w.name}`);
      console.log(`      ${w.manualNote}`);
      console.log(`      → ${w.url}`);
    });
  }

  if (needsEyes.length) {
    console.log('\n■ 人の目で確認してほしい項目');
    needsEyes.forEach((s, i) => console.log(`\n  ${i + 1}. ${s}`));
    console.log('\n  「要確認」は必ずしも誤りではありません。ページの言い回しが変わった、');
    console.log('  表が画像になった、複数年度が併記されている、なども同じ表示になります。');
    console.log('  一次資料を開いて確かめ、実際に改正されていれば assets/data.js を直し、');
    console.log('  そのあと次を順に実行してください。');
    console.log('    node test/verify.js && node test/verify-calc.js && node test/verify-matrix.js');
    console.log('    node test/build-tax-parameters.js && node test/audit.js');
  } else {
    console.log('\n収録値はすべて公表資料の本文で確認できました。修正の必要はありません。');
  }
  console.log('\n■ このスクリプトが見ていないもの（PDFのため自動化できない）');
  console.log('  ・国税庁 給与所得控除後の給与等の金額の表（別表第五）… 例年9〜10月公表');
  console.log('  ・厚生労働省 国民健康保険の政令改正 … 例年3月末公表');
  console.log('  ・財務省 税制改正の大綱 … 例年12月末公表');
  console.log('  これらは公表時期にカレンダーで思い出して手で確認してください。');
  process.exit(0);
})();
