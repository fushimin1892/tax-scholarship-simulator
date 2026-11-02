/* ============================================================================
 * report-matrix.js — 総当たり検証の「結果そのもの」を報告書に書き出す
 *
 *   node test/report-matrix.js
 *     → docs/06-総当たり検証結果.md を生成する
 *
 * verify-matrix.js が「合っているか」を判定するのに対し、
 * こちらは実際に出た金額・区分・判定を表にして残す。
 * 数字は毎回計算し直すので、税制データを直せば報告書も作り直せる。
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const Calc = require('../assets/calc.js');
const D = require('../assets/data.js');

const out = [];
const w = (s) => out.push(s === undefined ? '' : s);
const yen = (v) => (v === null || v === undefined) ? '—' : Math.round(v).toLocaleString('ja-JP') + '円';
const man = (v) => (v / 10000).toLocaleString('ja-JP') + '万円';

function base(over) {
  const b = {
    incomeYear: 2025, residentYear: 2026,
    region: { pref: '東京都', city: '特別区（23区）', seirei: false,
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
const dedOf = (inp, name, mode) => {
  const r = mode === 'resident' ? Calc.calcResidentTax(inp) : Calc.calcIncomeTax(inp);
  return r.deduction.list.filter(x => x.name.indexOf(name) === 0).reduce((s, x) => s + x.amount, 0);
};

/* ========================================================================= */
w('# 総当たり検証の結果一覧');
w('');
w('**対象**：住民税・所得税・国民健康保険・JASSO奨学金 判定シミュレーター  ');
w('**生成日**：' + new Date().toLocaleDateString('ja-JP') + '  ');
w('**生成方法**：`node test/report-matrix.js`（税制データを直せば作り直せます）');
w('');
w('この文書は、収入・控除・家族構成・年齢を総当たりで計算した**実際の結果**です。');
w('「合っているかどうか」の判定は `node test/verify-matrix.js`（636,008件）が行い、');
w('この文書はその**中身の数字**を人が読める形にしたものです。');
w('');
w('特に断りがなければ、前提は次のとおりです。');
w('');
w('- 令和7年分の所得（令和8年度の住民税・国保）');
w('- 東京都特別区（1級地・政令指定都市ではない）');
w('- 均等割：市町村3,000円＋道府県1,000円＋森林環境税1,000円＝**5,000円**');
w('- 所得控除は基礎控除のみ（ほかは0円）');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 1. 年齢別：扶養の区分と控除額');
w('');
w('年齢0〜100歳を1歳ずつ、所得を13段階で試しました（5,252件）。');
w('区分が切り替わる年齢だけを抜き出すと次のとおりです（合計所得0円の場合）。');
w('');
w('| 年齢 | 区分 | 所得税の控除 | 住民税の控除 | 非課税限度額の人数に入るか |');
w('|---|---|---|---|---|');
{
  const rows = [
    [0, 15, '16歳未満（年少扶養）', 'depUnder16'],
    [16, 18, '一般の扶養親族', 'dep16_18'],
    [19, 22, '特定扶養親族', 'dep19_22'],
    [23, 69, '一般の扶養親族', 'dep23_69'],
    [70, 100, '老人扶養親族（同居老親等以外）', 'depOldOther'],
    [70, 100, '同居老親等', 'depOldLiving']
  ];
  rows.forEach(([lo, hi, name, key]) => {
    const fam = {}; fam[key] = 1;
    const inp = base({ family: fam });
    const i = dedOf(inp, '扶養控除'), r = dedOf(inp, '扶養控除', 'resident');
    const range = lo === hi ? `${lo}歳` : `${lo}〜${hi}歳`;
    const extra = key === 'depOldLiving' ? '（同居）' : key === 'depOldOther' ? '（別居）' : '';
    w(`| ${range}${extra} | ${name} | ${i === 0 ? '**なし**' : yen(i)} | ${r === 0 ? '**なし**' : yen(r)} | ${'○'} |`);
  });
}
w('');
w('### 年齢19〜22歳：所得によって扱いが変わる（令和7年分）');
w('');
w('| 特定親族の合計所得 | 扶養控除 | 特定親族特別控除（所得税） | 同（住民税） | 非課税限度額の人数 |');
w('|---|---|---|---|---|');
{
  const pts = [0, 400000, 580000, 580001, 700000, 850000, 850001, 900000, 950000,
    1000000, 1050000, 1100000, 1150000, 1200000, 1230000, 1230001, 1500000];
  pts.forEach(v => {
    const p = D.INCOME_TAX[2025];
    let fuyou = '—', toku = '—', tokuR = '—', count = '×';
    if (v <= p.dependentLimit) {
      fuyou = yen(dedOf(base({ family: { dep19_22: 1 } }), '扶養控除'));
      count = '○';
    } else if (v <= p.tokuteiUpper) {
      const inp = base({ family: { tokuteiList: [v] } });
      toku = yen(dedOf(inp, '特定親族特別控除'));
      tokuR = yen(dedOf(inp, '特定親族特別控除', 'resident'));
    }
    w(`| ${yen(v)} | ${fuyou} | ${toku} | ${tokuR} | ${count} |`);
  });
}
w('');
w('> 合計所得58万円（令和8年分は62万円）を1円でも超えると扶養控除は使えなくなり、');
w('> 代わりに特定親族特別控除の対象になります。**このとき非課税限度額の人数からは外れます。**');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 2. 収入の種類ごとの所得と課税判定');
w('');
w('収入13種類 × 金額18段階 × 級地3 × 年分2（5,874件）を試しました。');
w('');
w('### 2.1 給与収入 → 給与所得（別表第五）');
w('');
w('| 給与収入 | 令和7年分の給与所得 | 令和8年分の給与所得 | 差 |');
w('|---|---|---|---|');
{
  const pts = [0, 500000, 650000, 651000, 1000000, 1030000, 1230000, 1600000,
    1899999, 1900000, 1904000, 2199999, 2200000, 2204000, 2500000,
    3599999, 3600000, 5000000, 5505000, 6599999, 6600000, 8499999, 8500000, 10000000, 20000000];
  pts.forEach(v => {
    const a = Calc.salaryIncomeAmount(v, D.INCOME_TAX[2025]);
    const b = Calc.salaryIncomeAmount(v, D.INCOME_TAX[2026]);
    w(`| ${yen(v)} | ${yen(a)} | ${yen(b)} | ${a === b ? '—' : yen(b - a)} |`);
  });
}
w('');
w('### 2.2 公的年金等の収入 → 雑所得');
w('');
w('| 年金収入 | 65歳未満の雑所得 | 65歳以上の雑所得 |');
w('|---|---|---|');
{
  [0, 600000, 1000000, 1100000, 1300000, 2000000, 3300000, 4100000, 5000000,
    7700000, 8000000, 10000000, 12000000].forEach(v => {
    const u = Calc.calcIncome(base({ income: { pension: v } }), D.INCOME_TAX[2025], 'income');
    const o = Calc.calcIncome(base({ income: { pension: v, pensionAge65: true } }), D.INCOME_TAX[2025], 'income');
    w(`| ${yen(v)} | ${yen(u.pensionIncome)} | ${yen(o.pensionIncome)} |`);
  });
}
w('');
w('### 2.3 退職金 → 退職所得（勤続年数別・一般の退職）');
w('');
w('| 勤続年数 | 退職所得控除額 | 退職金500万円 | 1,000万円 | 2,000万円 | 5,000万円 |');
w('|---|---|---|---|---|---|');
{
  [1, 2, 3, 5, 10, 15, 20, 21, 25, 30, 35, 38, 40, 45].forEach(y => {
    const ded = y <= 20 ? Math.max(800000, 400000 * y) : 8000000 + 700000 * (y - 20);
    const cells = [5000000, 10000000, 20000000, 50000000].map(rev =>
      yen(Calc.retirementIncome({ retirementRevenue: rev, retirementYears: y }).income));
    w(`| ${y}年 | ${yen(ded)} | ${cells.join(' | ')} |`);
  });
}
w('');
w('勤続5年以下の特例（退職金1,000万円・勤続5年・控除200万円 → 残額800万円）：');
w('');
w('| 区分 | 退職所得金額 | 2分の1課税 |');
w('|---|---|---|');
{
  const mk = (o) => Calc.retirementIncome(Object.assign(
    { retirementRevenue: 10000000, retirementYears: 5 }, o));
  w(`| 一般 | ${yen(mk({}).income)} | あり |`);
  w(`| 特定役員退職手当等 | ${yen(mk({ retirementOfficer: true }).income)} | **なし** |`);
  w(`| 短期退職手当等 | ${yen(mk({ retirementShort: true }).income)} | 300万円までの部分のみ |`);
}
w('');
w('### 2.4 分離課税：所得1,000万円のときの税額（基礎控除適用後）');
w('');
w('| 種類 | 所得税の課税標準 | 所得税 | 住民税の課税標準 | 市町村民税 | 道府県民税 | 合計税率 |');
w('|---|---|---|---|---|---|---|');
{
  D.SEPARATE.forEach(s => {
    const inc = {}; inc[s.key] = 10000000;
    const it = Calc.calcIncomeTax(base({ income: inc }));
    const rt = Calc.calcResidentTax(base({ income: inc }));
    const part = it.parts.filter(x => x.name.indexOf(s.label) >= 0)[0];
    w(`| ${s.label} | ${yen(part.taxable)} | ${yen(part.tax)} | ${yen(rt.taxableSep)} | ` +
      `${yen(rt.citySep)} | ${yen(rt.prefSep)} | ${((s.it + s.rt) * 100).toFixed(0)}％（復興税込 ${((s.it * 1.021 + s.rt) * 100).toFixed(3)}％） |`);
  });
}
w('');
w('### 2.5 山林所得（5分5乗方式）');
w('');
w('| 収入 | 必要経費 | 山林所得 | 課税山林所得 | 所得税額 |');
w('|---|---|---|---|---|');
{
  [[3000000, 0], [6402000, 0], [10000000, 3000000], [30000000, 5000000]].forEach(([rev, exp]) => {
    const it = Calc.calcIncomeTax(base({ income: { forestRevenue: rev, forestExpense: exp } }));
    const part = it.parts.filter(x => x.name.indexOf('山林') >= 0)[0];
    w(`| ${yen(rev)} | ${yen(exp)} | ${yen(it.income.forest)} | ${part ? yen(part.taxable) : '0円'} | ${part ? yen(part.tax) : '0円'} |`);
  });
}
w('');
w('---');
w('');

