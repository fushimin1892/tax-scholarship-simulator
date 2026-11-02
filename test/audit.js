/* 網羅監査（node test/audit.js）
 *
 * 個別のケースを人が思いつくのではなく、「バグの種類」ごとに機械的に潰す。
 *   A. データテーブルの整合性（境界の連続性・単調性・欠損）
 *   B. 不変条件（invariant）— どんな入力でも必ず成り立つべき性質
 *   C. ランダム入力による総当たり（fuzz）— NaN・負値・非整数の混入を検出
 *   D. 静的検査 — app.js が参照するIDが実在するか、読み書きの取りこぼしがないか
 */
const path = require('path');
const fs = require('fs');
const D = require('../assets/data.js');
const C = require('../assets/calc.js');

let pass = 0, fail = 0;
const issues = [];
function ok(label, cond, detail) {
  if (cond) { pass++; }
  else { fail++; issues.push(label + (detail ? '  … ' + detail : '')); }
}
function section(t) { console.log('\n■ ' + t); }
function report() {
  if (!issues.length) { console.log('   問題なし'); return; }
  issues.splice(0).forEach(m => console.log('   ❌ ' + m));
}

/* =====================================================================
 * A. データテーブルの整合性
 * ===================================================================*/
section('A-1 所得税の速算表：区分が連続し、税額が単調増加すること');
{
  const B = D.INCOME_TAX_BRACKETS;
  for (let i = 0; i + 1 < B.length; i++) {
    ok(`速算表 ${i} の税率が単調増加`, B[i][1] < B[i + 1][1], `${B[i][1]} → ${B[i + 1][1]}`);
    ok(`速算表 ${i} の上限が単調増加`, B[i][0] < B[i + 1][0]);
    // 課税所得金額は必ず1,000円単位なので、境界の前後1,000円で段差が
    // 「次の区分の税率×1,000円」以内に収まっていれば連続とみなせる。
    const x = B[i][0];                       // 例：1,949,000円（この区分の上限）
    const lower = Math.floor(x * B[i][1] - B[i][2]);
    const next = x + 1000;                   // 例：1,950,000円（次の区分の下限）
    const upper = Math.floor(next * B[i + 1][1] - B[i + 1][2]);
    const step = upper - lower;
    ok(`速算表 ${i}→${i + 1} の境界(${x}→${next})で税額が連続`,
      step >= 0 && step <= B[i + 1][1] * 1000 + 1,
      `${lower} → ${upper}（差 ${step}円、上限 ${B[i + 1][1] * 1000}円）`);
  }
  // 税額は課税所得に対して単調増加
  let prev = -1;
  for (let t = 0; t <= 50000000; t += 7919) {
    let tax = 0;
    for (const b of B) if (t <= b[0]) { tax = Math.floor(t * b[1] - b[2]); break; }
    ok('所得税額が単調増加', tax >= prev, `課税所得${t}`);
    if (tax < prev) break;
    prev = tax;
  }
}
report();

section('A-2 給与所得：単調非減少・収入以下・法定表の境界で連続');
{
  for (const year of [2025, 2026]) {
    const p = D.INCOME_TAX[year];
    let prev = -1, bad = 0;
    for (let r = 0; r <= 12000000; r += 997) {
      const inc = C.salaryIncomeAmount(r, p);
      if (!isFinite(inc) || inc < 0) { ok(`R${year} 給与所得が有限で非負`, false, `収入${r} → ${inc}`); bad++; break; }
      if (inc > r) { ok(`R${year} 給与所得 ≦ 給与収入`, false, `収入${r} → ${inc}`); bad++; break; }
      if (inc < prev) { ok(`R${year} 給与所得が単調非減少`, false, `収入${r} で ${prev} → ${inc}`); bad++; break; }
      prev = inc;
    }
    if (!bad) pass += 3;
    // 区分の境界で連続していること
    [p.salaryMinCap, 3600000, 6600000, 8500000].forEach(function (b) {
      const a = C.salaryIncomeAmount(b - 1, p), c = C.salaryIncomeAmount(b, p);
      ok(`R${year} 境界${b}で連続（差が4,000円以内）`, c - a >= 0 && c - a <= 4000, `${a} → ${c}`);
    });
  }
}
report();

section('A-3 公的年金等控除：単調・境界で連続');
{
  [true, false].forEach(function (over65) {
    let prevIncome = -1;
    for (let r = 0; r <= 15000000; r += 1013) {
      const ded = C.pensionDeduction(r, over65, 0);
      const inc = Math.max(0, r - ded);
      if (ded > r && r > 0) { ok(`年金控除 ≦ 収入(65歳${over65 ? '以上' : '未満'})`, false, `収入${r} 控除${ded}`); break; }
      if (inc < prevIncome) { ok(`年金所得が単調非減少(65歳${over65 ? '以上' : '未満'})`, false, `収入${r}`); break; }
      prevIncome = inc;
    }
    pass += 2;
    [1300000, 3300000, 4100000, 7700000, 10000000].forEach(function (b) {
      const a = b - 1 - C.pensionDeduction(b - 1, over65, 0);
      const c = b - C.pensionDeduction(b, over65, 0);
      ok(`年金 境界${b}(65歳${over65 ? '以上' : '未満'})で連続`, Math.abs(c - a) <= 2, `${a} → ${c}`);
    });
  });
}
report();

section('A-4 基礎控除：所得が増えたら控除は減る（単調非増加）・全区分が定義済み');
{
  for (const year of [2025, 2026]) {
    const tbl = D.INCOME_TAX[year].basic;
    for (let i = 0; i + 1 < tbl.length; i++) {
      ok(`R${year} 基礎控除の上限が単調増加`, tbl[i][0] < tbl[i + 1][0]);
      ok(`R${year} 基礎控除額が単調非増加`, tbl[i][1] >= tbl[i + 1][1], `${tbl[i][1]} → ${tbl[i + 1][1]}`);
    }
    ok(`R${year} 基礎控除の最終区分が Infinity`, tbl[tbl.length - 1][0] === Infinity);
    ok(`R${year} 2,500万円超は0円`, tbl[tbl.length - 1][1] === 0);
  }
  for (const year of [2026, 2027]) {
    const tbl = D.RESIDENT_TAX[year].basic;
    ok(`住民税R${year} 基礎控除の最終区分が Infinity`, tbl[tbl.length - 1][0] === Infinity);
    ok(`住民税R${year} 2,400万円以下は43万円`, tbl[0][1] === 430000);
  }
}
report();

