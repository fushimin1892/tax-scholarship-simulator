/* ============================================================================
 * verify-calc.js — 計算を「1つずつ」法令の条文・速算表と突き合わせる検証
 *
 *   node test/verify-calc.js            … 全件
 *   node test/verify-calc.js 給与        … 見出しに「給与」を含む節だけ
 *
 * verify.js が「通しの計算例」（自治体の公式計算例との突合）を担当するのに対し、
 * こちらは各関数・各控除・各税率を単独で、境界値と端数まで含めて検証する。
 * 期待値はすべて条文・速算表から手計算したものを直書きしている（実装から
 * 逆算した値を書くと検証にならないため）。
 * ==========================================================================*/
const Calc = require('../assets/calc.js');
const D = require('../assets/data.js');

const only = process.argv[2];
let pass = 0, fail = 0, skipped = 0, current = '', shown = false;
const fails = [];

function section(t) { current = t; shown = false; }
function head() {
  if (!shown) { console.log('\n=== ' + current + ' ==='); shown = true; }
}
function eq(label, actual, expected) {
  if (only && current.indexOf(only) < 0) { skipped++; return; }
  head();
  if (actual === expected) { pass++; console.log(`  OK   ${label} = ${fmt(actual)}`); }
  else {
    fail++; fails.push(`${current} / ${label}: ${fmt(actual)}（期待 ${fmt(expected)}）`);
    console.log(`  NG   ${label} = ${fmt(actual)}  ← 期待 ${fmt(expected)}`);
  }
}
function fmt(v) { return typeof v === 'number' ? v.toLocaleString('ja-JP') : String(v); }

