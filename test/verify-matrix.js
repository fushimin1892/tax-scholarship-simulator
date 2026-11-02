/* ============================================================================
 * verify-matrix.js — 収入・控除・家族構成・年齢を総当たりで検証する
 *
 *   node test/verify-matrix.js          … 全件
 *   node test/verify-matrix.js 年齢      … 見出しに「年齢」を含む節だけ
 *
 * ねらい
 *   verify-calc.js は「1つの計算が法令どおりか」を見る。
 *   こちらは「あらゆる組み合わせで、区分・非課税・軽減の判定が正しいか」を見る。
 *
 * 判定の正解は calc.js を呼ばずに、この файл内で**法令から独立に**書き起こした
 * オラクル（oracle＝独立実装）で作る。実装と突き合わせて食い違いを探す。
 * 実装から期待値を逆算すると検証にならないため、この分離が要。
 * ==========================================================================*/
const Calc = require('../assets/calc.js');
const D = require('../assets/data.js');

const only = process.argv[2];
let pass = 0, fail = 0, current = '', shown = false, sectionCount = 0;
const fails = [];
const cover = {};   // 何をどれだけ試したかの記録

function section(t) { current = t; shown = false; sectionCount = 0; }
function head() { if (!shown) { console.log('\n=== ' + current + ' ==='); shown = true; } }
function active() { return !only || current.indexOf(only) >= 0; }
function ok(label, cond, detail) {
  if (!active()) return;
  sectionCount++;
  cover[current] = (cover[current] || 0) + 1;
  if (cond) { pass++; return; }
  fail++;
  if (fails.length < 40) fails.push(`${current} / ${label}${detail ? '：' + detail : ''}`);
  head();
  console.log(`  NG   ${label}${detail ? ' … ' + detail : ''}`);
}
function done(note) {
  if (!active()) return;
  head();
  console.log(`  OK   ${sectionCount.toLocaleString()} 件すべて一致${note ? '（' + note + '）' : ''}`);
}

