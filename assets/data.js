/* ============================================================================
 * data.js  —  税制・社会保険・奨学金の基礎データ
 *
 * すべての数値は公的機関の公表資料に基づく（出典は SOURCES を参照）。
 * 「年分」= 所得税の年分 / 「年度」= 個人住民税・国保の年度。
 *   令和7年分（2025年）の所得  →  令和8年度（2026年度）の住民税・国保
 *   令和8年分（2026年）の所得  →  令和9年度（2027年度）の住民税・国保
 * ==========================================================================*/
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------
   * 1. 所得税（年分別）
   * ----------------------------------------------------------------*/
  var INCOME_TAX = {
    2025: {
      label: '令和7年分（2025年）',
      // 給与所得控除：最低保障額と、それが適用される収入上限
      salaryMin: 650000,
      salaryMinCap: 1900000,
      // 基礎控除（令和7年分・令和8年分の特例加算を含む）
      basic: [
        [1320000, 950000], [3360000, 880000], [4890000, 680000],
        [6550000, 630000], [23500000, 580000], [24000000, 480000],
        [24500000, 320000], [25000000, 160000], [Infinity, 0]
      ],
      dependentLimit: 580000,        // 同一生計配偶者・扶養親族の合計所得金額要件
      studentLimit: 850000,          // 勤労学生控除の合計所得金額要件
      studentDeduction: 270000,
      spouseSpecialUpper: 1330000,   // 配偶者特別控除の上限（配偶者の合計所得）
      tokuteiLower: 580000,          // 特定親族特別控除の下限
      tokuteiUpper: 1230000
    },
    2026: {
      label: '令和8年分（2026年）',
      salaryMin: 740000,             // 本則69万＋特例加算5万（令和8・9年分）
      salaryMinCap: 2200000,
      // 基礎控除：本則62万＋特例加算（489万円以下＋42万、489万超655万以下＋5万）
      basic: [
        [4890000, 1040000], [6550000, 670000], [23500000, 620000],
        [24000000, 480000], [24500000, 320000], [25000000, 160000],
        [Infinity, 0]
      ],
      dependentLimit: 620000,
      studentLimit: 890000,
      studentDeduction: 270000,
      spouseSpecialUpper: 1330000,
      tokuteiLower: 620000,
      tokuteiUpper: 1230000
    }
  };

  // 所得税の速算表（課税総所得金額の上限, 税率, 控除額）
  var INCOME_TAX_BRACKETS = [
    [1949000, 0.05, 0],
    [3299000, 0.10, 97500],
    [6949000, 0.20, 427500],
    [8999000, 0.23, 636000],
    [17999000, 0.33, 1536000],
    [39999000, 0.40, 2796000],
    [Infinity, 0.45, 4796000]
  ];
  var RECONSTRUCTION_RATE = 0.021; // 復興特別所得税（令和19年分まで）

  /* ------------------------------------------------------------------
   * 2. 個人住民税（年度別）
   * ----------------------------------------------------------------*/
  var RESIDENT_TAX = {
    2026: { // 令和8年度＝令和7年分の所得
      label: '令和8年度（2026年度）',
      incomeYear: 2025,
      salaryMin: 650000,
      salaryMinCap: 1900000,
      basic: [[24000000, 430000], [24500000, 290000], [25000000, 150000], [Infinity, 0]],
      dependentLimit: 580000,
      studentLimit: 850000,
      studentDeduction: 260000,
      spouseSpecialUpper: 1330000,
      tokuteiLower: 580000,
      tokuteiUpper: 1230000,
      provisional: false
    },
    2027: { // 令和9年度＝令和8年分の所得
      label: '令和9年度（2027年度）',
      incomeYear: 2026,
      salaryMin: 740000,
      salaryMinCap: 2200000,
      basic: [[24000000, 430000], [24500000, 290000], [25000000, 150000], [Infinity, 0]],
      dependentLimit: 620000,
      studentLimit: 890000,
      studentDeduction: 260000,
      spouseSpecialUpper: 1330000,
      tokuteiLower: 620000,
      tokuteiUpper: 1230000,
      provisional: true   // 令和8年度税制改正の住民税適用分（今後の通知等で要確認）
    }
  };

  // 均等割の標準税率（森林環境税は国税で別建て）
  var KINTOWARI = { city: 3000, pref: 1000, forest: 1000 };

  // 非課税限度額の係数
  var HIKAZEI = {
    // 均等割：級地区分別（本人＋同一生計配偶者＋扶養親族の人数に乗じる額, 扶養等がいる場合の加算額）
    kintou: { 1: [350000, 210000], 2: [315000, 189000], 3: [280000, 168000] },
    // 所得割：全国共通
    shotoku: [350000, 320000],
    base: 100000,      // 一律加算（給与所得控除等の10万円引下げに伴う調整）
    // 障害者・未成年者・寡婦・ひとり親で合計所得金額がこの額以下なら均等割・所得割とも非課税
    specialLimit: 1350000
  };

  /* ------------------------------------------------------------------
   * 3. 都道府県（道府県民税均等割の超過課税・所得割税率）
   *    ※超過課税は課税期間が定められており、延長・廃止・改称がある。
   *      画面上で編集できるようにしてあるので、必ず自治体HPで確認すること。
   *
   *    【検証状況】47団体すべてを公式ページの生HTMLと突合済み（2026-08-15）。
   *      再検証は `node test/verify-prefectures.js` で実行できる。同スクリプトが
   *      47件分の出典URLを保持しており、上乗せ額そのものと「均等割の年額
   *      （標準税率1,000円＋上乗せ）」の両面で照合する。
   *      年次保守ではこのスクリプトを流し、❌が出た県だけ調べ直せばよい。
   *
   *    【注意】令和6年度に創設された国税の「森林環境税」（年額1,000円）とは別物。
   *      県独自税で名称が「森林環境税」の団体は県名を冠して区別している。
   * ----------------------------------------------------------------*/
  var PREFECTURES = [
    { n: '北海道', add: 0, rate: 4, tax: '' },
    { n: '青森県', add: 0, rate: 4, tax: '' },
    { n: '岩手県', add: 1000, rate: 4, tax: 'いわての森林づくり県民税' },
    { n: '宮城県', add: 1200, rate: 4, tax: 'みやぎ環境税' },
    { n: '秋田県', add: 800, rate: 4, tax: '秋田県水と緑の森づくり税' },
    { n: '山形県', add: 1000, rate: 4, tax: 'やまがた緑環境税' },
    { n: '福島県', add: 1000, rate: 4, tax: '福島県森林環境税' },
    { n: '茨城県', add: 1000, rate: 4, tax: '森林湖沼環境税' },
    { n: '栃木県', add: 700, rate: 4, tax: 'とちぎの元気な森づくり県民税' },
    { n: '群馬県', add: 700, rate: 4, tax: 'ぐんま緑の県民税' },
    { n: '埼玉県', add: 0, rate: 4, tax: '' },
    { n: '千葉県', add: 0, rate: 4, tax: '' },
    { n: '東京都', add: 0, rate: 4, tax: '' },
    { n: '神奈川県', add: 300, rate: 4.025, tax: '水源環境保全税（所得割も＋0.025％／令和8年度まで）' },
    { n: '新潟県', add: 0, rate: 4, tax: '' },
    { n: '富山県', add: 500, rate: 4, tax: '水と緑の森づくり税' },
    { n: '石川県', add: 500, rate: 4, tax: 'いしかわ森林環境税' },
    { n: '福井県', add: 0, rate: 4, tax: '' },
    { n: '山梨県', add: 500, rate: 4, tax: '山梨県森林環境税' },
    { n: '長野県', add: 500, rate: 4, tax: '長野県森林づくり県民税' },
    { n: '岐阜県', add: 1000, rate: 4, tax: '清流の国ぎふ森林・環境税' },
    { n: '静岡県', add: 400, rate: 4, tax: '森林づくり県民税' },
    { n: '愛知県', add: 500, rate: 4, tax: 'あいち森と緑づくり税' },
    { n: '三重県', add: 1000, rate: 4, tax: 'みえ森と緑の県民税' },
    { n: '滋賀県', add: 800, rate: 4, tax: '琵琶湖森林づくり県民税' },
    { n: '京都府', add: 600, rate: 4, tax: '豊かな森を育てる府民税' },
    { n: '大阪府', add: 300, rate: 4, tax: '大阪府森林環境税' },
    { n: '兵庫県', add: 800, rate: 4, tax: '県民緑税（令和12年度まで延長）' },
    { n: '奈良県', add: 500, rate: 4, tax: '奈良県森林環境税' },
    { n: '和歌山県', add: 500, rate: 4, tax: '紀の国森づくり税' },
    { n: '鳥取県', add: 500, rate: 4, tax: '豊かな森づくり協働税（令和5年度に森林環境保全税から改組）' },
    { n: '島根県', add: 500, rate: 4, tax: '水と緑の森づくり税' },
    { n: '岡山県', add: 500, rate: 4, tax: 'おかやま森づくり県民税' },
    { n: '広島県', add: 500, rate: 4, tax: 'ひろしまの森づくり県民税' },
    { n: '山口県', add: 500, rate: 4, tax: 'やまぐち森林づくり県民税' },
    { n: '徳島県', add: 0, rate: 4, tax: '' },
    { n: '香川県', add: 0, rate: 4, tax: '' },
    { n: '愛媛県', add: 700, rate: 4, tax: '愛媛県森林環境税' },
    { n: '高知県', add: 500, rate: 4, tax: '高知県森林環境税' },
    { n: '福岡県', add: 500, rate: 4, tax: '福岡県森林環境税' },
    { n: '佐賀県', add: 500, rate: 4, tax: '佐賀県森林環境税' },
    { n: '長崎県', add: 500, rate: 4, tax: 'ながさき森林環境税' },
    { n: '熊本県', add: 500, rate: 4, tax: '水とみどりの森づくり税' },
    { n: '大分県', add: 500, rate: 4, tax: 'おおいた森づくり税' },
    { n: '宮崎県', add: 500, rate: 4, tax: '宮崎県水と緑の森林づくり税（令和8年度に森林環境税から改称・5年延長）' },
    { n: '鹿児島県', add: 500, rate: 4, tax: 'みんなの森づくり県民税' },
    { n: '沖縄県', add: 0, rate: 4, tax: '' }
  ];

  /* 市区町村の特例（政令指定都市／超過課税・減税を行っている団体）
   * seirei: 政令指定都市（市民税所得割8％・道府県民税所得割2％）
   * addKin: 市町村民税均等割の上乗せ額
   * fixKin: 市町村民税均等割を直接指定
   * fixRate: 市町村民税所得割率を直接指定
   * kyuchi: 住民税非課税限度額の級地区分の目安                                */
  var CITIES = {
    '北海道': [
      { n: '札幌市', seirei: true, kyuchi: 1 },
      { n: '夕張市', addKin: 500, fixRate: 6.5, kyuchi: 3, note: '財政再生計画に基づく超過課税' }
    ],
    '宮城県': [{ n: '仙台市', seirei: true, kyuchi: 1 }],
    '埼玉県': [{ n: 'さいたま市', seirei: true, kyuchi: 1 }],
    '千葉県': [{ n: '千葉市', seirei: true, kyuchi: 1 }],
    '東京都': [{ n: '特別区（23区）', kyuchi: 1 }],
    '神奈川県': [
      { n: '横浜市', seirei: true, addKin: 900, kyuchi: 1, note: '横浜みどり税900円（令和10年度まで）' },
      { n: '川崎市', seirei: true, kyuchi: 1 },
      { n: '相模原市', seirei: true, kyuchi: 1 }
    ],
    '新潟県': [{ n: '新潟市', seirei: true, kyuchi: 1 }],
    '静岡県': [
      { n: '静岡市', seirei: true, kyuchi: 1 },
      { n: '浜松市', seirei: true, kyuchi: 1 }
    ],
    '愛知県': [
      { n: '名古屋市', seirei: true, fixKin: 2800, fixRate: 7.7, kyuchi: 1, note: '市民税5％減税（均等割2,800円・所得割7.7％）' }
    ],
    '京都府': [{ n: '京都市', seirei: true, kyuchi: 1 }],
    '大阪府': [
      { n: '大阪市', seirei: true, kyuchi: 1 },
      { n: '堺市', seirei: true, kyuchi: 1 }
    ],
    '兵庫県': [
      { n: '神戸市', seirei: true, addKin: 400, kyuchi: 1, note: '認知症「神戸モデル」400円' },
      { n: '豊岡市', fixRate: 6.1, kyuchi: 2, note: '都市計画税に代わる超過課税' }
    ],
    '岡山県': [{ n: '岡山市', seirei: true, kyuchi: 1 }],
    '広島県': [{ n: '広島市', seirei: true, kyuchi: 1 }],
    '福岡県': [
      { n: '福岡市', seirei: true, kyuchi: 1 },
      { n: '北九州市', seirei: true, kyuchi: 1 }
    ],
    '熊本県': [{ n: '熊本市', seirei: true, kyuchi: 1 }]
  };

  /* ------------------------------------------------------------------
   * 4. 所得控除の各種テーブル
   * ----------------------------------------------------------------*/
  // 配偶者控除（本人の合計所得金額区分ごと）[所得税, 住民税]
  var SPOUSE_DEDUCTION = {
    normal: [[9000000, 380000, 330000], [9500000, 260000, 220000], [10000000, 130000, 110000]],
    old: [[9000000, 480000, 380000], [9500000, 320000, 260000], [10000000, 160000, 130000]]
  };

  // 配偶者特別控除（配偶者の合計所得金額の上限, [本人900万以下, 950万以下, 1000万以下]）
  // ※所得要件は年分により下限が変わるため、calc 側で下限を判定する
  var SPOUSE_SPECIAL = {
    // 令和7年分ベース（配偶者の合計所得 58万円超133万円以下）
    income: [
      [950000, [380000, 260000, 130000]],
      [1000000, [360000, 240000, 120000]],
      [1050000, [310000, 210000, 110000]],
      [1100000, [260000, 180000, 90000]],
      [1150000, [210000, 140000, 70000]],
      [1200000, [160000, 110000, 60000]],
      [1250000, [110000, 80000, 40000]],
      [1300000, [60000, 40000, 20000]],
      [1330000, [30000, 20000, 10000]]
    ],
    resident: [
      [950000, [330000, 220000, 110000]],
      [1000000, [330000, 220000, 110000]],
      [1050000, [310000, 210000, 110000]],
      [1100000, [260000, 180000, 90000]],
      [1150000, [210000, 140000, 70000]],
      [1200000, [160000, 110000, 60000]],
      [1250000, [110000, 80000, 40000]],
      [1300000, [60000, 40000, 20000]],
      [1330000, [30000, 20000, 10000]]
    ]
  };

  // 扶養控除 [所得税, 住民税]
  var DEPENDENT_DEDUCTION = {
    general: [380000, 330000],      // 一般（16歳以上18歳以下・23歳以上69歳以下）
    specific: [630000, 450000],     // 特定扶養親族（19歳以上23歳未満）
    oldOther: [480000, 380000],     // 老人扶養親族（同居老親等以外）
    oldLiving: [580000, 450000]     // 同居老親等
  };

  // 特定親族特別控除（特定親族の合計所得金額の上限, 所得税, 住民税）
  var TOKUTEI_SHINZOKU = [
    [850000, 630000, 450000],
    [900000, 610000, 450000],
    [950000, 510000, 450000],
    [1000000, 410000, 410000],
    [1050000, 310000, 310000],
    [1100000, 210000, 210000],
    [1150000, 110000, 110000],
    [1200000, 60000, 60000],
    [1230000, 30000, 30000]
  ];

  // 障害者控除 [所得税, 住民税]
  var DISABILITY = { normal: [270000, 260000], special: [400000, 300000], liveTogether: [750000, 530000] };
  // 寡婦・ひとり親・勤労学生 [所得税, 住民税]
  var WIDOW = [270000, 260000];
  var SINGLE_PARENT = [350000, 300000];

  /* ------------------------------------------------------------------
   * 5. 調整控除に用いる人的控除の差
   * ----------------------------------------------------------------*/
  var JINTEKI_SA = {
    // 基礎控除：令和7年度税制改正後も従前どおり据置き
    basic: [[24000000, 50000], [24500000, 30000], [25000000, 10000], [Infinity, 0]],
    spouseNormal: [50000, 40000, 20000],   // 本人 900万以下 / 950万以下 / 1000万以下
    spouseOld: [100000, 60000, 30000],
    // 配偶者特別控除：配偶者の合計所得 58万超95万以下 / 95万超100万以下 / それ超
    spouseSpecial: [[950000, [50000, 40000, 20000]], [1000000, [30000, 20000, 10000]], [Infinity, [0, 0, 0]]],
    dependentGeneral: 50000,
    dependentSpecific: 180000,
    dependentOldOther: 100000,
    dependentOldLiving: 130000,
    disabilityNormal: 10000,
    disabilitySpecial: 100000,
    disabilityLiveTogether: 220000,
    widow: 10000,
    singleParentMother: 50000,
    singleParentFather: 10000,
    student: 10000,
    // 特定親族特別控除（特定親族の合計所得金額の上限, 差額）
    tokutei: [[850000, 180000], [900000, 160000], [950000, 60000], [Infinity, 0]]
  };

  /* ------------------------------------------------------------------
   * 6. 生命保険料控除・地震保険料控除
   * ----------------------------------------------------------------*/
  var INSURANCE = {
    lifeNewIncome: { steps: [[20000, 1, 0], [40000, 0.5, 10000], [80000, 0.25, 20000]], max: 40000 },
    lifeOldIncome: { steps: [[25000, 1, 0], [50000, 0.5, 12500], [100000, 0.25, 25000]], max: 50000 },
    lifeNewResident: { steps: [[12000, 1, 0], [32000, 0.5, 6000], [56000, 0.25, 14000]], max: 28000 },
    lifeOldResident: { steps: [[15000, 1, 0], [40000, 0.5, 7500], [70000, 0.25, 17500]], max: 35000 },
    lifeCategoryCapIncome: 40000,   // 新旧併用時の各区分の上限（所得税）
    lifeCategoryCapResident: 28000,
    lifeTotalCapIncome: 120000,
    lifeTotalCapResident: 70000,
    quakeIncomeMax: 50000,
    quakeResidentRate: 0.5,
    quakeResidentMax: 25000,
    longOldIncome: { steps: [[10000, 1, 0], [20000, 0.5, 5000]], max: 15000 },
    longOldResident: { steps: [[5000, 1, 0], [15000, 0.5, 2500]], max: 10000 }
  };

  /* ------------------------------------------------------------------
   * 7. 公的年金等控除（令和2年分以降・令和8年分も改正なし）
   *    [収入の上限, 率, 控除額]／最低保障額は別枠
   * ----------------------------------------------------------------*/
  var PENSION_DEDUCTION = {
    under65: { min: 600000, minCap: 1300000 },
    over65: { min: 1100000, minCap: 3300000 },
    steps: [
      [4100000, 0.25, 275000],
      [7700000, 0.15, 685000],
      [10000000, 0.05, 1455000],
      [Infinity, 0, 1955000]
    ],
    // 公的年金等以外の合計所得金額による控除額の減額
    otherIncomeAdjust: [[10000000, 0], [20000000, 100000], [Infinity, 200000]]
  };

  /* ------------------------------------------------------------------
   * 8. 国民健康保険料（税）— 令和8年度
   * ----------------------------------------------------------------*/
  var KOKUHO = {
    year: '令和8年度（2026年度）',
    base: 430000,          // 基礎控除相当額
    kyuyoAdd: 100000,      // 給与所得者等の数が2人以上の場合の加算（×(人数−1)）
    per5: 310000,          // 5割軽減：被保険者等1人あたり（令和8年度：30.5万円→31万円）
    per2: 570000,          // 2割軽減：被保険者等1人あたり（令和8年度：56万円→57万円）
    pensionDeduct65: 150000, // 65歳以上の公的年金所得から控除する15万円
    limits: { medical: 670000, support: 260000, care: 170000, child: 30000, total: 1130000 },
    prev: { per5: 305000, per2: 560000, total: 1090000 } // 令和7年度
  };

  /* ------------------------------------------------------------------
   * 9. JASSO 給付奨学金・授業料等減免（高等教育の修学支援新制度）
   * ----------------------------------------------------------------*/
  var JASSO = {
    // 支給額算定基準額の区分（下限以上・上限未満）
    kubun: [
      { id: 1, name: '第Ⅰ区分', lo: 0, hi: 100, ratio: '満額（10分の10）',
        note: '市町村民税所得割が非課税であれば必ずこの区分になります。' },
      { id: 2, name: '第Ⅱ区分', lo: 100, hi: 25600, ratio: '3分の2' },
      { id: 3, name: '第Ⅲ区分', lo: 25600, hi: 51300, ratio: '3分の1' },
      { id: 4, name: '第Ⅳ区分', lo: 51300, hi: 154500, ratio: '4分の1',
        note: '多子世帯（扶養する子3人以上）または私立の理工農系学科等の学生のみが対象です。' +
          '<b>私立理工農系（多子世帯でない場合）は給付奨学金は0円で、授業料等減免のみ</b>（文系との授業料の差額に着目した額）になります。' }
    ],
    // 給付奨学金の月額（第Ⅰ区分・自宅／自宅外）
    monthly: {
      '大学・短期大学・専修学校（専門課程）': { 国公立: [29200, 66700], 私立: [38300, 75800] },
      '高等専門学校': { 国公立: [17500, 34200], 私立: [26700, 43300] }
    },
    // 授業料等減免の上限額（年額・第Ⅰ区分／多子世帯）
    genmen: {
      '大学': { 国公立: [282000, 535800], 私立: [260000, 700000] },
      '短期大学': { 国公立: [169200, 390000], 私立: [250000, 620000] },
      '高等専門学校': { 国公立: [84600, 234600], 私立: [130000, 700000] },
      '専門学校': { 国公立: [70000, 170000], 私立: [160000, 590000] }
    },
    // 資産基準
    assetTwo: 50000000,
    assetOne: 35000000,
    // 貸与型（第一種）の家計基準
    taiyoIchishu: 189400
  };

  /* ------------------------------------------------------------------
   * 10. 分離課税
   *   key            : 内部キー
   *   label          : 表示名
   *   it             : 所得税の税率
   *   rt             : 住民税（所得割）の税率。市町村分と道府県分の内訳は
   *                    一般市町村 3:2、政令指定都市 4:1 の比で按分する
   *   order          : 所得控除を引き切れなかったときに控除する順序
   * ----------------------------------------------------------------*/
  var SEPARATE = [
    { key: 'landShort', label: '土地建物等の短期譲渡所得', it: 0.30, rt: 0.09, order: 1,
      note: '所有期間5年以下。所得税30％＋住民税9％（復興特別所得税を含め39.63％）' },
    { key: 'landLong', label: '土地建物等の長期譲渡所得', it: 0.15, rt: 0.05, order: 2,
      note: '所有期間5年超。所得税15％＋住民税5％（復興特別所得税を含め20.315％）' },
    { key: 'stockTransfer', label: '株式等に係る譲渡所得等', it: 0.15, rt: 0.05, order: 3,
      note: '上場株式等・一般株式等。所得税15％＋住民税5％（復興特別所得税を含め20.315％）' },
    { key: 'stockDividend', label: '上場株式等に係る配当所得等', it: 0.15, rt: 0.05, order: 4,
      note: '申告分離課税を選択したもの。譲渡損失と損益通算できる' },
    { key: 'futures', label: '先物取引に係る雑所得等', it: 0.15, rt: 0.05, order: 5,
      note: '先物・FX・CFDなど。所得税15％＋住民税5％' }
  ];

  // 退職所得（所得税のみ。住民税は退職時に分離課税で徴収済みのため翌年度の課税標準に含まれない）
  var RETIREMENT = { perYearUnder20: 400000, min: 800000, base20: 8000000, perYearOver20: 700000,
    disabilityAdd: 1000000, shortTermThreshold: 3000000 };

  // 山林所得（5分5乗方式・特別控除50万円）
  var FOREST = { specialDeduction: 500000, divisor: 5 };

  /* ------------------------------------------------------------------
   * 12. 一時所得・総合課税の譲渡所得
   *   一時所得   … 収入 − 経費 − 特別控除50万円。総所得への算入は「2分の1」
   *   総合譲渡   … 短期は全額、長期は「2分の1」を総所得に算入。
   *                 特別控除50万円は短期・長期あわせて50万円で、短期から先に引く
   * ----------------------------------------------------------------*/
  var TEMPORARY = { specialDeduction: 500000, halve: true };
  var TRANSFER_GENERAL = { specialDeduction: 500000, longHalve: true };

  /* ------------------------------------------------------------------
   * 13. 配当控除（税額控除）
   *   課税総所得金額等が1,000万円以下の部分と超える部分で率が変わる。
   *   ここで扱うのは「剰余金の配当等」（株式の配当）。
   *   証券投資信託の収益の分配は率が半分になるが、本サイトでは扱わない。
   *   出典：所得税法92条／地方税法37条の3・314条の9
   * ----------------------------------------------------------------*/
  var DIVIDEND_CREDIT = {
    threshold: 10000000,
    income: { under: 0.10, over: 0.05 },      // 所得税
    resident: { under: 0.028, over: 0.014 },  // 住民税（市町村1.6%＋道府県1.2%／0.8%＋0.6%）
    residentCityShare: { under: 1.6 / 2.8, over: 0.8 / 1.4 }
  };

  /* ------------------------------------------------------------------
   * 14. 寄附金控除
   *   所得税 … 所得控除。（寄附金と総所得金額等の40%の小さいほう）− 2,000円
   *   住民税 … 税額控除。
   *     基本控除   （寄附金と総所得金額等の30%の小さいほう − 2,000円）× 10%
   *     特例控除   ふるさと納税（都道府県・市区町村への寄附）のみ。
   *                （ふるさと納税額 − 2,000円）×（90% − 所得税の限界税率 × 1.021）
   *                所得割額（調整控除後）の20%が上限
   *   出典：所得税法78条／地方税法37条の2・314条の7・附則5条の5
   * ----------------------------------------------------------------*/
  var DONATION = {
    minimum: 2000,
    incomeLimitRate: 0.4,       // 所得税：総所得金額等の40%
    residentLimitRate: 0.3,     // 住民税：総所得金額等の30%
    basicRate: 0.1,             // 住民税の基本控除10%（市町村6%＋道府県4%）
    basicCityShare: 0.6,
    specialBase: 0.9,           // 特例控除の 90% −（所得税の限界税率×1.021）
    reconstruction: 1.021,
    specialCapRate: 0.2         // 特例控除は所得割額の20%が上限
  };

  /* ------------------------------------------------------------------
   * 11. 出典
   * ----------------------------------------------------------------*/
  /* ------------------------------------------------------------------
   * 収録データの鮮度
   *   VERIFIED_AT … 最後に一次資料と突き合わせた日
   *   NEXT_REVIEW … 次に確認すべき日（この日を過ぎたら画面に注意を出す）
   * 税制は毎年変わるので、古いまま気づかず使われるのが一番こわい。
   * 画面にこの日付を出し、期限を過ぎたら警告する。
   *
   * VERIFIED_AT は GitHub Actions（.github/workflows/check-updates.yml）が
   * 毎月18日に公表資料と突き合わせ、全件一致したときだけ自動で進める。
   * ズレが見つかった回は進めないので、予定日を過ぎて画面に注意が出る。
   * 手で直すときは node test/set-verified-at.js を使うこと
   * （日付の妥当性を確かめ、tax-parameters.json の作り直しも案内する）。
   * ----------------------------------------------------------------*/
  var VERIFIED_AT = '2026-09-17';
  var REVIEW_DAY = 18;              // 毎月この日に自動チェックが走る

  /* 次回の確認予定日は VERIFIED_AT から自動で出す。
   * 直書きにすると VERIFIED_AT だけ更新して次回日を直し忘れ、
   * 「最終確認は新しいのに期限切れ表示のまま」になるため。
   *
   * 「最終確認日の1か月後」ではなく「次にチェックが走る日」を出す。
   * 1か月後にすると、確認が17日に行われた月は予定日が17日になり、
   * 18日のチェックが走るまでの半日だけ期限切れ表示が出てしまう。
   * ローカル時刻で組み立てる（toISOString だと時差で1日ずれる）。 */
  var NEXT_REVIEW = (function () {
    var p = VERIFIED_AT.split('-');
    var y = Number(p[0]), m = Number(p[1]) - 1, day = Number(p[2]);
    /* 最終確認日より後にくる、最初の「毎月18日」。
     * 18日ちょうどに確認できた月は、翌月18日が次回になる。 */
    var d = new Date(y, day >= REVIEW_DAY ? m + 1 : m, REVIEW_DAY);
    var two = function (v) { return (v < 10 ? '0' : '') + v; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  })();

  var SOURCES = [
    { c: '所得税', t: '国税庁 No.1199 基礎控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm' },
    { c: '所得税', t: '国税庁 No.1410 給与所得控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm' },
    { c: '所得税', t: '国税庁 No.2260 所得税の税率', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm' },
    { c: '所得税', t: '国税庁 No.1177 特定親族特別控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm' },
    { c: '所得税', t: '国税庁 No.1175 勤労学生控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1175.htm' },
    { c: '所得税', t: '国税庁 No.1180 扶養控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm' },
    { c: '所得税', t: '国税庁 令和7年度税制改正による所得税の基礎控除の見直し等について', u: 'https://www.nta.go.jp/users/gensen/2025kiso/index.htm' },
    { c: '所得税', t: '財務省 令和8年度 税制改正（国税）等について', u: 'https://www.mof.go.jp/public_relations/finance/202604/202604c.html' },
    { c: '所得税', t: '国税庁 令和8年分 源泉徴収税額表', u: 'https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm' },
    { c: '住民税', t: '総務省 地方税制度 個人住民税', u: 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/150790_06.html' },
    { c: '住民税', t: '総務省 森林環境税及び森林環境譲与税', u: 'https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/04000067.html' },
    { c: '住民税', t: '長野市 令和8年度課税の個人市民税・県民税 控除の種類', u: 'https://www.city.nagano.nagano.jp/n062000/contents/p005567.html' },
    { c: '住民税', t: '千葉市 令和8年度から適用される個人市・県民税の主な改正点', u: 'https://www.city.chiba.jp/zaiseikyoku/zeimu/kazeikanri/zeiseikaiseijuminzei2026.html' },
    { c: '住民税', t: '洲本市 個人市県民税の税額控除（令和8年度課税以降適用）', u: 'https://www.city.sumoto.lg.jp/soshiki/5/11338.html' },
    { c: '住民税', t: '柏市 令和8年度以降、個人住民税がかからないかた（非課税）', u: 'https://www.city.kashiwa.lg.jp/shiminzei/kojinshiminzei/r8hikazei.html' },
    { c: '住民税', t: '坂戸市 個人住民税所得割の調整措置', u: 'https://www.city.sakado.lg.jp/soshiki/13/22493.html' },
    { c: '住民税', t: '横浜市 令和8年度市民税・県民税・森林環境税の計算（例）', u: 'https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/kojinkeisan.html' },
    { c: '住民税', t: '名古屋市 市民税・県民税の計算例', u: 'https://www.city.nagoya.jp/kurashi/zeikin/1037356/1011880/1011883/1011891.html' },
    { c: '住民税', t: '神奈川県 水源環境を保全・再生するための個人県民税の超過課税', u: 'https://www.pref.kanagawa.jp/zei/kenzei/a001/b001/002.html' },
    { c: '国保', t: '厚生労働省 国民健康保険制度の概要（被用者保険等の適用者以外を被保険者とする）', u: 'https://www.mhlw.go.jp/content/000951286.pdf' },
    { c: '国保', t: '横浜市 被保険者について（誰が国保に加入するか＝一人ひとりの保険で決まる）', u: 'https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/kokuho/hokensho/hihokensha.html' },
    { c: '国保', t: '新潟市 令和8年度の国民健康保険料率と軽減判定所得について', u: 'https://www.city.niigata.lg.jp/kurashi/hoken/kokuho/hokenryo/henko.html' },
    { c: '国保', t: '厚生労働省 令和8年度 税制改正の概要（厚生労働省関係）', u: 'https://www.mhlw.go.jp/content/12602000/001623254.pdf' },
    { c: '国保', t: '長野市 国民健康保険料の計算・軽減・減免（軽減判定所得の作り方）', u: 'https://www.city.nagano.nagano.jp/n104500/contents/p000303.html' },
    { c: '国保', t: '松阪市 国民健康保険税の軽減（令和8年度）', u: 'https://www.city.matsusaka.mie.jp/soshiki/23/keigen.html' },
    { c: '国保', t: '長久手市 国民健康保険税の計算対象となる所得等（所得割と軽減判定の違い）', u: 'https://www.city.nagakute.lg.jp/soshiki/fukushibu/hokeniryoka/1/kokuho/huka/24743.html' },
    { c: '国保', t: '川越市 国民健康保険税の計算に用いる総所得金額等', u: 'https://www.city.kawagoe.saitama.jp/kurashi/kokuho/1002193/1002207.html' },
    { c: '国保', t: '山口市 国民健康保険料の賦課限度額・軽減判定基準額の変更', u: 'https://www.city.yamaguchi.lg.jp/soshiki/59/102500.html' },
    { c: '奨学金', t: 'JASSO 進学後（在学採用）の給付奨学金の家計基準', u: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kakei/zaigaku.html' },
    { c: '奨学金', t: 'JASSO 進学前（予約採用）の給付奨学金の家計基準', u: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kakei/yoyaku.html' },
    { c: '奨学金', t: 'JASSO 給付奨学金の支給額', u: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kingaku.html' },
    { c: '奨学金', t: 'JASSO 令和7年度からの多子世帯支援拡充に係る対応について', u: 'https://www.jasso.go.jp/shogakukin/about/kyufu/kakei/r7tashikakudai/' },
    { c: '奨学金', t: 'JASSO 大学等で受ける第一種奨学金の家計基準（在学採用）', u: 'https://www.jasso.go.jp/shogakukin/about/taiyo/taiyo_1shu/kakei/zaigaku/daigaku.html' },
    { c: '奨学金', t: '文部科学省 高等教育の修学支援新制度', u: 'https://www.mext.go.jp/a_menu/koutou/hutankeigen/' },
    { c: '分離課税', t: '国税庁 No.1474 上場株式等に係る譲渡損失の損益通算及び繰越控除', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1474.htm' },
    { c: '分離課税', t: '国税庁 No.1420 退職金を受け取ったとき（退職所得）', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1420.htm' },
    { c: '分離課税', t: '国税庁 No.1440 譲渡所得（土地や建物を譲渡したとき）', u: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1440.htm' },
    { c: '所得の区分', t: '坂戸市 合計所得金額、総所得金額、総所得金額等の違い', u: 'https://www.city.sakado.lg.jp/soshiki/13/42681.html' },
    { c: '級地', t: '級地制度（厚生労働省告示に基づく市町村別の級地区分）', u: 'https://ja.wikipedia.org/wiki/%E7%B4%9A%E5%9C%B0%E5%88%B6%E5%BA%A6' }
  ];

  var DATA = {
    INCOME_TAX: INCOME_TAX,
    INCOME_TAX_BRACKETS: INCOME_TAX_BRACKETS,
    RECONSTRUCTION_RATE: RECONSTRUCTION_RATE,
    RESIDENT_TAX: RESIDENT_TAX,
    KINTOWARI: KINTOWARI,
    HIKAZEI: HIKAZEI,
    PREFECTURES: PREFECTURES,
    CITIES: CITIES,
    SPOUSE_DEDUCTION: SPOUSE_DEDUCTION,
    SPOUSE_SPECIAL: SPOUSE_SPECIAL,
    DEPENDENT_DEDUCTION: DEPENDENT_DEDUCTION,
    TOKUTEI_SHINZOKU: TOKUTEI_SHINZOKU,
    DISABILITY: DISABILITY,
    WIDOW: WIDOW,
    SINGLE_PARENT: SINGLE_PARENT,
    JINTEKI_SA: JINTEKI_SA,
    INSURANCE: INSURANCE,
    PENSION_DEDUCTION: PENSION_DEDUCTION,
    KOKUHO: KOKUHO,
    JASSO: JASSO,
    SEPARATE: SEPARATE,
    RETIREMENT: RETIREMENT,
    FOREST: FOREST,
    TEMPORARY: TEMPORARY,
    TRANSFER_GENERAL: TRANSFER_GENERAL,
    DIVIDEND_CREDIT: DIVIDEND_CREDIT,
    DONATION: DONATION,
    SOURCES: SOURCES,
    VERIFIED_AT: VERIFIED_AT,
    REVIEW_DAY: REVIEW_DAY,
    NEXT_REVIEW: NEXT_REVIEW
  };

  root.TaxData = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
