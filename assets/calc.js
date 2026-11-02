/* ============================================================================
 * calc.js  —  所得税・住民税・国民健康保険・JASSO 支援区分の計算エンジン
 *
 * 総合課税に加えて、分離課税（土地建物等の譲渡・株式等の譲渡／配当・先物・
 * 山林・退職）と、前年から繰り越した損失の繰越控除に対応する。
 *
 *   合計所得金額   … 繰越控除を適用する「前」の金額。均等割の非課税判定・扶養判定に使う
 *   総所得金額等   … 繰越控除を適用した「後」の金額。所得割の非課税判定・課税標準に使う
 *
 * data.js に依存。ブラウザ / Node の両方で動作する。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var D = root.TaxData || (typeof require === 'function' ? require('./data.js') : null);

  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var pos = function (v) { return Math.max(0, n(v)); };
  var floorTo = function (v, unit) { return Math.floor(v / unit) * unit; };

  /* ================================================================
   * 所得の計算
   * ==============================================================*/

  /* ---------- 給与所得 ----------
   * 所得税法別表第五「給与所得控除後の給与等の金額の表」のとおりに計算する。
   * 収入が 190万円（令和8年分は220万円）を超え660万円未満の区間は、
   *   A ＝ 収入金額 ÷ 4（千円未満切捨て）
   * として A×2.8−80,000 / A×3.2−440,000 で求める。単純に率を掛けると
   * 最大で数百円ずれるため、この丸めを省略してはいけない。
   * （検証：名古屋市の公式計算例 給与収入5,505,000円 → 給与所得3,963,200円）
   */
  function salaryIncomeAmount(revenue, p) {
    var r = Math.floor(n(revenue));
    if (r <= 0) return 0;
    if (r < p.salaryMinCap) return Math.max(0, r - p.salaryMin);
    var A = Math.floor(r / 4 / 1000) * 1000;              // 4で除して千円未満切捨て
    if (r < 3600000) return A * 2.8 - 80000;
    if (r < 6600000) return A * 3.2 - 440000;
    if (r < 8500000) return Math.floor(r * 0.9) - 1100000;
    return r - 1950000;
  }
  /* 表示用の給与所得控除額（収入 − 給与所得） */
  function salaryDeduction(revenue, p) {
    var r = Math.floor(n(revenue));
    if (r <= 0) return 0;
    return r - salaryIncomeAmount(r, p);
  }

  /* ---------- 公的年金等控除 ---------- */
  function pensionDeduction(income, over65, otherIncome) {
    income = n(income);
    if (income <= 0) return 0;
    var P = D.PENSION_DEDUCTION;
    var band = over65 ? P.over65 : P.under65;
    var cut = 0, i;
    for (i = 0; i < P.otherIncomeAdjust.length; i++) {
      if (n(otherIncome) <= P.otherIncomeAdjust[i][0]) { cut = P.otherIncomeAdjust[i][1]; break; }
    }
    var ded;
    if (income <= band.minCap) {
      ded = band.min;
    } else {
      ded = P.steps[P.steps.length - 1][2];
      for (i = 0; i < P.steps.length; i++) {
        if (income <= P.steps[i][0]) { ded = income * P.steps[i][1] + P.steps[i][2]; break; }
      }
    }
    return Math.min(Math.max(0, ded - cut), income);
  }

  /* ---------- 退職所得 ---------- */
  function retirementIncome(inc) {
    var R = D.RETIREMENT;
    var revenue = pos(inc.retirementRevenue);
    if (revenue <= 0) return { revenue: 0, deduction: 0, income: 0, halved: false };
    var years = Math.max(1, Math.ceil(n(inc.retirementYears)));
    var ded = years <= 20 ? Math.max(R.min, R.perYearUnder20 * years)
      : R.base20 + R.perYearOver20 * (years - 20);
    if (inc.retirementDisability) ded += R.disabilityAdd;
    var over = Math.max(0, revenue - ded);
    var income, halved = true;
    if (inc.retirementOfficer && years <= 5) {
      income = over; halved = false;                       // 特定役員退職手当等：2分の1課税なし
    } else if (inc.retirementShort && years <= 5) {
      // 短期退職手当等：控除後の額のうち300万円超の部分は2分の1課税なし
      income = over <= R.shortTermThreshold ? over / 2
        : R.shortTermThreshold / 2 + (over - R.shortTermThreshold);
      halved = over <= R.shortTermThreshold;
    } else {
      income = over / 2;
    }
    return { revenue: revenue, deduction: ded, years: years, income: Math.floor(income), halved: halved };
  }

  /* ---------- 各種所得の集計と繰越控除 ---------- */
  function calcIncome(input, p, mode) {
    var inc = input.income, f = input.family, co = input.carryover || {};

    /* --- 総合課税 --- */
    var salaryRev = pos(inc.salary);
    var salary = salaryIncomeAmount(salaryRev, p);
    var salDed = salaryRev - salary;

    var otherForPension = salary + pos(inc.business) + pos(inc.realEstate) + pos(inc.otherIncome);
    var penDed = pensionDeduction(inc.pension, !!inc.pensionAge65, otherForPension);
    /* 速算表の「収入×割合−控除額」は1円未満の端数が出る（例：収入1,300,002円 →
     * 700,001.5円）。所得金額は円単位なので切り捨てる。小数のまま持つと
     * 合計所得金額が非課税限度額とちょうど並んだときに判定が反転してしまう。 */
    var pension = Math.floor(Math.max(0, pos(inc.pension) - penDed));

    // 所得金額調整控除（子ども・特別障害者等を有する者等）※1円未満は切上げ
    var adj1 = 0;
    if (salaryRev > 8500000 && (f.under23Dependent || f.selfDisability === 'special' || f.specialDisabilityFamily)) {
      adj1 = Math.ceil((Math.min(salaryRev, 10000000) - 8500000) * 0.1);
    }
    var salary1 = Math.max(0, salary - adj1);
    // 所得金額調整控除（給与所得と年金所得の双方を有する者）
    var adj2 = 0;
    if (salary1 > 0 && pension > 0) {
      adj2 = Math.max(0, Math.min(salary1, 100000) + Math.min(pension, 100000) - 100000);
    }
    var salaryFinal = Math.max(0, salary1 - adj2);

    /* --- 利子所得（総合課税）---
     * 源泉分離課税で申告不要のものは入力しない。国外の預金利子など申告するものだけ。
     * 特定公社債等の利子で申告分離を選んだものは「上場株式等に係る配当所得等」に入れる
     * （そちらは上場株式等の譲渡損失と損益通算できるため、区別が必要）。 */
    var interest = pos(inc.interest);

    /* --- 配当所得（総合課税）＝ 収入金額 − 元本取得のための負債利子 --- */
    var dividendGeneral = Math.max(0, pos(inc.dividendGeneral) - pos(inc.dividendDebt));

    /* --- 一時所得 ---
     * （収入 − 経費 − 特別控除50万円）の「2分の1」を総所得金額に算入する。
     * 1/2を忘れると所得が2倍になるため、ここで確実に行う。 */
    var temporaryRaw = Math.max(0,
      pos(inc.temporaryRevenue) - pos(inc.temporaryExpense) - D.TEMPORARY.specialDeduction);
    var temporaryIncluded = Math.floor(temporaryRaw / 2);

    /* --- 総合課税の譲渡所得（車・ゴルフ会員権など）---
     * 特別控除50万円は短期・長期あわせて50万円。短期から先に引く。
     * 総所得金額への算入は、短期は全額・長期は2分の1。 */
    var tShortRaw = Math.max(0, pos(inc.transferShortRevenue) - pos(inc.transferShortExpense));
    var tLongRaw = Math.max(0, pos(inc.transferLongRevenue) - pos(inc.transferLongExpense));
    var spLeft = D.TRANSFER_GENERAL.specialDeduction;
    var uShort = Math.min(spLeft, tShortRaw); spLeft -= uShort;
    var uLong = Math.min(spLeft, tLongRaw);
    var transferShort = tShortRaw - uShort;
    var transferLong = tLongRaw - uLong;
    var transferIncluded = transferShort + Math.floor(transferLong / 2);

    var sougou = salaryFinal + pension + pos(inc.business) + pos(inc.realEstate) + pos(inc.otherIncome)
      + interest + dividendGeneral + temporaryIncluded + transferIncluded;

    /* --- 分離課税（繰越控除前） --- */
    var sepBefore = {};
    D.SEPARATE.forEach(function (s) { sepBefore[s.key] = pos(inc[s.key]); });

    /* --- 山林所得 --- */
    var forestBefore = Math.max(0, pos(inc.forestRevenue) - pos(inc.forestExpense) - D.FOREST.specialDeduction);

    /* --- 退職所得（住民税は退職時に分離課税で徴収済みのため翌年度には含めない） --- */
    var ret = retirementIncome(inc);
    var retBefore = mode === 'resident' ? 0 : ret.income;

    /* --- 合計所得金額（繰越控除「前」） --- */
    var sepSumBefore = 0;
    D.SEPARATE.forEach(function (s) { sepSumBefore += sepBefore[s.key]; });
    var gokei = sougou + sepSumBefore + forestBefore + retBefore;

    /* --- 繰越控除① 上場株式等に係る譲渡損失（3年間） --- */
    var sep = {};
    D.SEPARATE.forEach(function (s) { sep[s.key] = sepBefore[s.key]; });
    var stockCarry = pos(co.stockLoss), stockUsed = 0, u;
    ['stockTransfer', 'stockDividend'].forEach(function (k) {
      u = Math.min(stockCarry, sep[k]); sep[k] -= u; stockCarry -= u; stockUsed += u;
    });

    /* --- 繰越控除② 純損失・雑損失（総所得 → 分離 → 山林 → 退職の順） --- */
    var lossCarry = pos(co.netLoss) + pos(co.casualtyLoss), lossUsed = 0;
    var sougouAfter = sougou, forestAfter = forestBefore, retAfter = retBefore;
    u = Math.min(lossCarry, sougouAfter); sougouAfter -= u; lossCarry -= u; lossUsed += u;
    D.SEPARATE.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (s) {
      u = Math.min(lossCarry, sep[s.key]); sep[s.key] -= u; lossCarry -= u; lossUsed += u;
    });
    u = Math.min(lossCarry, forestAfter); forestAfter -= u; lossCarry -= u; lossUsed += u;
    u = Math.min(lossCarry, retAfter); retAfter -= u; lossCarry -= u; lossUsed += u;

    var sepSumAfter = 0;
    D.SEPARATE.forEach(function (s) { sepSumAfter += sep[s.key]; });
    var souShotokuTou = sougouAfter + sepSumAfter + forestAfter + retAfter;

    return {
      salaryRevenue: salaryRev, salaryDeduction: salDed, salaryIncomeRaw: salary,
      adjust1: adj1, adjust2: adj2, salaryIncome: salaryFinal,
      pensionRevenue: pos(inc.pension), pensionDeduction: penDed, pensionIncome: pension,
      business: pos(inc.business), realEstate: pos(inc.realEstate), other: pos(inc.otherIncome),
      interest: interest, dividendGeneral: dividendGeneral,
      temporaryRaw: temporaryRaw, temporaryIncluded: temporaryIncluded,
      transferShort: transferShort, transferLong: transferLong, transferIncluded: transferIncluded,
      sougouBefore: sougou, sougou: sougouAfter,
      sepBefore: sepBefore, sep: sep, sepSumBefore: sepSumBefore, sepSum: sepSumAfter,
      forestBefore: forestBefore, forest: forestAfter,
      retirement: ret, retirementIncome: retAfter, retirementBefore: retBefore,
      carryStockUsed: stockUsed, carryStockRemain: stockCarry,
      carryLossUsed: lossUsed, carryLossRemain: lossCarry,
      carryTotal: stockUsed + lossUsed,
      gokei: gokei,                 // 合計所得金額（繰越控除前）
      souShotokuTou: souShotokuTou  // 総所得金額等（繰越控除後）
    };
  }

  /* ================================================================
   * 所得控除
   * ==============================================================*/
  /* 生命保険料控除・地震保険料控除の区分ごとの控除額。
   * 「算出した金額に1円未満の端数があるときは、その端数を切り上げる」
   * （国税庁「年末調整のしかた」）。切り捨てると1円ずつ過少になる。 */
  function steps(amount, tbl) {
    amount = n(amount);
    if (amount <= 0) return 0;
    for (var i = 0; i < tbl.steps.length; i++) {
      if (amount <= tbl.steps[i][0]) return Math.ceil(amount * tbl.steps[i][1] + tbl.steps[i][2]);
    }
    return tbl.max;
  }
  function lifeCategory(newAmt, oldAmt, mode) {
    var I = D.INSURANCE;
    var nv = steps(newAmt, mode === 'income' ? I.lifeNewIncome : I.lifeNewResident);
    var ov = steps(oldAmt, mode === 'income' ? I.lifeOldIncome : I.lifeOldResident);
    var cap = mode === 'income' ? I.lifeCategoryCapIncome : I.lifeCategoryCapResident;
    if (n(newAmt) > 0 && n(oldAmt) > 0) return Math.max(ov, Math.min(nv + ov, cap));
    if (n(oldAmt) > 0) return ov;
    return nv;
  }
  function lifeInsurance(ded, mode) {
    var I = D.INSURANCE;
    var total = lifeCategory(ded.lifeNewGeneral, ded.lifeOldGeneral, mode)
      + lifeCategory(ded.lifeNewCare, 0, mode)
      + lifeCategory(ded.lifeNewPension, ded.lifeOldPension, mode);
    return Math.min(total, mode === 'income' ? I.lifeTotalCapIncome : I.lifeTotalCapResident);
  }
  function quakeInsurance(ded, mode) {
    var I = D.INSURANCE;
    if (mode === 'income') {
      return Math.min(Math.min(n(ded.quake), I.quakeIncomeMax) + steps(ded.longOld, I.longOldIncome), I.quakeIncomeMax);
    }
    // 住民税は支払保険料の2分の1（上限25,000円）。端数は所得税と同じく切上げ。
    return Math.min(Math.ceil(Math.min(n(ded.quake) * I.quakeResidentRate, I.quakeResidentMax))
      + steps(ded.longOld, I.longOldResident), I.quakeResidentMax);
  }

  function lookup(tbl, v) { for (var i = 0; i < tbl.length; i++) if (v <= tbl[i][0]) return tbl[i][1]; return 0; }
  function spouseTier(gokei) { return gokei <= 9000000 ? 0 : gokei <= 9500000 ? 1 : gokei <= 10000000 ? 2 : -1; }
  /* 特定親族特別控除は対象者ごとに適用するので配列で受け取る */
  function tokuteiIncomes(f) {
    if (f.tokuteiList && f.tokuteiList.length) return f.tokuteiList.map(pos);
    return f.tokuteiEnabled ? [pos(f.tokuteiIncome)] : [];
  }

  function calcDeductions(input, inc, p, mode) {
    var f = input.family, d = input.ded, list = [], idx = mode === 'income' ? 1 : 2;
    var push = function (name, amount, memo) {
      if (amount > 0) list.push({ name: name, amount: Math.floor(amount), memo: memo || '' });
    };

    push('社会保険料控除', pos(d.social));
    push('小規模企業共済等掛金控除', pos(d.kyosai));
    push('生命保険料控除', lifeInsurance(d, mode));
    push('地震保険料控除', quakeInsurance(d, mode));

    var med = pos(d.medical) - pos(d.medicalComp) - Math.min(inc.souShotokuTou * 0.05, 100000);
    push('医療費控除', Math.max(0, Math.min(med, 2000000)));

    /* 寄附金控除は所得税だけが「所得控除」。
     * 住民税は所得控除ではなく税額控除（基本控除＋ふるさと納税の特例控除）なので、
     * ここでは所得税のときだけ足す。住民税分は calcResidentTax で扱う。 */
    if (mode === 'income') {
      var DN = D.DONATION;
      var donation = pos(d.donationFurusato) + pos(d.donationOther);
      var donationTarget = Math.min(donation, inc.souShotokuTou * DN.incomeLimitRate);
      push('寄附金控除', Math.max(0, donationTarget - DN.minimum));
    }

    push('雑損控除', pos(d.zasson));
    push('その他の所得控除', pos(d.otherDeduction));

    var DIS = D.DISABILITY;
    if (f.selfDisability === 'normal') push('障害者控除（本人・普通）', DIS.normal[idx - 1]);
    if (f.selfDisability === 'special') push('障害者控除（本人・特別）', DIS.special[idx - 1]);
    if (pos(f.disNormal) > 0) push('障害者控除（配偶者・扶養親族／普通）', DIS.normal[idx - 1] * pos(f.disNormal), pos(f.disNormal) + '人');
    if (pos(f.disSpecial) > 0) push('障害者控除（特別障害者）', DIS.special[idx - 1] * pos(f.disSpecial), pos(f.disSpecial) + '人');
    if (pos(f.disLive) > 0) push('障害者控除（同居特別障害者）', DIS.liveTogether[idx - 1] * pos(f.disLive), pos(f.disLive) + '人');

    if (f.widow) push('寡婦控除', D.WIDOW[idx - 1]);
    if (f.singleParent === 'mother' || f.singleParent === 'father') push('ひとり親控除', D.SINGLE_PARENT[idx - 1]);
    if (f.student && inc.gokei <= p.studentLimit) push('勤労学生控除', p.studentDeduction);

    var tier = spouseTier(inc.gokei), spouseInc = pos(f.spouseIncome);
    if (f.hasSpouse && tier >= 0) {
      if (spouseInc <= p.dependentLimit) {
        var tbl = f.spouseOld ? D.SPOUSE_DEDUCTION.old : D.SPOUSE_DEDUCTION.normal;
        push(f.spouseOld ? '配偶者控除（老人）' : '配偶者控除', tbl[tier][idx]);
      } else if (spouseInc <= p.spouseSpecialUpper) {
        var st = mode === 'income' ? D.SPOUSE_SPECIAL.income : D.SPOUSE_SPECIAL.resident;
        for (var i = 0; i < st.length; i++) {
          if (spouseInc <= st[i][0]) { push('配偶者特別控除', st[i][1][tier]); break; }
        }
      }
    }

    var DD = D.DEPENDENT_DEDUCTION, j = idx - 1;
    if (pos(f.dep16_18) > 0) push('扶養控除（16〜18歳）', DD.general[j] * pos(f.dep16_18), pos(f.dep16_18) + '人');
    if (pos(f.dep19_22) > 0) push('扶養控除（特定扶養親族・19〜22歳）', DD.specific[j] * pos(f.dep19_22), pos(f.dep19_22) + '人');
    if (pos(f.dep23_69) > 0) push('扶養控除（23〜69歳）', DD.general[j] * pos(f.dep23_69), pos(f.dep23_69) + '人');
    if (pos(f.depOldOther) > 0) push('扶養控除（老人・同居老親等以外）', DD.oldOther[j] * pos(f.depOldOther), pos(f.depOldOther) + '人');
    if (pos(f.depOldLiving) > 0) push('扶養控除（同居老親等）', DD.oldLiving[j] * pos(f.depOldLiving), pos(f.depOldLiving) + '人');

    tokuteiIncomes(f).forEach(function (v, i, arr) {
      if (v <= p.tokuteiLower || v > p.tokuteiUpper) return;
      for (var k = 0; k < D.TOKUTEI_SHINZOKU.length; k++) {
        if (v <= D.TOKUTEI_SHINZOKU[k][0]) {
          push('特定親族特別控除' + (arr.length > 1 ? '（' + (i + 1) + '人目）' : ''), D.TOKUTEI_SHINZOKU[k][idx]);
          break;
        }
      }
    });

    var basic = lookup(p.basic, inc.gokei);
    push('基礎控除', basic);

    return { list: list, total: list.reduce(function (s, x) { return s + x.amount; }, 0), basic: basic };
  }

  /* ---------- 人的控除の差（調整控除用） ---------- */
  function calcJintekiSa(input, inc, p) {
    var f = input.family, J = D.JINTEKI_SA, sum = 0, list = [];
    var add = function (name, v) { if (v > 0) { sum += v; list.push({ name: name, amount: v }); } };

    add('基礎控除', lookup(J.basic, inc.gokei));
    var tier = spouseTier(inc.gokei);
    if (f.hasSpouse && tier >= 0) {
      if (pos(f.spouseIncome) <= p.dependentLimit) {
        add('配偶者控除', (f.spouseOld ? J.spouseOld : J.spouseNormal)[tier]);
      } else if (pos(f.spouseIncome) <= p.spouseSpecialUpper) {
        for (var i = 0; i < J.spouseSpecial.length; i++) {
          if (pos(f.spouseIncome) <= J.spouseSpecial[i][0]) { add('配偶者特別控除', J.spouseSpecial[i][1][tier]); break; }
        }
      }
    }
    add('扶養控除（16〜18歳）', J.dependentGeneral * pos(f.dep16_18));
    add('扶養控除（特定）', J.dependentSpecific * pos(f.dep19_22));
    add('扶養控除（23〜69歳）', J.dependentGeneral * pos(f.dep23_69));
    add('扶養控除（老人）', J.dependentOldOther * pos(f.depOldOther));
    add('扶養控除（同居老親等）', J.dependentOldLiving * pos(f.depOldLiving));
    if (f.selfDisability === 'normal') add('障害者控除（本人）', J.disabilityNormal);
    if (f.selfDisability === 'special') add('障害者控除（本人・特別）', J.disabilitySpecial);
    add('障害者控除（普通）', J.disabilityNormal * pos(f.disNormal));
    add('障害者控除（特別）', J.disabilitySpecial * pos(f.disSpecial));
    add('障害者控除（同居特別）', J.disabilityLiveTogether * pos(f.disLive));
    if (f.widow) add('寡婦控除', J.widow);
    if (f.singleParent === 'mother') add('ひとり親控除（母）', J.singleParentMother);
    if (f.singleParent === 'father') add('ひとり親控除（父）', J.singleParentFather);
    if (f.student && inc.gokei <= p.studentLimit) add('勤労学生控除', J.student);
    tokuteiIncomes(f).forEach(function (v, i, arr) {
      if (v <= p.tokuteiLower || v > p.tokuteiUpper) return;
      for (var k = 0; k < J.tokutei.length; k++) {
        if (v <= J.tokutei[k][0]) {
          add('特定親族特別控除' + (arr.length > 1 ? '（' + (i + 1) + '人目）' : ''), J.tokutei[k][1]);
          break;
        }
      }
    });
    return { total: sum, list: list };
  }

  /* ---------- 所得控除の充当（総所得 → 分離 → 山林 → 退職の順） ---------- */
  function allocate(inc, dedTotal) {
    var rest = dedTotal, used = [], take = function (label, amount) {
      var u = Math.min(rest, amount); rest -= u;
      if (u > 0) used.push({ name: label, amount: u });
      return amount - u;
    };
    var out = { sougou: take('総所得金額', inc.sougou), sep: {} };
    D.SEPARATE.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (s) {
      out.sep[s.key] = take(s.label, inc.sep[s.key]);
    });
    out.forest = take('山林所得', inc.forest);
    out.retirement = take('退職所得', inc.retirementIncome);
    out.unused = rest;
    out.used = used;
    return out;
  }

  /* ================================================================
   * 所得税
   * ==============================================================*/
  function bracketTax(taxable) {
    for (var i = 0; i < D.INCOME_TAX_BRACKETS.length; i++) {
      if (taxable <= D.INCOME_TAX_BRACKETS[i][0]) {
        return {
          tax: Math.floor(taxable * D.INCOME_TAX_BRACKETS[i][1] - D.INCOME_TAX_BRACKETS[i][2]),
          rate: D.INCOME_TAX_BRACKETS[i][1], sub: D.INCOME_TAX_BRACKETS[i][2]
        };
      }
    }
    return { tax: 0, rate: 0, sub: 0 };
  }

  function calcIncomeTax(input) {
    var p = D.INCOME_TAX[input.incomeYear];
    var inc = calcIncome(input, p, 'income');
    var ded = calcDeductions(input, inc, p, 'income');
    var al = allocate(inc, ded.total);

    var tSougou = floorTo(al.sougou, 1000);
    var b = bracketTax(tSougou);
    var parts = [{ name: '課税総所得金額', taxable: tSougou, rate: b.rate * 100, tax: b.tax, memo: '超過累進税率' }];
    var total = b.tax;

    D.SEPARATE.forEach(function (s) {
      var t = floorTo(al.sep[s.key], 1000);
      if (t <= 0) return;
      var tax = Math.floor(t * s.it);
      parts.push({ name: '課税' + s.label, taxable: t, rate: s.it * 100, tax: tax, memo: '分離課税' });
      total += tax;
    });

    var tForest = floorTo(al.forest, 1000);
    if (tForest > 0) {
      /* 山林所得は5分5乗方式（所得税法89条）。
       * 課税山林所得金額はすでに千円未満切捨て済みなので、5分の1にした額に
       * さらに千円未満切捨てを掛けてはいけない（法令にその定めはない）。 */
      var fb = bracketTax(tForest / D.FOREST.divisor);
      var fTax = fb.tax * D.FOREST.divisor;
      parts.push({ name: '課税山林所得金額', taxable: tForest, rate: fb.rate * 100, tax: fTax, memo: '5分5乗方式' });
      total += fTax;
    }
    var tRet = floorTo(al.retirement, 1000);
    if (tRet > 0) {
      var rb = bracketTax(tRet);
      parts.push({ name: '課税退職所得金額', taxable: tRet, rate: rb.rate * 100, tax: rb.tax, memo: '分離課税' });
      total += rb.tax;
    }

    /* 配当控除（総合課税を選んだ配当がある場合の税額控除）。
     * 課税総所得金額等（総合・山林・退職・分離のすべての課税所得の合計）が
     * 1,000万円を超えるかどうかで率が変わる。超える部分に対応する配当から先に低い率を当てる。 */
    var taxableAll = tSougou + tForest + tRet;
    D.SEPARATE.forEach(function (s) { taxableAll += floorTo(al.sep[s.key], 1000); });
    var divCredit = dividendCredit(inc.dividendGeneral, taxableAll, 'income');

    var base = Math.max(0, total - divCredit - pos(input.taxCredit));
    var recon = Math.floor(base * D.RECONSTRUCTION_RATE);

    return {
      params: p, income: inc, deduction: ded, allocation: al,
      taxable: tSougou, rate: b.rate, subtraction: b.sub, parts: parts,
      taxableAll: taxableAll, dividendCredit: divCredit,
      beforeCredit: total, baseTax: base, reconstruction: recon,
      total: floorTo(base + recon, 100), isTaxable: floorTo(base + recon, 100) > 0
    };
  }

  /* 配当控除の額（所得税法92条・地方税法37条の3）
   * 課税総所得金額等のうち1,000万円を超える部分に対応する配当には低い率を使う。 */
  function dividendCredit(dividend, taxableAll, mode) {
    dividend = pos(dividend);
    if (dividend <= 0) return 0;
    var C = D.DIVIDEND_CREDIT, r = mode === 'resident' ? C.resident : C.income;
    var over = Math.max(0, taxableAll - C.threshold);   // 1,000万円を超える部分
    var atOver = Math.min(dividend, over);              // そのうち配当が占める分
    var atUnder = dividend - atOver;
    return Math.floor(atUnder * r.under + atOver * r.over);
  }

  /* ================================================================
   * 個人住民税
   * ==============================================================*/
  function calcResidentTax(input) {
    var p = D.RESIDENT_TAX[input.residentYear];
    var r = input.region;
    var inc = calcIncome(input, p, 'resident');
    var ded = calcDeductions(input, inc, p, 'resident');
    var al = allocate(inc, ded.total);
    var f = input.family;

    /* --- 非課税限度額 --- */
    var depCount = pos(f.dep16_18) + pos(f.dep19_22) + pos(f.dep23_69) + pos(f.depOldOther)
      + pos(f.depOldLiving) + pos(f.depUnder16);
    var spouseCounted = (f.hasSpouse && pos(f.spouseIncome) <= p.dependentLimit) ? 1 : 0;
    var headcount = 1 + spouseCounted + depCount;
    var hasDependents = headcount >= 2;

    var H = D.HIKAZEI, kyuchi = r.kyuchi || 1, kin = H.kintou[kyuchi];
    var kintouLimit = kin[0] * headcount + H.base + (hasDependents ? kin[1] : 0);
    var shotokuLimit = H.shotoku[0] * headcount + H.base + (hasDependents ? H.shotoku[1] : 0);
    var kintouAll = {};
    [1, 2, 3].forEach(function (k) {
      kintouAll[k] = H.kintou[k][0] * headcount + H.base + (hasDependents ? H.kintou[k][1] : 0);
    });

    var specialExempt = (f.selfDisability !== 'none' || input.flags.minor || f.widow ||
      f.singleParent === 'mother' || f.singleParent === 'father') && inc.gokei <= H.specialLimit;
    var welfare = !!input.flags.welfare;
    // 均等割は「合計所得金額」（繰越控除前）、所得割は「総所得金額等」（繰越控除後）で判定する
    var kintouExempt = welfare || specialExempt || inc.gokei <= kintouLimit;
    var shotokuExempt = welfare || specialExempt || inc.souShotokuTou <= shotokuLimit;

    /* --- 課税標準額と所得割額 --- */
    var cityRate = r.cityRate / 100, prefRate = r.prefRate / 100;
    var cityShare = r.seirei ? 0.8 : 0.6, prefShare = 1 - cityShare;

    var tSougou = floorTo(al.sougou, 1000);
    var tForest = floorTo(al.forest, 1000);
    var stdBase = tSougou + tForest;                        // 総合課税＋山林（10％課税の対象）
    var cityStd = Math.floor(stdBase * cityRate);
    var prefStd = Math.floor(stdBase * prefRate);

    var sepParts = [], sepTaxable = 0, citySep = 0, prefSep = 0;
    D.SEPARATE.forEach(function (s) {
      var t = floorTo(al.sep[s.key], 1000);
      if (t <= 0) return;
      // 端数を出さないよう、合計額を先に確定させてから市町村分・道府県分に分ける
      var whole = Math.round(t * s.rt);
      var c = Math.floor(Math.round(whole * cityShare * 100) / 100);
      var pf = whole - c;
      sepParts.push({ name: s.label, taxable: t, rate: s.rt * 100, city: c, pref: pf, total: whole });
      citySep += c; prefSep += pf; sepTaxable += t;
    });
    var cityRaw = cityStd + citySep, prefRaw = prefStd + prefSep;

    /* --- 調整控除（合計課税所得金額＝課税総所得＋課税退職＋課税山林 が基礎） --- */
    var jinteki = calcJintekiSa(input, inc, p);
    var adjTarget = tSougou + tForest;
    var adjBase = 0;
    if (inc.gokei <= 25000000 && adjTarget > 0) {
      adjBase = adjTarget <= 2000000 ? Math.min(jinteki.total, adjTarget)
        : Math.max(jinteki.total - (adjTarget - 2000000), 50000);
    }
    var cityAdj = Math.floor(adjBase * (r.seirei ? 0.04 : 0.03));
    var prefAdj = Math.floor(adjBase * (r.seirei ? 0.01 : 0.02));

    var cityAfter = Math.max(0, cityRaw - cityAdj);
    var prefAfter = Math.max(0, prefRaw - prefAdj);

    /* --- 配当控除（住民税）--- */
    var taxableAllR = tSougou + tForest + sepTaxable;
    var divCreditR = dividendCredit(inc.dividendGeneral, taxableAllR, 'resident');
    var DC = D.DIVIDEND_CREDIT;
    var divCity = Math.floor(divCreditR * (taxableAllR > DC.threshold
      ? DC.residentCityShare.over : DC.residentCityShare.under));
    var divPref = divCreditR - divCity;
    cityAfter = Math.max(0, cityAfter - divCity);
    prefAfter = Math.max(0, prefAfter - divPref);

    /* --- 寄附金税額控除（基本控除＋ふるさと納税の特例控除）---
     * 基本控除 ：（寄附金と総所得金額等の30%の小さいほう − 2,000円）× 10%
     * 特例控除 ：ふるさと納税だけが対象。
     *            （ふるさと納税額 − 2,000円）×（90% − 所得税の限界税率 × 1.021）
     *            所得割額（調整控除後）の20%が上限。
     * 限界税率は「課税総所得金額 − 人的控除の差の合計」で判定する（地方税法附則5条の5）。
     * その額が0以下のときは特例控除の税率差を0として扱う。 */
    var DN = D.DONATION;
    var furusato = pos(input.ded && input.ded.donationFurusato);
    var donationAll = furusato + pos(input.ded && input.ded.donationOther);
    var limitR = inc.souShotokuTou * DN.residentLimitRate;
    var donationBasicTarget = Math.min(donationAll, limitR);
    var donationBasic = Math.floor(Math.max(0, donationBasicTarget - DN.minimum) * DN.basicRate);

    var marginalBase = tSougou - jinteki.total;
    var marginal = marginalBase > 0 ? bracketTax(marginalBase).rate : 0;
    var furusatoTarget = Math.min(furusato, limitR);
    var donationSpecial = Math.floor(Math.max(0, furusatoTarget - DN.minimum) *
      Math.max(0, DN.specialBase - marginal * DN.reconstruction));
    var specialCap = Math.floor((cityAfter + prefAfter) * DN.specialCapRate);
    donationSpecial = Math.min(donationSpecial, specialCap);

    var donationCredit = donationBasic + donationSpecial;
    var donCity = Math.min(cityAfter, Math.floor(donationCredit * DN.basicCityShare));
    var donPref = Math.min(prefAfter, donationCredit - donCity);
    cityAfter -= donCity;
    prefAfter -= donPref;

    var credit = pos(input.residentCredit);
    var creditCity = Math.min(cityAfter, Math.floor(credit * cityShare));
    var creditPref = Math.min(prefAfter, credit - creditCity);
    cityAfter -= creditCity; prefAfter -= creditPref;

    /* --- 所得割額の調整措置 --- */
    var totalBefore = cityAfter + prefAfter, chosei = 0;
    if (!shotokuExempt && totalBefore > 0) {
      var diff = shotokuLimit - (inc.souShotokuTou - totalBefore);
      if (diff > 0) chosei = Math.min(Math.floor(diff), totalBefore);
    }
    var cityChosei = totalBefore > 0 ? Math.floor(chosei * cityAfter / totalBefore) : 0;
    var prefChosei = chosei - cityChosei;

    var cityFinal = shotokuExempt ? 0 : floorTo(Math.max(0, cityAfter - cityChosei), 100);
    var prefFinal = shotokuExempt ? 0 : floorTo(Math.max(0, prefAfter - prefChosei), 100);

    var cityKin = kintouExempt ? 0 : r.cityKin;
    var prefKin = kintouExempt ? 0 : r.prefKin;
    var forestTax = kintouExempt ? 0 : D.KINTOWARI.forest;

    return {
      params: p, income: inc, deduction: ded, allocation: al, jinteki: jinteki,
      headcount: headcount, hasDependents: hasDependents,
      kintouLimit: kintouLimit, shotokuLimit: shotokuLimit, kintouAll: kintouAll,
      kintouExempt: kintouExempt, shotokuExempt: shotokuExempt,
      specialExempt: specialExempt, welfare: welfare,
      taxableSougou: tSougou, taxableForest: tForest, taxableSep: sepTaxable,
      taxable: tSougou + tForest + sepTaxable,     // 課税標準額の合計
      sepParts: sepParts,
      cityStd: cityStd, prefStd: prefStd, citySep: citySep, prefSep: prefSep,
      cityRaw: cityRaw, prefRaw: prefRaw,
      adjBase: adjBase, cityAdj: cityAdj, prefAdj: prefAdj,
      dividendCredit: divCreditR, dividendCity: divCity, dividendPref: divPref,
      donationBasic: donationBasic, donationSpecial: donationSpecial,
      donationCredit: donationCredit, donationSpecialCap: specialCap,
      donationMarginalRate: marginal,
      creditCity: creditCity, creditPref: creditPref,
      chosei: chosei, cityChosei: cityChosei, prefChosei: prefChosei,
      cityShotoku: cityFinal, prefShotoku: prefFinal, shotokuTotal: cityFinal + prefFinal,
      cityKin: cityKin, prefKin: prefKin, forest: forestTax,
      kintouTotal: cityKin + prefKin + forestTax,
      total: cityFinal + prefFinal + cityKin + prefKin + forestTax
    };
  }

  /* ================================================================
   * JASSO 支給額算定基準額
   * ==============================================================*/
  function calcJasso(res, region) {
    if (res.shotokuExempt) {
      return { kijun: 0, taxable: 0, taxableSougou: 0, taxableSep: 0, cityAdj: 0, cityChosei: 0,
        factor: region.seirei ? 0.75 : 1, exempt: true, taiyo: 0 };
    }
    var factor = region.seirei ? 0.75 : 1;
    var base = res.taxable;
    var kijun = Math.max(0, floorTo(base * 0.06 - (res.cityAdj + res.cityChosei) * factor, 100));
    return {
      kijun: kijun, taxable: base, taxableSougou: res.taxableSougou + res.taxableForest,
      taxableSep: res.taxableSep, cityAdj: res.cityAdj, cityChosei: res.cityChosei,
      factor: factor, exempt: false,
      taiyo: Math.max(0, floorTo(base * 0.06 - res.cityAdj * factor, 100))
    };
  }

  /* 支給額算定基準額の合計から支援区分を判定する。
   *
   * 多子世帯（扶養する子3人以上）は令和7年度から
   * 「所得制限なく授業料等減免を受けられる」ようになった（JASSO 多子世帯支援）。
   * そのため基準額が154,500円以上で支援区分から外れても、
   * 授業料等減免だけは対象として案内しなければならない。
   * 給付奨学金のほうは支援区分（第Ⅰ〜Ⅳ）に応じた額なので、この場合は0円になる。
   */
  function judgeKubun(sum, opts) {
    opts = opts || {};
    var list = D.JASSO.kubun;
    for (var i = 0; i < list.length; i++) {
      if (sum < list[i].hi) {
        if (list[i].id === 4 && !(opts.tashi || opts.rikonou)) {
          return { id: 0, name: '対象外（収入基準超過）', ratio: '—', over: true, genmenOnly: false,
            note: '第Ⅳ区分は多子世帯または私立の理工農系学部の学生のみが対象です。' };
        }
        return { id: list[i].id, name: list[i].name, ratio: list[i].ratio, over: false,
          genmenOnly: false, note: list[i].note || '' };
      }
    }
    if (opts.tashi) {
      return { id: 0, name: '授業料等減免のみ対象（給付奨学金は0円）', ratio: '—', over: true, genmenOnly: true,
        note: '<b>多子世帯は所得制限なく授業料等減免を受けられます。</b>' +
          '一方、給付奨学金は支援区分（第Ⅰ〜Ⅳ区分）に応じた額のため、' +
          '支給額算定基準額が154,500円以上のこの場合は0円になります。' };
    }
    return { id: 0, name: '対象外（収入基準超過）', ratio: '—', over: true, genmenOnly: false, note: '' };
  }

  /* ================================================================
   * 国民健康保険料（税）の軽減判定
   *
   *   軽減判定所得（地方税法施行令）の作り方は住民税の所得と少し違う。
   *     ・世帯主（擬制世帯主を含む）＋被保険者＋特定同一世帯所属者の総所得金額等の合計
   *     ・退職所得（一時金）は含めない
   *     ・純損失・雑損失の繰越控除は適用した後の額
   *     ・65歳以上の公的年金等に係る所得からさらに15万円を控除
   *     ・分離譲渡所得は「特別控除前」の額
   *     ・事業専従者控除・青色事業専従者給与は事業主の所得に戻す
   *     ・所得控除（基礎控除・社会保険料控除など）は差し引かない
   * ==============================================================*/
  /* 1人分の軽減判定所得（世帯単位の調整は含まない） */
  function personJudgeIncome(input, inc) {
    var K = D.KOKUHO;
    var v = inc.souShotokuTou - inc.retirementIncome;   // 退職所得は含めない
    if (input.income.pensionAge65 && inc.pensionIncome > 0) {
      v -= Math.min(K.pensionDeduct65, inc.pensionIncome);   // 65歳以上は年金所得から15万円
    }
    return Math.max(0, v);
  }

  function calcKokuho(input, inc) {
    var K = D.KOKUHO, k = input.kokuho;
    var steps = [];
    // 本人が世帯主でも被保険者でもない場合、その所得は軽減判定に含めない
    var useSelf = k.includeSelf !== false;
    var self = 0, pensionCut = 0;
    if (useSelf) {
      var base = inc.souShotokuTou - inc.retirementIncome;
      steps.push({ label: '本人の総所得金額等（繰越控除後）', amount: inc.souShotokuTou });
      if (inc.retirementIncome > 0) steps.push({ label: '− 退職所得（軽減判定には含めない）', amount: -inc.retirementIncome });
      if (input.income.pensionAge65 && inc.pensionIncome > 0) {
        pensionCut = Math.min(K.pensionDeduct65, inc.pensionIncome);
        steps.push({ label: '− 65歳以上の公的年金等所得から15万円', amount: -pensionCut });
      }
      self = Math.max(0, base - pensionCut);
    } else {
      steps.push({ label: '本人は世帯主でも国保の被保険者でもないため、軽減判定には含めません', amount: 0 });
    }

    // 世帯単位の調整（1回だけ加算する）
    var addBack = pos(k.landSpecialDeduction) + pos(k.senjusha);
    if (pos(k.landSpecialDeduction) > 0) {
      steps.push({ label: '＋ 分離譲渡所得の特別控除額（軽減判定は特別控除前で見る）', amount: pos(k.landSpecialDeduction) });
    }
    if (pos(k.senjusha) > 0) {
      steps.push({ label: '＋ 事業専従者控除額・青色事業専従者給与（事業主の所得に戻す）', amount: pos(k.senjusha) });
    }
    var others = pos(k.otherMembersIncome);
    if (others > 0) steps.push({ label: '＋ ほかの世帯員の軽減判定所得', amount: others });

    var judge = Math.max(0, self + addBack + others);
    steps.push({ label: '＝ 世帯の軽減判定所得', amount: judge, total: true });

    var members = pos(k.insured) + pos(k.tokutei);
    var kyuyoCount = pos(k.salaryEarners);
    var addend = kyuyoCount >= 2 ? K.kyuyoAdd * (kyuyoCount - 1) : 0;

    var t7 = K.base + addend;
    var t5 = K.base + K.per5 * members + addend;
    var t2 = K.base + K.per2 * members + addend;
    var level = judge <= t7 ? 7 : judge <= t5 ? 5 : judge <= t2 ? 2 : 0;

    return { selfJudgeIncome: self, judgeIncome: judge, steps: steps, addBack: addBack,
      members: members, salaryEarners: kyuyoCount, addend: addend,
      t7: t7, t5: t5, t2: t2, level: level, limits: K.limits };
  }

  function calcAll(input) {
    var it = calcIncomeTax(input);
    var rt = calcResidentTax(input);
    return { incomeTax: it, resident: rt, jasso: calcJasso(rt, input.region), kokuho: calcKokuho(input, rt.income) };
  }

  var API = {
    salaryDeduction: salaryDeduction, salaryIncomeAmount: salaryIncomeAmount,
    pensionDeduction: pensionDeduction,
    retirementIncome: retirementIncome, calcIncome: calcIncome,
    calcIncomeTax: calcIncomeTax, calcResidentTax: calcResidentTax,
    calcJasso: calcJasso, judgeKubun: judgeKubun,
    calcKokuho: calcKokuho, personJudgeIncome: personJudgeIncome, calcAll: calcAll
  };
  root.TaxCalc = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