section('A-5 特定親族特別控除・配偶者特別控除：単調非増加・上限一致');
{
  const T = D.TOKUTEI_SHINZOKU;
  for (let i = 0; i + 1 < T.length; i++) {
    ok(`特定親族 上限が単調増加`, T[i][0] < T[i + 1][0]);
    ok(`特定親族 所得税の控除が単調非増加`, T[i][1] >= T[i + 1][1], `${T[i][1]} → ${T[i + 1][1]}`);
    ok(`特定親族 住民税の控除が単調非増加`, T[i][2] >= T[i + 1][2], `${T[i][2]} → ${T[i + 1][2]}`);
    ok(`特定親族 住民税 ≦ 所得税`, T[i][2] <= T[i][1]);
  }
  ok('特定親族の上限が p.tokuteiUpper と一致', T[T.length - 1][0] === D.INCOME_TAX[2025].tokuteiUpper,
    `${T[T.length - 1][0]} vs ${D.INCOME_TAX[2025].tokuteiUpper}`);
  ['income', 'resident'].forEach(function (k) {
    const S = D.SPOUSE_SPECIAL[k];
    for (let i = 0; i + 1 < S.length; i++) {
      ok(`配偶者特別(${k}) 上限が単調増加`, S[i][0] < S[i + 1][0]);
      for (let t = 0; t < 3; t++) {
        ok(`配偶者特別(${k}) tier${t} が単調非増加`, S[i][1][t] >= S[i + 1][1][t],
          `${S[i][1][t]} → ${S[i + 1][1][t]}`);
      }
    }
    ok(`配偶者特別(${k}) の上限が spouseSpecialUpper と一致`,
      S[S.length - 1][0] === D.INCOME_TAX[2025].spouseSpecialUpper);
  });
}
report();

section('A-6 住民税の控除 ≦ 所得税の控除（人的控除）');
{
  const pairs = [
    ['障害者（普通）', D.DISABILITY.normal], ['障害者（特別）', D.DISABILITY.special],
    ['同居特別障害者', D.DISABILITY.liveTogether], ['寡婦', D.WIDOW], ['ひとり親', D.SINGLE_PARENT],
    ['扶養（一般）', D.DEPENDENT_DEDUCTION.general], ['扶養（特定）', D.DEPENDENT_DEDUCTION.specific],
    ['扶養（老人）', D.DEPENDENT_DEDUCTION.oldOther], ['扶養（同居老親）', D.DEPENDENT_DEDUCTION.oldLiving]
  ];
  pairs.forEach(function (p) {
    ok(`${p[0]}：住民税 ≦ 所得税`, p[1][1] <= p[1][0], `所得税${p[1][0]} 住民税${p[1][1]}`);
  });
  [['normal', D.SPOUSE_DEDUCTION.normal], ['old', D.SPOUSE_DEDUCTION.old]].forEach(function (x) {
    x[1].forEach(function (row, i) {
      ok(`配偶者控除(${x[0]}) tier${i}：住民税 ≦ 所得税`, row[2] <= row[1], `${row[1]} / ${row[2]}`);
    });
  });
}
report();

section('A-7 非課税限度額：級地1 ≧ 級地2 ≧ 級地3');
{
  const H = D.HIKAZEI;
  ok('1級地 ≧ 2級地（1人あたり）', H.kintou[1][0] >= H.kintou[2][0]);
  ok('2級地 ≧ 3級地（1人あたり）', H.kintou[2][0] >= H.kintou[3][0]);
  ok('1級地 ≧ 2級地（加算）', H.kintou[1][1] >= H.kintou[2][1]);
  ok('2級地 ≧ 3級地（加算）', H.kintou[2][1] >= H.kintou[3][1]);
  ok('所得割の加算(32万) > 均等割1級地の加算(21万)', H.shotoku[1] > H.kintou[1][1]);
}
report();

section('A-8 都道府県・市区町村データの妥当性');
{
  ok('都道府県が47件', D.PREFECTURES.length === 47, `${D.PREFECTURES.length}件`);
  const names = new Set();
  D.PREFECTURES.forEach(function (p) {
    ok(`${p.n} の名称が重複しない`, !names.has(p.n)); names.add(p.n);
    ok(`${p.n} の均等割上乗せが0〜2000円`, p.add >= 0 && p.add <= 2000, `${p.add}`);
    ok(`${p.n} の所得割率が4〜4.1%`, p.rate >= 4 && p.rate <= 4.1, `${p.rate}`);
    ok(`${p.n} 上乗せがあるなら税の名称がある`, p.add === 0 || !!p.tax);
    ok(`${p.n} 上乗せがないなら税の名称は空`, p.add !== 0 || !p.tax);
  });
  const CK = require('../assets/cities.js');
  ok('市区町村マスタが47都道府県ぶんある', Object.keys(CK).length === 47);
  let total = 0, k1 = 0, k2 = 0;
  Object.entries(CK).forEach(function (e) {
    ok(`${e[0]} が PREFECTURES に存在`, D.PREFECTURES.some(p => p.n === e[0]));
    e[1].forEach(function (c) {
      total++;
      ok(`${e[0]} ${c[0]} の級地が1〜3`, [1, 2, 3].indexOf(c[1]) >= 0, `${c[1]}`);
      if (c[1] === 1) k1++; if (c[1] === 2) k2++;
    });
  });
  ok('市区町村の合計が1,719件', total === 1719, `${total}件`);
  ok('1級地が107団体（公表値と一致）', k1 === 107, `${k1}団体`);
  ok('2級地が200団体（公表値と一致）', k2 === 200, `${k2}団体`);
  // CITIES（特例団体）が cities.js に存在するか
  Object.entries(D.CITIES).forEach(function (e) {
    e[1].forEach(function (c) {
      ok(`特例団体 ${e[0]}${c.n} が市区町村マスタに存在`,
        (CK[e[0]] || []).some(x => x[0] === c.n), `${e[0]}${c.n}`);
    });
  });
}
report();