/* 入力のひな形。上書きしたいところだけ渡す。 */
function base(over) {
  const b = {
    incomeYear: 2025, residentYear: 2026,
    region: { pref: '東京都', city: '特別区（23区）', seirei: false,
      cityKin: 3000, prefKin: 1000, cityRate: 6, prefRate: 4, kyuchi: 1 },
    income: {
      salary: 0, pension: 0, pensionAge65: false, business: 0, realEstate: 0, otherIncome: 0,
      landShort: 0, landLong: 0, stockTransfer: 0, stockDividend: 0, futures: 0,
      forestRevenue: 0, forestExpense: 0,
      retirementRevenue: 0, retirementYears: 0, retirementOfficer: false,
      retirementShort: false, retirementDisability: false
    },
    carryover: { stockLoss: 0, netLoss: 0, casualtyLoss: 0 },
    ded: { social: 0, kyosai: 0, lifeNewGeneral: 0, lifeOldGeneral: 0, lifeNewCare: 0,
      lifeNewPension: 0, lifeOldPension: 0, quake: 0, longOld: 0,
      medical: 0, medicalComp: 0, zasson: 0, otherDeduction: 0 },
    family: {
      hasSpouse: false, spouseIncome: 0, spouseOld: false,
      dep16_18: 0, dep19_22: 0, dep23_69: 0, depOldOther: 0, depOldLiving: 0, depUnder16: 0,
      tokuteiEnabled: false, tokuteiIncome: 0,
      disNormal: 0, disSpecial: 0, disLive: 0, selfDisability: 'none',
      widow: false, singleParent: 'none', student: false,
      under23Dependent: false, specialDisabilityFamily: false
    },
    flags: { minor: false, welfare: false },
    taxCredit: 0, residentCredit: 0,
    kokuho: { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 }
  };
  const o = over || {};
  Object.keys(o).forEach(function (k) {
    b[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? Object.assign(b[k], o[k]) : o[k];
  });
  return b;
}
/* 所得控除だけを取り出すヘルパ（名前で1件引く） */
function dedOf(input, name, mode) {
  const p = mode === 'resident' ? D.RESIDENT_TAX[input.residentYear] : D.INCOME_TAX[input.incomeYear];
  const r = mode === 'resident' ? Calc.calcResidentTax(input) : Calc.calcIncomeTax(input);
  const hit = r.deduction.list.filter(function (x) { return x.name.indexOf(name) === 0; });
  return hit.reduce(function (s, x) { return s + x.amount; }, 0);
}

/* ==========================================================================
 * 1. 給与所得（所得税法別表第五）
 *    190万円（令和8年分は220万円）以下 … 収入 − 最低保障額
 *    それ超〜660万円未満 … A＝収入÷4（千円未満切捨て）を使う4,000円刻みの表
 *    660万〜850万 … 収入×90％ − 110万円 ／ 850万超 … 収入 − 195万円
 * ======================================================================== */
section('1. 給与所得（別表第五・令和7年分）');
{
  const p = D.INCOME_TAX[2025];
  const inc = function (r) { return Calc.salaryIncomeAmount(r, p); };
  eq('収入0円', inc(0), 0);
  eq('収入650,000円（最低保障と同額）', inc(650000), 0);
  eq('収入651,000円', inc(651000), 1000);
  eq('収入1,000,000円', inc(1000000), 350000);
  eq('収入1,899,999円（最低保障の上限）', inc(1899999), 1249999);
  eq('収入1,900,000円（表の起点・連続）', inc(1900000), 1250000);
  eq('収入1,903,000円（4,000円刻みで据置き）', inc(1903000), 1250000);
  eq('収入1,904,000円（次の刻みへ）', inc(1904000), 1252800);
  eq('収入3,599,999円', inc(3599999), 2437200);
  eq('収入3,600,000円（区分の境目・連続）', inc(3600000), 2440000);
  eq('収入5,505,000円（名古屋市の公式計算例）', inc(5505000), 3963200);
  eq('収入6,599,999円', inc(6599999), 4836800);
  eq('収入6,600,000円（区分の境目・連続）', inc(6600000), 4840000);
  eq('収入8,499,999円', inc(8499999), 6549999);
  eq('収入8,500,000円（上限・連続）', inc(8500000), 6550000);
  eq('収入10,000,000円', inc(10000000), 8050000);
  eq('給与所得控除額 収入5,000,000円', Calc.salaryDeduction(5000000, p), 1440000);
  eq('給与所得控除額 収入10,000,000円（195万円で頭打ち）', Calc.salaryDeduction(10000000, p), 1950000);
}

section('1c. 給与所得：別表第五の構造そのものを検証する');
{
  /* 別表第五は「4,000円刻みの帯の中では給与所得が一定」という表。
   * 実装が A＝⌊収入÷4⌋1000 で組み立てているので、次の3つが成り立てば
   * 表を再現できていると言える。
   *   ① 最低保障の区間では 収入−最低保障額 が1円刻みで連続する
   *   ② 境目で両側の値が一致する（段差がない）
   *   ③ 境目から上は、ちょうど4,000円ごとに値が変わる
   *
   * 旧制度（令和6年分以前・最低保障55万）は境目が1,625,000円で
   * 4,000の倍数でなかったため、国税庁の表に固定額の特例行が必要だった。
   * 令和7年分（1,900,000円）・令和8年分（2,200,000円）はどちらも
   * 4,000で割り切れるので、その特例行は生じない。 */
  [[2025, D.INCOME_TAX[2025]], [2026, D.INCOME_TAX[2026]]].forEach(function (x) {
    var year = x[0], p = x[1], cap = p.salaryMinCap, tag = 'R' + (year - 2018);
    eq(`${tag} 境目が4,000円の倍数（特例行が不要）`, cap % 4000, 0);

    // ① 最低保障の区間は1円刻みで連続
    var contOK = true;
    for (var r = cap - 10; r < cap; r++) {
      if (Calc.salaryIncomeAmount(r, p) !== r - p.salaryMin) contOK = false;
    }
    eq(`${tag} 最低保障の区間は 収入−最低保障額 のまま`, contOK, true);

    // ② 境目で段差がない
    eq(`${tag} 境目の直前と境目の差が1円`,
      Calc.salaryIncomeAmount(cap, p) - Calc.salaryIncomeAmount(cap - 1, p), 1);

    // ③ 境目から上は4,000円ごとの階段（帯の中では一定、帯をまたぐと増える）
    var bandOK = true, stepOK = true;
    for (var b = 0; b < 40; b++) {
      var base = cap + b * 4000;
      var v = Calc.salaryIncomeAmount(base, p);
      for (var d = 1; d < 4000; d += 397) {           // 帯の中を粗くなめる
        if (Calc.salaryIncomeAmount(base + d, p) !== v) bandOK = false;
      }
      if (b > 0 && v <= Calc.salaryIncomeAmount(base - 4000, p)) stepOK = false;
    }
    eq(`${tag} 4,000円の帯の中では給与所得が一定`, bandOK, true);
    eq(`${tag} 帯をまたぐと必ず増える`, stepOK, true);

    // 区分の変わり目（360万・660万・850万）でも段差がない
    [3600000, 6600000, 8500000].forEach(function (edge) {
      eq(`${tag} 収入${edge.toLocaleString()}円の区分境界で段差がない`,
        Calc.salaryIncomeAmount(edge, p) - Calc.salaryIncomeAmount(edge - 1, p) >= 0, true);
    });
  });
}

section('1b. 給与所得（令和8年分・最低保障74万円）');
{
  const p = D.INCOME_TAX[2026];
  const inc = function (r) { return Calc.salaryIncomeAmount(r, p); };
  eq('収入740,000円', inc(740000), 0);
  eq('収入1,780,000円（178万円の壁）', inc(1780000), 1040000);
  eq('収入2,199,999円', inc(2199999), 1459999);
  eq('収入2,200,000円（表の起点・連続）', inc(2200000), 1460000);
  eq('収入2,203,000円（4,000円刻みで据置き）', inc(2203000), 1460000);
  eq('収入2,204,000円', inc(2204000), 1462800);
  eq('収入6,600,000円（区分の境目・連続）', inc(6600000), 4840000);
}

/* ==========================================================================
 * 2. 公的年金等に係る雑所得（国税庁 No.1600 速算表）
 *    雑所得 ＝ 収入 × 割合 − 控除額。1円未満は切捨て。
 * ======================================================================== */
section('2. 公的年金等控除（65歳未満）');
{
  const d = function (r, o) { return Calc.pensionDeduction(r, false, o || 0); };
  eq('収入600,000円（控除は収入が上限）', d(600000), 600000);
  eq('収入1,000,000円', d(1000000), 600000);
  eq('収入1,300,000円（最低保障の上限・連続）', d(1300000), 600000);
  eq('収入2,000,000円（25％＋275,000円）', d(2000000), 775000);
  eq('収入4,100,000円（区分の境目・連続）', d(4100000), 1300000);
  eq('収入5,000,000円（15％＋685,000円）', d(5000000), 1435000);
  eq('収入7,700,000円（区分の境目・連続）', d(7700000), 1840000);
  eq('収入8,000,000円（5％＋1,455,000円）', d(8000000), 1855000);
  eq('収入10,000,000円（区分の境目・連続）', d(10000000), 1955000);
  eq('収入12,000,000円（1,955,000円で頭打ち）', d(12000000), 1955000);
}
section('2b. 公的年金等控除（65歳以上・他所得による減額）');
{
  const d = function (r, o) { return Calc.pensionDeduction(r, true, o || 0); };
  eq('収入1,100,000円', d(1100000), 1100000);
  eq('収入3,300,000円（最低保障の上限・連続）', d(3300000), 1100000);
  eq('収入4,000,000円', d(4000000), 1275000);
  eq('他所得10,000,000円ちょうど（減額なし）', d(4000000, 10000000), 1275000);
  eq('他所得10,000,001円（10万円減額）', d(4000000, 10000001), 1175000);
  eq('他所得20,000,001円（20万円減額）', d(4000000, 20000001), 1075000);
}
section('2c. 公的年金等の雑所得に1円未満の端数を残さない');
{
  /* 収入1,300,002円・65歳未満 → 雑所得 ＝ 1,300,002×75％ − 275,000 ＝ 700,001.5
   * 1円未満切捨てで 700,001円。小数のまま持つと非課税限度額の判定がずれる。 */
  const r = Calc.calcAll(base({ income: { pension: 1300002 } }));
  eq('年金収入1,300,002円 → 雑所得', r.incomeTax.income.pensionIncome, 700001);
  eq('合計所得金額が整数', Number.isInteger(r.incomeTax.income.gokei), true);
  const r2 = Calc.calcAll(base({ income: { pension: 2000006 } }));
  eq('年金収入2,000,006円 → 雑所得', r2.incomeTax.income.pensionIncome, 1225004);
  eq('総所得金額等が整数', Number.isInteger(r2.incomeTax.income.souShotokuTou), true);
}

/* ==========================================================================
 * 3. 退職所得（所得税法30条・措置法）
 * ======================================================================== */
section('3. 退職所得控除額と退職所得金額');
{
  const ri = function (o) { return Calc.retirementIncome(Object.assign(
    { retirementRevenue: 0, retirementYears: 0 }, o)); };
  eq('勤続1年（80万円の最低保障）', ri({ retirementRevenue: 3000000, retirementYears: 1 }).deduction, 800000);
  eq('勤続2年（40万×2＝80万で最低保障と同額）', ri({ retirementRevenue: 3000000, retirementYears: 2 }).deduction, 800000);
  eq('勤続3年（40万×3）', ri({ retirementRevenue: 3000000, retirementYears: 3 }).deduction, 1200000);
  eq('勤続20年（40万×20）', ri({ retirementRevenue: 3000000, retirementYears: 20 }).deduction, 8000000);
  eq('勤続21年（800万＋70万×1）', ri({ retirementRevenue: 3000000, retirementYears: 21 }).deduction, 8700000);
  eq('勤続30年（800万＋70万×10）', ri({ retirementRevenue: 3000000, retirementYears: 30 }).deduction, 15000000);
  eq('勤続10.2年 → 11年に切上げ', ri({ retirementRevenue: 3000000, retirementYears: 10.2 }).years, 11);
  eq('障害による退職は控除額に100万円加算',
    ri({ retirementRevenue: 3000000, retirementYears: 10, retirementDisability: true }).deduction, 5000000);
  eq('一般：収入1,000万・勤続20年 → (1,000万−800万)÷2',
    ri({ retirementRevenue: 10000000, retirementYears: 20 }).income, 1000000);
  eq('控除額が収入を上回れば0円',
    ri({ retirementRevenue: 3000000, retirementYears: 30 }).income, 0);
  eq('特定役員（勤続5年以下）は2分の1課税なし',
    ri({ retirementRevenue: 10000000, retirementYears: 5, retirementOfficer: true }).income, 8000000);
  eq('短期退職（控除後300万円ちょうど）は全額2分の1',
    ri({ retirementRevenue: 5000000, retirementYears: 5, retirementShort: true }).income, 1500000);
  eq('短期退職（控除後400万円）は150万＋超過分',
    ri({ retirementRevenue: 6000000, retirementYears: 5, retirementShort: true }).income, 2500000);
  eq('勤続6年なら短期の特例は効かない（通常の2分の1）',
    ri({ retirementRevenue: 6000000, retirementYears: 6, retirementShort: true }).income, 1800000);
}

/* ==========================================================================
 * 4. 所得控除を1つずつ（所得税／住民税の両方）
 * ======================================================================== */
section('4a. 生命保険料控除（新契約・所得税）');
{
  const v = function (a) { return dedOf(base({ ded: { lifeNewGeneral: a } }), '生命保険料控除'); };
  eq('支払20,000円（全額）', v(20000), 20000);
  eq('支払20,002円（×1/2＋10,000円）', v(20002), 20001);
  eq('支払40,000円', v(40000), 30000);
  eq('支払80,000円（上限に到達）', v(80000), 40000);
  eq('支払200,000円（40,000円で頭打ち）', v(200000), 40000);
  /* 端数は切上げ（国税庁「年末調整のしかた」）。20,001×1/2＋10,000＝20,000.5 → 20,001 */
  eq('支払20,001円は切上げて20,001円', v(20001), 20001);
}
section('4b. 生命保険料控除（旧契約・新旧併用・住民税）');
{
  const inc = function (o) { return dedOf(base({ ded: o }), '生命保険料控除'); };
  const res = function (o) { return dedOf(base({ ded: o }), '生命保険料控除', 'resident'); };
  eq('旧25,000円（所得税・全額）', inc({ lifeOldGeneral: 25000 }), 25000);
  eq('旧50,000円（所得税）', inc({ lifeOldGeneral: 50000 }), 37500);
  eq('旧200,000円（所得税・50,000円で頭打ち）', inc({ lifeOldGeneral: 200000 }), 50000);
  eq('新旧併用（新80,000＋旧200,000）は旧のみ50,000円が有利',
    inc({ lifeNewGeneral: 80000, lifeOldGeneral: 200000 }), 50000);
  eq('新旧併用（新80,000＋旧30,000）は合算して上限40,000円',
    inc({ lifeNewGeneral: 80000, lifeOldGeneral: 30000 }), 40000);
  eq('3区分合計の上限120,000円（所得税）',
    inc({ lifeNewGeneral: 80000, lifeNewCare: 80000, lifeNewPension: 80000 }), 120000);
  eq('新12,000円（住民税・全額）', res({ lifeNewGeneral: 12000 }), 12000);
  eq('新32,000円（住民税）', res({ lifeNewGeneral: 32000 }), 22000);
  eq('新56,000円（住民税・上限28,000円）', res({ lifeNewGeneral: 56000 }), 28000);
  eq('旧70,000円（住民税・上限35,000円）', res({ lifeOldGeneral: 70000 }), 35000);
  eq('新旧併用は旧のみ35,000円が有利（住民税）',
    res({ lifeNewGeneral: 56000, lifeOldGeneral: 70000 }), 35000);
  eq('3区分合計の上限70,000円（住民税）',
    res({ lifeNewGeneral: 56000, lifeNewCare: 56000, lifeNewPension: 56000 }), 70000);
}
section('4c. 地震保険料控除');
{
  const inc = function (o) { return dedOf(base({ ded: o }), '地震保険料控除'); };
  const res = function (o) { return dedOf(base({ ded: o }), '地震保険料控除', 'resident'); };
  eq('地震30,000円（所得税・全額）', inc({ quake: 30000 }), 30000);
  eq('地震60,000円（所得税・上限50,000円）', inc({ quake: 60000 }), 50000);
  eq('地震30,000円（住民税・2分の1）', res({ quake: 30000 }), 15000);
  eq('地震30,001円（住民税・端数切上げ）', res({ quake: 30001 }), 15001);
  eq('地震60,000円（住民税・上限25,000円）', res({ quake: 60000 }), 25000);
  eq('旧長期10,000円（所得税・全額）', inc({ longOld: 10000 }), 10000);
  eq('旧長期20,000円（所得税）', inc({ longOld: 20000 }), 15000);
  eq('旧長期30,000円（所得税・上限15,000円）', inc({ longOld: 30000 }), 15000);
  eq('旧長期5,000円（住民税・全額）', res({ longOld: 5000 }), 5000);
  eq('旧長期15,000円（住民税）', res({ longOld: 15000 }), 10000);
  eq('地震と旧長期の合計も上限50,000円（所得税）',
    inc({ quake: 50000, longOld: 30000 }), 50000);
}
section('4d. 医療費控除');
{
  /* 足切りは「総所得金額等×5％」と10万円の小さいほう */
  const v = function (sal, med, comp) {
    return dedOf(base({ income: { salary: sal }, ded: { medical: med, medicalComp: comp || 0 } }), '医療費控除');
  };
  eq('給与500万（所得356万）・医療費30万 → 10万円が足切り', v(5000000, 300000), 200000);
  eq('補填10万円があるとその分減る', v(5000000, 300000, 100000), 100000);
  eq('所得が少ないと5％が足切り（給与165万→所得100万・医療費10万）',
    v(1650000, 100000), 50000);
  eq('足切りを下回れば0円', v(5000000, 80000), 0);
  eq('上限200万円', v(20000000, 5000000), 2000000);
}
section('4e. 人的控除（所得税／住民税）');
{
  const P = function (fam) { return base({ family: fam }); };
  eq('障害者控除（本人・普通）所得税', dedOf(P({ selfDisability: 'normal' }), '障害者控除'), 270000);
  eq('障害者控除（本人・普通）住民税', dedOf(P({ selfDisability: 'normal' }), '障害者控除', 'resident'), 260000);
  eq('障害者控除（本人・特別）所得税', dedOf(P({ selfDisability: 'special' }), '障害者控除'), 400000);
  eq('障害者控除（本人・特別）住民税', dedOf(P({ selfDisability: 'special' }), '障害者控除', 'resident'), 300000);
  eq('同居特別障害者1人 所得税', dedOf(P({ disLive: 1 }), '障害者控除'), 750000);
  eq('同居特別障害者1人 住民税', dedOf(P({ disLive: 1 }), '障害者控除', 'resident'), 530000);
  eq('寡婦控除 所得税', dedOf(P({ widow: true }), '寡婦控除'), 270000);
  eq('寡婦控除 住民税', dedOf(P({ widow: true }), '寡婦控除', 'resident'), 260000);
  eq('ひとり親控除 所得税', dedOf(P({ singleParent: 'mother' }), 'ひとり親控除'), 350000);
  eq('ひとり親控除 住民税', dedOf(P({ singleParent: 'mother' }), 'ひとり親控除', 'resident'), 300000);
  eq('勤労学生控除 所得税', dedOf(P({ student: true }), '勤労学生控除'), 270000);
  eq('勤労学生控除 住民税', dedOf(P({ student: true }), '勤労学生控除', 'resident'), 260000);
}
section('4f. 扶養控除');
{
  const P = function (fam) { return base({ family: fam }); };
  eq('16〜18歳1人 所得税', dedOf(P({ dep16_18: 1 }), '扶養控除'), 380000);
  eq('16〜18歳1人 住民税', dedOf(P({ dep16_18: 1 }), '扶養控除', 'resident'), 330000);
  eq('特定扶養（19〜22歳）1人 所得税', dedOf(P({ dep19_22: 1 }), '扶養控除'), 630000);
  eq('特定扶養（19〜22歳）1人 住民税', dedOf(P({ dep19_22: 1 }), '扶養控除', 'resident'), 450000);
  eq('23〜69歳2人 所得税', dedOf(P({ dep23_69: 2 }), '扶養控除'), 760000);
  eq('老人（同居老親等以外）1人 所得税', dedOf(P({ depOldOther: 1 }), '扶養控除'), 480000);
  eq('老人（同居老親等以外）1人 住民税', dedOf(P({ depOldOther: 1 }), '扶養控除', 'resident'), 380000);
  eq('同居老親等1人 所得税', dedOf(P({ depOldLiving: 1 }), '扶養控除'), 580000);
  eq('同居老親等1人 住民税', dedOf(P({ depOldLiving: 1 }), '扶養控除', 'resident'), 450000);
  eq('16歳未満は扶養控除の対象外', dedOf(P({ depUnder16: 3 }), '扶養控除'), 0);
}
section('4g. 配偶者控除・配偶者特別控除');
{
  const P = function (sal, sInc, old) {
    return base({ income: { salary: sal }, family: { hasSpouse: true, spouseIncome: sInc, spouseOld: !!old } });
  };
  eq('本人900万以下・配偶者所得0（所得税）', dedOf(P(3000000, 0), '配偶者控除'), 380000);
  eq('本人900万以下・配偶者所得0（住民税）', dedOf(P(3000000, 0), '配偶者控除', 'resident'), 330000);
  eq('老人控除対象配偶者（所得税）', dedOf(P(3000000, 0, true), '配偶者控除（老人）'), 480000);
  eq('配偶者の所得58万円ちょうどは配偶者控除', dedOf(P(3000000, 580000), '配偶者控除'), 380000);
  eq('配偶者の所得58万円超は配偶者特別控除', dedOf(P(3000000, 580001), '配偶者特別控除'), 380000);
  eq('配偶者の所得133万円（上限）', dedOf(P(3000000, 1330000), '配偶者特別控除'), 30000);
  eq('配偶者の所得133万円超は対象外', dedOf(P(3000000, 1330001), '配偶者特別控除'), 0);
  /* 本人の合計所得による逓減：給与1,195万→所得1,000万（1,000万以下の段） */
  eq('本人の合計所得1,000万円ちょうどは1/3の額', dedOf(P(11950000, 0), '配偶者控除'), 130000);
  eq('本人の合計所得1,000万円超は適用なし', dedOf(P(11950001, 0), '配偶者控除'), 0);
}
section('4h. 特定親族特別控除（令和7年分創設）');
{
  const P = function (v) { return base({ family: { tokuteiEnabled: true, tokuteiIncome: v } }); };
  eq('所得58万円ちょうどは扶養控除の側（特別控除なし）', dedOf(P(580000), '特定親族特別控除'), 0);
  eq('所得58万円超85万円以下 所得税', dedOf(P(850000), '特定親族特別控除'), 630000);
  eq('所得58万円超95万円以下 住民税', dedOf(P(850000), '特定親族特別控除', 'resident'), 450000);
  eq('所得90万円以下 所得税', dedOf(P(900000), '特定親族特別控除'), 610000);
  eq('所得95万円以下 所得税', dedOf(P(950000), '特定親族特別控除'), 510000);
  eq('所得100万円以下 所得税', dedOf(P(1000000), '特定親族特別控除'), 410000);
  eq('所得100万円以下 住民税', dedOf(P(1000000), '特定親族特別控除', 'resident'), 410000);
  eq('所得123万円（上限）', dedOf(P(1230000), '特定親族特別控除'), 30000);
  eq('所得123万円超は対象外', dedOf(P(1230001), '特定親族特別控除'), 0);
}
section('4i. 基礎控除（令和7年分の特例加算）');
{
  const P = function (other) { return base({ income: { otherIncome: other } }); };
  eq('合計所得132万円以下 → 95万円', dedOf(P(1320000), '基礎控除'), 950000);
  eq('合計所得132万円超336万円以下 → 88万円', dedOf(P(1320001), '基礎控除'), 880000);
  eq('合計所得336万円超489万円以下 → 68万円', dedOf(P(3360001), '基礎控除'), 680000);
  eq('合計所得489万円超655万円以下 → 63万円', dedOf(P(4890001), '基礎控除'), 630000);
  eq('合計所得655万円超2,350万円以下 → 58万円', dedOf(P(6550001), '基礎控除'), 580000);
  eq('合計所得2,350万円超2,400万円以下 → 48万円', dedOf(P(23500001), '基礎控除'), 480000);
  eq('合計所得2,500万円超 → 0円', dedOf(P(25000001), '基礎控除'), 0);
  eq('住民税は2,400万円以下なら一律43万円', dedOf(P(1320000), '基礎控除', 'resident'), 430000);
  eq('住民税 2,400万円超2,450万円以下 → 29万円', dedOf(P(24000001), '基礎控除', 'resident'), 290000);
  eq('住民税 2,500万円超 → 0円', dedOf(P(25000001), '基礎控除', 'resident'), 0);
}

/* ==========================================================================
 * 5. 所得金額調整控除（措置法41条の3の3）
 * ======================================================================== */
section('5. 所得金額調整控除');
{
  const P = function (sal, fam) { return base({ income: { salary: sal }, family: fam || {} }); };
  const a1 = function (sal, fam) { return Calc.calcIncomeTax(P(sal, fam)).income.adjust1; };
  eq('給与850万円ちょうど・23歳未満扶養あり → 0円', a1(8500000, { under23Dependent: true }), 0);
  eq('給与900万円・23歳未満扶養あり → (900万−850万)×10％', a1(9000000, { under23Dependent: true }), 50000);
  eq('給与1,100万円 → 1,000万円で頭打ち', a1(11000000, { under23Dependent: true }), 150000);
  eq('要件を満たさなければ0円', a1(9000000, {}), 0);
  eq('特別障害者である本人も対象', a1(9000000, { selfDisability: 'special' }), 50000);
  eq('端数は切上げ（給与8,500,005円）', a1(8500005, { under23Dependent: true }), 1);
  /* 給与と年金の双方がある場合：(給与所得10万上限＋年金雑所得10万上限)−10万 */
  const r = Calc.calcIncomeTax(base({ income: { salary: 2000000, pension: 1500000, pensionAge65: true } }));
  eq('給与・年金の双方あり → 調整額10万円', r.income.adjust2, 100000);
  const r2 = Calc.calcIncomeTax(base({ income: { salary: 700000, pension: 1150000, pensionAge65: true } }));
  eq('給与所得5万＋年金雑所得5万 → 合計10万円以下なので0円', r2.income.adjust2, 0);
}

/* ==========================================================================
 * 6. 所得税の速算表（所得税法89条）
 * ======================================================================== */
section('6. 所得税の速算表（境界の連続性）');
{
  /* 課税総所得金額をピンポイントで作る。基礎控除は合計所得によって変わるので、
   * 収入を少しずつ足しながら目標の課税総所得になる点を探す（不動点反復）。 */
  const taxOf = function (taxable) {
    let other = taxable + 950000;
    for (let i = 0; i < 40; i++) {
      const r = Calc.calcIncomeTax(base({ income: { otherIncome: other } }));
      if (r.taxable === taxable) return { taxable: r.taxable, before: r.beforeCredit };
      other += taxable - r.taxable;
    }
    return { taxable: -1, before: -1 };
  };
  const cases = [
    [1949000, 97450], [1950000, 97500], [3299000, 232400], [3300000, 232500],
    [6949000, 962300], [6950000, 962500], [8999000, 1433770], [9000000, 1434000],
    [17999000, 4403670], [18000000, 4404000], [39999000, 13203600], [40000000, 13204000]
  ];
  cases.forEach(function (c) {
    const r = taxOf(c[0]);
    eq(`課税総所得${c[0].toLocaleString()}円`, r.taxable === c[0] ? r.before : -1, c[1]);
  });
}
section('6b. 復興特別所得税と100円未満切捨て');
{
  const r = Calc.calcIncomeTax(base({ income: { salary: 5000000 } }));
  /* 給与500万→所得356万。基礎控除68万（合計所得336万超489万以下）→ 課税総所得288万 */
  eq('給与所得', r.income.salaryIncome, 3560000);
  eq('基礎控除', r.deduction.basic, 680000);
  eq('課税総所得金額（千円未満切捨て）', r.taxable, 2880000);
  eq('所得税額（10％−97,500円）', r.beforeCredit, 190500);
  eq('復興特別所得税（2.1％・1円未満切捨て）', r.reconstruction, Math.floor(190500 * 0.021));
  eq('年税額（100円未満切捨て）', r.total, Math.floor((190500 + Math.floor(190500 * 0.021)) / 100) * 100);
  const r2 = Calc.calcIncomeTax(base({ income: { salary: 5000000 }, taxCredit: 190500 }));
  eq('税額控除で税額0円なら復興特別所得税も0円', r2.reconstruction, 0);
  eq('税額控除で年税額0円', r2.total, 0);
}

/* ==========================================================================
 * 7. 分離課税
 * ======================================================================== */
section('7. 分離課税の税率（所得税・住民税）');
{
  /* 所得控除で総合課税分を消さないよう、基礎控除だけの状態で分離所得を入れる */
  const run = function (key, amount) {
    const inc = {}; inc[key] = amount;
    const i = Calc.calcIncomeTax(base({ income: inc }));
    const r = Calc.calcResidentTax(base({ income: inc }));
    return { it: i.beforeCredit, rt: r.cityShotoku + r.prefShotoku, city: r.citySep, pref: r.prefSep,
      taxable: r.taxableSep };
  };
  /* 分離所得1,000万円のみ＝合計所得1,000万円。
   * 所得税の基礎控除は58万円（655万超2,350万以下）→ 課税標準 942万円
   * 住民税の基礎控除は43万円 → 課税標準 957万円 */
  const IT = 10000000 - 580000, RT = 10000000 - 430000;
  const s = run('landShort', 10000000);
  eq('短期譲渡：所得税の課税標準', 10000000 - 580000, IT);
  eq('短期譲渡：住民税の課税標準', s.taxable, RT);
  eq('短期譲渡：所得税30％', s.it, IT * 0.30);
  eq('短期譲渡：市町村分5.4％', s.city, RT * 0.054);
  eq('短期譲渡：道府県分3.6％', s.pref, RT * 0.036);
  eq('短期譲渡：住民税9％（市町村分＋道府県分）', s.city + s.pref, RT * 0.09);
  const l = run('landLong', 10000000);
  eq('長期譲渡：所得税15％', l.it, IT * 0.15);
  eq('長期譲渡：市町村分3％', l.city, RT * 0.03);
  eq('長期譲渡：道府県分2％', l.pref, RT * 0.02);
  eq('長期譲渡：住民税5％', l.city + l.pref, RT * 0.05);
  const k = run('stockTransfer', 10000000);
  eq('株式等譲渡：所得税15％', k.it, IT * 0.15);
  eq('株式等譲渡：住民税5％', k.city + k.pref, RT * 0.05);
  const f = run('futures', 10000000);
  eq('先物取引：所得税15％', f.it, IT * 0.15);
  eq('先物取引：住民税5％', f.city + f.pref, RT * 0.05);
  eq('所得割は最後に100円未満切捨て', s.rt, Math.floor(s.city / 100) * 100 + Math.floor(s.pref / 100) * 100);
}
section('7b. 政令指定都市の分離課税の按分');
{
  const region = { pref: '神奈川県', city: '横浜市', seirei: true,
    cityKin: 3900, prefKin: 1300, cityRate: 8, prefRate: 2.025, kyuchi: 1 };
  const RT = 10000000 - 430000;      // 住民税の基礎控除43万円を引いた課税標準
  const r = Calc.calcResidentTax(base({ region: region, income: { landLong: 10000000 } }));
  eq('政令市・長期譲渡：市民税4％', r.citySep, RT * 0.04);
  eq('政令市・長期譲渡：道府県民税1％', r.prefSep, RT * 0.01);
  eq('政令市・長期譲渡：合計は一般市と同じ5％', r.citySep + r.prefSep, RT * 0.05);
  const r2 = Calc.calcResidentTax(base({ region: region, income: { landShort: 10000000 } }));
  eq('政令市・短期譲渡：市民税7.2％', r2.citySep, RT * 0.072);
  eq('政令市・短期譲渡：道府県民税1.8％', r2.prefSep, RT * 0.018);
  eq('政令市・短期譲渡：合計は一般市と同じ9％', r2.citySep + r2.prefSep, RT * 0.09);
}
section('7c. 山林所得（5分5乗方式）');
{
  const r = Calc.calcIncomeTax(base({ income: { forestRevenue: 10000000, forestExpense: 3000000 } }));
  /* 収入1,000万−経費300万−特別控除50万＝650万。
   * 合計所得650万は「489万超655万以下」なので基礎控除63万 → 課税山林587万 */
  eq('山林所得金額（特別控除50万円後）', r.income.forest, 6500000);
  eq('課税山林所得金額', r.allocation.forest, 5870000);
  /* 5分5乗：5,870,000÷5＝1,174,000 → 5％で58,700 → ×5＝293,500 */
  const forestPart = r.parts.filter(function (x) { return x.name.indexOf('山林') >= 0; })[0];
  eq('山林の所得税額（1/5に税率→5倍）', forestPart.tax, 293500);
  /* 1/5が千円の倍数にならないケース。ここに余計な千円未満切捨てを入れると
   * 税額が100円ずれる（5,272,000÷5＝1,054,400 → 5％で52,720 → ×5＝263,600） */
  const r2 = Calc.calcIncomeTax(base({ income: { forestRevenue: 6402000, forestExpense: 0 } }));
  eq('山林所得金額', r2.income.forest, 5902000);
  eq('課税山林所得金額', r2.allocation.forest, 5272000);
  const fp2 = r2.parts.filter(function (x) { return x.name.indexOf('山林') >= 0; })[0];
  eq('1/5にした額を千円未満で丸めない', fp2.tax, 263600);
}

/* ==========================================================================
 * 8. 繰越控除と所得控除の充当順序
 * ======================================================================== */
section('8. 繰越控除（合計所得金額と総所得金額等の分離）');
{
  const r = Calc.calcAll(base({
    income: { stockTransfer: 3000000 },
    carryover: { stockLoss: 1000000 }
  }));
  eq('合計所得金額は繰越控除「前」', r.incomeTax.income.gokei, 3000000);
  eq('総所得金額等は繰越控除「後」', r.incomeTax.income.souShotokuTou, 2000000);
  eq('使った繰越額', r.incomeTax.income.carryStockUsed, 1000000);
  eq('残った繰越額', r.incomeTax.income.carryStockRemain, 0);
  /* 上場株式等の譲渡損失は株式譲渡・配当からのみ控除できる */
  const r2 = Calc.calcAll(base({
    income: { futures: 3000000 }, carryover: { stockLoss: 1000000 }
  }));
  eq('先物所得からは株式の繰越損失を引かない', r2.incomeTax.income.souShotokuTou, 3000000);
  eq('引けなかった繰越額はそのまま残る', r2.incomeTax.income.carryStockRemain, 1000000);
  /* 純損失は総所得→分離→山林→退職の順 */
  const r3 = Calc.calcAll(base({
    income: { salary: 2000000, landShort: 1000000 }, carryover: { netLoss: 2000000 }
  }));
  /* 給与200万→給与所得132万。純損失200万をまず総所得132万に充て、
   * 残り68万を短期譲渡100万から引いて32万 */
  eq('まず総所得金額から控除', r3.incomeTax.income.sougou, 0);
  eq('引ききれない分を分離課税から控除', r3.incomeTax.income.sep.landShort, 320000);
  eq('繰越控除の使用額の合計', r3.incomeTax.income.carryLossUsed, 2000000);
}
section('8b. 所得控除の充当順序（総所得→短期→長期→株式→配当→先物→山林→退職）');
{
  const r = Calc.calcIncomeTax(base({
    income: { salary: 700000, landShort: 500000, landLong: 500000, stockTransfer: 500000 }
  }));
  /* 給与所得5万＋分離150万＝合計所得155万 → 基礎控除88万。
   * 5万を総所得から、残り83万を短期50万→長期33万の順に充てる */
  eq('総所得金額（充当後）', r.allocation.sougou, 0);
  eq('短期譲渡（充当後）', r.allocation.sep.landShort, 0);
  eq('長期譲渡（充当後）', r.allocation.sep.landLong, 170000);
  eq('株式等譲渡（手つかず）', r.allocation.sep.stockTransfer, 500000);
  eq('引ききれなかった控除額', r.allocation.unused, 0);
}

/* ==========================================================================
 * 9. 住民税
 * ======================================================================== */
section('9. 非課税限度額（級地別・人数別）');
{
  const lim = function (kyuchi, fam) {
    const r = Calc.calcResidentTax(base({
      region: { pref: '東京都', city: 'X', seirei: false, cityKin: 3000, prefKin: 1000,
        cityRate: 6, prefRate: 4, kyuchi: kyuchi },
      family: fam || {}
    }));
    return r;
  };
  eq('1級地・単身：均等割', lim(1).kintouLimit, 450000);
  eq('1級地・単身：所得割', lim(1).shotokuLimit, 450000);
  eq('2級地・単身：均等割', lim(2).kintouLimit, 415000);
  eq('3級地・単身：均等割', lim(3).kintouLimit, 380000);
  eq('1級地・扶養1人：均等割（35万×2＋10万＋21万）', lim(1, { dep16_18: 1 }).kintouLimit, 1010000);
  eq('1級地・扶養1人：所得割（35万×2＋10万＋32万）', lim(1, { dep16_18: 1 }).shotokuLimit, 1120000);
  eq('16歳未満も人数に数える', lim(1, { depUnder16: 1 }).kintouLimit, 1010000);
  eq('2級地・扶養1人：均等割（31.5万×2＋10万＋18.9万）', lim(2, { dep16_18: 1 }).kintouLimit, 919000);
  eq('3級地・扶養1人：均等割（28万×2＋10万＋16.8万）', lim(3, { dep16_18: 1 }).kintouLimit, 828000);
  eq('扶養がいない場合は加算しない', lim(1).hasDependents, false);
}
section('9b. 均等割だけ課税される領域');
{
  /* 1級地・扶養1人。合計所得が均等割限度101万円超・所得割限度112万円以下 */
  const r = Calc.calcResidentTax(base({
    income: { otherIncome: 1100000 }, family: { dep16_18: 1 }
  }));
  eq('均等割は課税', r.kintouExempt, false);
  eq('所得割は非課税', r.shotokuExempt, true);
  eq('所得割額', r.shotokuTotal, 0);
  eq('均等割額（市町村3,000＋道府県1,000＋森林環境税1,000）', r.kintouTotal, 5000);
  eq('住民税の年税額', r.total, 5000);
}
section('9c. 調整控除（地方税法37条）');
{
  /* 合計課税所得金額200万円以下：人的控除の差の合計と課税所得の小さいほうの5％ */
  const r = Calc.calcResidentTax(base({ income: { salary: 2000000 } }));
  /* 給与200万→所得132万。住民税の基礎控除43万→課税89万。人的控除差は基礎控除5万のみ */
  eq('課税総所得金額', r.taxableSougou, 890000);
  eq('人的控除の差の合計', r.jinteki.total, 50000);
  eq('調整控除の基礎額', r.adjBase, 50000);
  eq('市町村民税の調整控除（3％）', r.cityAdj, 1500);
  eq('道府県民税の調整控除（2％）', r.prefAdj, 1000);
  /* 合計課税所得金額200万円超：差の合計−(課税所得−200万)。ただし5万円が下限 */
  const r2 = Calc.calcResidentTax(base({ income: { salary: 5000000 }, family: { dep19_22: 1 } }));
  eq('課税総所得金額が200万円超', r2.taxableSougou > 2000000, true);
  eq('人的控除の差（基礎5万＋特定扶養18万）', r2.jinteki.total, 230000);
  eq('調整控除の基礎額（下限5万円が効く）', r2.adjBase, 50000);
  /* 合計所得2,500万円超は調整控除なし */
  const r3 = Calc.calcResidentTax(base({ income: { otherIncome: 26000000 } }));
  eq('合計所得2,500万円超は調整控除なし', r3.adjBase, 0);
}
section('9d. 政令指定都市の税率配分');
{
  const region = { pref: '神奈川県', city: '横浜市', seirei: true,
    cityKin: 3900, prefKin: 1300, cityRate: 8, prefRate: 2.025, kyuchi: 1 };
  const r = Calc.calcResidentTax(base({ region: region, income: { salary: 2000000 } }));
  eq('市民税の所得割は8％', r.cityStd, Math.floor(890000 * 0.08));
  eq('道府県民税の所得割は2.025％（水源環境保全税0.025％を含む）',
    r.prefStd, Math.floor(890000 * 0.02025));
  eq('市民税の調整控除は4％', r.cityAdj, 2000);
  eq('道府県民税の調整控除は1％', r.prefAdj, 500);
}
section('9e. 所得割額の調整措置');
{
  /* 所得割を課すと手取りが非課税限度額（単身45万円）を下回る領域では、
   * その差額を所得割額から減額する（地方税法附則3条の3）。
   * 合計所得451,000円 → 所得割1,050円。451,000−1,050＝449,950 < 450,000 なので
   * 差額50円を減額する。 */
  const r = Calc.calcResidentTax(base({ income: { otherIncome: 451000 } }));
  eq('所得割は非課税ではない', r.shotokuExempt, false);
  eq('減額前の所得割額', r.cityRaw - r.cityAdj + r.prefRaw - r.prefAdj, 1050);
  eq('調整措置の減額分', r.chosei, 50);
  eq('調整後の所得割額（100円未満切捨て後）', r.shotokuTotal, 1000);
  eq('均等割は課税される', r.kintouTotal, 5000);
  /* 手取りが限度額を上回る領域では調整措置は働かない */
  const r2 = Calc.calcResidentTax(base({ income: { otherIncome: 460000 } }));
  eq('限度額を十分上回れば減額なし', r2.chosei, 0);
}
section('9f. 均等割の非課税（障害者・未成年者・寡婦・ひとり親）');
{
  const r = Calc.calcResidentTax(base({ income: { salary: 2040000 }, flags: { minor: true } }));
  eq('未成年者・合計所得135万円以下は均等割も非課税', r.kintouExempt, true);
  eq('所得割も非課税', r.shotokuExempt, true);
  const r2 = Calc.calcResidentTax(base({ income: { salary: 2050000 }, flags: { minor: true } }));
  eq('合計所得135万円超は課税', r2.specialExempt, false);
  const r3 = Calc.calcResidentTax(base({ income: { salary: 5000000 }, flags: { welfare: true } }));
  eq('生活扶助を受けていれば非課税', r3.kintouExempt, true);
}
section('9g. 退職所得は翌年度の住民税に含めない');
{
  const inp = base({ income: { retirementRevenue: 20000000, retirementYears: 10 } });
  const i = Calc.calcIncomeTax(inp), r = Calc.calcResidentTax(inp);
  eq('所得税には退職所得が入る', i.income.retirementIncome, 8000000);
  eq('住民税には入らない', r.income.retirementIncome, 0);
  eq('住民税の合計所得金額にも入らない', r.income.gokei, 0);
  eq('住民税は非課税', r.total, 0);
}

/* ==========================================================================
 * 10. JASSO 支給額算定基準額
 * ======================================================================== */
section('10. JASSO 支給額算定基準額と区分');
{
  const r = Calc.calcResidentTax(base({ income: { salary: 4000000 } }));
  const j = Calc.calcJasso(r, base().region);
  /* 給与400万→所得276万。住民税の課税標準276万−43万＝233万 */
  eq('課税標準額', j.taxable, 2330000);
  eq('支給額算定基準額 ＝ 課税標準×6％ −（調整控除＋調整額）',
    j.kijun, Math.floor((2330000 * 0.06 - r.cityAdj - r.cityChosei) / 100) * 100);
  eq('区分の判定', Calc.judgeKubun(j.kijun).name, '対象外（収入基準超過）');
  /* 所得割非課税なら必ず第Ⅰ区分 */
  const r2 = Calc.calcResidentTax(base({ income: { salary: 1000000 } }));
  const j2 = Calc.calcJasso(r2, base().region);
  eq('所得割非課税 → 基準額0円', j2.kijun, 0);
  eq('所得割非課税 → 第Ⅰ区分', Calc.judgeKubun(j2.kijun).name, '第Ⅰ区分');
  eq('区分の境目 99円', Calc.judgeKubun(99).name, '第Ⅰ区分');
  eq('区分の境目 100円', Calc.judgeKubun(100).name, '第Ⅱ区分');
  eq('区分の境目 25,599円', Calc.judgeKubun(25599).name, '第Ⅱ区分');
  eq('区分の境目 25,600円', Calc.judgeKubun(25600).name, '第Ⅲ区分');
  eq('区分の境目 51,299円', Calc.judgeKubun(51299).name, '第Ⅲ区分');
  eq('第Ⅳ区分は多子世帯・私立理工農系のみ', Calc.judgeKubun(51300).name, '対象外（収入基準超過）');
  eq('多子世帯なら第Ⅳ区分', Calc.judgeKubun(51300, { tashi: true }).name, '第Ⅳ区分');
  eq('154,500円以上は支援区分の対象外', Calc.judgeKubun(154500).name, '対象外（収入基準超過）');
  /* 多子世帯は令和7年度から「所得制限なく授業料等減免」を受けられる。
   * 基準額が154,500円以上でも、給付奨学金が0円になるだけで減免は対象。 */
  eq('多子世帯は154,500円以上でも授業料等減免の対象',
    Calc.judgeKubun(154500, { tashi: true }).genmenOnly, true);
  eq('多子世帯・154,500円以上の表示',
    Calc.judgeKubun(154500, { tashi: true }).name, '授業料等減免のみ対象（給付奨学金は0円）');
  eq('多子世帯でない場合は減免も対象外', Calc.judgeKubun(154500, { rikonou: true }).genmenOnly, false);
  eq('区分内なら genmenOnly は立たない', Calc.judgeKubun(50000).genmenOnly, false);
  /* 政令指定都市は調整控除に3/4を乗じる */
  const region = { pref: '神奈川県', city: '横浜市', seirei: true,
    cityKin: 3900, prefKin: 1300, cityRate: 8, prefRate: 2.025, kyuchi: 1 };
  const r3 = Calc.calcResidentTax(base({ region: region, income: { salary: 4000000 } }));
  const j3 = Calc.calcJasso(r3, region);
  eq('政令市の係数', j3.factor, 0.75);
  eq('政令市でも課税標準×6％で計算する',
    j3.kijun, Math.floor((2330000 * 0.06 - (r3.cityAdj + r3.cityChosei) * 0.75) / 100) * 100);
}

/* ==========================================================================
 * 11. 国民健康保険料の軽減判定
 * ======================================================================== */
section('11. 国保の軽減判定（令和8年度）');
{
  const K = D.KOKUHO;
  const run = function (o, kok) {
    const inp = base(Object.assign({ kokuho: Object.assign({ insured: 1, tokutei: 0,
      salaryEarners: 1, otherMembersIncome: 0 }, kok || {}) }, o));
    return Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
  };
  eq('7割軽減の基準額（43万円）', run({}).t7, 430000);
  eq('5割軽減の基準額（43万＋31万×1人）', run({}).t5, 740000);
  eq('2割軽減の基準額（43万＋57万×1人）', run({}).t2, 1000000);
  eq('被保険者4人の5割基準（43万＋31万×4）', run({}, { insured: 4 }).t5, 1670000);
  eq('特定同一世帯所属者も人数に数える', run({}, { insured: 2, tokutei: 1 }).t5, 1360000);
  eq('給与所得者等が2人なら10万円加算', run({}, { salaryEarners: 2 }).t7, 530000);
  eq('給与所得者等が3人なら20万円加算', run({}, { salaryEarners: 3 }).t7, 630000);
  eq('給与所得者等1人では加算なし', run({}, { salaryEarners: 1 }).addend, 0);
  eq('所得0円 → 7割軽減', run({}).level, 7);
  eq('判定所得43万円ちょうど → 7割軽減', run({ income: { otherIncome: 430000 } }).level, 7);
  eq('判定所得430,001円 → 5割軽減', run({ income: { otherIncome: 430001 } }).level, 5);
  eq('判定所得74万円ちょうど → 5割軽減', run({ income: { otherIncome: 740000 } }).level, 5);
  eq('判定所得740,001円 → 2割軽減', run({ income: { otherIncome: 740001 } }).level, 2);
  eq('判定所得100万円ちょうど → 2割軽減', run({ income: { otherIncome: 1000000 } }).level, 2);
  eq('判定所得1,000,001円 → 軽減なし', run({ income: { otherIncome: 1000001 } }).level, 0);
  eq('賦課限度額の合計（令和8年度）', K.limits.total, 1130000);
  eq('子ども・子育て支援納付金分', K.limits.child, 30000);
}
section('11b. 軽減判定所得のつくり方（住民税の所得との違い）');
{
  const run = function (o, kok) {
    const inp = base(Object.assign({ kokuho: Object.assign({ insured: 1, tokutei: 0,
      salaryEarners: 1, otherMembersIncome: 0 }, kok || {}) }, o));
    return Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
  };
  eq('所得控除は引かない（社会保険料控除があっても判定所得は変わらない）',
    run({ income: { otherIncome: 1000000 }, ded: { social: 500000 } }).judgeIncome, 1000000);
  eq('退職所得は含めない',
    run({ income: { retirementRevenue: 20000000, retirementYears: 10 } }).judgeIncome, 0);
  eq('65歳以上は公的年金等所得からさらに15万円',
    run({ income: { pension: 2000000, pensionAge65: true } }).judgeIncome, 750000);
  /* 65歳・年金120万 → 控除110万で年金所得10万。15万円は所得の額までしか引けない */
  eq('年金所得が15万円未満ならその額までしか引かない',
    run({ income: { pension: 1200000, pensionAge65: true } }).judgeIncome, 0);
  eq('65歳未満は15万円控除なし',
    run({ income: { pension: 2000000, pensionAge65: false } }).judgeIncome, 1225000);
  eq('分離譲渡は特別控除「前」で見る（特別控除額を戻す）',
    run({ income: { landLong: 1000000 } }, { landSpecialDeduction: 3000000 }).judgeIncome, 4000000);
  eq('事業専従者控除は事業主の所得に戻す',
    run({ income: { business: 1000000 } }, { senjusha: 860000 }).judgeIncome, 1860000);
  eq('繰越控除は適用「後」で見る',
    run({ income: { stockTransfer: 3000000 }, carryover: { stockLoss: 1000000 } }).judgeIncome, 2000000);
  eq('本人が世帯主でも被保険者でもなければ本人の所得は含めない',
    run({ income: { otherIncome: 5000000 } }, { includeSelf: false }).judgeIncome, 0);
  eq('擬制世帯主の所得は他の世帯員分として加算できる',
    run({ income: { otherIncome: 0 } }, { otherMembersIncome: 3000000 }).judgeIncome, 3000000);
}

/* ==========================================================================
 * 13. 一時所得（所得税法34条）
 * ======================================================================== */
section('13. 一時所得：特別控除50万円のあと2分の1を算入');
{
  const t = (rev, exp) => Calc.calcIncomeTax(base({
    income: { temporaryRevenue: rev, temporaryExpense: exp || 0 } })).income;
  eq('収入40万・経費0（特別控除内）', t(400000).temporaryIncluded, 0);
  eq('収入50万・経費0（ちょうど特別控除）', t(500000).temporaryIncluded, 0);
  eq('収入100万・経費0 → (100万−50万)÷2', t(1000000).temporaryIncluded, 250000);
  eq('収入200万・経費50万 → (200万−50万−50万)÷2', t(2000000, 500000).temporaryIncluded, 500000);
  eq('控除前の一時所得も持っている', t(2000000, 500000).temporaryRaw, 1000000);
  eq('経費が収入を上回っても0円', t(300000, 500000).temporaryIncluded, 0);
  eq('端数は切捨て（101万円）', t(1010000).temporaryIncluded, 255000);
  eq('合計所得金額に2分の1後で入る', t(1000000).gokei, 250000);
}

/* ==========================================================================
 * 14. 総合課税の譲渡所得（所得税法33条）
 * ======================================================================== */
section('14. 総合譲渡：特別控除50万円は短期から先に、長期は2分の1');
{
  const g = (sr, se, lr, le) => Calc.calcIncomeTax(base({
    income: { transferShortRevenue: sr || 0, transferShortExpense: se || 0,
      transferLongRevenue: lr || 0, transferLongExpense: le || 0 } })).income;
  eq('短期100万のみ → 50万（特別控除50万）', g(1000000).transferIncluded, 500000);
  eq('長期100万のみ → (100万−50万)÷2', g(0, 0, 1000000).transferIncluded, 250000);
  eq('短期100万＋長期200万：特別控除は短期から', g(1000000, 0, 2000000).transferShort, 500000);
  eq('　このとき長期は控除を使えない', g(1000000, 0, 2000000).transferLong, 2000000);
  eq('　算入額 ＝ 短期50万 ＋ 長期200万÷2', g(1000000, 0, 2000000).transferIncluded, 1500000);
  eq('短期30万＋長期100万：残り20万を長期から', g(300000, 0, 1000000).transferLong, 800000);
  eq('　算入額 ＝ 0 ＋ 80万÷2', g(300000, 0, 1000000).transferIncluded, 400000);
  eq('経費が収入を上回っても0円', g(300000, 500000).transferIncluded, 0);
}

/* ==========================================================================
 * 15. 利子所得・配当所得（総合課税）と配当控除
 * ======================================================================== */
section('15. 利子所得・配当所得（総合課税）と配当控除');
{
  eq('利子所得はそのまま総所得に入る',
    Calc.calcIncomeTax(base({ income: { interest: 300000 } })).income.gokei, 300000);
  eq('配当所得 ＝ 収入 − 負債利子',
    Calc.calcIncomeTax(base({ income: { dividendGeneral: 1000000, dividendDebt: 200000 } }))
      .income.dividendGeneral, 800000);
  eq('負債利子が収入を上回っても0円',
    Calc.calcIncomeTax(base({ income: { dividendGeneral: 100000, dividendDebt: 300000 } }))
      .income.dividendGeneral, 0);

  /* 配当控除：課税総所得金額等が1,000万円以下なら所得税10％・住民税2.8％ */
  const d1 = base({ income: { salary: 5000000, dividendGeneral: 1000000 } });
  const i1 = Calc.calcIncomeTax(d1), r1 = Calc.calcResidentTax(d1);
  eq('課税総所得金額等が1,000万円以下', i1.taxableAll <= 10000000, true);
  eq('配当控除（所得税10％）', i1.dividendCredit, 100000);
  eq('配当控除（住民税2.8％）', r1.dividendCredit, 28000);
  eq('　うち市町村民税分（1.6％）', r1.dividendCity, 16000);
  eq('　うち道府県民税分（1.2％）', r1.dividendPref, 12000);

  /* 1,000万円を超える部分に対応する配当は所得税5％・住民税1.4％ */
  const d2 = base({ income: { salary: 20000000, dividendGeneral: 1000000 } });
  const i2 = Calc.calcIncomeTax(d2);
  eq('課税総所得金額等が1,000万円超', i2.taxableAll > 10000000, true);
  eq('配当がすべて1,000万円超の部分なら5％', i2.dividendCredit, 50000);

  /* ちょうどまたぐケース：1,000万円を超える部分だけ5％、残りは10％ */
  const d3 = base({ income: { otherIncome: 10000000, dividendGeneral: 1000000 } });
  const i3 = Calc.calcIncomeTax(d3);
  const over = Math.max(0, i3.taxableAll - 10000000);
  const atOver = Math.min(1000000, over);
  eq('またぐ場合は按分して計算', i3.dividendCredit,
    Math.floor((1000000 - atOver) * 0.10 + atOver * 0.05));
  eq('配当がなければ配当控除は0円',
    Calc.calcIncomeTax(base({ income: { salary: 5000000 } })).dividendCredit, 0);
}

/* ==========================================================================
 * 16. 寄附金控除（所得税の所得控除・住民税の税額控除）
 * ======================================================================== */
section('16. 寄附金控除とふるさと納税');
{
  const mk = (f, o, sal) => base({ income: { salary: sal || 5000000 },
    ded: { social: Math.floor((sal || 5000000) * 0.15), donationFurusato: f || 0, donationOther: o || 0 } });

  /* 所得税は所得控除。（寄附金と総所得金額等の40％の小さいほう）− 2,000円 */
  eq('寄附1万円 → 所得税の控除は8,000円',
    dedOf(mk(10000), '寄附金控除'), 8000);
  eq('寄附2,000円ちょうど → 0円', dedOf(mk(2000), '寄附金控除'), 0);
  eq('寄附1,000円（2,000円未満）→ 0円', dedOf(mk(1000), '寄附金控除'), 0);
  eq('ふるさと納税とその他は合算する', dedOf(mk(10000, 20000), '寄附金控除'), 28000);
  /* 総所得金額等の40％が上限（給与500万 → 所得356万 → 上限142.4万） */
  eq('40％の上限が効く', dedOf(mk(5000000), '寄附金控除'), Math.floor(3560000 * 0.4) - 2000);
  eq('住民税は所得控除ではない（税額控除）', dedOf(mk(10000), '寄附金控除', 'resident'), 0);

  /* 住民税は税額控除。基本控除10％＋ふるさと納税の特例控除 */
  const r = Calc.calcResidentTax(mk(10000));
  eq('基本控除（1万−2,000）×10％', r.donationBasic, 800);
  eq('特例控除がある', r.donationSpecial > 0, true);
  eq('特例控除の上限は所得割額の20％', r.donationSpecial <= r.donationSpecialCap, true);
  const r0 = Calc.calcResidentTax(mk(0));
  eq('寄附なしなら基本控除0円', r0.donationBasic, 0);
  eq('寄附なしなら特例控除0円', r0.donationSpecial, 0);
  eq('その他の寄附は特例控除の対象外',
    Calc.calcResidentTax(mk(0, 30000)).donationSpecial, 0);
  eq('　基本控除は対象になる',
    Calc.calcResidentTax(mk(0, 30000)).donationBasic, Math.floor((30000 - 2000) * 0.1));

  /* 上限内なら自己負担は2,000円に収まる（給与500万・単身の目安は約61,000円） */
  const noDonation = mk(0);
  const baseIt = Calc.calcIncomeTax(noDonation).total, baseRt = Calc.calcResidentTax(noDonation).total;
  [10000, 30000, 60000].forEach(f => {
    const it = Calc.calcIncomeTax(mk(f)).total, rt = Calc.calcResidentTax(mk(f)).total;
    const saved = (baseIt - it) + (baseRt - rt);
    eq(`ふるさと納税${f.toLocaleString()}円の自己負担が2,000円前後`,
      Math.abs(f - saved - 2000) <= 200, true, `自己負担 ${(f - saved).toLocaleString()}円`);
  });
  /* 上限を大きく超えると自己負担が増える */
  const big = 300000;
  const itB = Calc.calcIncomeTax(mk(big)).total, rtB = Calc.calcResidentTax(mk(big)).total;
  eq('上限を大きく超えると自己負担が2,000円で済まない',
    big - ((baseIt - itB) + (baseRt - rtB)) > 2000, true);
}

/* ==========================================================================
 * 12. 全体の整合（不変条件）
 * ======================================================================== */
section('12. 不変条件');
{
  const r = Calc.calcAll(base({ income: { salary: 6000000, stockTransfer: 1000000 },
    ded: { social: 800000 }, family: { hasSpouse: true, spouseIncome: 0, dep19_22: 1 } }));
  eq('合計所得金額 ≧ 総所得金額等',
    r.incomeTax.income.gokei >= r.incomeTax.income.souShotokuTou, true);
  eq('課税標準額の合計 ＝ 総合＋山林＋分離',
    r.resident.taxable,
    r.resident.taxableSougou + r.resident.taxableForest + r.resident.taxableSep);
  eq('住民税の合計 ＝ 所得割＋均等割',
    r.resident.total, r.resident.shotokuTotal + r.resident.kintouTotal);
  eq('所得割は100円未満切捨て', r.resident.cityShotoku % 100, 0);
  eq('道府県民税も100円未満切捨て', r.resident.prefShotoku % 100, 0);
  eq('所得税の年税額は100円未満切捨て', r.incomeTax.total % 100, 0);
  eq('課税総所得金額は1,000円未満切捨て', r.incomeTax.taxable % 1000, 0);
  eq('所得税額の内訳の合計 ＝ 税額控除前の税額',
    r.incomeTax.parts.reduce(function (s, x) { return s + x.tax; }, 0), r.incomeTax.beforeCredit);
  eq('所得控除の合計 ＝ 明細の合計',
    r.incomeTax.deduction.total,
    r.incomeTax.deduction.list.reduce(function (s, x) { return s + x.amount; }, 0));
  eq('すべての金額が整数', [r.incomeTax.total, r.resident.total, r.jasso.kijun,
    r.kokuho.judgeIncome].every(Number.isInteger), true);
}

/* -------------------------------------------------------------------- */
console.log('\n' + '='.repeat(64));
console.log(`検証 ${pass + fail} 件：成功 ${pass} / 失敗 ${fail}` + (skipped ? `（${skipped} 件は絞り込みで除外）` : ''));
if (fails.length) {
  console.log('\n■ 失敗した項目');
  fails.forEach(function (f) { console.log('  - ' + f); });
}
process.exit(fail ? 1 : 0);