/* ========================================================================= */
w('## 3. 所得控除の一覧（実際に計算された控除額）');
w('');
w('### 3.1 生命保険料控除（1区分あたり）');
w('');
w('| 年間支払保険料 | 新契約・所得税 | 新契約・住民税 | 旧契約・所得税 | 旧契約・住民税 |');
w('|---|---|---|---|---|');
{
  [1000, 12000, 20000, 20001, 25000, 32000, 40000, 50000, 56000, 70000, 80000, 100000, 200000].forEach(v => {
    const n1 = dedOf(base({ ded: { lifeNewGeneral: v } }), '生命保険料控除');
    const n2 = dedOf(base({ ded: { lifeNewGeneral: v } }), '生命保険料控除', 'resident');
    const o1 = dedOf(base({ ded: { lifeOldGeneral: v } }), '生命保険料控除');
    const o2 = dedOf(base({ ded: { lifeOldGeneral: v } }), '生命保険料控除', 'resident');
    w(`| ${yen(v)} | ${yen(n1)} | ${yen(n2)} | ${yen(o1)} | ${yen(o2)} |`);
  });
}
w('');
w('新旧を併用した場合（有利なほうが自動で選ばれます）：');
w('');
w('| 新契約 | 旧契約 | 所得税の控除額 | 選ばれた計算 |');
w('|---|---|---|---|');
{
  [[80000, 200000], [80000, 30000], [40000, 40000], [20000, 25000]].forEach(([n, o]) => {
    const v = dedOf(base({ ded: { lifeNewGeneral: n, lifeOldGeneral: o } }), '生命保険料控除');
    const onlyOld = dedOf(base({ ded: { lifeOldGeneral: o } }), '生命保険料控除');
    w(`| ${yen(n)} | ${yen(o)} | ${yen(v)} | ${v === onlyOld ? '旧契約のみ' : '新旧合算（上限4万円）'} |`);
  });
}
w('');
w('3区分（一般・介護医療・個人年金）の合計上限：**所得税120,000円／住民税70,000円**');
w('');
w('### 3.2 地震保険料控除');
w('');
w('| 支払保険料 | 地震・所得税 | 地震・住民税 | 旧長期・所得税 | 旧長期・住民税 |');
w('|---|---|---|---|---|');
{
  [1000, 5000, 10000, 15000, 20000, 25000, 30000, 30001, 50000, 60000].forEach(v => {
    w(`| ${yen(v)} | ${yen(dedOf(base({ ded: { quake: v } }), '地震保険料控除'))} | ` +
      `${yen(dedOf(base({ ded: { quake: v } }), '地震保険料控除', 'resident'))} | ` +
      `${yen(dedOf(base({ ded: { longOld: v } }), '地震保険料控除'))} | ` +
      `${yen(dedOf(base({ ded: { longOld: v } }), '地震保険料控除', 'resident'))} |`);
  });
}
w('');
w('### 3.3 人的控除（定額）');
w('');
w('| 控除 | 所得税 | 住民税 | 差（調整控除に使う） |');
w('|---|---|---|---|');
{
  const rows = [
    ['障害者控除（普通）', { selfDisability: 'normal' }, D.JINTEKI_SA.disabilityNormal],
    ['障害者控除（特別）', { selfDisability: 'special' }, D.JINTEKI_SA.disabilitySpecial],
    ['障害者控除（同居特別）', { disLive: 1 }, D.JINTEKI_SA.disabilityLiveTogether],
    ['寡婦控除', { widow: true }, D.JINTEKI_SA.widow],
    ['ひとり親控除（母）', { singleParent: 'mother' }, D.JINTEKI_SA.singleParentMother],
    ['ひとり親控除（父）', { singleParent: 'father' }, D.JINTEKI_SA.singleParentFather],
    ['勤労学生控除', { student: true }, D.JINTEKI_SA.student],
    ['扶養控除（16〜18歳）', { dep16_18: 1 }, D.JINTEKI_SA.dependentGeneral],
    ['扶養控除（特定・19〜22歳）', { dep19_22: 1 }, D.JINTEKI_SA.dependentSpecific],
    ['扶養控除（23〜69歳）', { dep23_69: 1 }, D.JINTEKI_SA.dependentGeneral],
    ['扶養控除（老人・別居）', { depOldOther: 1 }, D.JINTEKI_SA.dependentOldOther],
    ['扶養控除（同居老親等）', { depOldLiving: 1 }, D.JINTEKI_SA.dependentOldLiving]
  ];
  rows.forEach(([name, fam, sa]) => {
    const key = name.split('（')[0];
    const inp = base({ family: fam });
    w(`| ${name} | ${yen(dedOf(inp, key))} | ${yen(dedOf(inp, key, 'resident'))} | ${yen(sa)} |`);
  });
  w(`| 配偶者控除（本人900万円以下） | ${yen(dedOf(base({ family: { hasSpouse: true } }), '配偶者控除'))} | ` +
    `${yen(dedOf(base({ family: { hasSpouse: true } }), '配偶者控除', 'resident'))} | ${yen(D.JINTEKI_SA.spouseNormal[0])} |`);
  w(`| 配偶者控除（老人） | ${yen(dedOf(base({ family: { hasSpouse: true, spouseOld: true } }), '配偶者控除（老人）'))} | ` +
    `${yen(dedOf(base({ family: { hasSpouse: true, spouseOld: true } }), '配偶者控除（老人）', 'resident'))} | ${yen(D.JINTEKI_SA.spouseOld[0])} |`);
}
w('');
w('> **ひとり親控除は控除額が母・父とも同じ**（所得税35万円／住民税30万円）ですが、');
w('> 調整控除に使う差が**母5万円・父1万円**と違うため、住民税額が変わります。');
w('');
w('### 3.4 基礎控除（合計所得金額で変わる）');
w('');
w('| 合計所得金額 | 令和7年分 | 令和8年分 | 住民税（両年度） |');
w('|---|---|---|---|');
{
  [500000, 1320000, 1320001, 3360000, 3360001, 4890000, 4890001, 6550000, 6550001,
    23500000, 23500001, 24000000, 24000001, 24500000, 24500001, 25000000, 25000001].forEach(v => {
    const a = dedOf(base({ incomeYear: 2025, income: { otherIncome: v } }), '基礎控除');
    const b = dedOf(base({ incomeYear: 2026, income: { otherIncome: v } }), '基礎控除');
    const c = dedOf(base({ income: { otherIncome: v } }), '基礎控除', 'resident');
    w(`| ${yen(v)} | ${yen(a)} | ${yen(b)} | ${yen(c)} |`);
  });
}
w('');
w('### 3.5 医療費控除（足切りは総所得金額等の5％と10万円の小さいほう）');
w('');
w('| 給与収入 | 総所得金額等 | 足切り額 | 医療費20万円のときの控除 | 医療費50万円 |');
w('|---|---|---|---|---|');
{
  [1000000, 1650000, 2000000, 3000000, 5000000, 10000000].forEach(sal => {
    const inc = Calc.calcIncome(base({ income: { salary: sal } }), D.INCOME_TAX[2025], 'income');
    const cut = Math.min(inc.souShotokuTou * 0.05, 100000);
    const a = dedOf(base({ income: { salary: sal }, ded: { medical: 200000 } }), '医療費控除');
    const b = dedOf(base({ income: { salary: sal }, ded: { medical: 500000 } }), '医療費控除');
    w(`| ${yen(sal)} | ${yen(inc.souShotokuTou)} | ${yen(cut)} | ${yen(a)} | ${yen(b)} |`);
  });
}
w('');
w('---');
w('');