section('A-9 JASSO：区分が連続し、隙間・重なりがないこと');
{
  const K = D.JASSO.kubun;
  ok('第Ⅰ区分の下限が0', K[0].lo === 0);
  for (let i = 0; i + 1 < K.length; i++) {
    ok(`区分${K[i].id}→${K[i + 1].id} が連続（隙間なし）`, K[i].hi === K[i + 1].lo,
      `${K[i].hi} vs ${K[i + 1].lo}`);
    ok(`区分${K[i].id} の下限 < 上限`, K[i].lo < K[i].hi);
  }
  // 全域が判定できること（0円〜20万円で必ずどれかに落ちる）
  for (let v = 0; v <= 200000; v += 97) {
    const r = C.judgeKubun(v, { tashi: true });
    ok('全額域で区分が決まる', !!r && (r.id >= 1 || r.over === true), `基準額${v}`);
  }
  pass++;
  ok('0円は第Ⅰ区分', C.judgeKubun(0, {}).id === 1);
  ok('99円は第Ⅰ区分', C.judgeKubun(99, {}).id === 1);
  ok('100円は第Ⅱ区分', C.judgeKubun(100, {}).id === 2);
  ok('25,599円は第Ⅱ区分', C.judgeKubun(25599, {}).id === 2);
  ok('25,600円は第Ⅲ区分', C.judgeKubun(25600, {}).id === 3);
  ok('51,299円は第Ⅲ区分', C.judgeKubun(51299, {}).id === 3);
  ok('51,300円は第Ⅳ区分（多子世帯）', C.judgeKubun(51300, { tashi: true }).id === 4);
  ok('51,300円は対象外（一般世帯）', C.judgeKubun(51300, {}).id === 0);
  ok('154,499円は第Ⅳ区分（多子世帯）', C.judgeKubun(154499, { tashi: true }).id === 4);
  ok('154,500円は対象外', C.judgeKubun(154500, { tashi: true }).id === 0);
}
report();

/* =====================================================================
 * B / C. 不変条件とランダム入力
 * ===================================================================*/
function baseInput(over) {
  const b = {
    incomeYear: 2025, residentYear: 2026,
    region: { pref: '東京都', city: '特別区（23区）', seirei: false,
      cityKin: 3000, prefKin: 1000, cityRate: 6, prefRate: 4, kyuchi: 1 },
    income: { salary: 0, pension: 0, pensionAge65: false, business: 0, realEstate: 0, otherIncome: 0,
      landShort: 0, landLong: 0, stockTransfer: 0, stockDividend: 0, futures: 0,
      forestRevenue: 0, forestExpense: 0, retirementRevenue: 0, retirementYears: 0,
      retirementOfficer: false, retirementShort: false, retirementDisability: false },
    carryover: { stockLoss: 0, netLoss: 0, casualtyLoss: 0 },
    ded: { social: 0, kyosai: 0, lifeNewGeneral: 0, lifeOldGeneral: 0, lifeNewCare: 0,
      lifeNewPension: 0, lifeOldPension: 0, quake: 0, longOld: 0, medical: 0, medicalComp: 0,
      zasson: 0, otherDeduction: 0 },
    family: { hasSpouse: false, spouseIncome: 0, spouseOld: false, depUnder16: 0, dep16_18: 0,
      dep19_22: 0, dep23_69: 0, depOldOther: 0, depOldLiving: 0, tokuteiList: [],
      disNormal: 0, disSpecial: 0, disLive: 0, selfDisability: 'none', widow: false,
      singleParent: 'none', student: false, under23Dependent: false, specialDisabilityFamily: false },
    flags: { minor: false, welfare: false }, taxCredit: 0, residentCredit: 0,
    kokuho: { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0,
      landSpecialDeduction: 0, senjusha: 0, includeSelf: true }
  };
  return Object.assign(b, over || {});
}

function checkInvariants(inp, tag) {
  let r;
  try { r = C.calcAll(inp); } catch (e) { ok('例外を投げない', false, tag + ' → ' + e.message); return; }
  const it = r.incomeTax, rt = r.resident, k = r.kokuho, j = r.jasso;
  const finite = (v) => typeof v === 'number' && isFinite(v);

  ok('所得税額が有限', finite(it.total), tag);
  ok('所得税額が非負', it.total >= 0, tag + ' → ' + it.total);
  ok('所得税額が100円単位', it.total % 100 === 0, tag + ' → ' + it.total);
  ok('課税総所得が1,000円単位', it.taxable % 1000 === 0, tag);
  ok('合計所得金額が有限・非負', finite(it.income.gokei) && it.income.gokei >= 0, tag);
  ok('総所得金額等 ≦ 合計所得金額', it.income.souShotokuTou <= it.income.gokei + 1e-6, tag);

  ok('住民税の所得割が有限・非負', finite(rt.shotokuTotal) && rt.shotokuTotal >= 0, tag);
  ok('市町村民税の所得割が100円単位', rt.cityShotoku % 100 === 0, tag);
  ok('道府県民税の所得割が100円単位', rt.prefShotoku % 100 === 0, tag);
  ok('均等割が有限・非負', finite(rt.kintouTotal) && rt.kintouTotal >= 0, tag);
  ok('住民税合計＝所得割＋均等割', rt.total === rt.shotokuTotal + rt.kintouTotal, tag);

  // 非課税なら税額は必ず0
  ok('均等割が非課税なら均等割額は0', !rt.kintouExempt || rt.kintouTotal === 0, tag);
  ok('所得割が非課税なら所得割額は0', !rt.shotokuExempt || rt.shotokuTotal === 0, tag);
  // 所得割が非課税 → 支給額算定基準額は0 → 第Ⅰ区分
  ok('所得割が非課税なら支給額算定基準額は0', !rt.shotokuExempt || j.kijun === 0, tag + ' → ' + j.kijun);
  ok('所得割が非課税なら第Ⅰ区分', !rt.shotokuExempt || C.judgeKubun(j.kijun, {}).id === 1, tag);
  // 課税標準が0なら所得割も0
  ok('課税標準0なら所得割0', rt.taxable > 0 || rt.shotokuTotal === 0, tag);

  ok('支給額算定基準額が有限・非負', finite(j.kijun) && j.kijun >= 0, tag);
  ok('支給額算定基準額が100円単位', j.kijun % 100 === 0, tag + ' → ' + j.kijun);
  ok('軽減判定所得が有限・非負', finite(k.judgeIncome) && k.judgeIncome >= 0, tag);
  ok('軽減割合が0/2/5/7のいずれか', [0, 2, 5, 7].indexOf(k.level) >= 0, tag + ' → ' + k.level);
  ok('軽減基準額 7割 ≦ 5割 ≦ 2割', k.t7 <= k.t5 && k.t5 <= k.t2, tag);
  ok('軽減割合と基準額が整合', (k.level === 7) === (k.judgeIncome <= k.t7), tag);
  ok('非課税限度額 均等割・所得割が有限', finite(rt.kintouLimit) && finite(rt.shotokuLimit), tag);
}