/* ---------------- 入力のひな形 ---------------- */
function base(over) {
  const b = {
    incomeYear: 2025, residentYear: 2026,
    region: { pref: '東京都', city: 'X', seirei: false,
      cityKin: 3000, prefKin: 1000, cityRate: 6, prefRate: 4, kyuchi: 1 },
    income: { salary: 0, pension: 0, pensionAge65: false, business: 0, realEstate: 0, otherIncome: 0,
      landShort: 0, landLong: 0, stockTransfer: 0, stockDividend: 0, futures: 0,
      forestRevenue: 0, forestExpense: 0,
      retirementRevenue: 0, retirementYears: 0, retirementOfficer: false,
      retirementShort: false, retirementDisability: false },
    carryover: { stockLoss: 0, netLoss: 0, casualtyLoss: 0 },
    ded: { social: 0, kyosai: 0, lifeNewGeneral: 0, lifeOldGeneral: 0, lifeNewCare: 0,
      lifeNewPension: 0, lifeOldPension: 0, quake: 0, longOld: 0,
      medical: 0, medicalComp: 0, zasson: 0, otherDeduction: 0 },
    family: { hasSpouse: false, spouseIncome: 0, spouseOld: false,
      dep16_18: 0, dep19_22: 0, dep23_69: 0, depOldOther: 0, depOldLiving: 0, depUnder16: 0,
      tokuteiEnabled: false, tokuteiIncome: 0, tokuteiList: [],
      disNormal: 0, disSpecial: 0, disLive: 0, selfDisability: 'none',
      widow: false, singleParent: 'none', student: false,
      under23Dependent: false, specialDisabilityFamily: false },
    flags: { minor: false, welfare: false },
    taxCredit: 0, residentCredit: 0,
    kokuho: { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 }
  };
  const o = over || {};
  Object.keys(o).forEach(k => {
    b[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? Object.assign(b[k], o[k]) : o[k];
  });
  return b;
}

/* ============================================================================
 * オラクル（法令から独立に書いた正解）
 * ==========================================================================*/

/* 扶養親族の区分：年齢と合計所得金額から決まる（所得税法2条・措置法） */
function oracleDependent(age, income, live, limit, tokuteiUpper) {
  if (income <= limit) {
    if (age < 16) return 'depUnder16';        // 年少扶養（控除なし・非課税限度額の人数には入る）
    if (age < 19) return 'dep16_18';
    if (age < 23) return 'dep19_22';          // 特定扶養親族
    if (age < 70) return 'dep23_69';
    return live ? 'depOldLiving' : 'depOldOther';
  }
  // 所得要件を超えても、19歳以上23歳未満で123万円以下なら特定親族特別控除
  if (age >= 19 && age < 23 && income <= tokuteiUpper) return 'tokutei';
  return 'over';
}

/* 住民税の非課税限度額（地方税法295条・地方税法施行令47条の3） */
function oracleHikazeiLimits(kyuchi, headcount) {
  const K = { 1: [350000, 210000], 2: [315000, 189000], 3: [280000, 168000] }[kyuchi];
  const many = headcount >= 2;
  return {
    kintou: K[0] * headcount + 100000 + (many ? K[1] : 0),
    shotoku: 350000 * headcount + 100000 + (many ? 320000 : 0)
  };
}

/* 国保の軽減割合（地方税法703条の5・令和8年度） */
function oracleKokuho(judgeIncome, members, salaryEarners) {
  const add = salaryEarners >= 2 ? 100000 * (salaryEarners - 1) : 0;
  if (judgeIncome <= 430000 + add) return 7;
  if (judgeIncome <= 430000 + 310000 * members + add) return 5;
  if (judgeIncome <= 430000 + 570000 * members + add) return 2;
  return 0;
}

/* JASSOの支援区分（支給額算定基準額の合計から） */
function oracleJasso(sum, tashi, riko) {
  if (sum < 100) return '第Ⅰ区分';
  if (sum < 25600) return '第Ⅱ区分';
  if (sum < 51300) return '第Ⅲ区分';
  if (sum < 154500) return (tashi || riko) ? '第Ⅳ区分' : '対象外（収入基準超過）';
  // 多子世帯は所得制限なく授業料等減免の対象（給付奨学金は0円）
  return tashi ? '減免のみ' : '対象外（収入基準超過）';
}

/* 給与所得（別表第五）。calc.js とは別に素朴に書き下ろす */
function oracleSalaryIncome(rev, minAmt, minCap) {
  rev = Math.floor(rev);
  if (rev <= 0) return 0;
  if (rev < minCap) return Math.max(0, rev - minAmt);
  const A = Math.floor(rev / 4000) * 1000;      // ÷4して千円未満切捨て＝÷4000して千円単位
  if (rev < 3600000) return A * 2.8 - 80000;
  if (rev < 6600000) return A * 3.2 - 440000;
  if (rev < 8500000) return Math.floor(rev * 0.9) - 1100000;
  return rev - 1950000;
}

/* 公的年金等の雑所得（国税庁 No.1600 速算表）。1円未満切捨て */
function oraclePensionIncome(rev, over65, other) {
  rev = Math.floor(rev);
  if (rev <= 0) return 0;
  const minAmt = over65 ? 1100000 : 600000;
  const minCap = over65 ? 3300000 : 1300000;
  const cut = other <= 10000000 ? 0 : other <= 20000000 ? 100000 : 200000;
  let ded;
  if (rev <= minCap) ded = minAmt;
  else if (rev <= 4100000) ded = rev * 0.25 + 275000;
  else if (rev <= 7700000) ded = rev * 0.15 + 685000;
  else if (rev <= 10000000) ded = rev * 0.05 + 1455000;
  else ded = 1955000;
  ded = Math.min(Math.max(0, ded - cut), rev);
  return Math.floor(Math.max(0, rev - ded));
}

/* ============================================================================
 * 1. 年齢 × 所得 × 同居 × 年分 の総当たり（扶養区分）
 * ==========================================================================*/
section('1. 年齢0〜100歳 × 所得 × 同居／別居 × 年分：扶養区分の判定');
{
  const incomes = [0, 100000, 480000, 580000, 580001, 620000, 620001, 850000, 950000,
    1000000, 1230000, 1230001, 2000000];
  [2025, 2026].forEach(year => {
    const p = D.INCOME_TAX[year];
    for (let age = 0; age <= 100; age++) {
      incomes.forEach(inc => {
        [true, false].forEach(live => {
          const want = oracleDependent(age, inc, live, p.dependentLimit, p.tokuteiUpper);
          // 実装側：扶養区分ごとに控除額が入るかで判定する
          const fam = {};
          if (want === 'tokutei') { fam.tokuteiList = [inc]; }
          else if (want !== 'over') { fam[want] = 1; }
          const r = Calc.calcIncomeTax(base({ incomeYear: year, family: fam }));
          const names = r.deduction.list.map(x => x.name).join(',');
          if (want === 'over') {
            ok(`${year} ${age}歳 所得${inc} → 扶養外`, !/扶養控除|特定親族特別控除/.test(names), names);
          } else if (want === 'depUnder16') {
            ok(`${year} ${age}歳 所得${inc} → 年少扶養（控除0）`, !/扶養控除/.test(names), names);
          } else if (want === 'tokutei') {
            ok(`${year} ${age}歳 所得${inc} → 特定親族特別控除`, /特定親族特別控除/.test(names), names);
          } else {
            const label = { dep16_18: '（16〜18歳）', dep19_22: '（特定扶養親族・19〜22歳）',
              dep23_69: '（23〜69歳）', depOldOther: '（老人・同居老親等以外）',
              depOldLiving: '（同居老親等）' }[want];
            ok(`${year} ${age}歳 所得${inc} → 扶養控除${label}`, names.indexOf('扶養控除' + label) >= 0, names);
          }
        });
      });
    }
  });
  done('年齢101通り × 所得13通り × 同居2通り × 年分2通り');
}

/* ============================================================================
 * 2. 非課税限度額：級地 × 判定人数 × 年分、境界の±1円
 * ==========================================================================*/
section('2. 級地 × 判定人数 × 年分：住民税の非課税限度額と境界');
{
  [2026, 2027].forEach(ry => {
    [1, 2, 3].forEach(kyuchi => {
      for (let dep = 0; dep <= 6; dep++) {
        const want = oracleHikazeiLimits(kyuchi, 1 + dep);
        const region = { pref: 'X', city: 'Y', seirei: false, cityKin: 3000, prefKin: 1000,
          cityRate: 6, prefRate: 4, kyuchi: kyuchi };
        const fam = { dep23_69: dep };
        const r = Calc.calcResidentTax(base({ residentYear: ry, region, family: fam }));
        ok(`${ry} ${kyuchi}級地 扶養${dep}人 均等割の限度額`, r.kintouLimit === want.kintou, `${r.kintouLimit} / 期待 ${want.kintou}`);
        ok(`${ry} ${kyuchi}級地 扶養${dep}人 所得割の限度額`, r.shotokuLimit === want.shotoku, `${r.shotokuLimit} / 期待 ${want.shotoku}`);
        ok(`${ry} ${kyuchi}級地 扶養${dep}人 判定人数`, r.headcount === 1 + dep, String(r.headcount));

        // 境界の±1円で判定がちょうど反転するか
        [['kintou', 'kintouExempt', want.kintou], ['shotoku', 'shotokuExempt', want.shotoku]].forEach(([, key, lim]) => {
          [[lim - 1, true], [lim, true], [lim + 1, false]].forEach(([v, exempt]) => {
            const rr = Calc.calcResidentTax(base({ residentYear: ry, region, family: fam,
              income: { otherIncome: v } }));
            ok(`${ry} ${kyuchi}級地 扶養${dep}人 ${key} 所得${v}`, rr[key] === exempt,
              `${rr[key]} / 期待 ${exempt}`);
          });
        });
      }
    });
  });
  done('年度2 × 級地3 × 扶養0〜6人 × 境界±1円');
}

/* ============================================================================
 * 3. 収入の種類ごとの総当たり（所得の算出と課税判定）
 * ==========================================================================*/
section('3. 収入12種類 × 金額 × 級地 × 年分：所得の算出と課税の有無');
{
  const amounts = [0, 1, 550000, 650000, 740000, 1000000, 1030000, 1230000, 1600000,
    1900000, 2200000, 2500000, 3600000, 5000000, 6600000, 8500000, 10000000, 20000000];
  const kinds = ['salary', 'pension65', 'pensionU65', 'business', 'realEstate', 'otherIncome',
    'landShort', 'landLong', 'stockTransfer', 'stockDividend', 'futures', 'forest', 'retirement'];

  [2025, 2026].forEach(year => {
    const ry = year === 2025 ? 2026 : 2027;
    const p = D.INCOME_TAX[year];
    kinds.forEach(kind => {
      amounts.forEach(amt => {
        const inc = {};
        let wantGokeiIncome = 0;      // 所得税の合計所得金額
        let wantGokeiResident = 0;    // 住民税の合計所得金額（退職所得を含まない）
        if (kind === 'salary') { inc.salary = amt; wantGokeiIncome = wantGokeiResident = oracleSalaryIncome(amt, p.salaryMin, p.salaryMinCap); }
        else if (kind === 'pension65') { inc.pension = amt; inc.pensionAge65 = true; wantGokeiIncome = wantGokeiResident = oraclePensionIncome(amt, true, 0); }
        else if (kind === 'pensionU65') { inc.pension = amt; wantGokeiIncome = wantGokeiResident = oraclePensionIncome(amt, false, 0); }
        else if (kind === 'forest') { inc.forestRevenue = amt; wantGokeiIncome = wantGokeiResident = Math.max(0, amt - 500000); }
        else if (kind === 'retirement') {
          inc.retirementRevenue = amt; inc.retirementYears = 10;
          wantGokeiIncome = Math.floor(Math.max(0, amt - 4000000) / 2);   // 控除40万×10年
          wantGokeiResident = 0;                                          // 住民税には入らない
        } else { inc[kind] = amt; wantGokeiIncome = wantGokeiResident = amt; }

        const it = Calc.calcIncomeTax(base({ incomeYear: year, income: inc }));
        ok(`${year} ${kind} ${amt} 所得税の合計所得金額`, it.income.gokei === wantGokeiIncome,
          `${it.income.gokei} / 期待 ${wantGokeiIncome}`);
        ok(`${year} ${kind} ${amt} 合計所得金額が整数`, Number.isInteger(it.income.gokei));

        [1, 2, 3].forEach(kyuchi => {
          const region = { pref: 'X', city: 'Y', seirei: false, cityKin: 3000, prefKin: 1000,
            cityRate: 6, prefRate: 4, kyuchi };
          const rt = Calc.calcResidentTax(base({ incomeYear: year, residentYear: ry, region, income: inc }));
          ok(`${year} ${kind} ${amt} ${kyuchi}級地 住民税の合計所得金額`,
            rt.income.gokei === wantGokeiResident, `${rt.income.gokei} / 期待 ${wantGokeiResident}`);

          const lim = oracleHikazeiLimits(kyuchi, 1);
          ok(`${year} ${kind} ${amt} ${kyuchi}級地 均等割の非課税判定`,
            rt.kintouExempt === (wantGokeiResident <= lim.kintou),
            `${rt.kintouExempt} / 所得${wantGokeiResident} 限度${lim.kintou}`);
          ok(`${year} ${kind} ${amt} ${kyuchi}級地 所得割の非課税判定`,
            rt.shotokuExempt === (wantGokeiResident <= lim.shotoku),
            `${rt.shotokuExempt} / 所得${wantGokeiResident} 限度${lim.shotoku}`);
          // 非課税なら税額は必ず0円
          if (rt.kintouExempt) ok(`${year} ${kind} ${amt} 均等割非課税なら均等割0円`, rt.kintouTotal === 0);
          if (rt.shotokuExempt) ok(`${year} ${kind} ${amt} 所得割非課税なら所得割0円`, rt.shotokuTotal === 0);
        });
      });
    });
  });
  done('年分2 × 収入13種 × 金額18段階 × 級地3');
}

/* ============================================================================
 * 4. 控除を1つずつ、金額を変えて総当たり
 * ==========================================================================*/
section('4. 所得控除を1つずつ：控除額が法令表どおりで、税額に正しく効くか');
{
  /* 控除額の正解を法令表から作る（calc.js を呼ばない） */
  const stepUp = (a, tbl) => {          // 1円未満切上げ
    for (const s of tbl.steps) if (a <= s[0]) return Math.ceil(a * s[1] + s[2]);
    return tbl.max;
  };
  const I = D.INSURANCE;
  const cases = [];
  [0, 1, 12000, 20000, 20001, 32000, 40000, 56000, 80000, 100000, 200000].forEach(v => {
    cases.push(['生命保険料控除', { lifeNewGeneral: v }, 'income', v === 0 ? 0 : stepUp(v, I.lifeNewIncome)]);
    cases.push(['生命保険料控除', { lifeNewGeneral: v }, 'resident', v === 0 ? 0 : stepUp(v, I.lifeNewResident)]);
    cases.push(['生命保険料控除', { lifeOldGeneral: v }, 'income', v === 0 ? 0 : stepUp(v, I.lifeOldIncome)]);
    cases.push(['生命保険料控除', { lifeOldGeneral: v }, 'resident', v === 0 ? 0 : stepUp(v, I.lifeOldResident)]);
  });
  [0, 1, 25000, 30000, 30001, 50000, 60000, 100000].forEach(v => {
    cases.push(['地震保険料控除', { quake: v }, 'income', Math.min(v, I.quakeIncomeMax)]);
    cases.push(['地震保険料控除', { quake: v }, 'resident',
      Math.min(Math.ceil(Math.min(v * I.quakeResidentRate, I.quakeResidentMax)), I.quakeResidentMax)]);
  });
  [0, 1, 5000, 10000, 15000, 20000, 30000].forEach(v => {
    cases.push(['地震保険料控除', { longOld: v }, 'income', v === 0 ? 0 : Math.min(stepUp(v, I.longOldIncome), I.quakeIncomeMax)]);
    cases.push(['地震保険料控除', { longOld: v }, 'resident', v === 0 ? 0 : Math.min(stepUp(v, I.longOldResident), I.quakeResidentMax)]);
  });
  [0, 100000, 500000, 1000000].forEach(v => {
    cases.push(['社会保険料控除', { social: v }, 'income', v]);
    cases.push(['社会保険料控除', { social: v }, 'resident', v]);
    cases.push(['小規模企業共済等掛金控除', { kyosai: v }, 'income', v]);
    cases.push(['雑損控除', { zasson: v }, 'income', v]);
    cases.push(['その他の所得控除', { otherDeduction: v }, 'income', v]);
  });
  cases.forEach(([name, ded, mode, want]) => {
    const inp = base({ ded });
    const r = mode === 'resident' ? Calc.calcResidentTax(inp) : Calc.calcIncomeTax(inp);
    const got = r.deduction.list.filter(x => x.name.indexOf(name) === 0)
      .reduce((s, x) => s + x.amount, 0);
    ok(`${name} ${JSON.stringify(ded)} ${mode}`, got === want, `${got} / 期待 ${want}`);
  });

  /* 人的控除：定額が法令どおりか（所得税・住民税） */
  const human = [
    ['障害者控除', { selfDisability: 'normal' }, D.DISABILITY.normal],
    ['障害者控除', { selfDisability: 'special' }, D.DISABILITY.special],
    ['障害者控除', { disNormal: 1 }, D.DISABILITY.normal],
    ['障害者控除', { disSpecial: 1 }, D.DISABILITY.special],
    ['障害者控除', { disLive: 1 }, D.DISABILITY.liveTogether],
    ['寡婦控除', { widow: true }, D.WIDOW],
    ['ひとり親控除', { singleParent: 'mother' }, D.SINGLE_PARENT],
    ['ひとり親控除', { singleParent: 'father' }, D.SINGLE_PARENT],
    ['勤労学生控除', { student: true }, [270000, 260000]],
    ['扶養控除', { dep16_18: 1 }, D.DEPENDENT_DEDUCTION.general],
    ['扶養控除', { dep19_22: 1 }, D.DEPENDENT_DEDUCTION.specific],
    ['扶養控除', { dep23_69: 1 }, D.DEPENDENT_DEDUCTION.general],
    ['扶養控除', { depOldOther: 1 }, D.DEPENDENT_DEDUCTION.oldOther],
    ['扶養控除', { depOldLiving: 1 }, D.DEPENDENT_DEDUCTION.oldLiving]
  ];
  human.forEach(([name, fam, want]) => {
    ['income', 'resident'].forEach((mode, i) => {
      const inp = base({ family: fam });
      const r = mode === 'resident' ? Calc.calcResidentTax(inp) : Calc.calcIncomeTax(inp);
      const got = r.deduction.list.filter(x => x.name.indexOf(name) === 0)
        .reduce((s, x) => s + x.amount, 0);
      ok(`${name} ${JSON.stringify(fam)} ${mode}`, got === want[i], `${got} / 期待 ${want[i]}`);
    });
  });

  /* 控除は税額を減らしこそすれ増やさない（全控除 × 金額段階） */
  const dedKeys = ['social', 'kyosai', 'medical', 'zasson', 'otherDeduction',
    'lifeNewGeneral', 'lifeOldGeneral', 'lifeNewCare', 'lifeNewPension', 'lifeOldPension', 'quake', 'longOld'];
  dedKeys.forEach(k => {
    let prevIt = Infinity, prevRt = Infinity;
    [0, 10000, 50000, 100000, 300000, 1000000].forEach(v => {
      const d = {}; d[k] = v;
      const inp = base({ income: { salary: 6000000 }, ded: d });
      const it = Calc.calcIncomeTax(inp).total, rt = Calc.calcResidentTax(inp).shotokuTotal;
      ok(`控除${k}=${v} 所得税が増えない`, it <= prevIt, `${it} > ${prevIt}`);
      ok(`控除${k}=${v} 住民税所得割が増えない`, rt <= prevRt, `${rt} > ${prevRt}`);
      prevIt = it; prevRt = rt;
      // 所得控除では均等割は絶対に変わらない（制度の核心）
      ok(`控除${k}=${v} 均等割は変わらない`, Calc.calcResidentTax(inp).kintouTotal === 5000);
    });
  });
  done('保険料控除の全段階 × 人的控除14種 × 所得税/住民税 ＋ 控除12種の単調性');
}

/* ============================================================================
 * 5. 家族構成の総当たり（通しの計算と不変条件）
 * ==========================================================================*/
section('5. 家族構成 × 収入 × 級地 × 年分：通し計算の整合');
{
  const families = [
    ['単身', {}],
    ['夫婦（配偶者無収入）', { hasSpouse: true, spouseIncome: 0 }],
    ['夫婦（配偶者パート）', { hasSpouse: true, spouseIncome: 600000 }],
    ['夫婦（配偶者所得133万）', { hasSpouse: true, spouseIncome: 1330000 }],
    ['夫婦（老人控除対象配偶者）', { hasSpouse: true, spouseIncome: 0, spouseOld: true }],
    ['夫婦＋子1（16歳未満）', { hasSpouse: true, depUnder16: 1 }],
    ['夫婦＋子1（高校生）', { hasSpouse: true, dep16_18: 1 }],
    ['夫婦＋子1（大学生）', { hasSpouse: true, dep19_22: 1 }],
    ['夫婦＋子2（大学生＋高校生）', { hasSpouse: true, dep19_22: 1, dep16_18: 1 }],
    ['夫婦＋子3（多子世帯）', { hasSpouse: true, dep19_22: 1, dep16_18: 1, depUnder16: 1 }],
    ['ひとり親＋子1', { singleParent: 'mother', dep16_18: 1 }],
    ['ひとり親（父）＋子1', { singleParent: 'father', dep16_18: 1 }],
    ['寡婦', { widow: true }],
    ['＋同居老親', { hasSpouse: true, depOldLiving: 1 }],
    ['＋別居老親', { hasSpouse: true, depOldOther: 1 }],
    ['＋障害者（同居特別）', { hasSpouse: true, disLive: 1 }],
    ['本人が特別障害者', { selfDisability: 'special' }],
    ['特定親族特別控除', { tokuteiList: [800000] }],
    ['特定親族2人', { tokuteiList: [800000, 1000000] }]
  ];
  const incomes = [0, 1000000, 2000000, 3500000, 5000000, 8000000, 15000000, 30000000];

  [2025, 2026].forEach(year => {
    const ry = year === 2025 ? 2026 : 2027;
    families.forEach(([fname, fam]) => {
      incomes.forEach(sal => {
        [1, 3].forEach(kyuchi => {
          [false, true].forEach(seirei => {
            const region = { pref: 'X', city: 'Y', seirei,
              cityKin: 3000, prefKin: 1000, cityRate: seirei ? 8 : 6, prefRate: seirei ? 2 : 4, kyuchi };
            const inp = base({ incomeYear: year, residentYear: ry, region,
              income: { salary: sal }, ded: { social: Math.floor(sal * 0.15) }, family: fam });
            const r = Calc.calcAll(inp);
            const tag = `${year} ${fname} 給与${sal} ${kyuchi}級地${seirei ? '政令市' : ''}`;

            // 金額が壊れていないこと
            ok(`${tag} 所得税が有限で0以上`, Number.isFinite(r.incomeTax.total) && r.incomeTax.total >= 0, String(r.incomeTax.total));
            ok(`${tag} 住民税が有限で0以上`, Number.isFinite(r.resident.total) && r.resident.total >= 0, String(r.resident.total));
            ok(`${tag} 所得税は100円未満切捨て`, r.incomeTax.total % 100 === 0);
            ok(`${tag} 市町村民税所得割は100円未満切捨て`, r.resident.cityShotoku % 100 === 0);
            ok(`${tag} 道府県民税所得割は100円未満切捨て`, r.resident.prefShotoku % 100 === 0);
            ok(`${tag} 住民税＝所得割＋均等割`, r.resident.total === r.resident.shotokuTotal + r.resident.kintouTotal);
            ok(`${tag} 課税標準＝総合＋山林＋分離`,
              r.resident.taxable === r.resident.taxableSougou + r.resident.taxableForest + r.resident.taxableSep);

            // 非課税限度額がオラクルと一致
            const want = oracleHikazeiLimits(kyuchi, r.resident.headcount);
            ok(`${tag} 均等割の限度額`, r.resident.kintouLimit === want.kintou, `${r.resident.kintouLimit}/${want.kintou}`);
            ok(`${tag} 所得割の限度額`, r.resident.shotokuLimit === want.shotoku, `${r.resident.shotokuLimit}/${want.shotoku}`);

            // 所得割が非課税ならJASSOは必ず第Ⅰ区分
            const j = Calc.calcJasso(r.resident, region);
            if (r.resident.shotokuExempt) {
              ok(`${tag} 所得割非課税→基準額0円`, j.kijun === 0, String(j.kijun));
              ok(`${tag} 所得割非課税→第Ⅰ区分`, Calc.judgeKubun(j.kijun).name === '第Ⅰ区分');
            }
            ok(`${tag} 基準額は100円単位`, j.kijun % 100 === 0, String(j.kijun));
            ok(`${tag} 基準額は0以上`, j.kijun >= 0);
          });
        });
      });
    });
  });
  done('年分2 × 家族19構成 × 給与8段階 × 級地2 × 政令市2');
}

/* ============================================================================
 * 6. 国保の軽減：被保険者数 × 給与所得者数 × 判定所得の境界
 * ==========================================================================*/
section('6. 国保：被保険者数 × 給与所得者等の数 × 判定所得の境界');
{
  for (let members = 1; members <= 10; members++) {
    for (let earners = 0; earners <= 5; earners++) {
      const add = earners >= 2 ? 100000 * (earners - 1) : 0;
      const bounds = [430000 + add, 430000 + 310000 * members + add, 430000 + 570000 * members + add];
      bounds.concat([0, 5000000]).forEach(b => {
        [-1, 0, 1].forEach(dd => {
          const v = Math.max(0, b + dd);
          const inp = base({ income: { otherIncome: v },
            kokuho: { insured: members, tokutei: 0, salaryEarners: earners, otherMembersIncome: 0 } });
          const k = Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
          const want = oracleKokuho(v, members, earners);
          ok(`被保険者${members} 給与所得者${earners} 判定所得${v}`, k.level === want,
            `${k.level}割 / 期待 ${want}割`);
          ok(`被保険者${members} 給与所得者${earners} 基準額7割`, k.t7 === 430000 + add, `${k.t7}`);
          ok(`被保険者${members} 給与所得者${earners} 基準額5割`,
            k.t5 === 430000 + 310000 * members + add, `${k.t5}`);
          ok(`被保険者${members} 給与所得者${earners} 基準額2割`,
            k.t2 === 430000 + 570000 * members + add, `${k.t2}`);
        });
      });
      // 特定同一世帯所属者も人数に数える
      const inp2 = base({ kokuho: { insured: members, tokutei: 2, salaryEarners: earners, otherMembersIncome: 0 } });
      const k2 = Calc.calcKokuho(inp2, Calc.calcResidentTax(inp2).income);
      ok(`被保険者${members}＋特定同一世帯2人 の5割基準`,
        k2.t5 === 430000 + 310000 * (members + 2) + add, `${k2.t5}`);
    }
  }
  done('被保険者1〜10人 × 給与所得者0〜5人 × 境界±1円');
}

/* ============================================================================
 * 7. JASSOの区分：基準額の全境界 × 多子世帯 × 私立理工農系
 * ==========================================================================*/
section('7. JASSO：支給額算定基準額の全境界 × 多子世帯 × 私立理工農系');
{
  const points = [];
  [0, 100, 25600, 51300, 154500].forEach(b => { points.push(b - 1, b, b + 1); });
  points.push(-1, 500000, 1000000);
  points.forEach(sum => {
    [false, true].forEach(tashi => {
      [false, true].forEach(riko => {
        const got = Calc.judgeKubun(Math.max(0, sum), { tashi, rikonou: riko });
        const want = oracleJasso(Math.max(0, sum), tashi, riko);
        const gotName = got.genmenOnly ? '減免のみ' : got.name;
        ok(`基準額${sum} 多子${tashi} 理工農${riko}`, gotName === want, `${gotName} / 期待 ${want}`);
      });
    });
  });
  // 課税標準額を細かく振って基準額と区分を確認（一般市町村・政令指定都市）
  [false, true].forEach(seirei => {
    for (let taxable = 0; taxable <= 4000000; taxable += 20000) {
      const region = { pref: 'X', city: 'Y', seirei, cityKin: 3000, prefKin: 1000,
        cityRate: seirei ? 8 : 6, prefRate: seirei ? 2 : 4, kyuchi: 1 };
      const inp = base({ region, income: { otherIncome: taxable + 430000 } });
      const rt = Calc.calcResidentTax(inp);
      const j = Calc.calcJasso(rt, region);
      const fx = seirei ? 0.75 : 1;
      const want = rt.shotokuExempt ? 0
        : Math.max(0, Math.floor((rt.taxable * 0.06 - (rt.cityAdj + rt.cityChosei) * fx) / 100) * 100);
      ok(`${seirei ? '政令市' : '一般市'} 課税標準${taxable} 基準額`, j.kijun === want, `${j.kijun} / 期待 ${want}`);
      ok(`${seirei ? '政令市' : '一般市'} 課税標準${taxable} 係数`, j.factor === fx);
    }
  });
  done('境界18点 × 多子2 × 理工農2 ＋ 課税標準0〜400万を2万円刻み × 政令市2');
}

/* ============================================================================
 * 8. 分離課税・繰越控除・退職所得の組み合わせ
 * ==========================================================================*/
section('8. 分離課税 × 繰越控除 × 退職所得の組み合わせ');
{
  const seps = ['landShort', 'landLong', 'stockTransfer', 'stockDividend', 'futures'];
  const amounts = [0, 500000, 3000000, 10000000];
  seps.forEach(k1 => {
    amounts.forEach(a1 => {
      seps.forEach(k2 => {
        if (k1 === k2) return;
        const inc = {}; inc[k1] = a1; inc[k2] = 2000000;
        [0, 1000000, 5000000].forEach(loss => {
          const inp = base({ income: inc, carryover: { stockLoss: loss } });
          const it = Calc.calcIncomeTax(inp);
          // 上場株式等の譲渡損失は株式譲渡・配当からしか引けない
          const stockPool = (inc.stockTransfer || 0) + (inc.stockDividend || 0);
          const used = Math.min(loss, stockPool);
          ok(`${k1}=${a1} ${k2}=200万 繰越${loss} 使用額`,
            it.income.carryStockUsed === used, `${it.income.carryStockUsed} / 期待 ${used}`);
          ok(`${k1}=${a1} ${k2}=200万 繰越${loss} 合計所得は繰越前`,
            it.income.gokei === a1 + 2000000, `${it.income.gokei}`);
          ok(`${k1}=${a1} ${k2}=200万 繰越${loss} 総所得金額等は繰越後`,
            it.income.souShotokuTou === a1 + 2000000 - used, `${it.income.souShotokuTou}`);
          ok(`${k1}=${a1} ${k2}=200万 繰越${loss} 合計所得 ≧ 総所得金額等`,
            it.income.gokei >= it.income.souShotokuTou);
        });
      });
    });
  });
  // 退職所得：勤続年数1〜45年 × 収入 × 特定役員／短期
  for (let years = 1; years <= 45; years++) {
    [0, 1000000, 5000000, 20000000, 50000000].forEach(rev => {
      [[false, false], [true, false], [false, true]].forEach(([officer, short]) => {
        const ded = years <= 20 ? Math.max(800000, 400000 * years) : 8000000 + 700000 * (years - 20);
        const over = Math.max(0, rev - ded);
        let want;
        if (officer && years <= 5) want = over;
        else if (short && years <= 5) want = over <= 3000000 ? over / 2 : 1500000 + (over - 3000000);
        else want = over / 2;
        want = Math.floor(want);
        const r = Calc.retirementIncome({ retirementRevenue: rev, retirementYears: years,
          retirementOfficer: officer, retirementShort: short });
        ok(`退職 ${years}年 ${rev}円 役員${officer} 短期${short}`, r.income === want, `${r.income} / 期待 ${want}`);
        // 退職金が0円のときは控除額も0円で表示する（引く相手がないため）
        ok(`退職 ${years}年 ${rev}円 控除額`, r.deduction === (rev > 0 ? ded : 0),
          `${r.deduction} / 期待 ${rev > 0 ? ded : 0}`);
        // 住民税には入らない
        const inp = base({ income: { retirementRevenue: rev, retirementYears: years,
          retirementOfficer: officer, retirementShort: short } });
        ok(`退職 ${years}年 ${rev}円 住民税に入らない`,
          Calc.calcResidentTax(inp).income.gokei === 0);
      });
    });
  }
  done('分離5種の2つ組 × 金額 × 繰越3段階 ＋ 退職 勤続1〜45年 × 収入5 × 区分3');
}

/* ============================================================================
 * 9. 課税の有無が所得の増加で逆転しないこと（単調性の総当たり）
 * ==========================================================================*/
section('9. 単調性：収入が増えて税額が下がる／非課税に戻ることがないか');
{
  const families = [{}, { hasSpouse: true, dep19_22: 1 }, { singleParent: 'mother', dep16_18: 1 }];
  [2025, 2026].forEach(year => {
    families.forEach((fam, fi) => {
      [1, 2, 3].forEach(kyuchi => {
        const region = { pref: 'X', city: 'Y', seirei: false, cityKin: 3000, prefKin: 1000,
          cityRate: 6, prefRate: 4, kyuchi };
        let prevIt = -1, prevRt = -1, wasKintouTaxed = false, wasShotokuTaxed = false;
        for (let sal = 0; sal <= 12000000; sal += 25000) {
          const inp = base({ incomeYear: year, residentYear: year === 2025 ? 2026 : 2027,
            region, income: { salary: sal }, family: fam });
          const it = Calc.calcIncomeTax(inp).total;
          const rt = Calc.calcResidentTax(inp);
          ok(`${year} 家族${fi} ${kyuchi}級地 給与${sal} 所得税が減らない`, it >= prevIt, `${it} < ${prevIt}`);
          ok(`${year} 家族${fi} ${kyuchi}級地 給与${sal} 所得割が減らない`,
            rt.shotokuTotal >= prevRt, `${rt.shotokuTotal} < ${prevRt}`);
          if (wasKintouTaxed) ok(`${year} 家族${fi} ${kyuchi}級地 給与${sal} 均等割が非課税に戻らない`, !rt.kintouExempt);
          if (wasShotokuTaxed) ok(`${year} 家族${fi} ${kyuchi}級地 給与${sal} 所得割が非課税に戻らない`, !rt.shotokuExempt);
          prevIt = it; prevRt = rt.shotokuTotal;
          if (!rt.kintouExempt) wasKintouTaxed = true;
          if (!rt.shotokuExempt) wasShotokuTaxed = true;
        }
      });
    });
  });
  done('年分2 × 家族3 × 級地3 × 給与0〜1,200万円を2.5万円刻み（481点）');
}

/* ============================================================================
 * 10. 収入12種類の「あり／なし」を全組み合わせ（2の12乗＝4,096通り）
 * ==========================================================================*/
section('10. 収入12種類の全組み合わせ（4,096通り）：所得の合算と課税標準');

/* 収入の定義。amount は固定、inc に入れる形と、期待される所得額を持つ */
const INCOME_SET = [
  { key: 'salary', put: i => { i.salary = 3000000; }, kind: 'salary' },
  { key: 'pension', put: i => { i.pension = 1500000; }, kind: 'pension' },
  { key: 'business', put: i => { i.business = 800000; }, amount: 800000, kind: 'sougou' },
  { key: 'realEstate', put: i => { i.realEstate = 600000; }, amount: 600000, kind: 'sougou' },
  { key: 'otherIncome', put: i => { i.otherIncome = 400000; }, amount: 400000, kind: 'sougou' },
  { key: 'landShort', put: i => { i.landShort = 1000000; }, amount: 1000000, kind: 'sep' },
  { key: 'landLong', put: i => { i.landLong = 1200000; }, amount: 1200000, kind: 'sep' },
  { key: 'stockTransfer', put: i => { i.stockTransfer = 900000; }, amount: 900000, kind: 'sep' },
  { key: 'stockDividend', put: i => { i.stockDividend = 700000; }, amount: 700000, kind: 'sep' },
  { key: 'futures', put: i => { i.futures = 500000; }, amount: 500000, kind: 'sep' },
  { key: 'forest', put: i => { i.forestRevenue = 2000000; }, amount: 1500000, kind: 'forest' },
  { key: 'retirement', put: i => { i.retirementRevenue = 10000000; i.retirementYears = 10; },
    amount: 3000000, kind: 'retirement' }
];

/* 所得の合算をオラクルで作る（所得金額調整控除②の相互作用も含む） */
function oracleIncome(mask, p, mode) {
  const inc = {};
  INCOME_SET.forEach((s, i) => { if (mask & (1 << i)) s.put(inc); });
  const salRev = inc.salary || 0, penRev = inc.pension || 0;
  let sal = oracleSalaryIncome(salRev, p.salaryMin, p.salaryMinCap);
  const otherForPension = sal + (inc.business || 0) + (inc.realEstate || 0) + (inc.otherIncome || 0);
  const pen = oraclePensionIncome(penRev, false, otherForPension);
  // 所得金額調整控除②（給与と年金の双方がある場合）
  const adj2 = (sal > 0 && pen > 0)
    ? Math.max(0, Math.min(sal, 100000) + Math.min(pen, 100000) - 100000) : 0;
  sal = Math.max(0, sal - adj2);
  const sougou = sal + pen + (inc.business || 0) + (inc.realEstate || 0) + (inc.otherIncome || 0);
  const sep = { landShort: inc.landShort || 0, landLong: inc.landLong || 0,
    stockTransfer: inc.stockTransfer || 0, stockDividend: inc.stockDividend || 0, futures: inc.futures || 0 };
  const sepSum = Object.values(sep).reduce((a, b) => a + b, 0);
  const forest = inc.forestRevenue ? Math.max(0, inc.forestRevenue - 500000) : 0;
  const ret = inc.retirementRevenue
    ? Math.floor(Math.max(0, inc.retirementRevenue - Math.max(800000, 400000 * inc.retirementYears)) / 2) : 0;
  const retUsed = mode === 'resident' ? 0 : ret;
  return { inc, sougou, sep, sepSum, forest, retirement: retUsed,
    gokei: sougou + sepSum + forest + retUsed };
}

/* 所得控除の充当（総所得→短期→長期→株式→配当→先物→山林→退職） */
function oracleAllocate(o, dedTotal) {
  let rest = dedTotal;
  const take = (v) => { const u = Math.min(rest, v); rest -= u; return v - u; };
  const a = { sougou: take(o.sougou), sep: {} };
  ['landShort', 'landLong', 'stockTransfer', 'stockDividend', 'futures']
    .forEach(k => { a.sep[k] = take(o.sep[k]); });
  a.forest = take(o.forest);
  a.retirement = take(o.retirement);
  return a;
}
const floorTo = (v, u) => Math.floor(v / u) * u;

{
  [2025, 2026].forEach(year => {
    const p = D.INCOME_TAX[year];
    const rp = D.RESIDENT_TAX[year === 2025 ? 2026 : 2027];
    for (let mask = 0; mask < (1 << INCOME_SET.length); mask++) {
      const oi = oracleIncome(mask, p, 'income');
      const orr = oracleIncome(mask, rp, 'resident');
      const inp = base({ incomeYear: year, residentYear: year === 2025 ? 2026 : 2027, income: oi.inc });
      const it = Calc.calcIncomeTax(inp);
      const rt = Calc.calcResidentTax(inp);
      const tag = `${year} mask=${mask}`;

      ok(`${tag} 所得税の合計所得金額`, it.income.gokei === oi.gokei, `${it.income.gokei}/${oi.gokei}`);
      ok(`${tag} 住民税の合計所得金額`, rt.income.gokei === orr.gokei, `${rt.income.gokei}/${orr.gokei}`);
      ok(`${tag} 繰越控除なしなら合計所得＝総所得金額等`, it.income.gokei === it.income.souShotokuTou);
      ok(`${tag} 合計所得金額が整数`, Number.isInteger(it.income.gokei));

      // 課税標準（区分ごとに1,000円未満切捨て）
      const alloc = oracleAllocate(oi, it.deduction.total);
      ok(`${tag} 課税総所得金額`, it.taxable === floorTo(alloc.sougou, 1000),
        `${it.taxable}/${floorTo(alloc.sougou, 1000)}`);
      ['landShort', 'landLong', 'stockTransfer', 'stockDividend', 'futures'].forEach(k => {
        const want = floorTo(alloc.sep[k], 1000);
        const got = floorTo(it.allocation.sep[k], 1000);
        ok(`${tag} ${k} の課税標準`, got === want, `${got}/${want}`);
      });
      // 税額の内訳の合計＝税額控除前の税額
      ok(`${tag} 内訳の合計＝税額控除前`,
        it.parts.reduce((s, x) => s + x.tax, 0) === it.beforeCredit);
      ok(`${tag} 年税額は100円未満切捨て`, it.total % 100 === 0);
      ok(`${tag} 住民税の所得割は100円未満切捨て`,
        rt.cityShotoku % 100 === 0 && rt.prefShotoku % 100 === 0);
      // 退職所得は住民税に入らない
      const hasRet = (mask & (1 << 11)) !== 0;
      ok(`${tag} 退職所得は住民税の合計所得に入らない`,
        rt.income.gokei === oi.gokei - (hasRet ? 3000000 : 0));
      // 非課税判定
      const lim = oracleHikazeiLimits(1, 1);
      ok(`${tag} 均等割の非課税判定`, rt.kintouExempt === (orr.gokei <= lim.kintou));
      ok(`${tag} 所得割の非課税判定`, rt.shotokuExempt === (orr.souShotokuTou === undefined
        ? orr.gokei <= lim.shotoku : orr.gokei <= lim.shotoku));
    }
  });
  done('年分2 × 収入12種の全組み合わせ4,096通り');
}

/* ============================================================================
 * 11. 所得控除12種類の「あり／なし」を全組み合わせ（4,096通り）
 * ==========================================================================*/
section('11. 所得控除12種類の全組み合わせ（4,096通り）：控除額の合算');
{
  const DED_SET = [
    { key: 'social', v: 200000 }, { key: 'kyosai', v: 100000 },
    { key: 'medical', v: 300000 }, { key: 'zasson', v: 50000 },
    { key: 'otherDeduction', v: 30000 },
    { key: 'lifeNewGeneral', v: 80000 }, { key: 'lifeOldGeneral', v: 60000 },
    { key: 'lifeNewCare', v: 50000 }, { key: 'lifeNewPension', v: 40000 },
    { key: 'lifeOldPension', v: 30000 },
    { key: 'quake', v: 40000 }, { key: 'longOld', v: 20000 }
  ];
  const I = D.INSURANCE;
  const stepUp = (a, tbl) => {
    if (a <= 0) return 0;
    for (const s of tbl.steps) if (a <= s[0]) return Math.ceil(a * s[1] + s[2]);
    return tbl.max;
  };
  /* 生命保険料の1区分（新旧の有利選択） */
  const lifeCat = (n, o, mode) => {
    const nv = stepUp(n, mode === 'income' ? I.lifeNewIncome : I.lifeNewResident);
    const ov = stepUp(o, mode === 'income' ? I.lifeOldIncome : I.lifeOldResident);
    const cap = mode === 'income' ? I.lifeCategoryCapIncome : I.lifeCategoryCapResident;
    if (n > 0 && o > 0) return Math.max(ov, Math.min(nv + ov, cap));
    return o > 0 ? ov : nv;
  };
  const SAL = 6000000;
  [2025, 2026].forEach(year => {
    const p = D.INCOME_TAX[year];
    const salaryIncome = oracleSalaryIncome(SAL, p.salaryMin, p.salaryMinCap);
    for (let mask = 0; mask < (1 << DED_SET.length); mask++) {
      const d = {};
      DED_SET.forEach((s, i) => { d[s.key] = (mask & (1 << i)) ? s.v : 0; });
      const inp = base({ incomeYear: year, income: { salary: SAL }, ded: d });

      ['income', 'resident'].forEach(mode => {
        const r = mode === 'resident' ? Calc.calcResidentTax(inp) : Calc.calcIncomeTax(inp);
        const life = Math.min(
          lifeCat(d.lifeNewGeneral, d.lifeOldGeneral, mode) +
          lifeCat(d.lifeNewCare, 0, mode) +
          lifeCat(d.lifeNewPension, d.lifeOldPension, mode),
          mode === 'income' ? I.lifeTotalCapIncome : I.lifeTotalCapResident);
        const quake = mode === 'income'
          ? Math.min(Math.min(d.quake, I.quakeIncomeMax) + stepUp(d.longOld, I.longOldIncome), I.quakeIncomeMax)
          : Math.min(Math.ceil(Math.min(d.quake * I.quakeResidentRate, I.quakeResidentMax))
            + stepUp(d.longOld, I.longOldResident), I.quakeResidentMax);
        const med = Math.max(0, Math.min(d.medical - Math.min(salaryIncome * 0.05, 100000), 2000000));
        const basic = mode === 'resident' ? 430000
          : (() => { for (const b of p.basic) if (salaryIncome <= b[0]) return b[1]; return 0; })();
        const want = Math.floor(d.social) + Math.floor(d.kyosai) + Math.floor(life) + Math.floor(quake)
          + Math.floor(med) + Math.floor(d.zasson) + Math.floor(d.otherDeduction) + basic;
        ok(`${year} ${mode} 控除mask=${mask} 所得控除の合計`,
          r.deduction.total === want, `${r.deduction.total}/${want}`);
        ok(`${year} ${mode} 控除mask=${mask} 明細の合計＝総額`,
          r.deduction.list.reduce((s, x) => s + x.amount, 0) === r.deduction.total);
        ok(`${year} ${mode} 控除mask=${mask} 各控除が0以上`,
          r.deduction.list.every(x => x.amount > 0));
      });
      // 均等割は所得控除の影響を受けない
      ok(`${year} 控除mask=${mask} 均等割は不変`,
        Calc.calcResidentTax(inp).kintouTotal === 5000);
    }
  });
  done('年分2 × 控除12種の全組み合わせ4,096通り × 所得税/住民税');
}

/* ============================================================================
 * 12. 収入 × 控除 × 家族構成をランダムに組み合わせる
 * ==========================================================================*/
section('12. 収入 × 控除 × 家族構成のランダム組み合わせ（20,000件）');
{
  let seed = 20260816;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const DED_KEYS = ['social', 'kyosai', 'medical', 'zasson', 'otherDeduction',
    'lifeNewGeneral', 'lifeOldGeneral', 'lifeNewCare', 'lifeNewPension', 'lifeOldPension', 'quake', 'longOld'];
  const FAM = [{}, { hasSpouse: true }, { hasSpouse: true, dep19_22: 1 },
    { singleParent: 'mother', dep16_18: 1 }, { widow: true }, { depOldLiving: 1 },
    { selfDisability: 'special' }, { tokuteiList: [800000] }, { depUnder16: 2, hasSpouse: true }];

  for (let n = 0; n < 20000; n++) {
    const year = pick([2025, 2026]);
    const ry = year === 2025 ? 2026 : 2027;
    const kyuchi = pick([1, 2, 3]);
    const seirei = rnd() < 0.3;
    const inc = {};
    INCOME_SET.forEach(s => { if (rnd() < 0.4) s.put(inc); });
    const ded = {};
    DED_KEYS.forEach(k => { ded[k] = rnd() < 0.4 ? Math.floor(rnd() * 300000) : 0; });
    const co = { stockLoss: rnd() < 0.2 ? Math.floor(rnd() * 3000000) : 0,
      netLoss: rnd() < 0.15 ? Math.floor(rnd() * 2000000) : 0, casualtyLoss: 0 };
    const fam = pick(FAM);
    const region = { pref: 'X', city: 'Y', seirei, cityKin: 3000, prefKin: 1000,
      cityRate: seirei ? 8 : 6, prefRate: seirei ? 2 : 4, kyuchi };
    const inp = base({ incomeYear: year, residentYear: ry, region,
      income: inc, ded, carryover: co, family: fam });
    const r = Calc.calcAll(inp);
    const tag = `#${n}`;

    // 壊れた値が出ていないこと
    [r.incomeTax.total, r.resident.total, r.jasso.kijun, r.kokuho.judgeIncome,
      r.incomeTax.income.gokei, r.incomeTax.income.souShotokuTou].forEach((v, i) => {
      ok(`${tag} 値${i}が有限で0以上の整数`,
        Number.isFinite(v) && v >= 0 && Number.isInteger(v), String(v));
    });
    // 丸めの約束
    ok(`${tag} 所得税は100円単位`, r.incomeTax.total % 100 === 0);
    ok(`${tag} 市町村民税所得割は100円単位`, r.resident.cityShotoku % 100 === 0);
    ok(`${tag} 道府県民税所得割は100円単位`, r.resident.prefShotoku % 100 === 0);
    ok(`${tag} 課税総所得は1,000円単位`, r.incomeTax.taxable % 1000 === 0);
    ok(`${tag} JASSO基準額は100円単位`, r.jasso.kijun % 100 === 0);
    // 関係の約束
    ok(`${tag} 合計所得金額 ≧ 総所得金額等`, r.incomeTax.income.gokei >= r.incomeTax.income.souShotokuTou);
    ok(`${tag} 住民税＝所得割＋均等割`, r.resident.total === r.resident.shotokuTotal + r.resident.kintouTotal);
    ok(`${tag} 課税標準＝総合＋山林＋分離`,
      r.resident.taxable === r.resident.taxableSougou + r.resident.taxableForest + r.resident.taxableSep);
    ok(`${tag} 所得税の内訳合計＝税額控除前`,
      r.incomeTax.parts.reduce((s, x) => s + x.tax, 0) === r.incomeTax.beforeCredit);
    ok(`${tag} 所得控除の明細合計＝総額`,
      r.incomeTax.deduction.list.reduce((s, x) => s + x.amount, 0) === r.incomeTax.deduction.total);
    // 非課税なら税額0、課税なら限度額超え
    ok(`${tag} 均等割 非課税⇔限度額以下`,
      r.resident.kintouExempt === (r.resident.income.gokei <= r.resident.kintouLimit
        || r.resident.specialExempt || r.resident.welfare));
    if (r.resident.kintouExempt) ok(`${tag} 均等割非課税なら0円`, r.resident.kintouTotal === 0);
    if (r.resident.shotokuExempt) {
      ok(`${tag} 所得割非課税なら0円`, r.resident.shotokuTotal === 0);
      ok(`${tag} 所得割非課税ならJASSO基準額0円`, r.jasso.kijun === 0);
    }
    // 国保の軽減がオラクルと一致
    const want = oracleKokuho(r.kokuho.judgeIncome, r.kokuho.members, r.kokuho.salaryEarners);
    ok(`${tag} 国保の軽減割合`, r.kokuho.level === want, `${r.kokuho.level}/${want}`);
    // JASSO区分がオラクルと一致
    const wantK = oracleJasso(r.jasso.kijun, false, false);
    const gotK = Calc.judgeKubun(r.jasso.kijun);
    ok(`${tag} JASSO区分`, (gotK.genmenOnly ? '減免のみ' : gotK.name) === wantK,
      `${gotK.name}/${wantK}`);
  }
  done('乱数20,000件（収入12種・控除12種・繰越控除・家族9構成・級地3・政令市を無作為に組み合わせ）');
}

/* -------------------------------------------------------------------- */
console.log('\n' + '='.repeat(70));
console.log('■ 試した組み合わせ');
Object.keys(cover).forEach(k => console.log(`   ${k}\n      → ${cover[k].toLocaleString()} 件`));
console.log('='.repeat(70));
console.log(`総当たり検証 ${(pass + fail).toLocaleString()} 件：成功 ${pass.toLocaleString()} / 失敗 ${fail}`);
if (fails.length) {
  console.log('\n■ 失敗した項目（先頭40件）');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