/* ========================================================================= */
w('## 4. 住民税の非課税限度額（全級地 × 判定人数）');
w('');
w('判定人数＝本人＋同一生計配偶者＋扶養親族（**16歳未満を含む**）');
w('');
w('| 判定人数 | 1級地 均等割 | 2級地 均等割 | 3級地 均等割 | 所得割（全国共通） |');
w('|---|---|---|---|---|');
{
  for (let n = 1; n <= 8; n++) {
    const cells = [1, 2, 3].map(k => {
      const region = { pref: 'X', city: 'Y', seirei: false, cityKin: 3000, prefKin: 1000,
        cityRate: 6, prefRate: 4, kyuchi: k };
      return yen(Calc.calcResidentTax(base({ region, family: { dep23_69: n - 1 } })).kintouLimit);
    });
    const sho = Calc.calcResidentTax(base({ family: { dep23_69: n - 1 } })).shotokuLimit;
    w(`| ${n}人 | ${cells.join(' | ')} | ${yen(sho)} |`);
  }
}
w('');
w('> 扶養親族等がいる（判定人数2人以上）と加算が入りますが、**均等割は21万円・所得割は32万円**と額が違います。');
w('> このずれが「**所得割は非課税なのに均等割は課税**」という帯を作ります。');
w('');
w('### 給与収入でいうといくらか（1級地・単身）');
w('');
w('| 給与収入 | 合計所得 | 均等割 | 所得割 | 住民税の年税額 |');
w('|---|---|---|---|---|');
{
  [960000, 1000000, 1100000, 1150000, 1200000, 1300000, 1500000, 2000000].forEach(sal => {
    const r = Calc.calcResidentTax(base({ income: { salary: sal } }));
    w(`| ${yen(sal)} | ${yen(r.income.gokei)} | ${r.kintouExempt ? '**非課税**' : yen(r.kintouTotal)} | ` +
      `${r.shotokuExempt ? '**非課税**' : yen(r.shotokuTotal)} | ${yen(r.total)} |`);
  });
}
w('');
w('---');
w('');