section('B-1 不変条件：代表的な30パターン');
{
  const cases = [
    ['収入なし', {}],
    ['給与103万', { income: { salary: 1030000 } }],
    ['給与160万', { income: { salary: 1600000 } }],
    ['給与300万', { income: { salary: 3000000 } }],
    ['給与850万超', { income: { salary: 9000000 } }],
    ['給与2500万超', { income: { salary: 30000000 } }],
    ['年金のみ65歳未満', { income: { pension: 1500000 } }],
    ['年金のみ65歳以上', { income: { pension: 2500000, pensionAge65: true } }],
    ['給与＋年金', { income: { salary: 2000000, pension: 1500000, pensionAge65: true } }],
    ['事業所得', { income: { business: 4000000 } }],
    ['株式譲渡益のみ', { income: { stockTransfer: 5000000 } }],
    ['土地短期譲渡', { income: { landShort: 20000000 } }],
    ['土地長期譲渡', { income: { landLong: 20000000 } }],
    ['先物', { income: { futures: 3000000 } }],
    ['山林', { income: { forestRevenue: 10000000, forestExpense: 1000000 } }],
    ['退職金', { income: { retirementRevenue: 20000000, retirementYears: 30 } }],
    ['退職金・勤続3年役員', { income: { retirementRevenue: 8000000, retirementYears: 3, retirementOfficer: true } }],
    ['繰越控除で所得0', { income: { salary: 3000000 }, carryover: { stockLoss: 0, netLoss: 5000000, casualtyLoss: 0 } }],
    ['株式繰越控除', { income: { stockTransfer: 3000000 }, carryover: { stockLoss: 5000000, netLoss: 0, casualtyLoss: 0 } }],
    ['全部入り', { income: { salary: 5000000, pension: 1000000, business: 1000000, realEstate: 500000,
      otherIncome: 300000, stockTransfer: 2000000, stockDividend: 500000, futures: 100000,
      landLong: 3000000, landShort: 1000000, forestRevenue: 5000000, forestExpense: 500000,
      retirementRevenue: 10000000, retirementYears: 20 } }]
  ];
  cases.forEach(function (c) {
    const inp = baseInput();
    Object.keys(c[1]).forEach(k => Object.assign(inp[k], c[1][k]));
    checkInvariants(inp, c[0]);
  });
  // 家族構成のバリエーション
  [['配偶者あり', { hasSpouse: true }],
   ['配偶者に所得', { hasSpouse: true, spouseIncome: 1000000 }],
   ['扶養5人', { depUnder16: 2, dep16_18: 1, dep19_22: 1, depOldLiving: 1 }],
   ['障害者だらけ', { selfDisability: 'special', disNormal: 1, disSpecial: 1, disLive: 1 }],
   ['ひとり親', { singleParent: 'mother', dep16_18: 1 }],
   ['勤労学生', { student: true }],
   ['特定親族2人', { tokuteiList: [700000, 900000] }]
  ].forEach(function (c) {
    const inp = baseInput();
    Object.assign(inp.income, { salary: 4000000 });
    Object.assign(inp.family, c[1]);
    checkInvariants(inp, c[0]);
  });
  // 地域のバリエーション
  [['政令市', { seirei: true, cityRate: 8, prefRate: 2, cityKin: 3900, prefKin: 1300 }],
   ['名古屋市', { seirei: true, cityRate: 7.7, prefRate: 2, cityKin: 2800, prefKin: 1500 }],
   ['夕張市', { seirei: false, cityRate: 6.5, prefRate: 4, cityKin: 3500, prefKin: 1000 }],
   ['3級地', { kyuchi: 3 }]
  ].forEach(function (c) {
    const inp = baseInput();
    Object.assign(inp.income, { salary: 4000000 });
    Object.assign(inp.region, c[1]);
    checkInvariants(inp, c[0]);
  });
}
report();

section('C-1 ランダム入力 20,000件（NaN・負値・端数の混入検出）');
{
  let seed = 20260814;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const money = (max) => Math.floor(rnd() * max);
  let checked = 0;
  const before = fail;
  for (let i = 0; i < 20000; i++) {
    const inp = baseInput({ incomeYear: pick([2025, 2026]) });
    inp.residentYear = inp.incomeYear === 2025 ? 2026 : 2027;
    Object.assign(inp.income, {
      salary: money(15000000), pension: money(5000000), pensionAge65: rnd() < 0.3,
      business: money(3000000), realEstate: money(1000000), otherIncome: money(1000000),
      landShort: rnd() < 0.1 ? money(30000000) : 0, landLong: rnd() < 0.1 ? money(30000000) : 0,
      stockTransfer: rnd() < 0.2 ? money(10000000) : 0, stockDividend: rnd() < 0.1 ? money(2000000) : 0,
      futures: rnd() < 0.05 ? money(3000000) : 0,
      forestRevenue: rnd() < 0.05 ? money(10000000) : 0, forestExpense: money(1000000),
      retirementRevenue: rnd() < 0.05 ? money(30000000) : 0, retirementYears: Math.floor(rnd() * 40)
    });
    Object.assign(inp.carryover, {
      stockLoss: rnd() < 0.15 ? money(5000000) : 0,
      netLoss: rnd() < 0.1 ? money(5000000) : 0,
      casualtyLoss: rnd() < 0.05 ? money(2000000) : 0
    });
    Object.assign(inp.ded, {
      social: money(1500000), kyosai: money(800000), medical: money(2000000), medicalComp: money(500000),
      lifeNewGeneral: money(150000), lifeOldGeneral: money(150000), lifeNewCare: money(100000),
      quake: money(80000), longOld: money(30000), zasson: money(500000), otherDeduction: money(300000)
    });
    Object.assign(inp.family, {
      hasSpouse: rnd() < 0.5, spouseIncome: money(1500000), spouseOld: rnd() < 0.2,
      depUnder16: Math.floor(rnd() * 4), dep16_18: Math.floor(rnd() * 3),
      dep19_22: Math.floor(rnd() * 3), dep23_69: Math.floor(rnd() * 2),
      depOldOther: Math.floor(rnd() * 2), depOldLiving: Math.floor(rnd() * 2),
      tokuteiList: rnd() < 0.2 ? [600000 + money(600000)] : [],
      disNormal: Math.floor(rnd() * 2), disSpecial: Math.floor(rnd() * 2), disLive: Math.floor(rnd() * 2),
      selfDisability: pick(['none', 'normal', 'special']),
      widow: rnd() < 0.1, singleParent: pick(['none', 'mother', 'father']), student: rnd() < 0.1,
      under23Dependent: rnd() < 0.3, specialDisabilityFamily: rnd() < 0.1
    });
    Object.assign(inp.region, {
      seirei: rnd() < 0.3, kyuchi: pick([1, 2, 3]),
      cityRate: pick([6, 6.1, 6.5, 7.7, 8]), prefRate: pick([4, 4.025, 2, 2.025]),
      cityKin: pick([3000, 2800, 3500, 3900]), prefKin: pick([1000, 1300, 1500, 2200])
    });
    Object.assign(inp.kokuho, {
      insured: Math.floor(rnd() * 6), tokutei: Math.floor(rnd() * 2),
      salaryEarners: Math.floor(rnd() * 4), otherMembersIncome: money(3000000),
      landSpecialDeduction: rnd() < 0.05 ? money(30000000) : 0, senjusha: rnd() < 0.05 ? money(1000000) : 0,
      includeSelf: rnd() < 0.9
    });
    inp.flags.minor = rnd() < 0.05;
    inp.flags.welfare = rnd() < 0.02;
    inp.taxCredit = rnd() < 0.1 ? money(200000) : 0;
    inp.residentCredit = rnd() < 0.1 ? money(100000) : 0;
    checkInvariants(inp, 'fuzz#' + i);
    checked++;
    if (fail > before + 5) { console.log('   （5件失敗したため打ち切り）'); break; }
  }
  console.log('   検査した組み合わせ: ' + checked + '件');
}
report();

