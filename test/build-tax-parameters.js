/* ============================================================================
 * build-tax-parameters.js — 税制パラメータを出典付きの JSON に書き出す
 *
 *   node test/build-tax-parameters.js
 *     → tax-parameters.json を生成する
 *
 * 正本はあくまで assets/data.js。この JSON はそこから機械生成する
 * 「読む・差分をとる・外部に渡す」ための写しで、手で書き換えてはいけない。
 * data.js と食い違っていないことは test/audit.js の D-6 で確認する。
 *
 * status の意味
 *   final       … 公表済みの確定値
 *   provisional … 改正は成立しているが、実務資料（通知・表）が未公表で要再確認
 *   pending     … 公表待ちで値を入れていない
 * ==========================================================================*/
const fs = require('fs');
const path = require('path');
const D = require('../assets/data.js');

const S = D.SOURCES;
const src = (i) => `${S[i].c}／${S[i].t}（${S[i].u}）`;

const J = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  meta: {
    name: '税制パラメータ（住民税・所得税・国民健康保険・JASSO奨学金）',
    /* 実行日は入れない。入れると「同じ data.js から作ったのに中身が変わる」ことになり、
     * CI の「生成し直して差分が出ないか」の検査が、翌日以降かならず落ちてしまう。
     * ここに書くべきは、中身がいつ時点のものかを表す data.js の最終確認日。 */
    verifiedAt: D.VERIFIED_AT,
    generatedBy: 'node test/build-tax-parameters.js',
    masterFile: 'assets/data.js',
    note: 'このファイルは assets/data.js から生成した写しです。手で編集せず、data.js を直して再生成してください。',
    statusLegend: {
      final: '公表済みの確定値',
      provisional: '改正は成立しているが実務資料（通知・表）が未公表で要再確認',
      pending: '公表待ちのため値を入れていない'
    }
  },

  /* ---------------- 所得税 ---------------- */
  incomeTax: {
    2025: {
      label: D.INCOME_TAX[2025].label,
      status: 'final',
      salaryDeductionMinimum: { value: D.INCOME_TAX[2025].salaryMin, unit: '円', source: src(1) },
      salaryDeductionMinimumCap: { value: D.INCOME_TAX[2025].salaryMinCap, unit: '円', source: src(1),
        note: 'この収入までは最低保障額。超えると別表第五の4,000円刻みに入る' },
      basicDeduction: { table: D.INCOME_TAX[2025].basic.map(([upTo, v]) => ({
        gokeiShotokuUpTo: upTo === Infinity ? null : upTo, deduction: v })), source: src(0) + ' ／ ' + src(6) },
      dependentIncomeLimit: { value: D.INCOME_TAX[2025].dependentLimit, unit: '円', source: src(5) },
      studentIncomeLimit: { value: D.INCOME_TAX[2025].studentLimit, unit: '円', source: src(4) },
      studentDeduction: { value: D.INCOME_TAX[2025].studentDeduction, unit: '円', source: src(4) },
      spouseSpecialUpper: { value: D.INCOME_TAX[2025].spouseSpecialUpper, unit: '円', source: src(6) },
      tokuteiShinzokuRange: { lower: D.INCOME_TAX[2025].tokuteiLower,
        upper: D.INCOME_TAX[2025].tokuteiUpper, unit: '円', source: src(3) }
    },
    2026: {
      label: D.INCOME_TAX[2026].label,
      status: 'final',
      statusNote: '令和8年度税制改正（令和7年12月26日 閣議決定・令和8年12月1日施行）を反映。' +
        'ただし別表第五そのもの（年末調整資料）は例年9〜10月公表のため provisionalTables を参照',
      salaryDeductionMinimum: { value: D.INCOME_TAX[2026].salaryMin, unit: '円', source: src(7) },
      salaryDeductionMinimumCap: { value: D.INCOME_TAX[2026].salaryMinCap, unit: '円', source: src(7) },
      basicDeduction: { table: D.INCOME_TAX[2026].basic.map(([upTo, v]) => ({
        gokeiShotokuUpTo: upTo === Infinity ? null : upTo, deduction: v })), source: src(7) },
      dependentIncomeLimit: { value: D.INCOME_TAX[2026].dependentLimit, unit: '円', source: src(7) },
      studentIncomeLimit: { value: D.INCOME_TAX[2026].studentLimit, unit: '円', source: src(7) },
      studentDeduction: { value: D.INCOME_TAX[2026].studentDeduction, unit: '円', source: src(4) },
      spouseSpecialUpper: { value: D.INCOME_TAX[2026].spouseSpecialUpper, unit: '円', source: src(7) },
      tokuteiShinzokuRange: { lower: D.INCOME_TAX[2026].tokuteiLower,
        upper: D.INCOME_TAX[2026].tokuteiUpper, unit: '円', source: src(3) + ' ／ ' + src(7) }
    },
    brackets: { source: src(2),
      table: D.INCOME_TAX_BRACKETS.map(([upTo, rate, sub]) => ({
        taxableUpTo: upTo === Infinity ? null : upTo, rate, subtraction: sub })) },
    reconstructionRate: { value: D.RECONSTRUCTION_RATE, source: '復興財源確保法（復興特別所得税 基準所得税額の2.1％）' }
  },

  /* ---------------- 住民税 ---------------- */
  residentTax: {
    2026: {
      label: D.RESIDENT_TAX[2026].label,
      incomeYear: D.RESIDENT_TAX[2026].incomeYear,
      status: D.RESIDENT_TAX[2026].provisional ? 'provisional' : 'final',
      basicDeduction: { table: D.RESIDENT_TAX[2026].basic.map(([upTo, v]) => ({
        gokeiShotokuUpTo: upTo === Infinity ? null : upTo, deduction: v })), source: src(11) },
      dependentIncomeLimit: { value: D.RESIDENT_TAX[2026].dependentLimit, unit: '円', source: src(11) },
      studentIncomeLimit: { value: D.RESIDENT_TAX[2026].studentLimit, unit: '円', source: src(11) },
      studentDeduction: { value: D.RESIDENT_TAX[2026].studentDeduction, unit: '円', source: src(11) }
    },
    2027: {
      label: D.RESIDENT_TAX[2027].label,
      incomeYear: D.RESIDENT_TAX[2027].incomeYear,
      status: D.RESIDENT_TAX[2027].provisional ? 'provisional' : 'final',
      statusNote: '令和8年度税制改正の住民税適用分。各自治体の令和9年度課税の案内は未公表のため要再確認',
      basicDeduction: { table: D.RESIDENT_TAX[2027].basic.map(([upTo, v]) => ({
        gokeiShotokuUpTo: upTo === Infinity ? null : upTo, deduction: v })), source: src(9) },
      dependentIncomeLimit: { value: D.RESIDENT_TAX[2027].dependentLimit, unit: '円', source: src(7) },
      studentIncomeLimit: { value: D.RESIDENT_TAX[2027].studentLimit, unit: '円', source: src(7) },
      studentDeduction: { value: D.RESIDENT_TAX[2027].studentDeduction, unit: '円', source: src(11) }
    },
    kintouwariStandard: { city: D.KINTOWARI.city, pref: D.KINTOWARI.pref,
      forestNationalTax: D.KINTOWARI.forest, unit: '円', source: src(9) + ' ／ ' + src(10) },
    hikazeiLimits: {
      source: src(14),
      note: '均等割＝級地別の額×判定人数＋10万円＋（扶養等がいれば加算）。所得割は全国共通',
      kintouByKyuchi: Object.keys(D.HIKAZEI.kintou).reduce((a, k) => {
        a[k] = { perPerson: D.HIKAZEI.kintou[k][0], addition: D.HIKAZEI.kintou[k][1] }; return a;
      }, {}),
      shotoku: { perPerson: D.HIKAZEI.shotoku[0], addition: D.HIKAZEI.shotoku[1] },
      flatAddition: D.HIKAZEI.base,
      specialExemptLimit: { value: D.HIKAZEI.specialLimit,
        note: '障害者・未成年者・寡婦・ひとり親はこの合計所得金額以下で均等割・所得割とも非課税' }
    },
    prefectureSurtax: {
      source: '各都道府県の個人住民税の課税案内（47団体すべてを node test/verify-prefectures.js で突合済み）',
      verifiedAt: '2026-08-15',
      list: D.PREFECTURES.map(p => ({ pref: p.n, kintouAddition: p.add,
        shotokuRate: p.rate, taxName: p.tax || null }))
    }
  },

  /* ---------------- 所得控除 ---------------- */
  deductions: {
    spouse: { source: src(11),
      normal: D.SPOUSE_DEDUCTION.normal.map(([upTo, i, r]) => ({ selfGokeiUpTo: upTo, incomeTax: i, residentTax: r })),
      old: D.SPOUSE_DEDUCTION.old.map(([upTo, i, r]) => ({ selfGokeiUpTo: upTo, incomeTax: i, residentTax: r })) },
    spouseSpecial: { source: src(6),
      incomeTax: D.SPOUSE_SPECIAL.income.map(([upTo, v]) => ({ spouseGokeiUpTo: upTo, bySelfIncome: v })),
      residentTax: D.SPOUSE_SPECIAL.resident.map(([upTo, v]) => ({ spouseGokeiUpTo: upTo, bySelfIncome: v })) },
    dependent: { source: src(5),
      general: { incomeTax: D.DEPENDENT_DEDUCTION.general[0], residentTax: D.DEPENDENT_DEDUCTION.general[1] },
      specific: { incomeTax: D.DEPENDENT_DEDUCTION.specific[0], residentTax: D.DEPENDENT_DEDUCTION.specific[1] },
      oldOther: { incomeTax: D.DEPENDENT_DEDUCTION.oldOther[0], residentTax: D.DEPENDENT_DEDUCTION.oldOther[1] },
      oldLiving: { incomeTax: D.DEPENDENT_DEDUCTION.oldLiving[0], residentTax: D.DEPENDENT_DEDUCTION.oldLiving[1] },
      under16: { incomeTax: 0, residentTax: 0, note: '控除はないが非課税限度額の判定人数には含める' } },
    tokuteiShinzoku: { source: src(3),
      table: D.TOKUTEI_SHINZOKU.map(([upTo, i, r]) => ({ gokeiUpTo: upTo, incomeTax: i, residentTax: r })) },
    disability: { source: src(11),
      normal: { incomeTax: D.DISABILITY.normal[0], residentTax: D.DISABILITY.normal[1] },
      special: { incomeTax: D.DISABILITY.special[0], residentTax: D.DISABILITY.special[1] },
      liveTogether: { incomeTax: D.DISABILITY.liveTogether[0], residentTax: D.DISABILITY.liveTogether[1] } },
    widow: { incomeTax: D.WIDOW[0], residentTax: D.WIDOW[1], source: src(11) },
    singleParent: { incomeTax: D.SINGLE_PARENT[0], residentTax: D.SINGLE_PARENT[1], source: src(11) },
    insurance: { source: '国税庁 No.1140 生命保険料控除／No.1145 地震保険料控除／年末調整のしかた（端数は切上げ）',
      rounding: '区分ごとの控除額は1円未満切上げ',
      lifeNewIncomeTax: D.INSURANCE.lifeNewIncome, lifeOldIncomeTax: D.INSURANCE.lifeOldIncome,
      lifeNewResidentTax: D.INSURANCE.lifeNewResident, lifeOldResidentTax: D.INSURANCE.lifeOldResident,
      lifeCategoryCap: { incomeTax: D.INSURANCE.lifeCategoryCapIncome, residentTax: D.INSURANCE.lifeCategoryCapResident },
      lifeTotalCap: { incomeTax: D.INSURANCE.lifeTotalCapIncome, residentTax: D.INSURANCE.lifeTotalCapResident },
      quake: { incomeTaxMax: D.INSURANCE.quakeIncomeMax, residentTaxRate: D.INSURANCE.quakeResidentRate,
        residentTaxMax: D.INSURANCE.quakeResidentMax },
      longOldIncomeTax: D.INSURANCE.longOldIncome, longOldResidentTax: D.INSURANCE.longOldResident },
    medical: { threshold: { rateOfSouShotokuTou: 0.05, cap: 100000 }, deductionCap: 2000000,
      source: '国税庁 No.1120 医療費を支払ったとき', note: '足切りは総所得金額等の5％と10万円の小さいほう' },
    pension: { source: '国税庁 No.1600 公的年金等の課税関係',
      under65: D.PENSION_DEDUCTION.under65, over65: D.PENSION_DEDUCTION.over65,
      steps: D.PENSION_DEDUCTION.steps.map(([upTo, rate, sub]) => ({
        revenueUpTo: upTo === Infinity ? null : upTo, rate, subtraction: sub })),
      otherIncomeAdjust: D.PENSION_DEDUCTION.otherIncomeAdjust.map(([upTo, cut]) => ({
        otherGokeiUpTo: upTo === Infinity ? null : upTo, reduction: cut })) },
    jintekiSa: { source: src(15) + '（地方税法37条 調整控除に用いる人的控除の差）', value: D.JINTEKI_SA }
  },

  /* ---------------- 分離課税・退職・山林 ---------------- */
  separateTaxation: {
    source: src(36) + ' ／ ' + src(34),
    list: D.SEPARATE.map(s => ({ key: s.key, label: s.label,
      incomeTaxRate: s.it, residentTaxRate: s.rt, deductionOrder: s.order, note: s.note })),
    citySharesOfResidentTax: { general: 0.6, seireiShiteiToshi: 0.8 }
  },
  retirement: { source: src(35), value: D.RETIREMENT,
    note: '住民税は退職時に分離課税で徴収済みのため、翌年度の課税標準・非課税判定・国保の軽減判定に含めない' },
  forest: { source: '国税庁 No.1480 山林所得', value: D.FOREST,
    note: '5分5乗方式。5分の1にした額に追加の千円未満切捨てはしない' },

  /* ---------------- 国民健康保険 ---------------- */
  kokuho: {
    year: D.KOKUHO.year,
    status: 'final',
    source: src(22) + ' ／ ' + src(21) + ' ／ ' + src(24),
    reductionThresholds: {
      base: { value: D.KOKUHO.base, note: '基礎控除相当額（7割・5割・2割に共通）' },
      per5wari: { value: D.KOKUHO.per5, note: '5割軽減：被保険者等1人あたりの加算' },
      per2wari: { value: D.KOKUHO.per2, note: '2割軽減：被保険者等1人あたりの加算' },
      salaryEarnerAddition: { value: D.KOKUHO.kyuyoAdd, note: '給与所得者等の数が2人以上のとき ×（人数−1）' }
    },
    pensionDeduct65: { value: D.KOKUHO.pensionDeduct65, note: '65歳以上の公的年金等所得からさらに控除' },
    limits: { value: D.KOKUHO.limits, source: src(27), note: '賦課限度額（子ども・子育て支援納付金分3万円は令和8年度新設）' },
    previousYear: { value: D.KOKUHO.prev, note: '令和7年度の値（差分確認用）' },
    premiumRates: {
      status: 'out-of-scope',
      reason: '保険料率（所得割率・均等割額・平等割額）は市区町村ごとに異なり毎年変わるため、' +
        '本サイトは軽減割合の判定のみを行い保険料額は算出しない。' +
        '料率を収録すると全国1,741団体分の年次更新が必要になり、誤りのまま古い値が残る危険が大きい。'
    }
  },

  /* ---------------- JASSO ---------------- */
  jasso: {
    status: 'final',
    source: src(28) + ' ／ ' + src(31),
    kijunFormula: '課税標準額 × 6％ −（市町村民税の調整控除額 ＋ 調整額）×係数、100円未満切捨て',
    seireiFactor: 0.75,
    kijunScope: '学生等本人と生計維持者の支給額算定基準額の合計で判定する',
    kubun: D.JASSO.kubun.map(k => ({ id: k.id, name: k.name, from: k.lo, to: k.hi, ratio: k.ratio, note: k.note || null })),
    tashiSetai: { incomeLimit: null,
      note: '多子世帯（扶養する子3人以上）は所得制限なく授業料等減免の対象。' +
        '給付奨学金は支援区分に応じた額のため、基準額154,500円以上では0円になる', source: src(31) },
    monthlyGrant: { value: D.JASSO.monthly, source: src(30) },
    tuitionReduction: { value: D.JASSO.genmen, source: src(33) },
    assetLimit: { twoMaintainers: D.JASSO.assetTwo, oneMaintainer: D.JASSO.assetOne, source: src(28) },
    taiyoIchishu: { value: D.JASSO.taiyoIchishu, source: src(32) }
  },

  /* ---------------- 公表待ち ---------------- */
  pending: [
    { item: '令和8年分 給与所得控除後の給与等の金額の表（別表第五）',
      status: 'pending',
      reason: '国税庁の年末調整資料に掲載され、例年9〜10月公表。現在は改正内容（最低保障74万円・適用上限220万円）から構造を再現している',
      impact: '構造検証（verify-calc.js §1c）で4,000円刻みの帯・境界の連続性は確認済み。公表後に実表と突合が必要',
      action: '公表後に test/verify-calc.js §1b に実表の値を追加する' },
    { item: '令和9年度 個人住民税の各自治体の課税案内',
      status: 'provisional',
      reason: '令和8年度税制改正の住民税適用分。自治体の令和9年度課税案内は例年5〜6月公表',
      impact: 'RESIDENT_TAX[2027] を provisional としている',
      action: '公表後に provisional を外し、公式計算例と突合する' },
    { item: '令和9年度 国民健康保険の軽減判定基準額',
      status: 'pending',
      reason: '地方税法施行令の改正が例年3月末公表。令和9年度の5割・2割の加算額と賦課限度額は未公表',
      impact: '現在の収録は令和8年度の値のみ',
      action: '公表後に KOKUHO を年度別に分ける' },
    { item: '2027年度 JASSO 支援区分の基準額',
      status: 'pending',
      reason: 'JASSOの当年度案内は例年7月頃公表',
      impact: '現在の収録は2026年度の値',
      action: '公表後に JASSO.kubun を更新する' }
  ]
};

const file = path.join(__dirname, '..', 'tax-parameters.json');
fs.writeFileSync(file, JSON.stringify(J, null, 2) + '\n', 'utf8');
console.log('生成しました: tax-parameters.json（' + (JSON.stringify(J, null, 2).split('\n').length).toLocaleString() + ' 行）');