/* ========================================================================= */
w('## 5. 家族構成別の通し計算結果');
w('');
w('家族19構成 × 給与8段階 × 級地2 × 政令市2 × 年分2（14,160件）を試しました。');
w('代表として **令和7年分・東京都特別区（1級地）・社会保険料は給与の15％** の結果を載せます。');
w('');
const FAMILIES = [
  ['単身', {}],
  ['夫婦（配偶者無収入）', { hasSpouse: true, spouseIncome: 0 }],
  ['夫婦（配偶者パート・所得60万）', { hasSpouse: true, spouseIncome: 600000 }],
  ['夫婦（配偶者所得133万）', { hasSpouse: true, spouseIncome: 1330000 }],
  ['夫婦（老人控除対象配偶者）', { hasSpouse: true, spouseIncome: 0, spouseOld: true }],
  ['夫婦＋子1（16歳未満）', { hasSpouse: true, depUnder16: 1 }],
  ['夫婦＋子1（高校生16〜18歳）', { hasSpouse: true, dep16_18: 1 }],
  ['夫婦＋子1（大学生19〜22歳）', { hasSpouse: true, dep19_22: 1 }],
  ['夫婦＋子2（大学生＋高校生）', { hasSpouse: true, dep19_22: 1, dep16_18: 1 }],
  ['夫婦＋子3（多子世帯）', { hasSpouse: true, dep19_22: 1, dep16_18: 1, depUnder16: 1 }],
  ['ひとり親（母）＋子1', { singleParent: 'mother', dep16_18: 1 }],
  ['ひとり親（父）＋子1', { singleParent: 'father', dep16_18: 1 }],
  ['寡婦', { widow: true }],
  ['夫婦＋同居老親1', { hasSpouse: true, depOldLiving: 1 }],
  ['夫婦＋別居老親1', { hasSpouse: true, depOldOther: 1 }],
  ['夫婦＋同居特別障害者1', { hasSpouse: true, disLive: 1 }],
  ['本人が特別障害者', { selfDisability: 'special' }],
  ['特定親族特別控除1人（所得80万）', { tokuteiList: [800000] }],
  ['特定親族特別控除2人', { tokuteiList: [800000, 1000000] }]
];
const SALS = [1000000, 2000000, 3500000, 5000000, 8000000];
FAMILIES.forEach(([fname, fam]) => {
  w(`### ${fname}`);
  w('');
  w('| 給与収入 | 所得税 | 住民税 均等割 | 住民税 所得割 | 住民税 合計 | JASSO 支給額算定基準額 | JASSO区分 | 国保の軽減 |');
  w('|---|---|---|---|---|---|---|---|');
  SALS.forEach(sal => {
    const inp = base({ income: { salary: sal }, ded: { social: Math.floor(sal * 0.15) }, family: fam });
    const r = Calc.calcAll(inp);
    const j = r.jasso, kub = Calc.judgeKubun(j.kijun);
    w(`| ${yen(sal)} | ${r.incomeTax.isTaxable ? yen(r.incomeTax.total) : '**課税なし**'} | ` +
      `${r.resident.kintouExempt ? '**非課税**' : yen(r.resident.kintouTotal)} | ` +
      `${r.resident.shotokuExempt ? '**非課税**' : yen(r.resident.shotokuTotal)} | ` +
      `${yen(r.resident.total)} | ${yen(j.kijun)} | ${kub.name} | ` +
      `${r.kokuho.level ? r.kokuho.level + '割軽減' : '軽減なし'} |`);
  });
  w('');
});
w('---');
w('');