section('C-2 単調性：ほかを固定して給与収入だけ増やしたとき、税額が減らないこと');
{
  let prevTax = -1, prevRes = -1, prevKijun = -1, bad = 0;
  for (let salary = 0; salary <= 12000000; salary += 13000) {
    const inp = baseInput();
    inp.income.salary = salary;
    inp.ded.social = 500000;
    inp.family.hasSpouse = true;
    inp.family.dep19_22 = 1;
    const r = C.calcAll(inp);
    if (r.incomeTax.total < prevTax) { ok('所得税が単調非減少', false, `給与${salary}: ${prevTax} → ${r.incomeTax.total}`); bad++; }
    if (r.resident.shotokuTotal < prevRes) { ok('住民税の所得割が単調非減少', false, `給与${salary}: ${prevRes} → ${r.resident.shotokuTotal}`); bad++; }
    if (r.jasso.kijun < prevKijun) { ok('支給額算定基準額が単調非減少', false, `給与${salary}: ${prevKijun} → ${r.jasso.kijun}`); bad++; }
    prevTax = r.incomeTax.total; prevRes = r.resident.shotokuTotal; prevKijun = r.jasso.kijun;
    if (bad > 3) break;
  }
  if (!bad) pass += 3;
}
report();

section('C-3 単調性：所得控除を増やしたとき、税額が増えないこと');
{
  let prevTax = Infinity, prevRes = Infinity, bad = 0;
  for (let social = 0; social <= 3000000; social += 7000) {
    const inp = baseInput();
    inp.income.salary = 6000000;
    inp.ded.social = social;
    const r = C.calcAll(inp);
    if (r.incomeTax.total > prevTax) { ok('控除増で所得税が増えない', false, `社保${social}: ${prevTax} → ${r.incomeTax.total}`); bad++; }
    if (r.resident.shotokuTotal > prevRes) { ok('控除増で所得割が増えない', false, `社保${social}: ${prevRes} → ${r.resident.shotokuTotal}`); bad++; }
    prevTax = r.incomeTax.total; prevRes = r.resident.shotokuTotal;
    if (bad > 3) break;
  }
  if (!bad) pass += 2;
}
report();

section('C-4 均等割は所得控除で変わらないこと（制度の核心）');
{
  const mk = (social) => {
    const inp = baseInput();
    inp.income.salary = 3000000;
    inp.ded.social = social;
    return C.calcAll(inp).resident.kintouTotal;
  };
  ok('社会保険料控除0円と300万円で均等割が同額', mk(0) === mk(3000000), `${mk(0)} vs ${mk(3000000)}`);
  ok('均等割が課税されている（前提の確認）', mk(0) > 0);
}
report();

/* =====================================================================
 * D. 静的検査（DOMのIDとコードの参照の突合）
 * ===================================================================*/
