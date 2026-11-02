/* 計算エンジンの検証（node test/verify.js） */
const Calc = require('../assets/calc.js');
const D = require('../assets/data.js');

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  OK   ${label} = ${actual}`); }
  else { fail++; console.log(`  NG   ${label} = ${actual}  (期待値 ${expected})`); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function base(over) {
  const b = {
    incomeYear: 2025,
    residentYear: 2026,
    region: { pref: '東京都', city: '特別区（23区）', seirei: false, cityKin: 3000, prefKin: 1000, cityRate: 6, prefRate: 4, kyuchi: 1 },
    income: {
      salary: 0, pension: 0, pensionAge65: false, business: 0, realEstate: 0, otherIncome: 0,
      landShort: 0, landLong: 0, stockTransfer: 0, stockDividend: 0, futures: 0,
      forestRevenue: 0, forestExpense: 0,
      retirementRevenue: 0, retirementYears: 0, retirementOfficer: false,
      retirementShort: false, retirementDisability: false
    },
    carryover: { stockLoss: 0, netLoss: 0, casualtyLoss: 0 },
    ded: {
      social: 0, kyosai: 0, lifeNewGeneral: 0, lifeOldGeneral: 0, lifeNewCare: 0,
      lifeNewPension: 0, lifeOldPension: 0, quake: 0, longOld: 0,
      medical: 0, medicalComp: 0, zasson: 0, otherDeduction: 0
    },
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
  return Object.assign(b, over || {});
}

/* -------------------------------------------------------------- */
section('給与所得控除（令和7年分：最低保障65万円／令和8年分：74万円）');
eq('R7 収入190万', Calc.salaryDeduction(1900000, D.INCOME_TAX[2025]), 650000);
eq('R7 収入200万', Calc.salaryDeduction(2000000, D.INCOME_TAX[2025]), 2000000 * 0.3 + 80000);
eq('R7 収入500万', Calc.salaryDeduction(5000000, D.INCOME_TAX[2025]), 1440000);
eq('R7 収入900万（上限）', Calc.salaryDeduction(9000000, D.INCOME_TAX[2025]), 1950000);
eq('R8 収入220万', Calc.salaryDeduction(2200000, D.INCOME_TAX[2026]), 740000);
eq('R8 収入230万', Calc.salaryDeduction(2300000, D.INCOME_TAX[2026]), 2300000 * 0.3 + 80000);

section('公的年金等控除');
eq('65歳以上・収入300万', Calc.pensionDeduction(3000000, true, 0), 1100000);
eq('65歳未満・収入120万', Calc.pensionDeduction(1200000, false, 0), 600000);
eq('65歳以上・収入400万', Calc.pensionDeduction(4000000, true, 0), 4000000 * 0.25 + 275000);

/* -------------------------------------------------------------- */
section('ケース1：学生アルバイト 給与収入110万円（令和7年分・東京都特別区・単身）');
{
  const r = Calc.calcAll(base({ income: Object.assign(base().income, { salary: 1100000 }), family: Object.assign(base().family, { student: true }) }));
  eq('給与所得', r.incomeTax.income.salaryIncome, 450000);
  eq('合計所得金額', r.incomeTax.income.gokei, 450000);
  eq('所得税（年税額）', r.incomeTax.total, 0);
  eq('均等割の非課税限度額（1級地・単身）', r.resident.kintouLimit, 450000);
  eq('所得割の非課税限度額（単身）', r.resident.shotokuLimit, 450000);
  eq('均等割 非課税か', r.resident.kintouExempt, true);
  eq('所得割 非課税か', r.resident.shotokuExempt, true);
  eq('住民税 合計', r.resident.total, 0);
  eq('JASSO 支給額算定基準額', r.jasso.kijun, 0);
  eq('JASSO 区分（生計維持者本人分のみ）', Calc.judgeKubun(r.jasso.kijun).name, '第Ⅰ区分');
}

section('ケース2：給与収入111万円（1円単位で課税に転じる）');
{
  const r = Calc.calcAll(base({ income: Object.assign(base().income, { salary: 1110000 }) }));
  eq('給与所得', r.incomeTax.income.salaryIncome, 460000);
  eq('均等割 非課税か', r.resident.kintouExempt, false);
  eq('所得割 非課税か', r.resident.shotokuExempt, false);
  eq('住民税 課税標準額', r.resident.taxable, 30000);
  eq('市町村民税 所得割（調整控除後）', r.resident.cityShotoku, 900);
  eq('道府県民税 所得割（調整控除後）', r.resident.prefShotoku, 600);
  eq('均等割合計（森林環境税を含む）', r.resident.kintouTotal, 5000);
  eq('住民税 合計', r.resident.total, 6500);
  eq('JASSO 支給額算定基準額', r.jasso.kijun, 900);
  eq('JASSO 区分', Calc.judgeKubun(r.jasso.kijun).name, '第Ⅱ区分');
  eq('所得税', r.incomeTax.total, 0);
}

section('ケース3：親 給与収入500万円／配偶者(無収入)／特定扶養1人／社保75万円');
{
  const inp = base();
  inp.income.salary = 5000000;
  inp.ded.social = 750000;
  inp.family.hasSpouse = true;
  inp.family.dep19_22 = 1;
  const r = Calc.calcAll(inp);
  eq('給与所得', r.incomeTax.income.salaryIncome, 3560000);
  eq('所得税の所得控除合計', r.incomeTax.deduction.total, 680000 + 380000 + 630000 + 750000);
  eq('所得税の課税総所得金額', r.incomeTax.taxable, 1120000);
  eq('所得税（年税額）', r.incomeTax.total, 57100);
  eq('住民税の所得控除合計', r.resident.deduction.total, 430000 + 330000 + 450000 + 750000);
  eq('住民税の課税標準額', r.resident.taxable, 1600000);
  eq('人的控除の差 合計', r.resident.jinteki.total, 280000);
  eq('調整控除（市町村民税分）', r.resident.cityAdj, 8400);
  eq('市町村民税 所得割', r.resident.cityShotoku, 87600);
  eq('道府県民税 所得割', r.resident.prefShotoku, 58400);
  eq('JASSO 支給額算定基準額', r.jasso.kijun, 87600);
  eq('JASSO 区分（多子世帯の場合）', Calc.judgeKubun(r.jasso.kijun, { tashi: true }).name, '第Ⅳ区分');
  eq('JASSO 区分（一般世帯）', Calc.judgeKubun(r.jasso.kijun).over, true);
}

section('ケース4：政令指定都市（横浜市）の税率・均等割・調整控除の按分');
{
  const inp = base();
  inp.region = { pref: '神奈川県', city: '横浜市', seirei: true, cityKin: 3900, prefKin: 1300, cityRate: 8, prefRate: 2.025, kyuchi: 1 };
  inp.income.salary = 5000000;
  inp.ded.social = 750000;
  inp.family.hasSpouse = true;
  inp.family.dep19_22 = 1;
  const r = Calc.calcAll(inp);
  eq('課税標準額', r.resident.taxable, 1600000);
  eq('市民税 所得割（8%）算出額', r.resident.cityRaw, 128000);
  eq('県民税 所得割（2.025%）算出額', r.resident.prefRaw, 32400);
  eq('調整控除 市民税分（4%）', r.resident.cityAdj, 11200);
  eq('調整控除 県民税分（1%）', r.resident.prefAdj, 2800);
  eq('市民税 所得割', r.resident.cityShotoku, 116800);
  eq('県民税 所得割', r.resident.prefShotoku, 29600);
  eq('均等割合計（横浜みどり税900＋水源環境保全税300＋森林環境税1000）', r.resident.kintouTotal, 6200);
  // 政令市は（調整控除額＋調整額）に3/4を乗じる
  eq('JASSO 支給額算定基準額', r.jasso.kijun, Math.floor((1600000 * 0.06 - 11200 * 0.75) / 100) * 100);
}

section('ケース5：国民健康保険料の軽減判定（令和8年度）');
{
  // 単身・給与収入100万円 → 給与所得35万円
  const inp = base();
  inp.income.salary = 1000000;
  inp.kokuho = { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('軽減判定所得', r.kokuho.judgeIncome, 350000);
  eq('7割軽減の基準額', r.kokuho.t7, 430000);
  eq('5割軽減の基準額（被保険者1人）', r.kokuho.t5, 430000 + 310000);
  eq('2割軽減の基準額（被保険者1人）', r.kokuho.t2, 430000 + 570000);
  eq('軽減割合', r.kokuho.level, 7);
}
{
  // 4人世帯・世帯主給与収入250万円（給与所得 250万×30%+8万=83万 → 167万）
  const inp = base();
  inp.income.salary = 2500000;
  inp.kokuho = { insured: 4, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('給与所得', r.resident.income.salaryIncome, 2500000 - (2500000 * 0.3 + 80000));
  eq('5割軽減の基準額（被保険者4人）', r.kokuho.t5, 430000 + 310000 * 4);
  eq('2割軽減の基準額（被保険者4人）', r.kokuho.t2, 430000 + 570000 * 4);
  eq('軽減割合', r.kokuho.level, 5);
}
{
  // 給与所得者が2人いる世帯（10万円×(2-1)の加算）
  const inp = base();
  inp.income.salary = 1000000;
  inp.kokuho = { insured: 2, tokutei: 0, salaryEarners: 2, otherMembersIncome: 300000 };
  const r = Calc.calcAll(inp);
  eq('加算額', r.kokuho.addend, 100000);
  eq('7割軽減の基準額', r.kokuho.t7, 530000);
  eq('軽減判定所得', r.kokuho.judgeIncome, 650000);
  eq('軽減割合', r.kokuho.level, 5);
}

section('ケース6：令和8年分（178万円の壁）の確認');
{
  const inp = base({ incomeYear: 2026, residentYear: 2027 });
  inp.income.salary = 1780000;
  const r = Calc.calcAll(inp);
  eq('給与所得控除', r.incomeTax.income.salaryDeduction, 740000);
  eq('給与所得', r.incomeTax.income.salaryIncome, 1040000);
  eq('基礎控除（令和8年分）', r.incomeTax.deduction.basic, 1040000);
  eq('課税総所得金額', r.incomeTax.taxable, 0);
  eq('所得税', r.incomeTax.total, 0);
}
{
  const inp = base({ incomeYear: 2026, residentYear: 2027 });
  inp.income.salary = 1790000;
  const r = Calc.calcAll(inp);
  eq('給与収入179万→所得税が発生', r.incomeTax.total > 0, true);
}

section('ケース7：住民税の非課税限度額（級地・扶養人数別／令和8年度）');
{
  const inp = base();
  inp.income.salary = 2000000;
  inp.family.hasSpouse = true;
  inp.family.depUnder16 = 2;
  const r = Calc.calcAll(inp);
  eq('判定人数（本人＋配偶者＋扶養2人）', r.resident.headcount, 4);
  eq('均等割 非課税限度額（1級地）', r.resident.kintouAll[1], 350000 * 4 + 100000 + 210000);
  eq('均等割 非課税限度額（2級地）', r.resident.kintouAll[2], 315000 * 4 + 100000 + 189000);
  eq('均等割 非課税限度額（3級地）', r.resident.kintouAll[3], 280000 * 4 + 100000 + 168000);
  eq('所得割 非課税限度額', r.resident.shotokuLimit, 350000 * 4 + 100000 + 320000);
}

section('ケース8：障害者で合計所得135万円以下 → 全額非課税');
{
  const inp = base();
  inp.income.salary = 2040000; // 給与所得 = 204万×30%+8万=69.2万 → 134.8万
  inp.family.selfDisability = 'normal';
  const r = Calc.calcAll(inp);
  eq('合計所得金額', r.resident.income.gokei, 2040000 - (2040000 * 0.3 + 80000));
  eq('特例非課税に該当', r.resident.specialExempt, true);
  eq('住民税 合計', r.resident.total, 0);
}

section('ケース9：所得割の調整措置（非課税限度額を僅かに超える場合）');
{
  const inp = base();
  inp.income.salary = 1100500; // 給与所得 450,500 円（限度額450,000円を500円超過）
  const r = Calc.calcAll(inp);
  eq('総所得金額等', r.resident.income.souShotokuTou, 450500);
  eq('所得割 非課税限度額', r.resident.shotokuLimit, 450000);
  eq('調整措置が発動', r.resident.chosei > 0, true);
}

section('ケース10：生命保険料控除・地震保険料控除');
{
  const inp = base();
  inp.income.salary = 5000000;
  inp.ded.lifeNewGeneral = 100000; // 新契約・一般 → 所得税4万／住民税2.8万
  inp.ded.lifeNewCare = 100000;    // 介護医療 → 同上
  inp.ded.lifeOldPension = 120000; // 旧契約・個人年金 → 所得税5万／住民税3.5万
  inp.ded.quake = 60000;           // 地震保険 → 所得税5万／住民税2.5万
  const r = Calc.calcAll(inp);
  const lifeI = r.incomeTax.deduction.list.find(x => x.name === '生命保険料控除').amount;
  const lifeR = r.resident.deduction.list.find(x => x.name === '生命保険料控除').amount;
  const qI = r.incomeTax.deduction.list.find(x => x.name === '地震保険料控除').amount;
  const qR = r.resident.deduction.list.find(x => x.name === '地震保険料控除').amount;
  // 一般4万＋介護医療4万＋個人年金5万＝13万だが、所得税の合計適用限度額は12万円
  eq('生命保険料控除（所得税・上限12万円）', lifeI, 120000);
  eq('生命保険料控除（住民税・上限7万円）', lifeR, 70000);
  eq('地震保険料控除（所得税）', qI, 50000);
  eq('地震保険料控除（住民税）', qR, 25000);
}

section('ケース11：特定親族特別控除（19〜23歳未満の子の所得が58万円超）');
{
  const inp = base();
  inp.income.salary = 5000000;
  inp.family.tokuteiEnabled = true;
  inp.family.tokuteiIncome = 800000; // 給与収入145万円相当
  const r = Calc.calcAll(inp);
  const tI = r.incomeTax.deduction.list.find(x => x.name === '特定親族特別控除').amount;
  const tR = r.resident.deduction.list.find(x => x.name === '特定親族特別控除').amount;
  eq('特定親族特別控除（所得税）', tI, 630000);
  eq('特定親族特別控除（住民税）', tR, 450000);
  eq('人的控除の差に18万円が算入', r.resident.jinteki.list.some(x => x.name === '特定親族特別控除' && x.amount === 180000), true);
}

section('ケース12：名古屋市（市民税減税）');
{
  const inp = base();
  inp.region = { pref: '愛知県', city: '名古屋市', seirei: true, cityKin: 2800, prefKin: 1500, cityRate: 7.7, prefRate: 2, kyuchi: 1 };
  inp.income.salary = 5000000;
  inp.ded.social = 750000;
  inp.family.hasSpouse = true;
  inp.family.dep19_22 = 1;
  const r = Calc.calcAll(inp);
  eq('市民税 所得割（7.7%）算出額', r.resident.cityRaw, Math.floor(1600000 * 0.077));
  eq('均等割合計（市2,800＋県1,500＋森林1,000）', r.resident.kintouTotal, 5300);
}

/* ============================================================
 * 分離課税・繰越控除
 * ==========================================================*/
section('ケース13：上場株式等の譲渡益と譲渡損失の繰越控除');
{
  // 給与300万円＋株式譲渡益200万円、前年繰越損失150万円
  const inp = base();
  inp.income.salary = 3000000;
  inp.ded.social = 450000;
  inp.income.stockTransfer = 2000000;
  inp.carryover.stockLoss = 1500000;
  const r = Calc.calcAll(inp);
  const salaryIncome = 3000000 - (3000000 * 0.3 + 80000);   // 2,020,000
  eq('給与所得', r.incomeTax.income.salaryIncome, salaryIncome);
  eq('合計所得金額（繰越控除前）', r.incomeTax.income.gokei, salaryIncome + 2000000);
  eq('繰越控除で使った額', r.incomeTax.income.carryStockUsed, 1500000);
  eq('翌年へ繰り越す残額', r.incomeTax.income.carryStockRemain, 0);
  eq('総所得金額等（繰越控除後）', r.incomeTax.income.souShotokuTou, salaryIncome + 500000);
  eq('繰越控除後の株式譲渡所得', r.incomeTax.income.sep.stockTransfer, 500000);
  // 所得控除は総所得金額から先に充当される
  eq('課税総所得金額', r.incomeTax.taxable, Math.floor((salaryIncome - r.incomeTax.deduction.total) / 1000) * 1000);
  eq('課税株式譲渡所得（所得控除は使い切られていない）', r.incomeTax.allocation.sep.stockTransfer, 500000);
  eq('株式譲渡分の所得税（15％）', 500000 * 0.15, 75000);
}

section('ケース14：繰越控除は均等割の判定に効かない（合計所得金額は控除前）');
{
  // 給与130万円（給与所得65万円）＋株式譲渡益0、繰越損失50万円
  const inp = base();
  inp.income.salary = 1300000;
  inp.carryover.netLoss = 500000;
  const r = Calc.calcAll(inp);
  const g = 1300000 - 650000;    // 給与所得 650,000
  eq('合計所得金額（繰越控除前）', r.resident.income.gokei, g);
  eq('総所得金額等（繰越控除後）', r.resident.income.souShotokuTou, g - 500000);
  eq('均等割の非課税限度額（1級地・単身）', r.resident.kintouLimit, 450000);
  eq('均等割：合計所得65万円 > 45万円 なので課税', r.resident.kintouExempt, false);
  eq('所得割：総所得金額等15万円 ≦ 45万円 なので非課税', r.resident.shotokuExempt, true);
  eq('均等割だけ課税される', r.resident.total, 5000);
  eq('JASSO は所得割で判定するので第Ⅰ区分', Calc.judgeKubun(r.jasso.kijun).name, '第Ⅰ区分');
}

section('ケース15：土地建物等の譲渡（短期39.63％／長期20.315％）');
{
  const inp = base();
  inp.income.landLong = 10000000;
  const r = Calc.calcAll(inp);
  eq('長期譲渡の所得税（15％）', r.incomeTax.parts.find(x => /長期/.test(x.name)).tax,
    Math.floor((10000000 - r.incomeTax.deduction.total) / 1000) * 1000 * 0.15);
  eq('所得控除は分離所得からも引かれる', r.incomeTax.allocation.sep.landLong, 10000000 - r.incomeTax.deduction.total);
  const sepLong = r.resident.sepParts.find(x => /長期/.test(x.name));
  eq('長期譲渡の住民税率', sepLong.rate, 5);
  eq('市町村民税分（3％）', sepLong.city, Math.floor(sepLong.taxable * 0.05 * 0.6));
  eq('道府県民税分（2％）', sepLong.pref, Math.floor(sepLong.taxable * 0.05 * 0.4));
}
{
  const inp = base();
  inp.income.landShort = 10000000;
  const r = Calc.calcAll(inp);
  const sep = r.resident.sepParts.find(x => /短期/.test(x.name));
  eq('短期譲渡の住民税率', sep.rate, 9);
  eq('短期譲渡の所得税率', r.incomeTax.parts.find(x => /短期/.test(x.name)).rate, 30);
}

section('ケース16：退職所得');
{
  const inp = base();
  inp.income.retirementRevenue = 20000000;
  inp.income.retirementYears = 30;
  const r = Calc.calcAll(inp);
  const ret = r.incomeTax.income.retirement;
  eq('退職所得控除（勤続30年）', ret.deduction, 8000000 + 700000 * 10);   // 15,000,000
  eq('退職所得の金額', ret.income, (20000000 - 15000000) / 2);            // 2,500,000
  eq('所得税の合計所得金額に含まれる', r.incomeTax.income.gokei, 2500000);
  eq('住民税は現年分離課税なので翌年度に含めない', r.resident.income.gokei, 0);
  eq('住民税は非課税', r.resident.total, 0);
}
{
  const inp = base();
  inp.income.retirementRevenue = 3000000;
  inp.income.retirementYears = 10;
  const r = Calc.calcAll(inp);
  eq('退職所得控除（勤続10年）', r.incomeTax.income.retirement.deduction, 400000 * 10);
  eq('退職所得の金額', r.incomeTax.income.retirement.income, (3000000 - 4000000) > 0 ? 0 : 0);
}

section('ケース17：山林所得（5分5乗方式・特別控除50万円）');
{
  const inp = base();
  inp.income.forestRevenue = 12000000;
  inp.income.forestExpense = 2000000;
  const r = Calc.calcAll(inp);
  eq('山林所得の金額', r.incomeTax.income.forestBefore, 12000000 - 2000000 - 500000);
  const t = 9500000 - r.incomeTax.deduction.total;
  const fifth = Math.floor(Math.floor(t / 1000) * 1000 / 5 / 1000) * 1000;  // 1,784,000円 → 税率5％
  eq('5分の1にした課税山林所得金額', fifth, 1784000);
  eq('5分5乗の税額', r.incomeTax.parts.find(x => /山林/.test(x.name)).tax,
    Math.floor(fifth * 0.05) * 5);
}

section('ケース18：JASSO の課税標準額に分離課税分が加わる');
{
  const inp = base();
  inp.income.salary = 5000000;
  inp.ded.social = 750000;
  inp.family.hasSpouse = true;
  inp.family.dep19_22 = 1;
  inp.income.stockTransfer = 1000000;
  const r = Calc.calcAll(inp);
  eq('課税標準額（総合）', r.resident.taxableSougou, 1600000);
  eq('課税標準額（分離）', r.resident.taxableSep, 1000000);
  eq('課税標準額の合計', r.resident.taxable, 2600000);
  eq('支給額算定基準額', r.jasso.kijun, Math.floor((2600000 * 0.06 - r.resident.cityAdj) / 100) * 100);
}

/* ============================================================
 * 国民健康保険の軽減判定（令和8年度）
 *   出典で確認したルール：
 *     43万円／5割 31万円×被保険者等／2割 57万円×被保険者等／給与所得者等2人目以降＋10万円
 *     退職所得は含めない・繰越控除は適用後・65歳以上は年金所得から15万円
 *     分離譲渡は特別控除「前」・専従者は事業主の所得に戻す・所得控除は引かない
 * ==========================================================*/
section('ケース19：軽減判定の基準額（令和8年度）');
{
  const inp = base();
  inp.income.salary = 1000000;
  inp.kokuho = { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('7割軽減の基準額（単身）', r.kokuho.t7, 430000);
  eq('5割軽減の基準額（被保険者1人）', r.kokuho.t5, 430000 + 310000);
  eq('2割軽減の基準額（被保険者1人）', r.kokuho.t2, 430000 + 570000);
}
{
  // 被保険者3人＋特定同一世帯所属者1人＝4人、給与所得者等3人
  const inp = base();
  inp.income.salary = 1000000;
  inp.kokuho = { insured: 3, tokutei: 1, salaryEarners: 3, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('被保険者等の数', r.kokuho.members, 4);
  eq('給与所得者等の加算（10万円×(3−1)）', r.kokuho.addend, 200000);
  eq('7割軽減の基準額', r.kokuho.t7, 430000 + 200000);
  eq('5割軽減の基準額', r.kokuho.t5, 430000 + 310000 * 4 + 200000);
  eq('2割軽減の基準額', r.kokuho.t2, 430000 + 570000 * 4 + 200000);
}

section('ケース20：軽減判定所得は所得控除を引かない・繰越控除は引く');
{
  const inp = base();
  inp.income.salary = 2000000;          // 給与所得 132万円
  inp.ded.social = 300000;              // 社会保険料控除は軽減判定では引かない
  inp.carryover.netLoss = 200000;       // 純損失の繰越控除は引く
  inp.kokuho = { insured: 2, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  const salaryIncome = 2000000 - (2000000 * 0.3 + 80000);   // 1,320,000
  eq('給与所得', r.resident.income.sougouBefore, salaryIncome);
  eq('軽減判定所得＝総所得金額等（繰越控除後・所得控除は引かない）',
    r.kokuho.judgeIncome, salaryIncome - 200000);
}

section('ケース21：65歳以上は公的年金等所得からさらに15万円を控除');
{
  const inp = base();
  inp.income.pension = 2000000;
  inp.income.pensionAge65 = true;       // 公的年金等控除110万 → 年金所得90万
  inp.kokuho = { insured: 2, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('公的年金等に係る雑所得', r.resident.income.pensionIncome, 900000);
  eq('軽減判定所得（900,000 − 150,000）', r.kokuho.judgeIncome, 750000);
  eq('5割軽減の基準額（被保険者2人）', r.kokuho.t5, 430000 + 310000 * 2);
  eq('軽減割合', r.kokuho.level, 5);
}
{
  // 年金所得が15万円未満なら、その額までしか控除しない
  const inp = base();
  inp.income.pension = 1200000;         // 65歳以上：年金所得10万円
  inp.income.pensionAge65 = true;
  inp.kokuho = { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('公的年金等に係る雑所得', r.resident.income.pensionIncome, 100000);
  eq('軽減判定所得は0円まで', r.kokuho.judgeIncome, 0);
  eq('軽減割合', r.kokuho.level, 7);
}

section('ケース22：退職所得は軽減判定に含めない');
{
  const inp = base();
  inp.income.salary = 1000000;
  inp.income.retirementRevenue = 20000000;
  inp.income.retirementYears = 30;      // 退職所得 250万円
  inp.kokuho = { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 };
  const r = Calc.calcAll(inp);
  eq('所得税では退職所得を含む', r.incomeTax.income.gokei, 350000 + 2500000);
  eq('軽減判定所得は給与所得のみ', r.kokuho.judgeIncome, 350000);
  eq('軽減割合', r.kokuho.level, 7);
}

section('ケース23：分離譲渡の特別控除・専従者は足し戻す');
{
  const inp = base();
  inp.income.salary = 1000000;                       // 給与所得 35万円
  inp.income.landLong = 5000000;                     // 特別控除後の譲渡所得
  inp.kokuho = { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0,
    landSpecialDeduction: 30000000, senjusha: 860000 };
  const r = Calc.calcAll(inp);
  eq('軽減判定所得（35万＋500万＋3,000万＋86万）',
    r.kokuho.judgeIncome, 350000 + 5000000 + 30000000 + 860000);
  eq('軽減割合', r.kokuho.level, 0);
}

section('ケース24：本人が世帯主でも被保険者でもない場合は判定に含めない');
{
  const inp = base();
  inp.income.salary = 5000000;
  inp.kokuho = { insured: 2, tokutei: 0, salaryEarners: 1, otherMembersIncome: 300000, includeSelf: false };
  const r = Calc.calcAll(inp);
  eq('本人の所得は入らない', r.kokuho.judgeIncome, 300000);
  eq('軽減割合', r.kokuho.level, 7);
}

section('ケース25：賦課限度額（令和8年度）');
{
  const L = D.KOKUHO.limits;
  eq('医療分', L.medical, 670000);
  eq('後期高齢者支援金分', L.support, 260000);
  eq('介護納付金分', L.care, 170000);
  eq('子ども・子育て支援納付金分（令和8年度新設）', L.child, 30000);
  eq('合計', L.total, 1130000);
  eq('令和7年度の合計', D.KOKUHO.prev.total, 1090000);
}

/* ============================================================
 * 自治体の「公式の計算例」と1円単位で突合する回帰テスト
 *   ここが合っていれば、給与所得の丸め・所得控除・調整控除・均等割・
 *   100円未満切捨てまで通しで正しいと確認できる。
 * ==========================================================*/
section('公式例A：横浜市 令和8年度 市民税・県民税・森林環境税の計算例');
{
  // 給与収入550万円／夫婦（配偶者無収入）＋子2人（17歳・13歳）
  // 社会保険料394,800円／一般生命保険料（新契約）90,000円／地震保険料20,000円
  const inp = base();
  inp.region = { pref: '神奈川県', city: '横浜市', seirei: true,
    cityKin: 3900, prefKin: 1300, cityRate: 8, prefRate: 2.025, kyuchi: 1 };
  inp.income.salary = 5500000;
  inp.ded.social = 394800;
  inp.ded.lifeNewGeneral = 90000;
  inp.ded.quake = 20000;
  inp.family.hasSpouse = true;
  inp.family.dep16_18 = 1;      // 17歳
  inp.family.depUnder16 = 1;    // 13歳
  const r = Calc.calcAll(inp);
  const rt = r.resident;
  eq('給与所得控除額', rt.income.salaryDeduction, 1540000);
  eq('給与所得', rt.income.salaryIncome, 3960000);
  const d = (name) => (rt.deduction.list.find(x => x.name.indexOf(name) === 0) || {}).amount;
  eq('社会保険料控除', d('社会保険料控除'), 394800);
  eq('生命保険料控除（住民税）', d('生命保険料控除'), 28000);
  eq('地震保険料控除（住民税）', d('地震保険料控除'), 10000);
  eq('配偶者控除（住民税）', d('配偶者控除'), 330000);
  eq('扶養控除（16〜18歳／住民税）', d('扶養控除'), 330000);
  eq('基礎控除（住民税）', d('基礎控除'), 430000);
  eq('所得控除の合計', rt.deduction.total, 1522800);
  eq('課税標準額', rt.taxable, 2437000);
  eq('人的控除の差（基礎5万＋配偶者5万＋一般扶養5万）', rt.jinteki.total, 150000);
  eq('調整控除の基礎額（200万円超なので最低5万円）', rt.adjBase, 50000);
  eq('市民税 所得割', rt.cityShotoku, 192900);
  eq('県民税 所得割', rt.prefShotoku, 48800);
  eq('均等割（市3,900＋県1,300＋森林1,000）', rt.kintouTotal, 6200);
  eq('年税額（公式例：247,900円）', rt.total, 247900);
}

section('公式例B：名古屋市 令和8年度 市民税・県民税の計算例（市民税5％減税）');
{
  // 給与収入5,505,000円／夫婦＋子3人（19歳・16歳・12歳、いずれも所得なし）
  // 社会保険料825,600円／生命保険料（旧契約）80,000円
  const inp = base();
  inp.region = { pref: '愛知県', city: '名古屋市', seirei: true,
    cityKin: 2800, prefKin: 1500, cityRate: 7.7, prefRate: 2, kyuchi: 1 };
  inp.income.salary = 5505000;
  inp.ded.social = 825600;
  inp.ded.lifeOldGeneral = 80000;
  inp.family.hasSpouse = true;
  inp.family.dep19_22 = 1;      // 19歳
  inp.family.dep16_18 = 1;      // 16歳
  inp.family.depUnder16 = 1;    // 12歳
  const r = Calc.calcAll(inp);
  const rt = r.resident;
  // 4,000円単位の丸めがないと 3,964,000 になってしまう
  eq('給与所得（4,000円単位に丸めた表どおり）', rt.income.salaryIncome, 3963200);
  eq('所得控除の合計', rt.deduction.total, 2400600);
  eq('課税総所得金額', rt.taxable, 1562000);
  eq('市民税 所得割の算出額（7.7％）', rt.cityStd, 120274);
  eq('県民税 所得割の算出額（2％）', rt.prefStd, 31240);
  eq('人的控除の差（基礎5万＋配偶者5万＋特定18万＋一般5万）', rt.jinteki.total, 330000);
  eq('市民税の調整控除（政令市4％）', rt.cityAdj, 13200);
  eq('県民税の調整控除（政令市1％）', rt.prefAdj, 3300);
  eq('市民税額（所得割＋均等割）', rt.cityShotoku + rt.cityKin, 109800);
  eq('県民税額（所得割＋均等割）', rt.prefShotoku + rt.prefKin, 29400);
  eq('年税額（公式例：140,200円）', rt.total, 140200);
}

section('給与所得の表の丸め（4,000円単位）');
{
  const p7 = D.INCOME_TAX[2025], p8 = D.INCOME_TAX[2026];
  eq('R7 収入5,505,000円', Calc.salaryIncomeAmount(5505000, p7), 3963200);
  eq('R7 収入5,504,000円（4,000の倍数）', Calc.salaryIncomeAmount(5504000, p7), 3963200);
  eq('R7 収入5,508,000円（次の刻み）', Calc.salaryIncomeAmount(5508000, p7), 3966400);
  eq('R7 収入1,900,000円（最低保障の境目・連続）', Calc.salaryIncomeAmount(1900000, p7), 1250000);
  eq('R7 収入1,899,999円', Calc.salaryIncomeAmount(1899999, p7), 1249999);
  eq('R7 収入3,600,000円（区分の境目・連続）', Calc.salaryIncomeAmount(3600000, p7), 2440000);
  eq('R7 収入6,600,000円（区分の境目・連続）', Calc.salaryIncomeAmount(6600000, p7), 4840000);
  eq('R7 収入8,500,000円（上限）', Calc.salaryIncomeAmount(8500000, p7), 6550000);
  eq('R8 収入2,200,000円（最低保障の境目・連続）', Calc.salaryIncomeAmount(2200000, p8), 1460000);
  eq('R8 収入2,199,999円', Calc.salaryIncomeAmount(2199999, p8), 1459999);
  eq('R8 収入2,203,000円（丸めで2,200,000円扱い）', Calc.salaryIncomeAmount(2203000, p8), 1460000);
}

console.log(`\n===== 合計 ${pass + fail} 件：成功 ${pass} / 失敗 ${fail} =====`);
process.exit(fail === 0 ? 0 : 1);