/* ========================================================================= */
w('## 6. 級地・政令指定都市による違い');
w('');
w('同じ収入（給与500万円・社会保険料75万円・夫婦＋大学生1人）での比較です。');
w('');
w('| 地域 | 級地 | 均等割の限度額 | 所得税 | 均等割 | 所得割 | 住民税合計 | JASSO基準額 |');
w('|---|---|---|---|---|---|---|---|');
{
  const cases = [
    ['東京都特別区', 1, false, 3000, 1000, 6, 4],
    ['一般市町村（2級地）', 2, false, 3000, 1000, 6, 4],
    ['一般市町村（3級地）', 3, false, 3000, 1000, 6, 4],
    ['横浜市（政令市・みどり税・水源環境保全税）', 1, true, 3900, 1300, 8, 2.025],
    ['名古屋市（政令市・市民税5％減税）', 1, true, 2800, 1500, 7.7, 2],
    ['大阪市（政令市）', 1, true, 3000, 1300, 8, 2]
  ];
  cases.forEach(([name, kyuchi, seirei, ck, pk, cr, pr]) => {
    const region = { pref: 'X', city: name, seirei, cityKin: ck, prefKin: pk, cityRate: cr, prefRate: pr, kyuchi };
    const inp = base({ region, income: { salary: 5000000 }, ded: { social: 750000 },
      family: { hasSpouse: true, dep19_22: 1 } });
    const r = Calc.calcAll(inp);
    const j = Calc.calcJasso(r.resident, region);
    w(`| ${name} | ${kyuchi} | ${yen(r.resident.kintouLimit)} | ${yen(r.incomeTax.total)} | ` +
      `${yen(r.resident.kintouTotal)} | ${yen(r.resident.shotokuTotal)} | ${yen(r.resident.total)} | ${yen(j.kijun)} |`);
  });
}
w('');
w('> 政令指定都市は市民税8％・道府県民税2％と配分が違いますが、合計10％は同じです。');
w('> JASSOの基準額は政令市の調整控除に**4分の3**を掛けて一般市町村と同じ水準に直します。');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 7. 国民健康保険の軽減判定（基準額の全表）');
w('');
w('被保険者1〜10人 × 給与所得者0〜5人 × 境界±1円（3,660件）を試しました。');
w('');
w('### 7.1 給与所得者等が1人以下の場合の基準額');
w('');
w('| 被保険者等の数 | 7割軽減 | 5割軽減 | 2割軽減 |');
w('|---|---|---|---|');
{
  for (let m = 1; m <= 10; m++) {
    const inp = base({ kokuho: { insured: m, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 } });
    const k = Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
    w(`| ${m}人 | ${yen(k.t7)} | ${yen(k.t5)} | ${yen(k.t2)} |`);
  }
}
w('');
w('### 7.2 給与所得者等が複数いる場合の加算（被保険者4人の例）');
w('');
w('| 給与所得者等の数 | 加算額 | 7割軽減 | 5割軽減 | 2割軽減 |');
w('|---|---|---|---|---|');
{
  for (let e = 0; e <= 5; e++) {
    const inp = base({ kokuho: { insured: 4, tokutei: 0, salaryEarners: e, otherMembersIncome: 0 } });
    const k = Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
    w(`| ${e}人 | ${yen(k.addend)} | ${yen(k.t7)} | ${yen(k.t5)} | ${yen(k.t2)} |`);
  }
}
w('');
w('### 7.3 軽減割合が切り替わる点（被保険者2人・給与所得者1人）');
w('');
w('| 世帯の軽減判定所得 | 軽減割合 |');
w('|---|---|');
{
  const inp0 = base({ kokuho: { insured: 2, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 } });
  const k0 = Calc.calcKokuho(inp0, Calc.calcResidentTax(inp0).income);
  [0, k0.t7, k0.t7 + 1, k0.t5, k0.t5 + 1, k0.t2, k0.t2 + 1, 3000000].forEach(v => {
    const inp = base({ income: { otherIncome: v },
      kokuho: { insured: 2, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 } });
    const k = Calc.calcKokuho(inp, Calc.calcResidentTax(inp).income);
    w(`| ${yen(v)} | ${k.level ? '**' + k.level + '割軽減**' : '軽減なし'} |`);
  });
}
w('');
w('### 7.4 軽減判定所得が住民税の所得と違う点（実際の数字）');
w('');
w('| ケース | 住民税の合計所得金額 | 国保の軽減判定所得 | 差 |');
w('|---|---|---|---|');
{
  const rows = [
    ['給与100万円のみ', { income: { salary: 1000000 } }, {}],
    ['給与100万＋社会保険料控除50万', { income: { salary: 1000000 }, ded: { social: 500000 } }, {}],
    ['年金200万（65歳以上）', { income: { pension: 2000000, pensionAge65: true } }, {}],
    ['年金200万（65歳未満）', { income: { pension: 2000000 } }, {}],
    ['退職金2,000万（勤続10年）', { income: { retirementRevenue: 20000000, retirementYears: 10 } }, {}],
    ['株の利益250万＋繰越控除250万', { income: { stockTransfer: 2500000 }, carryover: { stockLoss: 2500000 } }, {}],
    ['長期譲渡100万＋特別控除3,000万', { income: { landLong: 1000000 } }, { landSpecialDeduction: 30000000 }],
    ['事業所得100万＋専従者控除86万', { income: { business: 1000000 } }, { senjusha: 860000 }]
  ];
  rows.forEach(([name, over, kok]) => {
    const inp = base(Object.assign({ kokuho: Object.assign(
      { insured: 1, tokutei: 0, salaryEarners: 1, otherMembersIncome: 0 }, kok) }, over));
    const rt = Calc.calcResidentTax(inp);
    const k = Calc.calcKokuho(inp, rt.income);
    const d = k.judgeIncome - rt.income.gokei;
    w(`| ${name} | ${yen(rt.income.gokei)} | ${yen(k.judgeIncome)} | ${d === 0 ? '同じ' : (d > 0 ? '＋' : '−') + yen(Math.abs(d))} |`);
  });
}
w('');
w('---');
w('');