section('D-1 app.js が参照するIDが、HTMLまたは生成フォームに存在すること');
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // HTML に直接書かれている id
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  // app.js の中で生成している id（'A_' などの接頭辞つき）
  const generated = new Set();
  [...app.matchAll(/id="'\s*\+\s*(?:p|who|id)\s*\+\s*'([A-Za-z0-9_]+)"/g)].forEach(m => generated.add(m[1]));
  [...app.matchAll(/'([A-Za-z0-9]+)_([A-Za-z0-9_]+)'/g)].forEach(() => {});
  // fld/cnt/sel/cb の第1引数から拾う
  [...app.matchAll(/(?:fld|cnt|sel|cb)\(\s*p\s*\+\s*'(_[A-Za-z0-9_]+)'/g)].forEach(m => generated.add(m[1]));

  const referenced = new Set();
  [...app.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].forEach(m => referenced.add(m[1]));
  [...app.matchAll(/(?:num|val|chk)\('([A-Za-z0-9_]+)'\)/g)].forEach(m => referenced.add(m[1]));

  const missing = [];
  referenced.forEach(function (id) {
    if (htmlIds.has(id)) return;
    // 接頭辞つきで生成されるものは、接尾辞が生成集合にあればよい
    const m = id.match(/^(A|B|md\d+)(_.+)$/);
    if (m && generated.has(m[2])) return;
    missing.push(id);
  });
  ok('参照している全IDが実在する', missing.length === 0, missing.join(', '));

  // 逆方向：HTML にあるフォーム部品で app.js が一度も読まないものがないか
  const formIds = [...html.matchAll(/<(?:input|select|textarea)[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
  const unread = formIds.filter(id => !app.includes("'" + id + "'"));
  ok('HTMLの入力部品はすべてコードから読まれている', unread.length === 0, unread.join(', '));
}
report();

section('D-2 危険なAPIを使っていないこと');
{
  const JS = ['app.js', 'calc.js', 'data.js', 'cities.js', 'theme.js'];
  const src = {};
  JS.forEach(f => { src[f] = fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8'); });
  const files = JS.map(f => src[f]).join('\n');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const banned = ['eval(', 'new Function', 'sessionStorage', 'indexedDB',
    'document.cookie', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'fetch('];
  banned.forEach(function (b) {
    ok(`${b} を使っていない`, files.indexOf(b) < 0, '検出');
  });

  /* localStorage は「配色の設定」だけに使ってよい。
   * 収入・控除などの入力内容を保存しないことが、このサイトの前提なので、
   * 使ってよいファイル・キー・呼び出し方を機械的に固定しておく。 */
  JS.filter(f => f !== 'theme.js').forEach(function (f) {
    ok(`${f} は localStorage を使っていない`, src[f].indexOf('localStorage') < 0, '検出');
  });
  const calls = [...src['theme.js'].matchAll(/localStorage\.(\w+)\(([^)]*)\)/g)];
  ok('theme.js の localStorage 呼び出しは3か所以内', calls.length <= 3, `${calls.length}か所`);
  calls.forEach(function (m, i) {
    ok(`localStorage呼び出し${i} は getItem/setItem/removeItem のいずれか`,
      ['getItem', 'setItem', 'removeItem'].indexOf(m[1]) >= 0, m[0]);
    ok(`localStorage呼び出し${i} が使うキーは変数 KEY のみ`,
      /^KEY\b/.test(m[2].trim()), m[0]);
  });
  ok('保存するキーは配色用の1つだけ',
    (src['theme.js'].match(/var KEY = '([^']+)'/) || [])[1] === 'tk-theme', 'キー定義が想定と違う');
  ok('入力値の識別子が theme.js に出てこない',
    !/(salary|pension|income|kokuho|jasso|deduction)/i.test(src['theme.js']), '入力値らしき語を検出');
  ok('localStorage は必ず try で包む',
    (src['theme.js'].match(/try\s*\{/g) || []).length >= calls.length, '未保護の呼び出しあり');

  /* 外部ホストから「読み込む」ものがないことを見る。
   * canonical と本文中のリンク（<a>）は通信を発生させないので対象外。
   * 出典リンクを踏むかどうかは利用者の操作であり、ページ表示では取りに行かない。 */
  const loadable = html
    .replace(/<a [^>]*>/g, '')
    .replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '');
  ok('外部ホストから読み込むものがない',
    !/(src|href)=["']https?:\/\//.test(loadable), '外部参照あり');
  ok('canonical が指定されている',
    /<link[^>]*rel=["']canonical["'][^>]*href=["']https:\/\//i.test(html), '未指定');
  ok('OGP と Twitter Card が指定されている',
    /property=["']og:title["']/.test(html) && /name=["']twitter:card["']/.test(html), '未指定');
  /* 構造化データは書き間違えると検索側に無視されるだけで画面には出ないので、
   * JSONとして読めることと、URLがcanonicalと一致することを機械で見る。 */
  const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
  let ldObj = null;
  try { ldObj = JSON.parse(ld); } catch (e) { ldObj = null; }
  /* 市区町村の数は「読み込み中に画面がずれない」ようHTMLに直書きしてある。
   * 収録データを足し引きしたときに書き換え忘れると嘘の数字が残るので、ここで突き合わせる。 */
  const cityTotal = Object.values(require('../assets/cities.js'))
    .reduce((a, b) => a + b.length, 0).toLocaleString('ja-JP');
  const written = [...html.matchAll(/id="cityCount2?"[^>]*>([^<]+)</g)].map(m => m[1]);
  ok('HTMLに書いた市区町村の数が実データと一致する',
    written.length === 2 && written.every(v => v === cityTotal),
    'HTML ' + written.join('/') + ' ／ 実データ ' + cityTotal);
  ok('構造化データ（JSON-LD）がJSONとして正しい', !!ldObj, '解析できない');
  ok('構造化データのURLが canonical と一致する',
    !!ldObj && ldObj.url === (html.match(/rel=["']canonical["'] href=["']([^"']+)/) || [])[1], '不一致');
  ok('ファビコンが埋め込みで404を出さない',
    /<link[^>]*rel=["']icon["'][^>]*href=["']data:image/i.test(html), '外部ファビコン');
  /* 通信先の許可が自分自身より広がっていないこと。
   * ここが 'self' 以外に広がると、入力された年収や家族構成を外に送れるようになる。 */
  const csp = (html.match(/Content-Security-Policy[^>]*content="([^"]+)"/i) || [])[1] || '';
  const connect = (csp.match(/connect-src ([^;]*)/) || [])[1] || '';
  ok('CSP の通信先が自分自身だけに限られている',
    connect.trim() === "'self'" && !/\*|https?:/.test(connect), 'connect-src: ' + connect);
  ok('CSP の既定が none のまま', /default-src 'none'/.test(csp), csp.slice(0, 60));
  ok('CSP に frame-ancestors を入れていない（metaでは無視されるため）',
    !/<meta[^>]*Content-Security-Policy[^>]*frame-ancestors/i.test(html), 'metaに指定あり');
  /* 実行されるインラインJSがないこと。JSON-LD は type が JavaScript ではないので
   * ブラウザは実行せず、CSP の script-src の対象にもならない（データ置き場扱い）。 */
  ok('実行されるインライン script がない（CSPを厳しくしても動くように）',
    !/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>[\s\S]*?<\/script>/.test(html),
    'インラインscript検出');
  ok('読み込んでいるスクリプトはすべて assets 配下の相対パス',
    [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].every(m => /^assets\/[\w.-]+\.js$/.test(m[1])), '想定外のsrc');
}
report();

section('D-3 出典（SOURCES）の妥当性');
{
  const s = D.SOURCES;
  ok('出典が20件以上ある', s.length >= 20, `${s.length}件`);
  s.forEach(function (x, i) {
    ok(`出典${i} に分類がある`, !!x.c);
    ok(`出典${i} に題名がある`, !!x.t);
    ok(`出典${i} のURLがhttpsで始まる`, /^https:\/\//.test(x.u), x.u);
  });
  const cats = new Set(s.map(x => x.c));
  ['所得税', '住民税', '国保', '奨学金'].forEach(function (c) {
    ok(`出典に「${c}」の分類がある`, cats.has(c));
  });
}
report();

section('D-4 配色（ライト／ダーク）の定義が揃っていること');
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'style.css'), 'utf8');
  /* 指定したセレクタのブロックを取り出して、定義しているカスタムプロパティを拾う */
  const blockAfter = function (needle) {
    const i = css.indexOf(needle);
    if (i < 0) return null;
    const s = css.indexOf('{', i), e = css.indexOf('}', s);
    return s < 0 || e < 0 ? null : css.slice(s + 1, e);
  };
  const tokensOf = function (block) {
    const m = {};
    if (block) [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].forEach(x => { m[x[1]] = x[2].trim(); });
    return m;
  };
  const light = tokensOf(blockAfter('\n:root {'));
  const darkMedia = tokensOf(blockAfter(':root:not([data-theme="light"])'));
  const darkAttr = tokensOf(blockAfter(':root[data-theme="dark"] {'));

  const lk = Object.keys(light).filter(k => !/^--r-|^--shadow/.test(k));
  ok('ライトの配色トークンが定義されている', lk.length >= 20, `${lk.length}件`);
  ok('端末追従のダークが定義されている', Object.keys(darkMedia).length >= 20);
  ok('明示的なダークが定義されている', Object.keys(darkAttr).length >= 20);

  /* ダークは2か所に書く必要があるので、キーも値も完全に一致していること */
  const km = Object.keys(darkMedia).sort().join(','), ka = Object.keys(darkAttr).sort().join(',');
  ok('ダークの2か所でトークンの顔ぶれが一致する', km === ka,
    '差分: ' + Object.keys(darkMedia).filter(k => !(k in darkAttr)).concat(
      Object.keys(darkAttr).filter(k => !(k in darkMedia))).join(', '));
  Object.keys(darkMedia).forEach(function (k) {
    ok(`ダークの2か所で ${k} の値が一致する`, darkMedia[k] === darkAttr[k],
      `${darkMedia[k]} / ${darkAttr[k]}`);
  });
  /* ライトで定義した色はダークでも必ず上書きする（片方だけ残ると読めない色になる） */
  Object.keys(light).filter(k => /^--(bg|surface|line|ink|brand|kin|sho|good|warn|bad)/.test(k))
    .forEach(function (k) {
      ok(`${k} がダークでも上書きされている`, k in darkAttr, '未定義');
    });
  ok('body に明示的な背景色がある', /body\s*\{[^}]*background:\s*var\(--bg\)/.test(css));
  ok('印刷時はダークを上書きしている',
    /:root,\s*:root\[data-theme="dark"\],\s*:root\[data-theme="light"\]/.test(css), '未対応');
  ok('配色の切替ボタンにスタイルがある', /\.themeswitch\s+button\s*\{/.test(css));
}
report();

section('D-5 計算方法ドキュメントの数値が data.js と一致すること');
{
  /* docs/05 は「サイトが実際に何をしているか」を書いた資料なので、
   * data.js を直したのに書き換え忘れる、という食い違いが一番こわい。
   * 主要な金額が資料に載っていることを機械的に確かめる。 */
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '05-計算方法とまるめの一覧.md'), 'utf8');
  const yen = (v) => v.toLocaleString('en-US');
  const has = (label, v) => ok(`${label}（${yen(v)}）が資料に載っている`, doc.indexOf(yen(v)) >= 0, '未記載');

  // 給与所得控除・公的年金等控除
  [2025, 2026].forEach(function (y) {
    has(`R${y - 2018} 給与所得控除の最低保障`, D.INCOME_TAX[y].salaryMin);
    has(`R${y - 2018} 最低保障の適用上限`, D.INCOME_TAX[y].salaryMinCap);
  });
  has('65歳未満の年金控除の最低保障', D.PENSION_DEDUCTION.under65.min);
  has('65歳未満の最低保障の上限', D.PENSION_DEDUCTION.under65.minCap);
  has('65歳以上の年金控除の最低保障', D.PENSION_DEDUCTION.over65.min);
  has('65歳以上の最低保障の上限', D.PENSION_DEDUCTION.over65.minCap);
  D.PENSION_DEDUCTION.steps.forEach(function (s, i) { has(`年金控除の定額部分${i}`, s[2]); });

  // 基礎控除（所得税・住民税）
  [2025, 2026].forEach(function (y) {
    D.INCOME_TAX[y].basic.forEach(function (b) { if (b[1] > 0) has(`R${y - 2018} 基礎控除`, b[1]); });
  });
  D.RESIDENT_TAX[2026].basic.forEach(function (b) { if (b[1] > 0) has('住民税の基礎控除', b[1]); });

  // 人的控除
  ['normal', 'special', 'liveTogether'].forEach(function (k) {
    D.DISABILITY[k].forEach(function (v) { has(`障害者控除(${k})`, v); });
  });
  D.WIDOW.forEach(function (v) { has('寡婦控除', v); });
  D.SINGLE_PARENT.forEach(function (v) { has('ひとり親控除', v); });
  ['general', 'specific', 'oldOther', 'oldLiving'].forEach(function (k) {
    D.DEPENDENT_DEDUCTION[k].forEach(function (v) { has(`扶養控除(${k})`, v); });
  });
  D.TOKUTEI_SHINZOKU.forEach(function (r) { has('特定親族特別控除', r[1]); has('特定親族特別控除(住民税)', r[2]); });
  D.SPOUSE_DEDUCTION.normal.forEach(function (r) { has('配偶者控除', r[1]); has('配偶者控除(住民税)', r[2]); });
  D.SPOUSE_DEDUCTION.old.forEach(function (r) { has('配偶者控除(老人)', r[1]); has('配偶者控除(老人・住民税)', r[2]); });

  // 保険料控除
  ['lifeTotalCapIncome', 'lifeTotalCapResident', 'lifeCategoryCapIncome', 'lifeCategoryCapResident',
    'quakeIncomeMax', 'quakeResidentMax'].forEach(function (k) { has(`保険料控除 ${k}`, D.INSURANCE[k]); });

  // 住民税の非課税限度額・均等割
  [1, 2, 3].forEach(function (k) {
    has(`${k}級地の1人あたり`, D.HIKAZEI.kintou[k][0]);
    has(`${k}級地の加算額`, D.HIKAZEI.kintou[k][1]);
  });
  has('所得割の1人あたり', D.HIKAZEI.shotoku[0]);
  has('所得割の加算額', D.HIKAZEI.shotoku[1]);
  has('均等割（市町村）', D.KINTOWARI.city);
  has('均等割（道府県）', D.KINTOWARI.pref);
  ok(`特例非課税の限度額（${D.HIKAZEI.specialLimit.toLocaleString()}）が資料に載っている`,
    /135万円/.test(doc) || doc.indexOf(yen(D.HIKAZEI.specialLimit)) >= 0, '未記載');

  // 所得税の速算表
  D.INCOME_TAX_BRACKETS.forEach(function (b) {
    if (isFinite(b[0])) has('速算表の上限', b[0]);
    if (b[2] > 0) has('速算表の控除額', b[2]);
  });
  ok('復興特別所得税の税率が資料に載っている', /2\.1％/.test(doc), '未記載');

  // 退職所得・山林所得
  Object.keys(D.RETIREMENT).forEach(function (k) { has(`退職所得 ${k}`, D.RETIREMENT[k]); });
  has('山林所得の特別控除', D.FOREST.specialDeduction);

  // 国保
  ['base', 'kyuyoAdd', 'per5', 'per2', 'pensionDeduct65'].forEach(function (k) { has(`国保 ${k}`, D.KOKUHO[k]); });
  Object.keys(D.KOKUHO.limits).forEach(function (k) { has(`国保の限度額 ${k}`, D.KOKUHO.limits[k]); });

  // JASSO
  D.JASSO.kubun.forEach(function (k) { if (k.hi > 100) has(`JASSO 第${k.id}区分の上限`, k.hi); });
  has('JASSO 貸与型第一種の目安', D.JASSO.taiyoIchishu);

  // 分離課税の税率
  D.SEPARATE.forEach(function (s) {
    ok(`分離課税「${s.label}」が資料に載っている`, doc.indexOf(s.label.replace('等の', '等の')) >= 0
      || doc.indexOf(s.label.slice(0, 6)) >= 0, '未記載');
  });

  // 端数処理の一覧が資料の冒頭にあること
  ok('端数処理の一覧が資料にある', /## 0\. 端数処理の一覧/.test(doc));
  ['1,000円未満切り捨て', '100円未満切り捨て', '切り上げ'].forEach(function (w) {
    ok(`「${w}」の説明がある`, doc.indexOf(w) >= 0, '未記載');
  });
}
report();

section('D-6 tax-parameters.json が data.js と一致していること');
{
  /* JSON は data.js から生成した写し。手で書き換えたり、data.js だけ直して
   * 再生成し忘れたりすると食い違うので、主要な値を突き合わせる。 */
  const jf = path.join(__dirname, '..', 'tax-parameters.json');
  if (!fs.existsSync(jf)) {
    ok('tax-parameters.json が存在する', false, 'node test/build-tax-parameters.js を実行してください');
  } else {
    const J = JSON.parse(fs.readFileSync(jf, 'utf8'));
    ok('生成元が data.js と明記されている', J.meta.masterFile === 'assets/data.js');

    [2025, 2026].forEach(y => {
      const a = D.INCOME_TAX[y], b = J.incomeTax[String(y)];
      ok(`所得税${y} 給与所得控除の最低保障`, b.salaryDeductionMinimum.value === a.salaryMin);
      ok(`所得税${y} 最低保障の適用上限`, b.salaryDeductionMinimumCap.value === a.salaryMinCap);
      ok(`所得税${y} 扶養親族等の所得要件`, b.dependentIncomeLimit.value === a.dependentLimit);
      ok(`所得税${y} 勤労学生の所得要件`, b.studentIncomeLimit.value === a.studentLimit);
      ok(`所得税${y} 基礎控除の段数`, b.basicDeduction.table.length === a.basic.length);
      a.basic.forEach((row, i) => {
        ok(`所得税${y} 基礎控除${i}`, b.basicDeduction.table[i].deduction === row[1]);
      });
      ok(`所得税${y} 特定親族の下限`, b.tokuteiShinzokuRange.lower === a.tokuteiLower);
      ok(`所得税${y} 特定親族の上限`, b.tokuteiShinzokuRange.upper === a.tokuteiUpper);
    });
    [2026, 2027].forEach(y => {
      const a = D.RESIDENT_TAX[y], b = J.residentTax[String(y)];
      ok(`住民税${y} 扶養親族等の所得要件`, b.dependentIncomeLimit.value === a.dependentLimit);
      ok(`住民税${y} provisional の反映`,
        b.status === (a.provisional ? 'provisional' : 'final'), `${b.status}`);
    });
    ok('均等割（市町村）', J.residentTax.kintouwariStandard.city === D.KINTOWARI.city);
    ok('均等割（道府県）', J.residentTax.kintouwariStandard.pref === D.KINTOWARI.pref);
    ok('森林環境税', J.residentTax.kintouwariStandard.forestNationalTax === D.KINTOWARI.forest);
    [1, 2, 3].forEach(k => {
      ok(`${k}級地の1人あたり`, J.residentTax.hikazeiLimits.kintouByKyuchi[k].perPerson === D.HIKAZEI.kintou[k][0]);
      ok(`${k}級地の加算額`, J.residentTax.hikazeiLimits.kintouByKyuchi[k].addition === D.HIKAZEI.kintou[k][1]);
    });
    ok('都道府県が47件', J.residentTax.prefectureSurtax.list.length === D.PREFECTURES.length);
    D.PREFECTURES.forEach((p, i) => {
      ok(`${p.n} の上乗せ額`, J.residentTax.prefectureSurtax.list[i].kintouAddition === p.add);
      ok(`${p.n} の所得割率`, J.residentTax.prefectureSurtax.list[i].shotokuRate === p.rate);
    });
    ['base', 'per5', 'per2', 'kyuyoAdd'].forEach(k => {
      const m = { base: 'base', per5: 'per5wari', per2: 'per2wari', kyuyoAdd: 'salaryEarnerAddition' }[k];
      ok(`国保 ${k}`, J.kokuho.reductionThresholds[m].value === D.KOKUHO[k]);
    });
    ok('国保の賦課限度額', J.kokuho.limits.value.total === D.KOKUHO.limits.total);
    ok('JASSOの区分数', J.jasso.kubun.length === D.JASSO.kubun.length);
    D.JASSO.kubun.forEach((k, i) => {
      ok(`JASSO 第${k.id}区分の上限`, J.jasso.kubun[i].to === k.hi);
    });
    D.SEPARATE.forEach((s, i) => {
      ok(`分離課税 ${s.key} の所得税率`, J.separateTaxation.list[i].incomeTaxRate === s.it);
      ok(`分離課税 ${s.key} の住民税率`, J.separateTaxation.list[i].residentTaxRate === s.rt);
    });
    ok('公表待ちの項目が記録されている', Array.isArray(J.pending) && J.pending.length > 0);
    J.pending.forEach((p, i) => {
      ok(`公表待ち${i} に理由がある`, !!p.reason && !!p.action);
      ok(`公表待ち${i} の status が正しい`, ['pending', 'provisional'].indexOf(p.status) >= 0);
    });
  }
}
report();

console.log(`\n===== 監査 ${pass + fail} 件：問題なし ${pass} / 要修正 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