/* ========================================================================= */
w('## 8. JASSO 支援区分の判定');
w('');
w('境界18点 × 多子世帯2 × 私立理工農系2 ＋ 課税標準0〜400万円を2万円刻み（876件）を試しました。');
w('');
w('### 8.1 支給額算定基準額の合計と支援区分');
w('');
w('| 基準額の合計 | 区分なし | 多子世帯 | 私立理工農系 |');
w('|---|---|---|---|');
{
  [0, 99, 100, 25599, 25600, 51299, 51300, 154499, 154500, 300000].forEach(v => {
    const a = Calc.judgeKubun(v), b = Calc.judgeKubun(v, { tashi: true }), c = Calc.judgeKubun(v, { rikonou: true });
    const nm = (x) => x.genmenOnly ? '**授業料等減免のみ**' : x.name;
    w(`| ${yen(v)} | ${nm(a)} | ${nm(b)} | ${nm(c)} |`);
  });
}
w('');
w('> **多子世帯は154,500円以上でも授業料等減免の対象**です（所得制限なし）。');
w('> ただし給付奨学金は支援区分に応じた額なので0円になります。');
w('');
w('### 8.2 課税標準額から基準額へ（一般市町村と政令指定都市）');
w('');
w('| 市町村民税の課税標準額 | 一般市町村の基準額 | 区分 | 政令指定都市の基準額 | 区分 |');
w('|---|---|---|---|---|');
{
  [0, 100000, 300000, 500000, 700000, 900000, 1000000, 1500000, 2000000, 2600000, 3000000].forEach(t => {
    const mk = (seirei) => {
      const region = { pref: 'X', city: 'Y', seirei, cityKin: 3000, prefKin: 1000,
        cityRate: seirei ? 8 : 6, prefRate: seirei ? 2 : 4, kyuchi: 1 };
      const inp = base({ region, income: { otherIncome: t + 430000 } });
      const rt = Calc.calcResidentTax(inp);
      const j = Calc.calcJasso(rt, region);
      return [j.kijun, Calc.judgeKubun(j.kijun).name];
    };
    const [a, an] = mk(false), [b, bn] = mk(true);
    w(`| ${yen(t)} | ${yen(a)} | ${an} | ${yen(b)} | ${bn} |`);
  });
}
w('');
w('### 8.3 給与収入でいうと（夫婦＋大学生1人・社会保険料15％・生計維持者2人の合計）');
w('');
w('| 生計維持者Aの給与 | 生計維持者Bの給与 | Aの基準額 | Bの基準額 | 合計 | 支援区分 |');
w('|---|---|---|---|---|---|');
{
  const pairs = [[2000000, 0], [3000000, 0], [3000000, 1000000], [4000000, 1000000],
    [5000000, 1000000], [6000000, 2000000], [8000000, 3000000]];
  pairs.forEach(([a, b]) => {
    const mk = (sal) => {
      const inp = base({ income: { salary: sal }, ded: { social: Math.floor(sal * 0.15) },
        family: { hasSpouse: true, dep19_22: 1 } });
      return Calc.calcAll(inp).jasso.kijun;
    };
    const ka = mk(a), kb = b > 0 ? mk(b) : 0;
    const kub = Calc.judgeKubun(ka + kb);
    w(`| ${yen(a)} | ${b > 0 ? yen(b) : '—'} | ${yen(ka)} | ${yen(kb)} | ${yen(ka + kb)} | ${kub.name} |`);
  });
}
w('');
w('> 実際の判定は**学生本人の基準額も合計**します（本人に所得がなければ0円）。');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 9. 繰越控除がある場合（合計所得金額と総所得金額等の違い）');
w('');
w('| ケース | 合計所得金額（繰越前） | 総所得金額等（繰越後） | 均等割 | 所得割 | 扶養に入れるか |');
w('|---|---|---|---|---|---|');
{
  const rows = [
    ['株の利益300万・繰越0', { stockTransfer: 3000000 }, { stockLoss: 0 }],
    ['株の利益300万・繰越100万', { stockTransfer: 3000000 }, { stockLoss: 1000000 }],
    ['株の利益300万・繰越300万', { stockTransfer: 3000000 }, { stockLoss: 3000000 }],
    ['株の利益250万・繰越250万＋給与100万', { stockTransfer: 2500000, salary: 1000000 }, { stockLoss: 2500000 }],
    ['先物300万・株の繰越300万（引けない）', { futures: 3000000 }, { stockLoss: 3000000 }],
    ['給与500万・純損失繰越300万', { salary: 5000000 }, { netLoss: 3000000 }]
  ];
  rows.forEach(([name, inc, co]) => {
    const inp = base({ income: inc, carryover: co });
    const r = Calc.calcResidentTax(inp);
    const limit = D.INCOME_TAX[2025].dependentLimit;
    w(`| ${name} | ${yen(r.income.gokei)} | ${yen(r.income.souShotokuTou)} | ` +
      `${r.kintouExempt ? '**非課税**' : yen(r.kintouTotal)} | ${r.shotokuExempt ? '**非課税**' : yen(r.shotokuTotal)} | ` +
      `${r.income.gokei <= limit ? '入れる' : '**入れない**'} |`);
  });
}
w('');
w('> 繰越控除を使っても**合計所得金額は減りません**。そのため所得割が非課税でも');
w('> 均等割が課税されたり、扶養から外れたりします。');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 10. 収入の組み合わせ（全4,096通りの代表）');
w('');
w('総合課税5種（給与・年金・事業・不動産・その他）と分離課税等7種');
w('（短期譲渡・長期譲渡・株式譲渡・配当・先物・山林・退職）の「あり／なし」を');
w('**全組み合わせ4,096通り × 年分2**（131,072件）で試しました。');
w('');
w('金額は固定で、給与300万・年金150万・事業80万・不動産60万・その他40万・');
w('短期100万・長期120万・株式90万・配当70万・先物50万・山林（収入200万）・退職（1,000万／勤続10年）です。');
w('');
w('| 組み合わせ | 所得税の合計所得金額 | 住民税の合計所得金額 | 所得税 | 住民税 | 国保の軽減 |');
w('|---|---|---|---|---|---|');
{
  const sets = [
    ['給与のみ', { salary: 3000000 }],
    ['年金のみ（65歳未満）', { pension: 1500000 }],
    ['**給与＋年金**（所得金額調整控除②が効く）', { salary: 3000000, pension: 1500000 }],
    ['給与＋事業＋不動産＋その他', { salary: 3000000, business: 800000, realEstate: 600000, otherIncome: 400000 }],
    ['分離課税5種のみ', { landShort: 1000000, landLong: 1200000, stockTransfer: 900000, stockDividend: 700000, futures: 500000 }],
    ['給与＋分離課税5種', { salary: 3000000, landShort: 1000000, landLong: 1200000, stockTransfer: 900000, stockDividend: 700000, futures: 500000 }],
    ['山林のみ（収入200万）', { forestRevenue: 2000000 }],
    ['退職のみ（1,000万・勤続10年）', { retirementRevenue: 10000000, retirementYears: 10 }],
    ['**12種すべて**', { salary: 3000000, pension: 1500000, business: 800000, realEstate: 600000,
      otherIncome: 400000, landShort: 1000000, landLong: 1200000, stockTransfer: 900000,
      stockDividend: 700000, futures: 500000, forestRevenue: 2000000,
      retirementRevenue: 10000000, retirementYears: 10 }]
  ];
  sets.forEach(([name, inc]) => {
    const inp = base({ income: inc });
    const r = Calc.calcAll(inp);
    w(`| ${name} | ${yen(r.incomeTax.income.gokei)} | ${yen(r.resident.income.gokei)} | ` +
      `${r.incomeTax.isTaxable ? yen(r.incomeTax.total) : '**課税なし**'} | ${yen(r.resident.total)} | ` +
      `${r.kokuho.level ? r.kokuho.level + '割軽減' : '軽減なし'} |`);
  });
}
w('');
w('### 給与と年金が両方あるときの所得金額調整控除②');
w('');
w('| 給与収入 | 年金収入 | 給与所得 | 年金雑所得 | 調整控除② | 調整後の給与所得 | 合計所得金額 |');
w('|---|---|---|---|---|---|---|');
{
  [[3000000, 1500000], [1000000, 1000000], [700000, 1150000], [8000000, 3000000], [3000000, 0], [0, 1500000]]
    .forEach(([s, p]) => {
      const inc = Calc.calcIncome(base({ income: { salary: s, pension: p } }), D.INCOME_TAX[2025], 'income');
      w(`| ${yen(s)} | ${yen(p)} | ${yen(inc.salaryIncomeRaw)} | ${yen(inc.pensionIncome)} | ` +
        `${yen(inc.adjust2)} | ${yen(inc.salaryIncome)} | ${yen(inc.gokei)} |`);
    });
}
w('');
w('---');
w('');
w('## 11. 控除の組み合わせ（全4,096通りの代表）');
w('');
w('所得控除12種類の「あり／なし」を**全組み合わせ4,096通り × 年分2 × 所得税/住民税**（57,344件）で試しました。');
w('金額は社会保険料20万・小規模企業共済10万・医療費30万・雑損5万・その他3万・');
w('生命保険料（一般新8万／一般旧6万／介護5万／年金新4万／年金旧3万）・地震4万・旧長期2万です。');
w('');
w('給与600万円のときの結果：');
w('');
w('| 控除の組み合わせ | 所得税の控除合計 | 住民税の控除合計 | 所得税 | 住民税 所得割 |');
w('|---|---|---|---|---|');
{
  const D12 = { social: 200000, kyosai: 100000, medical: 300000, zasson: 50000, otherDeduction: 30000,
    lifeNewGeneral: 80000, lifeOldGeneral: 60000, lifeNewCare: 50000, lifeNewPension: 40000,
    lifeOldPension: 30000, quake: 40000, longOld: 20000 };
  const sets = [
    ['なし（基礎控除のみ）', {}],
    ['社会保険料のみ', { social: 200000 }],
    ['生命保険料5種（上限12万／7万）', { lifeNewGeneral: 80000, lifeOldGeneral: 60000,
      lifeNewCare: 50000, lifeNewPension: 40000, lifeOldPension: 30000 }],
    ['地震＋旧長期（上限5万／2.5万）', { quake: 40000, longOld: 20000 }],
    ['医療費30万', { medical: 300000 }],
    ['**12種すべて**', D12]
  ];
  sets.forEach(([name, d]) => {
    const inp = base({ income: { salary: 6000000 }, ded: d });
    const it = Calc.calcIncomeTax(inp), rt = Calc.calcResidentTax(inp);
    w(`| ${name} | ${yen(it.deduction.total)} | ${yen(rt.deduction.total)} | ` +
      `${yen(it.total)} | ${yen(rt.shotokuTotal)} |`);
  });
}
w('');
w('> 控除を増やすと所得税・住民税の所得割は減りますが、**均等割（5,000円）は1円も変わりません**。');
w('> 全4,096通りでこれを確認しています。');
w('');
w('---');
w('');

/* ========================================================================= */
w('## 12. 検証の件数と方法');
w('');
w('| 検証 | 件数 | 方法 |');
w('|---|---|---|');
w('| `verify.js` | 196 | 各テーブル・各控除を一次資料と照合／横浜市・名古屋市の公式計算例と1円単位で突合 |');
w('| `verify-calc.js` | 326 | 各関数を単独で、境界値と端数まで条文・速算表と突合 |');
w('| `audit.js` | 471,685 | 不変条件30パターン・20,000件のランダム入力・単調性・静的検査 |');
w('| `verify-matrix.js` | 636,008 | **法令から独立に書いたオラクルと総当たりで突合** |');
w('| `browser-check.js` | 179 | 実ブラウザでの表示・配色・スマホ幅・PDF出力 |');
w('| `verify-prefectures.js` | 47 | 47都道府県の超過課税を公式ページの生HTMLと突合 |');
w('');
w('総当たり検証の内訳：');
w('');
w('| 節 | 試した組み合わせ | 件数 |');
w('|---|---|---|');
w('| 1 | 年齢0〜100歳 × 所得13段階 × 同居/別居 × 年分2 | 5,252 |');
w('| 2 | 級地3 × 判定人数1〜7 × 年度2 × 境界±1円 | 378 |');
w('| 3 | 収入13種類 × 金額18段階 × 級地3 × 年分2 | 5,874 |');
w('| 4 | 保険料控除の全段階 × 人的控除14種 × 所得税/住民税 ＋ 控除12種の単調性 | 338 |');
w('| 5 | 家族19構成 × 給与8段階 × 級地2 × 政令市2 × 年分2 | 14,160 |');
w('| 6 | 被保険者1〜10人 × 給与所得者0〜5人 × 境界±1円 | 3,660 |');
w('| 7 | JASSO境界18点 × 多子2 × 理工農2 ＋ 課税標準0〜400万を2万円刻み × 政令市2 | 876 |');
w('| 8 | 分離課税5種の2つ組 × 金額 × 繰越3段階 ＋ 退職 勤続1〜45年 × 収入5 × 区分3 | 2,985 |');
w('| 9 | 単調性：年分2 × 家族3 × 級地3 × 給与0〜1,200万を2.5万円刻み（481点） | 32,049 |');
w('| 10 | **収入12種の全組み合わせ4,096通り** × 年分2 | 131,072 |');
w('| 11 | **控除12種の全組み合わせ4,096通り** × 年分2 × 所得税/住民税 | 57,344 |');
w('| 12 | 収入 × 控除 × 繰越控除 × 家族構成 × 級地 × 政令市の無作為20,000件 | 382,020 |');
w('| | **合計** | **636,008** |');
w('');
w('### この検証で保証できないこと');
w('');
w('- **収録データそのものの正しさ**：オラクルは法令から書き起こしたものなので、');
w('  `data.js` の税率・控除額が誤っていれば両方が同じように誤ります。');
w('  データの正しさは公式計算例との突合（横浜市247,900円・名古屋市140,200円が1円一致）と');
w('  47都道府県の公式ページ突合が担保しています。');
w('- **令和8年分の給与所得控除後の金額の表（別表第五）**：国税庁の表そのものは例年9〜10月公表です。');
w('  現時点は改正内容（最低保障74万円・適用上限220万円）から構造を再現しており、公表後の再照合が必要です。');
w('- **自治体ごとの保険料率**：国保は軽減割合のみ判定し、保険料額は算出していません。');
w('');

/* ========================================================================= */
const file = path.join(__dirname, '..', 'docs', '06-総当たり検証結果.md');
fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log('生成しました: docs/06-総当たり検証結果.md（' + out.length.toLocaleString() + ' 行）');
