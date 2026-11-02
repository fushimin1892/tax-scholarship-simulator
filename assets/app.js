/* ============================================================================
 * app.js  —  画面の生成・入力の取得・結果の描画
 *   上から下へ進む1本の流れ（STEP 1〜7 → 判定結果）で構成する。
 *   人数は STEP 3 の「世帯にいる人」から自動で数え、控除の所得条件を満たさなく
 *   なった項目は自動的にロックする。
 * ==========================================================================*/
(function () {
  'use strict';
  var D = window.TaxData, C = window.TaxCalc, CK = window.CityKyuchi;

  var $ = function (id) { return document.getElementById(id); };
  var num = function (id) { var e = $(id); return e ? Number(String(e.value).replace(/,/g, '') || 0) || 0 : 0; };
  var val = function (id) { var e = $(id); return e ? e.value : ''; };
  var chk = function (id) { var e = $(id); return e ? e.checked : false; };
  var yen = function (v) { return (Math.round(v) || 0).toLocaleString('ja-JP') + '円'; };
  var man = function (v) { return (v / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万円'; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var pct = function (v) { return (Math.round(v * 1000) / 1000) + '％'; };

  /* ============================================================
   * 0. 状態
   * ==========================================================*/
  var roster = [];          // A・B以外の世帯員
  var seq = 0;
  // STEP 3 と STEP 7 から導いた国保の集計結果（readPerson から参照する）
  var lastKokuho = { includeSelf: true };
  var MODE_LABEL = {
    student: { A: 'お父さん（生計維持者A）', B: 'お母さん（生計維持者B）', short: '学生本人', jasso: true },
    couple: { A: 'あなた（生計維持者A）', B: '配偶者（生計維持者B）', short: '夫婦（2人）', jasso: true },
    single: { A: 'あなた', B: '配偶者', short: 'ひとり', jasso: false }
  };
  var mode = function () {
    var el = document.querySelector('input[name="mode"]:checked');
    return el && MODE_LABEL[el.value] ? el.value : 'student';
  };
  var useJasso = function () { return chk('useJasso'); };
  // 学生本人モードでは、生計維持者が父か母かを選べるようにする（ひとり親の場合に必要）
  var REL_PARENT = { father: 'お父さん', mother: 'お母さん', other: 'その他の生計維持者' };
  var whoLabel = function (w) {
    if (mode() === 'student') return REL_PARENT[meta[w].rel] + '（生計維持者' + w + '）';
    return MODE_LABEL[mode()][w];
  };
  var labelA = function () { return whoLabel('A'); };
  var labelB = function () { return whoLabel('B'); };
  // セレクトなど狭い場所で使う短い呼び名（「お父さん（生計維持者A）」→「お父さん」）
  var shortLabel = function (w) { return whoLabel(w).replace(/（.*$/, ''); };
  var params = function () { return D.INCOME_TAX[Number(val('year'))]; };

  /* ============================================================
   * 1. フォーム部品
   * ==========================================================*/
  function fld(id, label, hint) {
    return '<label class="field"><span>' + label + '</span>' +
      '<input type="text" class="money" inputmode="numeric" autocomplete="off" id="' + id + '" value="0">' +
      (hint ? '<small class="hint">' + hint + '</small>' : '') + '</label>';
  }
  function cnt(id, label, hint, v) {
    return '<label class="field"><span>' + label + '</span>' +
      '<input type="number" id="' + id + '" value="' + (v === undefined ? 0 : v) + '" step="1" min="0">' +
      (hint ? '<small class="hint">' + hint + '</small>' : '') + '</label>';
  }
  function sel(id, label, opts, hint) {
    return '<label class="field"><span class="lbl">' + label + '</span><select id="' + id + '">' +
      opts.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') +
      '</select>' + (hint ? '<small class="hint">' + hint + '</small>' : '') +
      '<small class="lockmsg" id="' + id + '_lock"></small></label>';
  }
  function cb(id, label, hint) {
    return '<label class="field checkline"><input type="checkbox" id="' + id + '">' +
      '<span class="ctext"><span class="lbl">' + label + '</span>' +
      (hint ? '<small class="hint">' + hint + '</small>' : '') +
      '<small class="lockmsg" id="' + id + '_lock"></small></span></label>';
  }

  /* 加入チェックのすぐ横に出す説明。
   * 「親が入っていれば子どもは入れなくてよい」（会社の健康保険の被扶養者と同じ発想）が
   * 最も多い誤解で、外すと被保険者数が1人減り、5割・2割軽減の基準額が
   * 31万円・57万円ずつ下がって軽減が消えることがある。ここで必ず打ち消しておく。 */
  var KOKUHO_HINT =
    '<small class="hint">' +
    '<b>入れる</b>：その人自身の保険証が「国民健康保険」。' +
    '<b>国保に「扶養」はないので、子どもも1人ずつ必要</b>（親のチェックではまとめて入りません）。' +
    '　<b>外す</b>：勤め先の健康保険とその扶養に入っている人／75歳以上／生活保護。' +
    '</small>';

  /* ---------- 収入・控除フォーム（A / B 共通） ---------- */
  /* ①〜⑥のまとまりごとに、別々の文字列で返す。
   * 起動時はこれを1つずつ画面に入れていく（一度に入れると、並べ直しに
   * 300ミリ秒近くかかって操作を受け付けなくなるため。init のコメント参照）。 */
  function personFormGroups(p) {
    return [
    '<fieldset class="group"><legend>① 総合課税の収入・所得</legend><div class="grid rows">' +
      fld(p + '_salary', '給与収入（円）', '源泉徴収票の「支払金額」。複数ある場合は合計。') +
      fld(p + '_pension', '公的年金等の収入（円）', '国民年金・厚生年金・企業年金など') +
      fld(p + '_business', '事業所得の金額（円）', '収入金額 − 必要経費（青色申告特別控除後）') +
      fld(p + '_realEstate', '不動産所得の金額（円）', '') +
      fld(p + '_otherIncome', 'その他の所得の金額（円）', '雑所得（業務・その他）など。下に専用欄がある所得はそちらへ') +
      fld(p + '_interest', '利子所得（円）', '国外の預金利子など、確定申告するものだけ。国内の預貯金は源泉分離課税で申告不要です') +
    '</div>' +

    '<div class="subblock"><h3>配当所得（総合課税を選ぶ場合）</h3>' +
    '<p class="hint">総合課税を選ぶと<b>配当控除</b>（税額控除）が受けられます。' +
    '申告分離課税を選ぶ配当は、下の④「上場株式等に係る配当所得等」に入れてください（両方には入れないでください）。</p>' +
    '<div class="grid rows">' +
      fld(p + '_dividendGeneral', '配当等の収入金額（円）', '株式の配当など') +
      fld(p + '_dividendDebt', '元本取得のための負債利子（円）', 'なければ0のまま') +
    '</div></div>' +

    '<div class="subblock"><h3>一時所得（満期保険金・懸賞金など）</h3>' +
    '<p class="hint"><b>収入と経費をそのまま入れてください。</b>特別控除50万円を引き、' +
    'さらに<b>2分の1</b>にして所得に算入する計算は自動で行います。</p>' +
    '<div class="grid rows">' +
      fld(p + '_temporaryRevenue', '一時所得の収入金額（円）', '満期保険金、解約返戻金、懸賞金、競馬の払戻金など') +
      fld(p + '_temporaryExpense', '収入を得るために支出した金額（円）', '払い込んだ保険料など') +
    '</div></div>' +

    '<div class="subblock"><h3>総合課税の譲渡所得（車・ゴルフ会員権・金地金など）</h3>' +
    '<p class="hint">土地建物・株式は<b>ここではなく</b>④の分離課税へ。' +
    '特別控除50万円（短期・長期あわせて）と、<b>長期の2分の1</b>は自動で計算します。</p>' +
    '<div class="grid rows">' +
      fld(p + '_transferShortRevenue', '短期（所有5年以下）の収入金額（円）', '') +
      fld(p + '_transferShortExpense', '短期の取得費・譲渡費用（円）', '') +
      fld(p + '_transferLongRevenue', '長期（所有5年超）の収入金額（円）', '') +
      fld(p + '_transferLongExpense', '長期の取得費・譲渡費用（円）', '') +
    '</div></div>' +
    '<p class="derived" id="' + p + '_incomeNote"></p></fieldset>',

    '<fieldset class="group"><legend>② 所得控除</legend><div class="grid rows">' +
      fld(p + '_social', '社会保険料控除（円）', '国民健康保険料・国民年金・厚生年金・健康保険・介護保険等の支払額') +
      fld(p + '_kyosai', '小規模企業共済等掛金控除（円）', 'iDeCo（個人型確定拠出年金）、小規模企業共済など') +
      fld(p + '_medical', '医療費の支払額（円）', '') +
      fld(p + '_medicalComp', '保険金などで補填される額（円）', '高額療養費・入院給付金など') +
      fld(p + '_zasson', '雑損控除の額（円）', '本年分の災害・盗難等。金額を直接入力してください。') +
      fld(p + '_otherDeduction', 'その他の所得控除（円）', '上記以外で所得税・住民税に共通して適用される控除') +
    '</div>' +

    '<div class="subblock"><h3>寄附金控除（ふるさと納税を含む）</h3>' +
    '<p class="hint">' +
    '<b>ふるさと納税</b>は所得税の所得控除に加えて、住民税で<b>基本控除（10％）＋特例控除</b>が受けられます。' +
    '特例控除は所得割額の20％が上限で、これを超えると自己負担が2,000円で収まりません。' +
    'ワンストップ特例を使った場合も、控除の合計額はほぼ同じになります。' +
    '</p>' +
    '<div class="grid rows">' +
      fld(p + '_donationFurusato', 'ふるさと納税の合計額（円）', '都道府県・市区町村への寄附。特例控除の対象です') +
      fld(p + '_donationOther', 'その他の寄附金（円）', '国・認定NPO法人・公益社団法人などへの寄附。' +
        '所得税の所得控除と住民税の基本控除の対象（住民税は自治体の条例で指定された団体のみ）') +
    '</div></div>' +
    // 見出しは h2（STEPカード）→ h3 の順にする（レベルを飛ばさない）
    '<div class="subblock"><h3>生命保険料控除・地震保険料控除（支払保険料を入れると控除額を計算します）</h3>' +
    '<p class="hint">保険会社から届く「控除証明書」の金額を入れてください。該当がなければ空欄のままで大丈夫です。</p>' +
    '<div class="grid rows">' +
      fld(p + '_lifeNewGeneral', '一般の生命保険料・新契約（円）', '平成24年1月1日以後に契約') +
      fld(p + '_lifeOldGeneral', '一般の生命保険料・旧契約（円）', '平成23年12月31日以前に契約') +
      fld(p + '_lifeNewCare', '介護医療保険料（円）', '新契約のみ') +
      fld(p + '_lifeNewPension', '個人年金保険料・新契約（円）', '') +
      fld(p + '_lifeOldPension', '個人年金保険料・旧契約（円）', '') +
      fld(p + '_quake', '地震保険料（円）', '') +
      fld(p + '_longOld', '旧長期損害保険料（円）', '平成18年末までに契約した満期返戻金のあるもの') +
    '</div></div></fieldset>',

    '<fieldset class="group"><legend>③ 本人の状況（所得の条件を満たさないものは自動でロックされます）</legend>' +
    '<div class="grid rows">' +
      cb(p + '_student', '勤労学生控除を受ける', '働きながら学校に通っている場合') +
      cb(p + '_widow', '寡婦控除を受ける', '夫と死別・離別して再婚していない女性') +
      sel(p + '_singleParent', 'ひとり親控除（この人が母か父かを選ぶ）',
        [['none', '受けない'], ['mother', '受ける ─ この人は母親'], ['father', '受ける ─ この人は父親']],
        '生計を一にする子がいて、事実婚でない場合に受けられます。控除額は母・父とも同じ（所得税35万円／住民税30万円）ですが、' +
        '住民税の調整控除に使う人的控除の差が母5万円・父1万円と異なるため、どちらかを選んでください。') +
      cb(p + '_minor', '未成年者である', '合計所得135万円以下なら住民税は非課税') +
      cb(p + '_welfare', '生活保護法の生活扶助を受けている') +
    '</div></fieldset>',

    '<fieldset class="group"><legend>④ 分離課税の所得（株式の譲渡・配当、不動産の譲渡、先物、退職金、山林）</legend>' +
    '<p class="hint">確定申告で申告分離課税を選んだ所得を入力してください。源泉徴収ありの特定口座で<b>申告しない</b>ものは入力不要です。' +
    '該当がなければ空欄のままで大丈夫です。</p>' +
    '<div class="grid rows">' +
      fld(p + '_stockTransfer', '株式等に係る譲渡所得等（円）', '同一年内の損益通算後・繰越控除前の金額') +
      fld(p + '_stockDividend', '上場株式等に係る配当所得等（円）', '申告分離課税を選択した配当・分配金') +
      fld(p + '_futures', '先物取引に係る雑所得等（円）', '先物・FX・CFDなど') +
      fld(p + '_landLong', '土地建物等の長期譲渡所得（円）', '所有期間5年超。特別控除後の金額') +
      fld(p + '_landShort', '土地建物等の短期譲渡所得（円）', '所有期間5年以下。特別控除後の金額') +
      fld(p + '_retirementRevenue', '退職金の収入金額（円）', '源泉徴収票の支払金額') +
      cnt(p + '_retirementYears', '勤続年数（年）', '1年未満の端数は切り上げ') +
      fld(p + '_forestRevenue', '山林所得の収入金額（円）', '') +
      fld(p + '_forestExpense', '山林所得の必要経費（円）', '特別控除50万円は自動で差し引きます') +
    '</div><div class="grid rows">' +
      cb(p + '_retirementOfficer', '役員等で勤続5年以下（特定役員退職手当等）') +
      cb(p + '_retirementShort', '一般社員で勤続5年以下（短期退職手当等）') +
      cb(p + '_retirementDisability', '障害者となったことによる退職（控除額に100万円加算）') +
    '</div>' +
    '<p class="hint">退職所得の住民税は退職時に分離課税で徴収済みのため、<b>翌年度の住民税・非課税判定・奨学金判定には影響しません</b>。</p></fieldset>',

    '<fieldset class="group"><legend>⑤ 前年から繰り越した損失（繰越控除）</legend>' +
    '<p class="hint">繰越控除は<b>所得割</b>には効きますが、<b>均等割の非課税判定・扶養判定に使う「合計所得金額」は繰越控除前</b>で見ます。' +
    '該当がなければ空欄のままで大丈夫です。</p>' +
    '<div class="grid rows">' +
      fld(p + '_coStockLoss', '上場株式等に係る譲渡損失の繰越額（円）', '翌年以後3年間繰越可') +
      fld(p + '_coNetLoss', '純損失の繰越控除額（円）', '青色申告の事業所得等の損失。3年間繰越可') +
      fld(p + '_coCasualtyLoss', '雑損失の繰越控除額（円）', '災害・盗難等による損失。3年間繰越可') +
    '</div></fieldset>',

    '<fieldset class="group"><legend>⑥ 税額控除（住宅ローン控除など）</legend>' +
    '<p class="hint">所得ではなく<b>税額から直接引く</b>控除です。該当がなければ空欄のままで大丈夫です。</p>' +
    '<div class="grid rows">' +
      fld(p + '_taxCredit', '所得税の税額控除の額（円）', '住宅借入金等特別控除、配当控除など') +
      fld(p + '_residentCredit', '住民税の税額控除の額（円）', '調整控除を除く。ふるさと納税には未対応。') +
    '</div></fieldset>'
    ];
  }

  /* まとめて1つの文字列がほしいとき（世帯員の詳細欄など）はこちら */
  function personForm(p) { return personFormGroups(p).join(''); }

  /* ============================================================
   * 2. STEP 3 世帯にいる人
   * ==========================================================*/
  var REL = { spouse: '配偶者', child: '子', parent: '父母・祖父母', other: 'その他の親族' };

  function fixedRow(who) {
    var isB = who === 'B';
    var label = isB ? labelB() : labelA();
    return '<div class="member fixed" id="row' + who + '">' +
      '<div class="mhead"><span class="mtag ' + (isB ? 'b' : 'a') + '">' + (isB ? 'B' : 'A') + '</span>' +
      (mode() === 'student'
        ? '<select class="relsel" aria-label="生計維持者' + who + 'の続柄" id="' + who + '_rel">' +
          Object.keys(REL_PARENT).map(function (k) {
            return '<option value="' + k + '"' + (meta[who].rel === k ? ' selected' : '') + '>' + REL_PARENT[k] + '</option>';
          }).join('') + '</select><b class="muted">（生計維持者' + who + '）</b>'
        : '<b>' + esc(label) + '</b>') +
      (isB ? '<button type="button" class="del no-print" data-delb="1" title="この人を削除">削除</button>' : '') +
      '</div>' +
      '<div class="mgrid">' +
      '<label class="field"><span>年齢</span><input type="number" id="' + who + '_age" min="0" max="120" value="' + (isB ? 48 : 50) + '"></label>' +
      '<label class="field"><span>障害者の区分</span><select id="' + who + '_selfDisability">' +
      '<option value="none">該当なし</option><option value="normal">一般の障害者</option><option value="special">特別障害者</option></select></label>' +
      '<label class="field checkline kokuholine"><input type="checkbox" id="' + who + '_kokuho">' +
      '<span class="ctext"><span class="lbl">この人が国民健康保険の被保険者</span>' +
      KOKUHO_HINT +
      '<small class="lockmsg" id="' + who + '_kokuho_lock"></small></span></label>' +
      '<div class="field"><span>合計所得金額（自動）</span><div class="readout" id="' + who + '_gokei">—</div>' +
      '<small class="hint">STEP ' + (isB ? '5' : '4') + ' の収入から自動計算</small></div>' +
      '</div><div class="mnote" id="' + who + '_note"></div></div>';
  }

  function memberRow(m) {
    var id = 'm' + m.id;
    return '<div class="member" id="row_' + id + '">' +
      '<div class="mhead"><span class="mtag c">家族</span>' +
      '<select class="relsel" aria-label="この家族の続柄" id="' + id + '_rel">' +
      Object.keys(REL).map(function (k) {
        return '<option value="' + k + '"' + (m.rel === k ? ' selected' : '') + '>' + REL[k] + '</option>';
      }).join('') + '</select>' +
      '<button type="button" class="del no-print" data-del="' + m.id + '" title="削除">削除</button></div>' +
      '<div class="mgrid">' +
      '<label class="field"><span>年齢</span><input type="number" id="' + id + '_age" min="0" max="120" value="' + m.age + '"></label>' +
      (m.detail
        ? '<div class="field"><span>合計所得金額（自動）</span><div class="readout" id="' + id + '_gokei">—</div>' +
          '<small class="hint">STEP 6 の収入から自動計算</small></div>'
        : '<label class="field"><span>給与収入（円）</span><input type="text" class="money" inputmode="numeric" id="' + id + '_salary" value="' + m.salary.toLocaleString('ja-JP') + '"></label>' +
          '<label class="field"><span>公的年金等の収入（円）</span><input type="text" class="money" inputmode="numeric" id="' + id + '_pension" value="' + m.pension.toLocaleString('ja-JP') + '"></label>' +
          '<label class="field"><span>その他の所得（円）</span><input type="text" class="money" inputmode="numeric" id="' + id + '_other" value="' + m.other.toLocaleString('ja-JP') + '"></label>') +
      '<label class="field"><span>だれの扶養に入れるか</span><select id="' + id + '_support">' +
      '<option value="A">' + esc(shortLabel('A')) + '（A）</option>' +
      '<option value="B">' + esc(shortLabel('B')) + '（B）</option>' +
      '<option value="none">扶養に入れない</option></select></label>' +
      '<label class="field"><span>障害者の区分</span><select id="' + id + '_disability">' +
      '<option value="none">該当なし</option><option value="normal">一般の障害者</option><option value="special">特別障害者</option></select></label>' +
      '<label class="field checkline"><input type="checkbox" id="' + id + '_live"' + (m.live ? ' checked' : '') + '><span>同居している</span></label>' +
      '<label class="field checkline kokuholine"><input type="checkbox" id="' + id + '_kokuho"' + (m.kokuho ? ' checked' : '') + '>' +
      '<span class="ctext"><span class="lbl">この人が国民健康保険の被保険者</span>' +
      KOKUHO_HINT +
      '<small class="lockmsg" id="' + id + '_kokuho_lock"></small></span></label>' +
      '</div>' +
      '<label class="field checkline detailtoggle"><input type="checkbox" data-detail="' + m.id + '"' + (m.detail ? ' checked' : '') + '>' +
      '<span>この人の税金も詳しく計算する' +
      '<small class="hint">株の譲渡益・繰越控除・社会保険料控除・勤労学生控除などを入力できます（STEP 6 に欄が出ます）。' +
      '学生本人が自分のアルバイト代や株の利益を入れたいときはこちら。</small></span></label>' +
      '<div class="mnote" id="' + id + '_note"></div></div>';
  }

  /* 生計維持者Bがいないときは、代わりに追加ボタンだけを出す */
  function addBRow() {
    return '<div class="addrow no-print"><button type="button" class="ghost small" data-addb="1">' +
      '＋ ' + esc(shortLabel('B')) + '（もう一人の生計維持者）を追加</button>' +
      '<span class="hint">配偶者がいない・ひとり親の場合は追加しないでください。</span></div>';
  }

  function renderRoster() {
    var h = fixedRow('A');
    if (mode() !== 'single') h += meta.B.wanted ? fixedRow('B') : addBRow();
    h += roster.map(memberRow).join('');
    $('roster').innerHTML = h;
    // 値を復元
    roster.forEach(function (m) {
      var id = 'm' + m.id;
      if ($(id + '_support')) $(id + '_support').value = m.support;
      if ($(id + '_disability')) $(id + '_disability').value = m.disability;
    });
    ['A', 'B'].forEach(function (w) {
      if ($(w + '_age')) $(w + '_age').value = meta[w].age;
      if ($(w + '_selfDisability')) $(w + '_selfDisability').value = meta[w].disability;
      if ($(w + '_kokuho')) $(w + '_kokuho').checked = meta[w].kokuho;
    });
  }

  // wanted … 利用者が「Bも計算する」にチェックしているか（単身モードに切り替えても保持する）
  // enabled … 実際に計算に使うか
  var meta = {
    A: { age: 50, disability: 'none', kokuho: false, rel: 'father' },
    B: { wanted: true, enabled: true, age: 48, disability: 'none', kokuho: false, rel: 'mother' }
  };

  function readRoster() {
    roster.forEach(function (m) {
      var id = 'm' + m.id;
      if (!$(id + '_age')) return;
      m.rel = val(id + '_rel');
      m.age = num(id + '_age');
      if (!m.detail) {                       // 詳細入力中は簡易欄が存在しないので触らない
        m.salary = num(id + '_salary');
        m.pension = num(id + '_pension');
        m.other = num(id + '_other');
      }
      m.support = val(id + '_support');
      m.disability = val(id + '_disability');
      m.live = chk(id + '_live');
      m.kokuho = chk(id + '_kokuho');
    });
    ['A', 'B'].forEach(function (w) {
      if ($(w + '_age')) meta[w].age = num(w + '_age');
      if ($(w + '_selfDisability')) meta[w].disability = val(w + '_selfDisability');
      if ($(w + '_kokuho')) meta[w].kokuho = chk(w + '_kokuho');
      if ($(w + '_rel')) meta[w].rel = val(w + '_rel');
    });
    meta.B.enabled = mode() !== 'single' && meta.B.wanted;
  }

  /* ---------- 世帯員の合計所得 ---------- */
  var memberPrefix = function (m) { return 'md' + m.id; };
  function memberByPrefix(pfx) {
    for (var i = 0; i < roster.length; i++) if (memberPrefix(roster[i]) === pfx) return roster[i];
    return null;
  }
  /* readPerson から年齢・障害区分を引くための共通アクセサ（A・B と 世帯員の両方に対応） */
  function personMeta(pfx) {
    if (meta[pfx]) return meta[pfx];
    var m = memberByPrefix(pfx);
    return m ? m : { age: 0, disability: 'none', kokuho: false };
  }
  function memberIncome(m, p) {
    if (m.detail && $(memberPrefix(m) + '_salary')) {
      return C.calcIncome(readPerson(memberPrefix(m), Number(val('year')), true), p, 'income').gokei;
    }
    var sal = Math.max(0, m.salary - C.salaryDeduction(m.salary, p));
    var pen = Math.max(0, m.pension - C.pensionDeduction(m.pension, m.age >= 65, sal + m.other));
    return sal + pen + m.other;
  }
  /* 国保の「給与所得者等」の判定に使う収入 */
  function memberRevenue(m) {
    if (m.detail && $(memberPrefix(m) + '_salary')) {
      return { salary: num(memberPrefix(m) + '_salary'), pension: num(memberPrefix(m) + '_pension') };
    }
    return { salary: m.salary, pension: m.pension };
  }
  /* 世帯員の国保の軽減判定所得。
   *
   * 扶養判定に使う memberIncome() は「合計所得金額」＝繰越控除の“前”だが、
   * 国保の軽減判定は「総所得金額等」＝繰越控除の“後”で見る。ここを取り違えると、
   * 株の譲渡損失を繰り越している人の判定所得が実際より大きく出て、
   * 本来受けられる軽減が出なくなる。
   * 詳しく計算する人は、A・Bと同じく計算エンジンの personJudgeIncome を通す
   *（総所得金額等 − 退職所得 − 65歳以上の年金15万円）。 */
  function memberJudgeIncome(m, p) {
    if (m.detail && $(memberPrefix(m) + '_salary')) {
      var inp = readPerson(memberPrefix(m), Number(val('year')), true);
      return C.personJudgeIncome(inp, C.calcIncome(inp, D.RESIDENT_TAX[inp.residentYear], 'resident'));
    }
    // 簡易入力の人は繰越控除・退職所得の欄がないので、合計所得金額＝総所得金額等
    var rev = memberRevenue(m);
    var salaryIncome = Math.max(0, rev.salary - C.salaryDeduction(rev.salary, p));
    var pensionIncome = Math.max(0, rev.pension - C.pensionDeduction(rev.pension, m.age >= 65, salaryIncome + m.other));
    var v = salaryIncome + pensionIncome + m.other;
    if (m.age >= 65) v -= Math.min(D.KOKUHO.pensionDeduct65, pensionIncome);
    return Math.max(0, v);
  }

  /* ---------- 扶養の区分を判定 ---------- */
  function classify(m, p) {
    var g = memberIncome(m, p);
    if (m.support === 'none') return { income: g, kind: 'none', text: '扶養に入れない設定です。住民税の非課税限度額の人数にも含めません。' };
    if (g <= p.dependentLimit) {
      var kind, ded;
      if (m.age < 16) { kind = 'depUnder16'; ded = [0, 0]; }
      else if (m.age < 19) { kind = 'dep16_18'; ded = D.DEPENDENT_DEDUCTION.general; }
      else if (m.age < 23) { kind = 'dep19_22'; ded = D.DEPENDENT_DEDUCTION.specific; }
      else if (m.age < 70) { kind = 'dep23_69'; ded = D.DEPENDENT_DEDUCTION.general; }
      else if ((m.rel === 'parent') && m.live) { kind = 'depOldLiving'; ded = D.DEPENDENT_DEDUCTION.oldLiving; }
      else { kind = 'depOldOther'; ded = D.DEPENDENT_DEDUCTION.oldOther; }
      var name = { depUnder16: '16歳未満（年少扶養）', dep16_18: '一般の扶養親族（16〜18歳）',
        dep19_22: '特定扶養親族（19〜22歳）', dep23_69: '一般の扶養親族（23〜69歳）',
        depOldLiving: '同居老親等（70歳以上）', depOldOther: '老人扶養親族（70歳以上）' }[kind];
      return { income: g, kind: kind, ded: ded, text: '合計所得金額 ' + yen(g) + ' ≦ ' + yen(p.dependentLimit) +
        ' → <b>' + name + '</b>' + (kind === 'depUnder16'
          ? '。扶養控除はありませんが、<b>住民税の非課税限度額の人数には含まれます</b>。'
          : '　控除額：所得税 ' + man(ded[0]) + '／住民税 ' + man(ded[1])) };
    }
    if (m.age >= 19 && m.age < 23 && g <= p.tokuteiUpper) {
      var t = null;
      for (var i = 0; i < D.TOKUTEI_SHINZOKU.length; i++) if (g <= D.TOKUTEI_SHINZOKU[i][0]) { t = D.TOKUTEI_SHINZOKU[i]; break; }
      return { income: g, kind: 'tokutei', text: '合計所得金額 ' + yen(g) + ' が ' + yen(p.dependentLimit) +
        ' を超えるため扶養控除は使えませんが、<b>特定親族特別控除</b>の対象です　控除額：所得税 ' + man(t[1]) + '／住民税 ' + man(t[2]) +
        '<br><span class="muted">※非課税限度額の人数には含まれません</span>' };
    }
    return { income: g, kind: 'over', text: '合計所得金額 ' + yen(g) + ' が ' + yen(p.dependentLimit) +
      ' を超えるため<b>扶養に入れません</b>（非課税限度額の人数にも含まれません）' };
  }

  /* ---------- calc.js に渡す family を組み立てる ---------- */
  function deriveFamily(who, p) {
    var other = who === 'A' ? 'B' : 'A';
    var f = {
      hasSpouse: false, spouseIncome: 0, spouseOld: false,
      depUnder16: 0, dep16_18: 0, dep19_22: 0, dep23_69: 0, depOldOther: 0, depOldLiving: 0,
      tokuteiList: [], disNormal: 0, disSpecial: 0, disLive: 0,
      selfDisability: personMeta(who).disability,
      widow: chk(who + '_widow'), singleParent: val(who + '_singleParent'), student: chk(who + '_student'),
      under23Dependent: false, specialDisabilityFamily: false
    };
    // 世帯員（詳しく計算する人）は、自分の配偶者・扶養親族は持たないものとして扱う
    if (!meta[who]) return f;
    // 配偶者（もう一方の生計維持者）
    if (mode() !== 'single' && meta.B.enabled) {
      f.hasSpouse = true;
      f.spouseIncome = personGokei(other, p);
      f.spouseOld = meta[other].age >= 70;
      if (f.spouseIncome <= p.dependentLimit) {
        var sd = meta[other].disability;
        if (sd === 'normal') f.disNormal++;
        if (sd === 'special') { f.disLive++; f.specialDisabilityFamily = true; }
      }
    }
    roster.forEach(function (m) {
      if (m.support !== who) return;
      var c = classify(m, p);
      if (c.kind === 'tokutei') { f.tokuteiList.push(c.income); return; }
      if (['depUnder16', 'dep16_18', 'dep19_22', 'dep23_69', 'depOldOther', 'depOldLiving'].indexOf(c.kind) < 0) return;
      f[c.kind]++;
      if (m.age < 23) f.under23Dependent = true;
      if (m.disability === 'normal') f.disNormal++;
      if (m.disability === 'special') {
        f.specialDisabilityFamily = true;
        if (m.live) f.disLive++; else f.disSpecial++;
      }
    });
    return f;
  }

  /* A / B の合計所得金額（配偶者控除の判定に使う）。循環を避けるため family は空で計算する */
  function personGokei(who, p) {
    if (who === 'B' && (mode() === 'single' || !meta.B.enabled)) return 0;
    var input = readPerson(who, Number(val('year')), true);
    return C.calcIncome(input, p, 'income').gokei;
  }

  /* ---------- 国保の自動集計 ----------
   * 被保険者数 … 国保に加入している人（＋特定同一世帯所属者）。均等割の人数と軽減の基準額に効く
   * 給与所得者等 … 世帯主（擬制世帯主を含む）＋被保険者のうち該当する人
   * 軽減判定所得 … 世帯主（国保未加入でも）＋被保険者の所得の合計
   */
  function deriveKokuho(p) {
    var insured = 0, earners = 0, otherIncome = 0, includeSelf = false;
    var head = val('k_head') || 'A';
    var isEarner = function (salary, pension, age) {
      return salary > 550000 || pension > (age >= 65 ? 1250000 : 600000);
    };
    var year = Number(val('year'));
    ['A', 'B'].forEach(function (w) {
      if (w === 'B' && (mode() === 'single' || !meta.B.enabled)) return;
      var counted = meta[w].kokuho || head === w;      // 被保険者 または 世帯主（擬制世帯主）
      if (meta[w].kokuho) insured++;
      if (!counted) return;
      if (isEarner(num(w + '_salary'), num(w + '_pension'), meta[w].age)) earners++;
      if (w === 'A') { includeSelf = true; return; }
      var inB = readPerson('B', year);
      otherIncome += C.personJudgeIncome(inB, C.calcIncome(inB, D.RESIDENT_TAX[inB.residentYear], 'resident'));
    });
    roster.forEach(function (m) {
      // 世帯主は国保に入っていなくても（擬制世帯主）所得を軽減判定に含める。
      // ただし均等割の人数（被保険者数）には入れない。
      var isHead = head === 'm' + m.id;
      if (m.kokuho) insured++;
      if (!m.kokuho && !isHead) return;
      otherIncome += memberJudgeIncome(m, p);
      var rev = memberRevenue(m);
      if (isEarner(rev.salary, rev.pension, m.age)) earners++;
    });
    return { insured: insured, earners: earners, otherIncome: otherIncome, includeSelf: includeSelf, head: head };
  }

  /* ============================================================
   * 3. 控除のロック
   * ==========================================================*/
  function lock(id, ok, reason) {
    var el = $(id), msg = $(id + '_lock');
    if (!el) return;
    el.disabled = !ok;
    if (!ok) {
      if (el.type === 'checkbox') el.checked = false; else el.value = 'none';
      el.closest('.field').classList.add('locked');
    } else {
      el.closest('.field').classList.remove('locked');
    }
    if (msg) msg.innerHTML = ok ? '' : '🔒 ' + reason;
  }

  /* ---------- 国保の入力の排他 ----------
   * 国保の人数・所得を決める入口は2つある。
   *   ① STEP 3 の「この人が国民健康保険の被保険者」チェック（→ 自動集計）
   *   ② STEP 7 の「手動で上書きする」の数値欄
   * 実際に使われるのはどちらか一方だけなので、効かないほうを操作できないようにして
   * 理由を出す。黙って無視すると「チェックしたのに結果が変わらない」
   * 「入力したのに勝手に書き戻される」という、気づきにくい形の誤りになる。
   *
   * ロック中も値そのものは保持する（disabled は checked/value を消さない）ので、
   * チェックを外せば元の状態に戻る。
   */
  function softLock(id, locked, reason) {
    var el = $(id), msg = $(id + '_lock');
    if (!el) return;
    /* 読み取り専用にしてもキーボードのフォーカスは外さない。
     * 自動計算された値を読み上げ・確認できる必要があるため（disabled との違い）。 */
    if (el.type === 'checkbox' || el.tagName === 'SELECT') el.disabled = locked;
    else {
      el.readOnly = locked;
      if (locked) el.setAttribute('aria-readonly', 'true'); else el.removeAttribute('aria-readonly');
    }
    var field = el.closest('.field');
    if (field) field.classList.toggle('locked', locked);
    if (msg) msg.innerHTML = locked ? '🔒 ' + reason : '';
  }

  function refreshKokuhoLocks() {
    if (!$('k_manual')) return;
    var manual = chk('k_manual');

    // ① STEP 3 の加入チェック：手動上書き中は使われないのでロックする
    var boxes = ['A_kokuho', 'B_kokuho'].concat(
      roster.map(function (m) { return 'm' + m.id + '_kokuho'; }));
    boxes.forEach(function (id) {
      softLock(id, manual,
        'STEP 7 で「手動で上書きする」を選んでいるため、この加入チェックは使われません。' +
        '自動で数えさせたい場合は STEP 7 のチェックを外してください。');
    });

    // ② STEP 7 の数値欄：自動計算中は書いても上書きされるのでロックする
    [['k_insured', '被保険者数'], ['k_salary', '給与所得者等の数'], ['k_other', 'そのほかの世帯員の所得']]
      .forEach(function (x) {
        softLock(x[0], !manual,
          'STEP 3 の加入チェックから自動計算しています（' + x[1] + '）。' +
          'ここに直接入れたい場合は、下の「上の3つを手入力した値で計算する」にチェックを入れてください。');
      });
  }

  function refreshLocks() {
    var p = params(), y = Number(val('year'));
    var targets = ['A', 'B'].concat(roster.filter(function (m) { return m.detail; }).map(memberPrefix));
    targets.forEach(function (w) {
      if (!$(w + '_student')) return;
      var inc = C.calcIncome(readPerson(w, y, true), p, 'income');
      var g = inc.gokei;
      // 勤労学生控除：合計所得の上限＋勤労によらない所得10万円以下
      var nonWork = Math.max(0, g - inc.salaryIncome - inc.business);
      lock(w + '_student', g <= p.studentLimit && nonWork <= 100000,
        g > p.studentLimit
          ? '合計所得金額が ' + yen(g) + ' で、要件の ' + yen(p.studentLimit) + ' 以下を超えています'
          : '勤労によらない所得が ' + yen(nonWork) + ' あり、要件の10万円以下を超えています');
      // ひとり親控除・寡婦控除：合計所得500万円以下
      var has500 = g <= 5000000;
      // ひとり親控除は生計を一にする子が必要
      var hasChild = roster.some(function (m) {
        return m.support === w && memberIncome(m, p) <= p.dependentLimit && m.age < 100 && (m.rel === 'child');
      });
      lock(w + '_singleParent', has500 && hasChild,
        !has500 ? '合計所得金額が ' + yen(g) + ' で、要件の500万円以下を超えています'
          : 'STEP 3 に「生計を一にする子」（' + esc(labelForWho(w)) + 'の扶養に入れる子）が登録されていません');
      var widowOk = has500 && val(w + '_singleParent') === 'none';
      lock(w + '_widow', widowOk,
        !has500 ? '合計所得金額が ' + yen(g) + ' で、要件の500万円以下を超えています'
          : 'ひとり親控除を選んでいるため併用できません');
      // 配偶者控除の注意
      var note = $(w + '_incomeNote');
      if (note) {
        var msgs = ['合計所得金額：<b>' + yen(g) + '</b>'];
        if (g > 10000000 && meta[w] && meta.B.enabled) msgs.push('<span class="ng">合計所得1,000万円超のため配偶者控除・配偶者特別控除は受けられません</span>');
        if (g > 25000000) msgs.push('<span class="ng">合計所得2,500万円超のため基礎控除は0円です</span>');
        if (!meta[w]) {
          var mm = memberByPrefix(w);
          if (mm) msgs.push('この所得で <b>' + esc(shortLabel('A')) + 'の扶養に入れるか</b>が決まります（STEP 3 に判定が出ます）');
        }
        note.innerHTML = msgs.join('　／　');
      }
    });
  }
  function labelForWho(w) {
    if (w === 'A') return labelA();
    if (w === 'B') return labelB();
    var m = memberByPrefix(w);
    return m ? memberTitle(m) : w;
  }

  /* ============================================================
   * 4. 画面の更新
   * ==========================================================*/
  /* ---------- STEP 6：詳しく計算する人のフォーム ---------- */
  function memberTitle(m) { return REL[m.rel] + '（' + m.age + '歳）'; }
  function renderDetailForms() {
    var wrap = $('formsDetail');
    var want = roster.filter(function (m) { return m.detail; });
    Array.prototype.slice.call(wrap.children).forEach(function (el) {
      if (!want.some(function (m) { return memberPrefix(m) === el.dataset.prefix; })) wrap.removeChild(el);
    });
    want.forEach(function (m) {
      var pfx = memberPrefix(m);
      var el = wrap.querySelector('[data-prefix="' + pfx + '"]');
      if (el) { el.querySelector('h3').textContent = memberTitle(m); return; }
      el = document.createElement('div');
      el.dataset.prefix = pfx;
      el.className = 'detailperson';
      el.innerHTML = '<h3>' + esc(memberTitle(m)) + '</h3>' + personForm(pfx);
      wrap.appendChild(el);
    });
    $('step6').classList.toggle('hidden', want.length === 0);
  }

  function refreshAll() {
    readRoster();
    renderDetailForms();
    var p = params();

    // A / B の表示
    $('titleA').textContent = labelA() + 'の収入と控除';
    $('titleB').textContent = labelB() + 'の収入と控除';
    $('leadA').innerHTML = mode() === 'student'
      ? '奨学金の支援区分は<b>学生本人ではなく生計維持者（原則として父母）</b>の住民税で決まります。まずお父さん（いない場合はお母さん）の情報を入力してください。'
      : mode() === 'couple' ? 'あなた自身の収入と控除を入力してください。' : 'あなたの収入と控除を入力してください。';
    $('leadB').innerHTML = mode() === 'student'
      ? 'お母さんの収入と控除を入力してください。収入がない場合も0円のままで結構です（配偶者控除の判定に使います）。'
      : '配偶者の収入と控除を入力してください。収入がない場合も0円のままで結構です（配偶者控除の判定に使います）。';
    $('step5').classList.toggle('hidden', mode() === 'single' || !meta.B.enabled);
    $('step8').classList.toggle('hidden', !useJasso());
    ['A', 'B'].forEach(function (w) {
      var g = $(w + '_gokei');
      if (g) g.textContent = (w === 'B' && !meta.B.enabled) ? '—' : yen(personGokei(w, p));
    });
    /* 世帯に国保加入者がいるのに、この人のチェックが外れている場合の注意書き。
     * 「親が入っていれば子どもは不要」という誤解を、その人の行で直接つぶす。
     * 勤め先の健康保険に入っている人は正しく外すので、断定せず確認をうながす形にする。 */
    var anyKokuho = meta.A.kokuho || (meta.B.enabled && meta.B.kokuho)
      || roster.some(function (x) { return x.kokuho; });
    function kokuhoReminder(isChecked, age) {
      if (!anyKokuho || isChecked) return '';
      if (age >= 75) return '<br><span class="muted">75歳以上のため後期高齢者医療です。' +
        '国保から移った方は STEP 7 の「特定同一世帯所属者の数」に入れてください。</span>';
      return '<br><b class="attn">⚠ この世帯には国保の加入者がいます。</b>' +
        'この人が<b>勤め先の健康保険（またはその扶養）に入っていないなら、この人も国保の被保険者</b>です。' +
        'チェックを入れてください。<b>親が加入していても、子どもは自動では入りません</b>' +
        '（外したままだと軽減の基準額が31万円・57万円下がり、受けられる軽減が出なくなります）。';
    }

    var an = $('A_note'), bn = $('B_note');
    if (an) {
      an.innerHTML = 'この人の税金を計算します。' +
        (mode() !== 'single' && !meta.B.enabled
          ? '<br>配偶者は<b>いないもの</b>として計算します。<b>ひとり親の世帯</b>なら、' +
            'STEP 4 の「ひとり親控除」で <b>' +
            (meta.A.rel === 'mother' ? 'この人は母親' : meta.A.rel === 'father' ? 'この人は父親' : '母親か父親か') +
            '</b> を選んでください。' : '') +
        kokuhoReminder(meta.A.kokuho, meta.A.age);
    }
    if (bn) bn.innerHTML = '<b>' + esc(labelA()) + 'の配偶者</b>として扱います。合計所得が ' + yen(p.dependentLimit) +
      ' 以下なら同一生計配偶者となり、住民税の非課税限度額の人数に含まれます。' +
      kokuhoReminder(meta.B.kokuho, meta.B.age);

    // 世帯員の判定表示
    roster.forEach(function (m) {
      var el = $('m' + m.id + '_note');
      if (!el) return;
      var c = classify(m, p);
      el.className = 'mnote ' + (c.kind === 'over' ? 'ng' : c.kind === 'none' ? 'muted' : 'ok');
      el.innerHTML = c.text + kokuhoReminder(m.kokuho, m.age);
      var g = $('m' + m.id + '_gokei');
      if (g) g.textContent = yen(c.income);
    });

    // 世帯のまとめ
    var fa = deriveFamily('A', p), fb = meta.B.enabled ? deriveFamily('B', p) : null;
    var head = 1 + (fa.hasSpouse && fa.spouseIncome <= p.dependentLimit ? 1 : 0) +
      fa.depUnder16 + fa.dep16_18 + fa.dep19_22 + fa.dep23_69 + fa.depOldOther + fa.depOldLiving;
    // 世帯主の選択肢も立場に合わせて作り直す（「あなた」が誰を指すかがモードで変わるため）
    /* 世帯主の選択肢。立場によって「あなた」が誰を指すかが変わるので作り直す。
     * 世帯員も選べるようにしておかないと、同居の親などが世帯主で国保に入っていない
     * （＝擬制世帯主）ときに、その人の所得を軽減判定に入れられない。 */
    var headSel = $('k_head');
    if (headSel) {
      var want = 'A:' + labelA() + '|B:' + (meta.B.enabled ? labelB() : '') +
        '|M:' + roster.map(function (m) { return m.id + ':' + memberTitle(m); }).join(',');
      if (headSel.dataset.built !== want) {
        var cur = headSel.value || 'A';
        headSel.innerHTML = '<option value="A">' + esc(labelA()) + '</option>' +
          (meta.B.enabled ? '<option value="B">' + esc(labelB()) + '</option>' : '') +
          roster.map(function (m) {
            return '<option value="m' + m.id + '">' + esc(memberTitle(m)) + '</option>';
          }).join('') +
          '<option value="none">上記以外の人（この世帯に登録していない方）</option>';
        headSel.value = [...headSel.options].some(function (o) { return o.value === cur; }) ? cur : 'A';
        headSel.dataset.built = want;
      }
    }

    /* 奨学金を申し込む学生本人の選択肢。
     * 給付奨学金の収入基準は「学生等本人と生計維持者の支給額算定基準額の合計」なので、
     * 本人が誰かを決めないと合計が出せない。 */
    var stuSel = $('j_student');
    if (stuSel) {
      var wantS = roster.map(function (m) {
        return m.id + ':' + memberTitle(m) + ':' + (m.detail ? 'd' : '-');
      }).join(',');
      if (stuSel.dataset.built !== wantS) {
        var curS = stuSel.value || '';
        stuSel.innerHTML = roster.map(function (m) {
          return '<option value="m' + m.id + '">' + esc(memberTitle(m)) +
            (m.detail ? '' : '（税額は未計算：0円として扱います）') + '</option>';
        }).join('') + '<option value="none">該当なし（生計維持者だけで判定する）</option>';
        /* 既定は「詳しく計算する」子。いなければ最初の世帯員。
         * 利用者が自分で選ぶまでは既定を追従させる。
         * （世帯員がいない時点の「該当なし」を保持してしまうと、
         *   あとから子を登録しても本人分が合計に入らなくなる） */
        var def = roster.filter(function (m) { return m.detail && m.rel === 'child'; })[0]
          || roster.filter(function (m) { return m.rel === 'child'; })[0] || roster[0];
        var keep = stuSel.dataset.touched === '1' &&
          [...stuSel.options].some(function (o) { return o.value === curS; });
        stuSel.value = keep ? curS : (def ? 'm' + def.id : 'none');
        stuSel.dataset.built = wantS;
      }
    }

    var k = deriveKokuho(p);
    var s = '<div class="summarybox"><h3>自動で数えた人数</h3><div class="sgrid">' +
      sbox('住民税の非課税限度額の判定人数', head + '人', '本人＋同一生計配偶者＋扶養親族（16歳未満を含む）') +
      sbox(esc(labelA()) + 'の扶養親族', (fa.depUnder16 + fa.dep16_18 + fa.dep19_22 + fa.dep23_69 + fa.depOldOther + fa.depOldLiving) + '人',
        depBreakdown(fa)) +
      (fb ? sbox(esc(labelB()) + 'の扶養親族', (fb.depUnder16 + fb.dep16_18 + fb.dep19_22 + fb.dep23_69 + fb.depOldOther + fb.depOldLiving) + '人', depBreakdown(fb)) : '') +
      sbox('国保の被保険者数', k.insured + '人', '「国民健康保険に加入」にチェックした人数') +
      sbox('国保の給与所得者等の数', k.earners + '人', '給与収入55万円超／年金収入が基準超の人数') +
      '</div></div>';
    $('rosterSummary').innerHTML = s;

    // 国保の自動集計表示
    lastKokuho = k;
    if ($('kokuhoAuto')) {
      var manual = chk('k_manual');
      var headMember = roster.filter(function (m) { return 'm' + m.id === k.head; })[0];
      var headName = k.head === 'A' ? shortLabel('A') : k.head === 'B' ? shortLabel('B')
        : headMember ? memberTitle(headMember) : 'この世帯に登録していない方';
      // 実際に計算に使われている値（自動集計か、手動上書きか）で表示する
      var useInsured = manual ? num('k_insured') : k.insured;
      var useEarners = manual ? num('k_salary') : k.earners;
      var useOther = manual ? num('k_other') : k.otherIncome;
      $('kokuhoAuto').innerHTML =
        '<div class="summarybox"><h3>' +
        (manual ? '手入力した値で計算しています（STEP 3 の加入チェックは使いません）'
                : 'STEP 3 から自動で数えた内容') + '</h3><div class="sgrid">' +
        sbox('国保の被保険者数', useInsured + '人', '均等割の人数・軽減の基準額に効きます') +
        sbox('特定同一世帯所属者', num('k_tokutei') + '人', '軽減の基準額では被保険者と同じように数えます') +
        sbox('給与所得者等の数', useEarners + '人', '世帯主＋被保険者のうち該当者') +
        sbox('本人以外の軽減判定所得', yen(useOther), manual ? '手動で上書き中' : '65歳以上は年金から15万円控除済み') +
        sbox('世帯主', headName, k.includeSelf ? '本人の所得を軽減判定に含めます' : '本人の所得は含めません') +
        '</div></div>' +
        (useInsured + num('k_tokutei') === 0
          ? '<div class="warn">国保の被保険者が0人です。世帯の誰も国保に加入していない場合、軽減判定は行われません。' +
            (manual ? '「国保の被保険者数」に人数を入れてください。'
                    : 'STEP 3 で「この人が国民健康保険の被保険者」にチェックを入れてください。') + '</div>'
          : '');
      if (!manual) {
        $('k_insured').value = k.insured;
        $('k_salary').value = k.earners;
        $('k_other').value = Math.round(k.otherIncome).toLocaleString('ja-JP');
      }
      refreshKokuhoLocks();
    }

    // 多子世帯の目安
    var kids = roster.filter(function (m) { return m.rel === 'child' && m.support !== 'none'; }).length;
    if ($('j_tashiNote')) {
      $('j_tashiNote').innerHTML = kids >= 3
        ? 'STEP 3 に扶養する子が <b>' + kids + '人</b> 登録されています。多子世帯に該当する可能性があります。'
        : 'STEP 3 に扶養する子は ' + kids + '人 登録されています（3人以上で該当）。';
    }

    refreshLocks();
  }
  function sbox(t, v, d) {
    return '<div class="sbox"><span class="st">' + t + '</span><span class="sv">' + v + '</span><span class="sd">' + d + '</span></div>';
  }
  function depBreakdown(f) {
    var a = [];
    if (f.depUnder16) a.push('16歳未満 ' + f.depUnder16);
    if (f.dep16_18) a.push('16〜18歳 ' + f.dep16_18);
    if (f.dep19_22) a.push('特定扶養 ' + f.dep19_22);
    if (f.dep23_69) a.push('23〜69歳 ' + f.dep23_69);
    if (f.depOldOther) a.push('老人 ' + f.depOldOther);
    if (f.depOldLiving) a.push('同居老親等 ' + f.depOldLiving);
    if (f.tokuteiList.length) a.push('特定親族特別控除 ' + f.tokuteiList.length);
    return a.length ? a.join('／') : '登録なし';
  }

  /* ============================================================
   * 5. 地域の設定
   * ==========================================================*/
  function commafy(el) {
    var caret = el.selectionStart === null ? el.value.length : el.selectionStart;
    var digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
    var raw = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var out = raw === '' ? '' : Number(raw).toLocaleString('ja-JP');
    if (out !== el.value) {
      el.value = out;
      var pos = 0, seen = 0;
      while (pos < out.length && seen < digitsBefore) { if (/\d/.test(out[pos])) seen++; pos++; }
      try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    }
  }
  function setMoney(id, v) { var e = $(id); if (e) e.value = Number(v || 0).toLocaleString('ja-JP'); }

  function specialCity(prefName, cityName) {
    var list = D.CITIES[prefName] || [];
    for (var i = 0; i < list.length; i++) if (list[i].n === cityName) return list[i];
    return null;
  }
  function fillPref() {
    $('pref').innerHTML = D.PREFECTURES.map(function (p, i) {
      return '<option value="' + i + '"' + (p.n === '東京都' ? ' selected' : '') + '>' + p.n + '</option>';
    }).join('');
  }
  function fillCity() {
    var pref = D.PREFECTURES[Number(val('pref'))].n;
    var list = (CK && CK[pref]) || [];
    $('city').innerHTML = list.map(function (c) {
      var sp = specialCity(pref, c[0]);
      return '<option value="' + esc(c[0]) + '" data-kyuchi="' + c[1] + '">' + esc(c[0]) +
        (sp && sp.seirei ? '（政令市）' : '') + '</option>';
    }).join('');
    var sp = (D.CITIES[pref] || []).filter(function (c) { return c.seirei; })[0];
    var first = sp && list.some(function (c) { return c[0] === sp.n; }) ? sp.n : (list[0] && list[0][0]);
    if (first) $('city').value = first;
    syncRegion();
  }
  function syncRegion() {
    var pref = D.PREFECTURES[Number(val('pref'))];
    var cityName = val('city');
    var opt = $('city').selectedOptions[0];
    var kyuchi = opt ? Number(opt.dataset.kyuchi) || 3 : 3;
    var c = specialCity(pref.n, cityName);
    var seirei = !!(c && c.seirei);
    var cityKin = D.KINTOWARI.city + (c && c.addKin ? c.addKin : 0);
    if (c && c.fixKin) cityKin = c.fixKin;

    $('kyuchi').value = String(kyuchi);
    $('seirei').checked = seirei;
    setMoney('cityKin', cityKin);
    setMoney('prefKin', D.KINTOWARI.pref + pref.add);
    $('cityRate').value = c && c.fixRate ? c.fixRate : (seirei ? 8 : 6);
    $('prefRate').value = Math.round((seirei ? (pref.rate - 2) : pref.rate) * 1000) / 1000;

    var H = D.HIKAZEI.kintou[kyuchi];
    $('kyuchiNote').innerHTML = '<b>' + esc(cityName) + ' は ' + kyuchi + '級地</b>と自動判定しました。' +
      '均等割の非課税限度額は「' + man(H[0]) + ' × 人数 ＋ 10万円（扶養親族等がいる場合は＋' + man(H[1]) + '）」です。';
    /* 通知書に載るのは「上乗せ額」ではなく均等割の年額なので、内訳と年額の両方を出す。
     * 令和6年度創設の国税「森林環境税」（年額1,000円）と紛らわしいため、別物である旨も添える。 */
    var forestNote = '<br><span class="muted">※これとは別に国税の森林環境税' +
      yen(D.KINTOWARI.forest) + 'が住民税と一緒に徴収されます（計算結果に含めています）。</span>';
    $('prefNote').innerHTML = (pref.add > 0
      ? '超過課税：<b>' + esc(pref.tax) + '</b>（＋' + yen(pref.add) + '）' +
        '　→ 道府県民税の均等割は <b>' + yen(1000 + pref.add) + '</b>（標準1,000円＋' + yen(pref.add) + '）'
      : '道府県民税均等割の超過課税なし　→ 均等割は <b>' + yen(1000) + '</b>（標準税率どおり）'
      ) + forestNote;
    $('cityNote').innerHTML = (seirei ? '<b>政令指定都市</b>：所得割は市8％＋道府県2％、調整控除は市4％＋道府県1％。' : '標準税率（市町村6％＋道府県4％）。') +
      (c && c.note ? '<br>' + esc(c.note) : '');
  }

  /* ============================================================
   * 6. 入力の取得
   * ==========================================================*/
  function readPerson(p, year, skipFamily) {
    var o = {
      incomeYear: year,
      residentYear: year === 2025 ? 2026 : 2027,
      region: {
        pref: D.PREFECTURES[Number(val('pref'))].n, city: val('city'), seirei: chk('seirei'),
        cityKin: num('cityKin'), prefKin: num('prefKin'),
        cityRate: num('cityRate'), prefRate: num('prefRate'), kyuchi: Number(val('kyuchi'))
      },
      income: {
        salary: num(p + '_salary'), pension: num(p + '_pension'),
        pensionAge65: personMeta(p).age >= 65,
        business: num(p + '_business'), realEstate: num(p + '_realEstate'),
        otherIncome: num(p + '_otherIncome'), interest: num(p + '_interest'),
        dividendGeneral: num(p + '_dividendGeneral'), dividendDebt: num(p + '_dividendDebt'),
        temporaryRevenue: num(p + '_temporaryRevenue'), temporaryExpense: num(p + '_temporaryExpense'),
        transferShortRevenue: num(p + '_transferShortRevenue'),
        transferShortExpense: num(p + '_transferShortExpense'),
        transferLongRevenue: num(p + '_transferLongRevenue'),
        transferLongExpense: num(p + '_transferLongExpense'),
        stockTransfer: num(p + '_stockTransfer'), stockDividend: num(p + '_stockDividend'),
        futures: num(p + '_futures'), landLong: num(p + '_landLong'), landShort: num(p + '_landShort'),
        retirementRevenue: num(p + '_retirementRevenue'), retirementYears: num(p + '_retirementYears'),
        retirementOfficer: chk(p + '_retirementOfficer'), retirementShort: chk(p + '_retirementShort'),
        retirementDisability: chk(p + '_retirementDisability'),
        forestRevenue: num(p + '_forestRevenue'), forestExpense: num(p + '_forestExpense')
      },
      carryover: { stockLoss: num(p + '_coStockLoss'), netLoss: num(p + '_coNetLoss'), casualtyLoss: num(p + '_coCasualtyLoss') },
      ded: {
        social: num(p + '_social'), kyosai: num(p + '_kyosai'),
        lifeNewGeneral: num(p + '_lifeNewGeneral'), lifeOldGeneral: num(p + '_lifeOldGeneral'),
        lifeNewCare: num(p + '_lifeNewCare'),
        lifeNewPension: num(p + '_lifeNewPension'), lifeOldPension: num(p + '_lifeOldPension'),
        quake: num(p + '_quake'), longOld: num(p + '_longOld'),
        medical: num(p + '_medical'), medicalComp: num(p + '_medicalComp'),
        zasson: num(p + '_zasson'), otherDeduction: num(p + '_otherDeduction'),
        donationFurusato: num(p + '_donationFurusato'), donationOther: num(p + '_donationOther')
      },
      family: null,
      flags: { minor: chk(p + '_minor'), welfare: chk(p + '_welfare') },
      taxCredit: num(p + '_taxCredit'), residentCredit: num(p + '_residentCredit'),
      kokuho: {
        insured: num('k_insured'), tokutei: num('k_tokutei'),
        salaryEarners: num('k_salary'), otherMembersIncome: num('k_other'),
        landSpecialDeduction: num('k_landSpecial'), senjusha: num('k_senjusha'),
        includeSelf: lastKokuho.includeSelf
      }
    };
    o.family = skipFamily ? {
      hasSpouse: false, spouseIncome: 0, spouseOld: false,
      depUnder16: 0, dep16_18: 0, dep19_22: 0, dep23_69: 0, depOldOther: 0, depOldLiving: 0,
      tokuteiList: [], disNormal: 0, disSpecial: 0, disLive: 0,
      selfDisability: personMeta(p).disability,
      widow: false, singleParent: 'none', student: false,
      under23Dependent: false, specialDisabilityFamily: false
    } : deriveFamily(p, D.INCOME_TAX[year]);
    return o;
  }

  /* ============================================================
   * 7. 結果の描画（前バージョンと同じ内容）
   * ==========================================================*/
  function rows(list) {
    return list.map(function (x) {
      return '<tr><th>' + esc(x.name) + (x.memo ? ' <span class="memo">（' + esc(x.memo) + '）</span>' : '') +
        '</th><td class="num">' + yen(x.amount) + '</td></tr>';
    }).join('');
  }
  function kpi(label, value, sub, cls) {
    return '<div class="kpi ' + (cls || '') + '"><span class="label">' + label + '</span>' +
      '<span class="value">' + value + '</span><span class="sub">' + sub + '</span></div>';
  }
  function gauge(title, amount, limit, exempt) {
    var scale = Math.max(amount, limit) * 1.25 || 1;
    var w = Math.min(100, amount / scale * 100);
    var linePos = Math.min(100, limit / scale * 100);
    var align = linePos > 68 ? ' right' : linePos < 22 ? ' left' : '';
    return '<div class="gauge">' +
      '<div class="gauge-head"><span>' + title + '</span><span>' + yen(amount) + '</span></div>' +
      '<div class="gauge-bar"><div class="gauge-track"><div class="gauge-fill ' + (exempt ? 'under' : 'over') +
      '" style="width:' + w.toFixed(1) + '%"></div></div>' +
      '<div class="gauge-line" style="left:' + linePos.toFixed(1) + '%"></div>' +
      '<div class="gauge-label' + align + '" style="left:' + linePos.toFixed(1) + '%">非課税限度額 ' + yen(limit) + '</div></div>' +
      '<div class="gauge-foot">' + (exempt
        ? '限度額まであと <b>' + yen(limit - amount) + '</b> の余裕があります。'
        : '限度額を <b>' + yen(amount - limit) + '</b> 超えています。') + '</div></div>';
  }
  function stepBar(items, activeIndex) {
    return '<div class="steps">' + items.map(function (it, i) {
      return '<div class="step2 ' + (i === activeIndex ? 'on' : 'off') + '">' +
        '<span class="t">' + it[0] + '</span><span class="d">' + it[1] + '</span></div>';
    }).join('') + '</div>';
  }

  function renderIncomeCard(title, r) {
    var inc = r.incomeTax.income;
    var h = '<div class="card"><h2>' + esc(title) + '：所得の計算</h2><table class="detail">';
    if (inc.salaryRevenue > 0) {
      h += '<tr><th>給与収入</th><td class="num">' + yen(inc.salaryRevenue) + '</td></tr>' +
        '<tr><th>− 給与所得控除</th><td class="num">− ' + yen(inc.salaryDeduction) + '</td></tr>';
      if (inc.adjust1 > 0) h += '<tr><th>− 所得金額調整控除（子ども・特別障害者等）</th><td class="num">− ' + yen(inc.adjust1) + '</td></tr>';
      if (inc.adjust2 > 0) h += '<tr><th>− 所得金額調整控除（給与と年金の双方）</th><td class="num">− ' + yen(inc.adjust2) + '</td></tr>';
      h += '<tr><th>＝ 給与所得</th><td class="num">' + yen(inc.salaryIncome) + '</td></tr>';
    }
    if (inc.pensionRevenue > 0) {
      h += '<tr><th>公的年金等の収入</th><td class="num">' + yen(inc.pensionRevenue) + '</td></tr>' +
        '<tr><th>− 公的年金等控除</th><td class="num">− ' + yen(inc.pensionDeduction) + '</td></tr>' +
        '<tr><th>＝ 公的年金等に係る雑所得</th><td class="num">' + yen(inc.pensionIncome) + '</td></tr>';
    }
    if (inc.business) h += '<tr><th>事業所得</th><td class="num">' + yen(inc.business) + '</td></tr>';
    if (inc.realEstate) h += '<tr><th>不動産所得</th><td class="num">' + yen(inc.realEstate) + '</td></tr>';
    if (inc.other) h += '<tr><th>その他の所得</th><td class="num">' + yen(inc.other) + '</td></tr>';
    h += '<tr class="sum"><th>総所得金額（総合課税の合計）</th><td class="num">' + yen(inc.sougouBefore) + '</td></tr>';
    var hasSep = false;
    D.SEPARATE.forEach(function (s) {
      if (inc.sepBefore[s.key] > 0) { hasSep = true; h += '<tr><th>' + s.label + '</th><td class="num">' + yen(inc.sepBefore[s.key]) + '</td></tr>'; }
    });
    if (inc.forestBefore > 0) h += '<tr><th>山林所得（特別控除50万円後）</th><td class="num">' + yen(inc.forestBefore) + '</td></tr>';
    if (inc.retirementBefore > 0) h += '<tr><th>退職所得<span class="memo">（収入 ' + yen(inc.retirement.revenue) +
      ' − 退職所得控除 ' + yen(inc.retirement.deduction) + (inc.retirement.halved ? '）× 2分の1' : '）') + '</span></th><td class="num">' + yen(inc.retirementBefore) + '</td></tr>';
    h += '<tr class="sum"><th>合計所得金額<span class="memo">（繰越控除前）</span></th><td class="num">' + yen(inc.gokei) + '</td></tr>';
    if (inc.carryTotal > 0) {
      if (inc.carryStockUsed > 0) h += '<tr><th>− 上場株式等の譲渡損失の繰越控除</th><td class="num">− ' + yen(inc.carryStockUsed) + '</td></tr>';
      if (inc.carryLossUsed > 0) h += '<tr><th>− 純損失・雑損失の繰越控除</th><td class="num">− ' + yen(inc.carryLossUsed) + '</td></tr>';
    }
    h += '<tr class="sum"><th>総所得金額等<span class="memo">（繰越控除後）</span></th><td class="num">' + yen(inc.souShotokuTou) + '</td></tr></table>';
    if (inc.carryTotal > 0) {
      h += '<div class="warn"><b>繰越控除は「合計所得金額」を減らしません。</b>' +
        '均等割の非課税判定・扶養親族の判定・配偶者控除の判定は繰越控除<b>前</b>の合計所得金額（' + yen(inc.gokei) +
        '）で行われます。所得割の判定と課税標準は繰越控除後の総所得金額等（' + yen(inc.souShotokuTou) + '）です。' +
        (inc.carryStockRemain > 0 ? '<br>使い切れなかった株式等の譲渡損失 ' + yen(inc.carryStockRemain) + ' は翌年以後（最長3年）に繰り越せます。' : '') +
        (inc.carryLossRemain > 0 ? '<br>使い切れなかった純損失・雑損失 ' + yen(inc.carryLossRemain) + ' は翌年以後に繰り越せます。' : '') + '</div>';
    }
    if (hasSep) h += '<p class="hint">※分離課税の所得にも所得控除は適用されますが、まず総所得金額から控除し、引ききれない分を分離課税の所得から順に控除します。</p>';
    return h + '</div>';
  }

  function renderIncomeTaxCard(title, r, input) {
    var it = r.incomeTax;
    var h = '<div class="card"><h2>' + esc(title) + '：所得税（' + it.params.label + '）</h2>' +
      '<div class="verdict ' + (it.isTaxable ? 'v-warn' : 'v-good') + '">' +
      '<h3>' + (it.isTaxable ? '所得税が課税されます' : '所得税は課税されません') + '</h3>' +
      '<span class="big">' + yen(it.total) + '</span>' +
      '<p>復興特別所得税（基準所得税額の2.1％＝' + yen(it.reconstruction) + '）を含む年税額です。</p></div>' +
      '<table class="detail"><caption>所得控除の内訳（所得税）</caption>' + rows(it.deduction.list) +
      '<tr class="sum"><th>所得控除 合計</th><td class="num">' + yen(it.deduction.total) + '</td></tr></table>' +
      '<table class="detail"><caption>課税所得と税額</caption><thead><tr><th>区分</th>' +
      '<th class="num">課税所得金額</th><th class="num">税率</th><th class="num">税額</th></tr></thead><tbody>';
    it.parts.forEach(function (x) {
      h += '<tr><th>' + esc(x.name) + ' <span class="memo">' + esc(x.memo) + '</span></th>' +
        '<td class="num">' + yen(x.taxable) + '</td><td class="num">' + pct(x.rate) + '</td>' +
        '<td class="num">' + yen(x.tax) + '</td></tr>';
    });
    h += '<tr class="sum"><th>算出所得税額</th><td class="num"></td><td class="num"></td><td class="num">' + yen(it.beforeCredit) + '</td></tr></tbody></table>' +
      '<table class="detail">' +
      (input.taxCredit ? '<tr><th>− 税額控除</th><td class="num">− ' + yen(input.taxCredit) + '</td></tr>' : '') +
      '<tr><th>基準所得税額</th><td class="num">' + yen(it.baseTax) + '</td></tr>' +
      '<tr><th>＋ 復興特別所得税（2.1％）</th><td class="num">' + yen(it.reconstruction) + '</td></tr>' +
      '<tr class="sum"><th>年税額（100円未満切捨て）</th><td class="num">' + yen(it.total) + '</td></tr></table></div>';
    return h;
  }

  function renderResidentCard(title, r, input) {
    var rt = r.resident, inc = rt.income, pr = rt.params, reg = input.region;
    var h = '<div class="card"><h2>' + esc(title) + '：個人住民税（' + pr.label + '）' +
      (pr.provisional ? ' <span class="badge n">見込み</span>' : '') + '</h2>' +
      '<div class="kpis">' +
      kpi('均等割', rt.kintouExempt ? '非課税' : yen(rt.kintouTotal),
        rt.kintouExempt ? '森林環境税も課税されません' : '市町村' + yen(rt.cityKin) + '＋道府県' + yen(rt.prefKin) + '＋森林環境税' + yen(rt.forest),
        rt.kintouExempt ? 'kin exempt' : 'kin') +
      kpi('所得割', rt.shotokuExempt ? '非課税' : yen(rt.shotokuTotal),
        rt.shotokuExempt ? '奨学金は第Ⅰ区分に該当します' : '市町村' + yen(rt.cityShotoku) + '＋道府県' + yen(rt.prefShotoku),
        rt.shotokuExempt ? 'sho exempt' : 'sho') +
      kpi('住民税 合計（年額）', yen(rt.total), esc(reg.pref) + ' ' + esc(reg.city) + '（' + reg.kyuchi + '級地）', '') +
      '</div>';
    if (rt.welfare) h += '<div class="verdict v-good"><h3>生活扶助を受けているため、均等割・所得割とも非課税です</h3></div>';
    else if (rt.specialExempt) h += '<div class="verdict v-good">' +
      '<h3>障害者・未成年者・寡婦・ひとり親で合計所得金額が135万円以下のため、均等割・所得割とも非課税です</h3>' +
      '<p>合計所得金額 ' + yen(inc.gokei) + ' ≦ 1,350,000円</p></div>';

    h += '<h3>非課税限度額の判定</h3>' +
      '<p class="hint">判定人数 ＝ 本人 ＋ 同一生計配偶者 ＋ 扶養親族（16歳未満を含む）＝ <b>' + rt.headcount + '人</b>' +
      (rt.hasDependents ? '（扶養親族等がいるので加算あり）' : '（扶養親族等がいないので加算なし）') + '</p>' +
      '<div class="grid two"><div>' + gauge('均等割の判定（合計所得金額）', inc.gokei, rt.kintouLimit, rt.kintouExempt) +
      '</div><div>' + gauge('所得割の判定（総所得金額等）', inc.souShotokuTou, rt.shotokuLimit, rt.shotokuExempt) + '</div></div>';

    var K = D.HIKAZEI.kintou[reg.kyuchi];
    h += '<div class="tablewrap"><table class="compare"><thead><tr><th></th>' +
      '<th class="c1">均等割</th><th class="c2">所得割</th></tr></thead><tbody>' +
      '<tr><th>判定に使う所得</th><td>合計所得金額（繰越控除<b>前</b>）<br><b>' + yen(inc.gokei) + '</b></td>' +
      '<td>総所得金額等（繰越控除<b>後</b>）<br><b>' + yen(inc.souShotokuTou) + '</b></td></tr>' +
      '<tr><th>計算式</th><td>' + man(K[0]) + ' × ' + rt.headcount + '人 ＋ 10万円' + (rt.hasDependents ? ' ＋ ' + man(K[1]) : '') +
      '<br><span class="muted">（' + reg.kyuchi + '級地）</span></td>' +
      '<td>35万円 × ' + rt.headcount + '人 ＋ 10万円' + (rt.hasDependents ? ' ＋ 32万円' : '') +
      '<br><span class="muted">（全国共通）</span></td></tr>' +
      '<tr><th>非課税限度額</th><td><b>' + yen(rt.kintouLimit) + '</b></td><td><b>' + yen(rt.shotokuLimit) + '</b></td></tr>' +
      '<tr><th>判定</th><td><span class="badge ' + (rt.kintouExempt ? 'ok">非課税' : 'ng">課税') + '</span>' +
      (rt.kintouExempt ? '' : '　限度額を ' + yen(inc.gokei - rt.kintouLimit) + ' 超過') + '</td>' +
      '<td><span class="badge ' + (rt.shotokuExempt ? 'ok">非課税' : 'ng">課税') + '</span>' +
      (rt.shotokuExempt ? '' : '　限度額を ' + yen(inc.souShotokuTou - rt.shotokuLimit) + ' 超過') + '</td></tr>' +
      '<tr><th>参考：他の級地なら</th><td colspan="2">1級地 ' + yen(rt.kintouAll[1]) + '／2級地 ' + yen(rt.kintouAll[2]) +
      '／3級地 ' + yen(rt.kintouAll[3]) + '　<span class="muted">（所得割の限度額は全国共通で ' + yen(rt.shotokuLimit) + '）</span></td></tr>' +
      '</tbody></table></div>';

    h += '<h3>所得割の計算</h3><table class="detail"><caption>所得控除の内訳（住民税）</caption>' + rows(rt.deduction.list) +
      '<tr class="sum"><th>所得控除 合計</th><td class="num">' + yen(rt.deduction.total) + '</td></tr></table>' +
      '<table class="detail"><tr><th>総所得金額等</th><td class="num">' + yen(inc.souShotokuTou) + '</td></tr>' +
      '<tr><th>− 所得控除合計</th><td class="num">− ' + yen(rt.deduction.total) + '</td></tr>' +
      '<tr class="sum"><th>＝ 課税標準額（1,000円未満切捨て）</th><td class="num">' + yen(rt.taxable) + '</td></tr>';
    if (rt.taxableSep > 0 || rt.taxableForest > 0) {
      h += '<tr><th>　うち総合課税分</th><td class="num">' + yen(rt.taxableSougou) + '</td></tr>';
      if (rt.taxableForest > 0) h += '<tr><th>　うち山林所得分</th><td class="num">' + yen(rt.taxableForest) + '</td></tr>';
      if (rt.taxableSep > 0) h += '<tr><th>　うち分離課税分</th><td class="num">' + yen(rt.taxableSep) + '</td></tr>';
    }
    h += '<tr><th>市町村民税 所得割（総合課税分 ' + pct(reg.cityRate) + '）</th><td class="num">' + yen(rt.cityStd) + '</td></tr>' +
      '<tr><th>道府県民税 所得割（総合課税分 ' + pct(reg.prefRate) + '）</th><td class="num">' + yen(rt.prefStd) + '</td></tr>' +
      (rt.citySep + rt.prefSep > 0
        ? '<tr><th>市町村民税 所得割（分離課税分）</th><td class="num">' + yen(rt.citySep) + '</td></tr>' +
          '<tr><th>道府県民税 所得割（分離課税分）</th><td class="num">' + yen(rt.prefSep) + '</td></tr>' : '') +
      '<tr><th>− 調整控除（市町村民税分／' + (reg.seirei ? '4' : '3') + '％）</th><td class="num">− ' + yen(rt.cityAdj) + '</td></tr>' +
      '<tr><th>− 調整控除（道府県民税分／' + (reg.seirei ? '1' : '2') + '％）</th><td class="num">− ' + yen(rt.prefAdj) + '</td></tr>' +
      (rt.creditCity + rt.creditPref > 0 ? '<tr><th>− 税額控除</th><td class="num">− ' + yen(rt.creditCity + rt.creditPref) + '</td></tr>' : '') +
      (rt.chosei > 0 ? '<tr><th>− 所得割額の調整措置</th><td class="num">− ' + yen(rt.chosei) + '</td></tr>' : '') +
      '<tr class="sum"><th>所得割額（100円未満切捨て）</th><td class="num">' + yen(rt.shotokuTotal) + '</td></tr></table>';

    if (rt.sepParts.length) {
      h += '<table class="detail"><caption>分離課税分の住民税</caption><thead><tr><th>区分</th>' +
        '<th class="num">課税標準額</th><th class="num">税率</th><th class="num">市町村民税</th>' +
        '<th class="num">道府県民税</th><th class="num">計</th></tr></thead><tbody>';
      rt.sepParts.forEach(function (s) {
        h += '<tr><th>' + esc(s.name) + '</th><td class="num">' + yen(s.taxable) + '</td>' +
          '<td class="num">' + pct(s.rate) + '</td><td class="num">' + yen(s.city) + '</td>' +
          '<td class="num">' + yen(s.pref) + '</td><td class="num">' + yen(s.total) + '</td></tr>';
      });
      h += '<tr class="sum"><th>合計</th><td class="num">' + yen(rt.taxableSep) + '</td><td class="num"></td>' +
        '<td class="num">' + yen(rt.citySep) + '</td><td class="num">' + yen(rt.prefSep) + '</td>' +
        '<td class="num">' + yen(rt.citySep + rt.prefSep) + '</td></tr></tbody></table>' +
        '<p class="hint">※分離課税分は標準税率（合計5％、短期譲渡は9％）で計算しています。市町村民税と道府県民税の内訳は政令指定都市 4：1、それ以外 3：2 で按分しています。</p>';
    }

    h += '<table class="detail"><caption>調整控除（所得税との人的控除の差を調整するもの）</caption>' + rows(rt.jinteki.list) +
      '<tr class="sum"><th>人的控除の差 合計</th><td class="num">' + yen(rt.jinteki.total) + '</td></tr>' +
      '<tr><th>調整控除の基礎となる額<span class="memo">（' +
      (rt.taxableSougou + rt.taxableForest <= 2000000
        ? '合計課税所得金額200万円以下：人的控除差と合計課税所得金額の少ない方'
        : '合計課税所得金額200万円超：人的控除差 −（合計課税所得金額 − 200万円）、最低5万円') +
      '）</span></th><td class="num">' + yen(rt.adjBase) + '</td></tr></table>' +
      '<table class="detail"><caption>均等割の計算</caption>' +
      '<tr><th>市町村民税 均等割</th><td class="num">' + yen(reg.cityKin) + '</td></tr>' +
      '<tr><th>道府県民税 均等割</th><td class="num">' + yen(reg.prefKin) + '</td></tr>' +
      '<tr><th>森林環境税（国税）</th><td class="num">' + yen(D.KINTOWARI.forest) + '</td></tr>' +
      '<tr class="sum"><th>合計' + (rt.kintouExempt ? '（非課税のため0円）' : '') + '</th><td class="num">' + yen(rt.kintouTotal) + '</td></tr></table>' +
      '<p class="hint">※均等割は<b>所得控除の影響を受けません</b>。非課税限度額を上回れば、控除がいくらあっても定額で課税されます。</p></div>';
    return h;
  }

  function renderKokuho(k) {
    var K = D.KOKUHO, lv = k.level;
    var cls = lv === 7 ? 'v-good' : lv === 5 ? 'v-info' : lv === 2 ? 'v-warn' : 'v-bad';
    var h = '<div class="card"><h2>国民健康保険料（税）の軽減判定（' + K.year + '）</h2>' +
      '<div class="verdict ' + cls + '"><h3>' + (lv ? lv + '割軽減に該当します' : '軽減には該当しません') + '</h3>' +
      '<span class="big">' + (lv ? '均等割額・平等割額が ' + lv + '割軽減' : '軽減割合 0割') + '</span>' +
      '<p>軽減の対象は<b>均等割額と平等割額</b>で、所得割額は軽減されません。申請は不要です。</p></div>' +
      stepBar([['7割軽減', '最も手厚い'], ['5割軽減', ''], ['2割軽減', ''], ['軽減なし', '全額負担']],
        lv === 7 ? 0 : lv === 5 ? 1 : lv === 2 ? 2 : 3) +
      '<table class="detail"><caption>軽減判定所得の計算過程</caption>' +
      (k.steps || []).map(function (s) {
        return '<tr' + (s.total ? ' class="sum"' : '') + '><th>' + esc(s.label) + '</th>' +
          '<td class="num">' + (s.amount < 0 ? '− ' + yen(-s.amount) : yen(s.amount)) + '</td></tr>';
      }).join('') + '</table>' +
      '<table class="detail"><tr><th>被保険者数＋特定同一世帯所属者数</th><td class="num">' + k.members + '人</td></tr>' +
      '<tr><th>給与所得者等の数</th><td class="num">' + k.salaryEarners + '人（加算 ' + yen(k.addend) + '）</td></tr></table>' +
      '<div class="tablewrap"><table class="compare"><thead><tr><th>軽減割合</th><th>令和8年度の基準額</th><th>判定</th></tr></thead><tbody>' +
      [[7, k.t7, '43万円 ＋ 10万円 ×（給与所得者等の数 − 1）'],
       [5, k.t5, '43万円 ＋ 31万円 × 被保険者等の数 ＋ 10万円 ×（給与所得者等の数 − 1）'],
       [2, k.t2, '43万円 ＋ 57万円 × 被保険者等の数 ＋ 10万円 ×（給与所得者等の数 − 1）']].map(function (x) {
        var ok = k.judgeIncome <= x[1];
        return '<tr><th class="l' + x[0] + '">' + x[0] + '割軽減</th><td><b>' + yen(x[1]) + '</b><br><span class="muted">' + x[2] + '</span></td>' +
          '<td><span class="badge ' + (ok ? 'ok">基準内' : 'ng">超過') + '</span>' +
          (ok ? '' : '　あと ' + yen(k.judgeIncome - x[1]) + ' 下げれば該当') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="hint">令和8年度の賦課限度額：医療分 ' + yen(K.limits.medical) + '＋支援金分 ' + yen(K.limits.support) +
      '＋介護分 ' + yen(K.limits.care) + '＋子ども・子育て支援納付金分 ' + yen(K.limits.child) +
      '＝ 合計 ' + yen(K.limits.total) + '（令和7年度は ' + yen(K.prev.total) + '）</p>' +
      '<div class="warn"><b>本サイトが判定するのは「軽減割合」だけです。</b>保険料率（所得割率・均等割額・平等割額）は市区町村ごとに異なるため、' +
      '保険料額そのものは算出していません。実際の金額はお住まいの市区町村の料率表でご確認ください。<br>' +
      'また、未就学児の均等割5割軽減、令和8年度に新設された子ども・子育て支援納付金分（18歳到達年度末までの子どもは均等割10割軽減）、' +
      '産前産後期間の免除、非自発的失業者の軽減（給与所得を100分の30とみなす）などは、上の7割・5割・2割軽減とは別に適用されます。</div>' +
      '<div class="note"><h3>軽減判定所得は住民税の所得と少し違います</h3><ul>' +
      '<li>退職金を一時金で受け取った<b>退職所得は含めません</b>。</li>' +
      '<li>純損失・雑損失の<b>繰越控除は適用した後</b>の額で判定します。</li>' +
      '<li>65歳以上の方は<b>公的年金等に係る所得からさらに15万円</b>を控除します。</li>' +
      '<li>土地建物等の分離譲渡所得は<b>特別控除前</b>の額で判定します（STEP 7 で足し戻せます）。</li>' +
      '<li>事業専従者控除・青色事業専従者給与は<b>事業主の所得に戻して</b>判定します。</li>' +
      '<li>基礎控除・社会保険料控除などの<b>所得控除は差し引きません</b>。</li>' +
      '<li>世帯主が会社の健康保険に入っていても（擬制世帯主）、<b>世帯主の所得は判定に含めます</b>。ただし均等割の人数には入りません。</li>' +
      '</ul></div></div>';
    return h;
  }

  function renderJasso(jA, jB, jS, studentMember, student, seirei, opts, kub, sum) {
    var J = D.JASSO;
    // 多子世帯で授業料等減免だけ対象になる場合は「対象外」の赤ではなく注意色にする
    var cls = kub.id === 1 ? 'v-good' : kub.genmenOnly ? 'v-warn' : kub.id === 0 ? 'v-bad' : 'v-info';
    var h = '<div class="card"><h2>JASSO 給付奨学金・授業料等減免の支援区分判定</h2>' +
      '<div class="verdict ' + cls + '"><h3>判定結果</h3>' +
      '<span class="big">' + kub.name + (kub.ratio !== '—' ? '（支給割合：' + kub.ratio + '）' : '') + '</span>' +
      '<p>支給額算定基準額の合計：<b>' + yen(sum) + '</b></p>' + (kub.note ? '<p>' + kub.note + '</p>' : '') + '</div>' +
      stepBar(J.kubun.map(function (k) {
        return [k.name, (k.lo ? yen(k.lo) + '以上 ' : '') + yen(k.hi) + '未満／' + k.ratio];
      }).concat([['対象外', yen(154500) + '以上']]), kub.id ? kub.id - 1 : 4);

    if (opts.tashi) h += '<div class="verdict v-good"><h3>多子世帯として、授業料等減免は所得制限なしで受けられます</h3>' +
      '<p>生計維持者が扶養する子が3人以上の世帯は、令和7年度から<b>所得基準の制限なく</b>授業料・入学金が上限額まで減免されます（給付奨学金の額は支援区分に応じます）。</p></div>';

    h += '<h3>「超えるか／超えないか」の判定</h3><div class="tablewrap"><table class="compare"><thead><tr>' +
      '<th>支援区分</th><th>支給額算定基準額の範囲</th><th>あなたの合計額</th><th>判定</th></tr></thead><tbody>';
    J.kubun.forEach(function (k) {
      var inRange = sum >= k.lo && sum < k.hi, over = sum >= k.hi;
      var blocked = k.id === 4 && !(opts.tashi || opts.rikonou);
      var target = String(k.id) === val('j_target');
      h += '<tr' + (target ? ' class="hl"' : '') + '><th>' + k.name + (target ? ' ★' : '') + '</th>' +
        '<td>' + (k.lo === 0 ? '' : yen(k.lo) + ' 以上 ') + yen(k.hi) + ' 未満' +
        (k.id === 4 ? '<br><span class="muted">多子世帯・私立理工農系のみ</span>' : '') + '</td>' +
        '<td class="num"><b>' + yen(sum) + '</b></td><td>' +
        (inRange ? (blocked ? '<span class="badge ng">金額は範囲内だが対象外</span>　多子世帯・私立理工農系でないため'
          : '<span class="badge ok">この区分に該当</span>')
          : over ? '<span class="badge ng">超えている</span>　あと <b>' + yen(sum - k.hi + 1) + '</b> 下げれば該当'
            : '<span class="badge n">超えていない</span>　より手厚い上位の区分に該当') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (!opts.tashi && !opts.rikonou) h += '<p class="hint">※第Ⅳ区分は<b>多子世帯</b>または<b>私立の理工農系学部</b>の学生のみが対象です。STEP 8 のチェックを入れると判定に反映されます。</p>';

    h += '<h3>支給額算定基準額の計算</h3><div class="formula">支給額算定基準額 ＝ <b>課税標準額 × 6％</b> −' +
      '（市町村民税の<b>調整控除額</b> ＋ <b>調整額</b>）' + (seirei ? ' <b>× 4分の3</b>' : '') +
      '　<span class="muted">（100円未満切捨て）</span></div>';
    var fx = seirei ? 0.75 : 1;
    /* 収入基準は「学生等本人と生計維持者の支給額算定基準額の合計」で判定する。
     * 本人分が0円でも列として必ず出す（合計に何が入っているかを見せるため）。 */
    var cols = [{ label: labelA(), j: jA }];
    if (jB) cols.push({ label: labelB(), j: jB });
    var stuLabel = studentMember ? memberTitle(studentMember) + '（学生本人）' : '学生本人';
    cols.push({ label: stuLabel, j: jS, missing: !jS && !!studentMember, none: !studentMember });

    /* 人ごとに1つの表にする。
     * 「項目 × 人」の1枚の表にすると、1人分の計算を追うのに列を目で行き来する
     * ことになり、狭い画面ではそれが縦の行き来になって追えなくなる。
     * 上から下へ読めば1人分の計算がそのまま終わる形にした。 */
    var showSep = cols.some(function (c) { return c.j && c.j.taxableSep > 0; });
    h += '<div class="jcalc">' + cols.map(function (c) {
      var j = c.j;
      var v = function (n) { return c.none ? '—' : yen(j ? n(j) : 0); };
      var rows = [['住民税の課税標準額', v(function (x) { return x.taxable; })]];
      if (showSep) {
        rows.push(['　うち総合課税・山林分', v(function (x) { return x.taxableSougou; })]);
        rows.push(['　うち分離課税分', v(function (x) { return x.taxableSep; })]);
      }
      rows.push(['× 6％', v(function (x) { return x.taxable * 0.06; })]);
      rows.push(['市町村民税の調整控除額', v(function (x) { return x.cityAdj; })]);
      rows.push(['市町村民税の調整額<br><span class="muted">（所得割額の調整措置）</span>',
        v(function (x) { return x.cityChosei; })]);
      rows.push(['− 差し引く額' + (seirei ? '<br><span class="muted">（政令指定都市のため×4分の3）</span>' : ''),
        v(function (x) { return (x.cityAdj + x.cityChosei) * fx; })]);
      return '<div class="jperson">' +
        '<h4>' + esc(c.label) + '</h4>' +
        '<table class="detail"><tbody>' +
        rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td class="num">' + r[1] + '</td></tr>'; }).join('') +
        '<tr class="sum"><th>支給額算定基準額<br><span class="muted">（100円未満切捨て）</span></th>' +
        '<td class="num">' + v(function (x) { return x.kijun; }) + '</td></tr>' +
        '</tbody></table></div>';
    }).join('') + '</div>' +
      '<div class="jsum"><span>合計（学生本人＋生計維持者全員）</span><b>' + yen(sum) + '</b></div>';

    if (jA.exempt) h += '<p class="hint"><b>' + esc(labelA()) + 'は市町村民税の所得割が非課税</b>のため、支給額算定基準額は0円です。</p>';
    if (jB && jB.exempt) h += '<p class="hint"><b>' + esc(labelB()) + 'は市町村民税の所得割が非課税</b>のため、支給額算定基準額は0円です。</p>';
    if (jS && jS.exempt) h += '<p class="hint"><b>' + esc(stuLabel) + 'は市町村民税の所得割が非課税</b>のため、支給額算定基準額は0円です。' +
      '（均等割が課税されていても、所得割が非課税なら基準額は0円です。）</p>';
    if (cols[cols.length - 1].missing) h += '<div class="warn">学生本人（' + esc(stuLabel) +
      '）の税額を計算していないため、<b>本人の基準額を0円として合計しています</b>。' +
      '本人にアルバイト代や株の利益がある場合は、STEP 3 でその人の「この人の税金も詳しく計算する」をONにしてください。</div>';
    if (cols[cols.length - 1].none) h += '<div class="warn">学生本人が選ばれていません。' +
      'STEP 8 の「奨学金を申し込む学生本人はだれですか」で選ぶと、本人の基準額も合計に入ります。</div>';

    var school = val('j_school'), founder = val('j_founder'), home = Number(val('j_home'));
    var mk = (school === '高等専門学校') ? '高等専門学校' : '大学・短期大学・専修学校（専門課程）';
    var full = J.monthly[mk][founder][home];
    var ratio = kub.id === 1 ? 1 : kub.id === 2 ? 2 / 3 : kub.id === 3 ? 1 / 3 : kub.id === 4 ? 1 / 4 : 0;
    // 第Ⅳ区分のうち「私立理工農系だが多子世帯でない」場合は、給付奨学金は0円で授業料等減免のみ
    var rikoOnly = kub.id === 4 && opts.rikonou && !opts.tashi;
    var gen = J.genmen[school] ? J.genmen[school][founder] : null;
    h += '<h3>支給額・減免額の目安（' + esc(founder) + esc(school) + '・' + (home ? '自宅外' : '自宅') + '通学）</h3><table class="detail">' +
      '<tr><th>給付奨学金（月額）　第Ⅰ区分の満額</th><td class="num">' + yen(full) + '</td></tr>' +
      '<tr class="sum"><th>あなたの区分での給付奨学金（月額の目安）</th><td class="num">' +
      (rikoOnly ? '0円（支給なし）' : ratio ? yen(Math.round(full * ratio)) : '対象外') + '</td></tr>' +
      (gen ? '<tr><th>入学金の減免上限（第Ⅰ区分／多子世帯）</th><td class="num">' + yen(gen[0]) + '</td></tr>' +
        '<tr><th>授業料の減免上限（年額・第Ⅰ区分／多子世帯）</th><td class="num">' + yen(gen[1]) + '</td></tr>' +
        '<tr class="sum"><th>あなたの区分での授業料減免（年額の目安）</th><td class="num">' +
        (opts.tashi && kub.id ? (kub.id === 1 ? yen(gen[1]) + '（多子世帯は所得制限なしで満額）' : yen(gen[1]) + '（多子世帯は満額）')
          : rikoOnly ? '文系との授業料の差額に着目した額'
            : ratio ? yen(Math.round(gen[1] * ratio)) : '対象外') + '</td></tr>' : '') +
      '</table>' +
      (rikoOnly ? '<div class="warn"><b>私立の理工農系学科等で第Ⅳ区分の場合、給付奨学金は支給されません（0円）。</b>' +
        '受けられるのは授業料等減免のみで、その額は「文系との授業料の差額に着目した額」です。多子世帯に該当する場合は給付奨学金も4分の1が支給されます。</div>' : '') +
      '<p class="hint">※生活保護世帯（自宅通学）・児童養護施設等から通学する場合は別の月額が適用されます。</p>';

    var taiyo = jA.taiyo + (jB ? jB.taiyo : 0);
    h += '<h3>貸与型（第一種奨学金）の参考</h3>' +
      '<div class="formula">貸与額算定基準額 ＝ 課税標準額 × 6％ − 市町村民税の調整控除額 − 多子控除 − ひとり親控除 − 私立自宅外控除</div>' +
      '<table class="detail"><tr><th>多子控除等を差し引く前の額</th><td class="num">' + yen(taiyo) + '</td></tr>' +
      '<tr><th>第一種奨学金の基準</th><td class="num">' + yen(J.taiyoIchishu) + ' 以下</td></tr>' +
      '<tr class="sum"><th>判定（多子控除等を考慮しない場合）</th><td class="num">' +
      (taiyo <= J.taiyoIchishu ? '<span class="badge ok">基準内</span>'
        : '<span class="badge ng">超過</span>（' + yen(taiyo - J.taiyoIchishu) + ' 超過）') + '</td></tr></table>' +
      '<p class="hint">多子控除・ひとり親控除・私立自宅外控除に該当する場合は、その額を差し引いた後で判定されます。第二種奨学金の家計基準は第一種より緩やかです。</p>' +
      '<div class="warn">収入基準以外の要件（学力・在学・国籍／在留資格・資産基準5,000万円未満）は<b>すべて満たしている前提</b>で判定しています。' +
      '正式な区分はマイナンバーで取得した課税情報に基づきJASSOが決定します。</div></div>';
    return h;
  }

  function salaryForIncome(g, p) {
    if (g <= 0) return 0;
    if (g <= p.salaryMinCap - p.salaryMin) return g + p.salaryMin;
    if (g <= 2440000) return (g + 80000) / 0.7;
    if (g <= 4840000) return (g + 440000) / 0.8;
    if (g <= 6550000) return (g + 1100000) / 0.9;
    return g + 1950000;
  }
  function salaryHint(inc, limit, p) {
    var need = inc.souShotokuTou - limit;
    if (inc.salaryRevenue <= 0 || need <= 0 || inc.salaryIncome < need) return '';
    var target = salaryForIncome(inc.salaryIncome - need, p);
    var cut = inc.salaryRevenue - target;
    if (cut <= 0) return '';
    return '給与収入だけで調整する場合は、給与収入を <b>' + yen(Math.ceil(target / 1000) * 1000) +
      '</b> 程度まで（約 ' + yen(Math.floor(cut / 1000) * 1000) + ' 減）にするのが目安です。';
  }

  /* 世帯全体が住民税非課税か。
   * 「住民税非課税」は その人の均等割・所得割が両方とも非課税のときだけ使う。
   * 「住民税非課税世帯」は 世帯員全員がそうであるときだけ使う。
   * 詳しく計算していない世帯員は、合計所得金額と単身の非課税限度額で見分ける。 */
  function householdResidentStatus(people, p, region) {
    var H = D.HIKAZEI, kin = H.kintou[region.kyuchi || 1];
    var soloKintou = kin[0] + H.base, soloShotoku = H.shotoku[0] + H.base;
    var list = people.map(function (x) {
      return { title: x.title, kintou: x.res.resident.kintouExempt, shotoku: x.res.resident.shotokuExempt, exact: true };
    });
    roster.forEach(function (m) {
      if (m.detail) return;                       // 詳しく計算した人は上で入っている
      var g = memberIncome(m, p);
      list.push({ title: memberTitle(m), kintou: g <= soloKintou, shotoku: g <= soloShotoku, exact: false });
    });
    var taxed = list.filter(function (x) { return !(x.kintou && x.shotoku); });
    return { list: list, allExempt: taxed.length === 0, taxed: taxed };
  }

  function summary(people, rA, kub, inputA, showJasso, jassoSum, studentMember, student) {
    var p = params(), hh = householdResidentStatus(people, p, inputA.region);
    var k = rA.kokuho;

    /* 上部の要約は「誰の結果か」が分かることを最優先にする。
     * 以前は生計維持者Aの数字だけを見出しなしで並べていたため、
     * 学生本人モードで使っている人には自分の税額に見えてしまっていた。 */
    var h = '<div class="card"><h2>判定結果の要約</h2>' +
      '<h3>人ごとの税額</h3>' +
      '<div class="tablewrap"><table class="compare persons"><thead><tr>' +
      '<th>だれの分か</th><th class="num">所得税</th><th class="num">住民税<br>合計</th>' +
      '<th class="num">うち<br>均等割</th><th class="num">うち<br>所得割</th>' +
      (showJasso ? '<th class="num">JASSO<br>支給額算定基準額</th>' : '') + '</tr></thead><tbody>';
    /* 金額と「非課税」が混ざると読みにくいので、非課税は緑のバッジで見分けられるようにする */
    var cell = function (exempt, amount, label) {
      return exempt ? '<span class="badge ok">' + (label || '非課税') + '</span>' : yen(amount);
    };
    people.forEach(function (x) {
      var it = x.res.incomeTax, rt = x.res.resident;
      var both = rt.kintouExempt && rt.shotokuExempt;
      h += '<tr' + (x.key === (studentMember ? 'm' + studentMember.id : '') ? ' class="hl"' : '') + '>' +
        '<th class="who"><b>' + esc(x.title) + '</b><span class="role">' + esc(x.sub) + '</span></th>' +
        '<td class="num">' + cell(!it.isTaxable, it.total, '課税なし') + '</td>' +
        '<td class="num total">' + (both ? '<span class="badge ok">非課税</span>' : '<b>' + yen(rt.total) + '</b>') + '</td>' +
        '<td class="num">' + cell(rt.kintouExempt, rt.kintouTotal) + '</td>' +
        '<td class="num">' + cell(rt.shotokuExempt, rt.shotokuTotal) + '</td>' +
        (showJasso ? '<td class="num">' + (x.jasso ? yen(x.jasso.kijun) : '—') + '</td>' : '') +
        '</tr>';
    });
    h += '</tbody></table></div>' +
      '<p class="hint">この表の金額は、下にある人ごとの明細カードと同じ数字です。' +
      '住民税は<b>人ごとに課税されます</b>（世帯でまとめて計算するものではありません）。</p>';

    h += '<h3>世帯としての判定</h3><div class="kpis">' +
      kpi('住民税非課税世帯', hh.allExempt ? '該当' : '該当しない',
        hh.allExempt ? '世帯員全員が均等割・所得割とも非課税'
          : hh.taxed.map(function (x) { return esc(x.title); }).slice(0, 3).join('・') + ' に課税あり',
        hh.allExempt ? 'exempt' : '') +
      kpi('国保の軽減', k.level ? k.level + '割軽減' : '軽減なし', '均等割額・平等割額が対象（世帯単位）', k.level ? 'exempt' : '') +
      (showJasso ? kpi('JASSO 支援区分',
        kub.id ? kub.name : kub.genmenOnly ? '授業料等減免のみ' : '対象外',
        (kub.id ? '' : kub.genmenOnly ? '給付奨学金は0円／' : '収入基準超過／') +
        '本人＋生計維持者の基準額 ' + yen(jassoSum), kub.id === 1 ? 'exempt' : '') : '') +
      '</div>';

    var msgs = [], NEAR = 2000000, rt = rA.resident;
    if (!hh.allExempt) {
      msgs.push('<b>「住民税非課税世帯」には該当しません。</b>' +
        hh.taxed.map(function (x) { return esc(x.title); }).join('・') +
        ' に住民税（均等割または所得割）が課税されています。' +
        '世帯員が1人でも課税されていれば、住民税非課税世帯向けの給付金などの対象にはなりません。');
    } else {
      msgs.push('世帯員全員が均等割・所得割とも非課税のため、<b>「住民税非課税世帯」</b>に該当します（森林環境税もかかりません）。');
    }
    if (showJasso) {
      msgs.push('<b>JASSOの支援区分と「住民税非課税世帯」は別の基準です。</b>' +
        'JASSOは住民税の均等割ではなく、<b>学生本人＋生計維持者の支給額算定基準額の合計</b>（所得割の課税標準がもと）で判定します。' +
        'そのため、均等割が課税されていても所得割が非課税で基準額が0円なら第Ⅰ区分になり得ますし、' +
        'その場合でも世帯に課税者がいれば住民税非課税世帯にはなりません。');
      if (student && student.res.resident.shotokuExempt) {
        msgs.push('学生本人（' + esc(student.title) + '）は<b>住民税の所得割が非課税</b>のため、本人の支給額算定基準額は<b>0円</b>です。');
      } else if (!student && studentMember) {
        msgs.push('学生本人（' + esc(studentMember.title) + '）の税額を計算していないため、本人の基準額を<b>0円</b>として合計しています。' +
          'STEP 3 でその人の「この人の税金も詳しく計算する」をONにすると、本人分も計算されます。');
      }
    }
    /* labelA() は「お父さん（生計維持者A）」まで含んでいる。ここで足すと二重になる。 */
    var who = esc(labelA());
    if (!rt.shotokuExempt && rt.income.souShotokuTou - rt.shotokuLimit <= NEAR)
      msgs.push(who + 'の所得割を非課税にするには、総所得金額等をあと <b>' + yen(rt.income.souShotokuTou - rt.shotokuLimit) + '</b> 減らす必要があります。' +
        salaryHint(rt.income, rt.shotokuLimit, rt.params));
    if (!rt.kintouExempt && rt.income.gokei - rt.kintouLimit <= NEAR)
      msgs.push(who + 'の均等割を非課税にするには、合計所得金額をあと <b>' + yen(rt.income.gokei - rt.kintouLimit) + '</b> 減らす必要があります（' +
        inputA.region.kyuchi + '級地の限度額 ' + yen(rt.kintouLimit) + '）。<b>均等割は所得控除では減らせません。</b>');
    if (!rt.shotokuExempt && rt.income.carryTotal > 0)
      msgs.push('繰越控除を使っているため、<b>均等割の判定（合計所得金額 ' + yen(rt.income.gokei) +
        '）と所得割の判定（総所得金額等 ' + yen(rt.income.souShotokuTou) + '）で見る金額が異なります。</b>');
    if (msgs.length) h += '<div class="note">' + msgs.map(function (m) { return '<p>' + m + '</p>'; }).join('') + '</div>';

    h += '<table class="detail"><caption>計算の前提</caption>' +
      '<tr><th>使い方</th><td>' + MODE_LABEL[mode()].short + 'として計算</td></tr>' +
      '<tr><th>対象年分</th><td>' + rA.incomeTax.params.label + '（住民税は ' + rt.params.label + '）</td></tr>' +
      '<tr><th>お住まい</th><td>' + esc(inputA.region.pref) + ' ' + esc(inputA.region.city) +
      '　<span class="badge info">' + inputA.region.kyuchi + '級地</span>' +
      (inputA.region.seirei ? ' <span class="badge info">政令指定都市</span>' : '') + '</td></tr>' +
      '<tr><th>世帯の判定人数</th><td>' + rt.headcount + '人（本人＋同一生計配偶者＋扶養親族）</td></tr>' +
      '<tr><th>住民税の税率</th><td>市町村民税 所得割 ' + pct(inputA.region.cityRate) + '／均等割 ' + yen(inputA.region.cityKin) +
      '　　道府県民税 所得割 ' + pct(inputA.region.prefRate) + '／均等割 ' + yen(inputA.region.prefKin) + '</td></tr>' +
      '<tr><th>作成日</th><td>' + new Date().toLocaleDateString('ja-JP') + '</td></tr></table></div>';
    return h;
  }

  function sourcesHtml() {
    return '<div class="card"><h2>出典</h2>' + D.SOURCES.map(function (s) {
      return '<div class="sourceline"><span class="cat">' + s.c + '</span>' + esc(s.t) +
        '<br><a href="' + s.u + '" target="_blank" rel="noopener">' + s.u + '</a></div>';
    }).join('') + '<p class="hint" style="margin-top:12px">数値は2026年8月時点の公表内容に基づきます。' +
      '都道府県・市町村の超過課税や国民健康保険の料率、生活保護の級地区分は年度ごとに変わることがあるため、必ずお住まいの自治体でご確認ください。</p></div>';
  }

  /* ============================================================
   * 8. 実行
   * ==========================================================*/
  function run() {
    refreshAll();
    var year = Number(val('year'));
    var showJasso = useJasso();
    var inA = readPerson('A', year);
    var rA = C.calcAll(inA);
    var jA = rA.jasso;

    var useB = mode() !== 'single' && meta.B.enabled, rB = null, jB = null, inB = null;
    if (useB) {
      inB = readPerson('B', year);
      rB = C.calcAll(inB);
      jB = rB.jasso;
    }
    var manualB = String(val('j_manualB')).replace(/,/g, '').trim();
    if (showJasso && manualB !== '' && !isNaN(Number(manualB))) {
      var mv = Math.max(0, Math.floor(Number(manualB) / 100) * 100);
      jB = { kijun: mv, taxable: 0, taxableSougou: 0, taxableSep: 0, cityAdj: 0, cityChosei: 0, exempt: false, taiyo: mv };
    }

    /* 「詳しく計算する」にした世帯員（学生本人など）も、A・Bと同じように1回だけ計算する。
     * 上部の要約と個別カードで数字が食い違わないよう、ここで作った結果を両方で使う。 */
    var detailPeople = roster.filter(function (m) { return m.detail; }).map(function (m) {
      var pfx = memberPrefix(m), inM = readPerson(pfx, year);
      return { key: 'm' + m.id, member: m, title: memberTitle(m), input: inM, res: C.calcAll(inM) };
    });

    /* 給付奨学金の収入基準は「学生等本人と生計維持者の支給額算定基準額の合計」。
     * 本人分を足し忘れると区分が甘く出るので、必ず合計に入れる。 */
    var studentKey = val('j_student') || 'none';
    var student = detailPeople.filter(function (x) { return x.key === studentKey; })[0] || null;
    var studentMember = roster.filter(function (m) { return 'm' + m.id === studentKey; })[0] || null;
    var jS = student ? student.res.jasso : null;
    var jassoSum = jA.kijun + (jB ? jB.kijun : 0) + (jS ? jS.kijun : 0);

    var opts = { tashi: chk('j_tashi'), rikonou: chk('j_riko') };
    var kub = C.judgeKubun(jassoSum, opts);

    // 上部要約で使う「人物ごとの結果」
    var people = [{ key: 'A', title: labelA(), sub: '生計維持者A', res: rA, jasso: jA }];
    if (rB) people.push({ key: 'B', title: labelB(), sub: '生計維持者B', res: rB, jasso: jB });
    detailPeople.forEach(function (x) {
      people.push({ key: x.key, title: x.title,
        sub: x.key === studentKey ? '奨学金を申し込む学生本人' : '世帯員',
        res: x.res, jasso: x.res.jasso });
    });

    var detailHtml = '';
    detailPeople.forEach(function (x) {
      detailHtml += '<div class="card sectionhead"><h2>' + esc(x.title) + ' 本人の税金</h2>' +
        '<p class="hint">この人自身にかかる所得税・住民税です。' +
        (x.res.resident.shotokuExempt ? '<b>住民税の所得割は非課税</b>です。' : '') +
        classify(x.member, params()).text + '</p></div>' +
        renderIncomeCard(x.title, x.res) + renderIncomeTaxCard(x.title, x.res, x.input) +
        renderResidentCard(x.title, x.res, x.input);
    });

    $('results').innerHTML =
      summary(people, rA, kub, inA, showJasso, jassoSum, studentMember, student) +
      (showJasso ? renderJasso(jA, jB, jS, studentMember, student, inA.region.seirei, opts, kub, jassoSum) : '') +
      renderKokuho(rA.kokuho) +
      renderIncomeCard(labelA(), rA) + renderIncomeTaxCard(labelA(), rA, inA) + renderResidentCard(labelA(), rA, inA) +
      (rB ? renderIncomeCard(labelB(), rB) + renderIncomeTaxCard(labelB(), rB, inB) + renderResidentCard(labelB(), rB, inB) : '') +
      detailHtml +
      sourcesHtml();

    labelTableCells($('results'));

    $('printBar').style.display = '';
    $('stepResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* 表のマス1つ1つに、それが何の欄なのかを持たせる。
   *
   * 結果の表は「項目 × 人」の形が多く、そのままだと狭い画面で列が潰れて
   * 「51,300円 以上 154,500円 未満」が1文字ずつ折り返され、右端の列は
   * 画面の外に出てしまう。そこで狭い画面では表を縦に積み直すのだが、
   * 積むと列の見出しが失われるため、各マスに見出しを持たせておく。
   * （CSSの ::before で attr(data-label) として表示する）
   *
   * 表を作っている場所は10か所以上あるので、作るときに1つずつ書くのではなく、
   * 出来上がった表から見出しを写す。新しい表を足しても自動で効く。 */
  function labelTableCells(root) {
    root.querySelectorAll('table').forEach(function (table) {
      var rows = table.querySelectorAll('tbody tr, tr');
      if (!rows.length) return;

      /* 値の列がいくつあるかを覚えておく。
       * 1つなら「項目 ─ 値」の1行として出せばよく、枠で囲う必要はない。
       * 2つ以上（人ごとの比較など）のときだけ、1行を1つのまとまりにする。 */
      var valueCols = 0;
      [].forEach.call(rows, function (tr) {
        var n = tr.querySelectorAll(':scope > td').length;
        if (n > valueCols) valueCols = n;
      });
      table.setAttribute('data-value-cols', String(valueCols));

      var heads = [].map.call(table.querySelectorAll('thead th'), function (th) {
        return th.textContent.trim();
      });
      if (heads.length < 2) return;
      [].forEach.call(rows, function (tr) {
        [].forEach.call(tr.children, function (cell, i) {
          // 行の見出し（左端の th）は積んだときの小見出しになるので、名札は要らない
          if (cell.tagName === 'TH') return;
          if (heads[i]) cell.setAttribute('data-label', heads[i]);
        });
      });
    });
  }

  /* ============================================================
   * 9. 初期化
   * ==========================================================*/
  function buildStepNav() {
    var items = [];
    document.querySelectorAll('.step').forEach(function (s) {
      var h2 = s.querySelector('h2');
      var no = s.querySelector('.stepno');
      var title = h2 ? h2.textContent.replace(/^\d+/, '').trim() : '判定結果';
      items.push('<a href="#' + s.id + '" data-target="' + s.id + '">' +
        (no ? '<b>' + no.textContent + '</b>' : '<b>★</b>') + title + '</a>');
    });
    $('stepNav').innerHTML = items.join('');
  }
  function addMember(rel, detail) {
    seq++;
    roster.push({ id: seq, rel: rel, age: rel === 'child' ? 19 : rel === 'parent' ? 75 : 30,
      salary: 0, pension: 0, other: 0, support: 'A', disability: 'none',
      live: true, kokuho: false, detail: !!detail });
    renderRoster();
    refreshAll();
  }
  function updateYearNote() {
    /* 「年分」と「年度」は1年ずれる。今年の収入がどの年度の住民税になるのかは
     * 一番よく聞かれるところなので、実際の暦年から見た呼び方（今年／去年）と
     * 納める時期まで書く。暦年は実行時に見るので、来年になっても表示がずれない。 */
    var y = Number(val('year'));
    var now = new Date().getFullYear();
    var when = y === now ? '<b>今年（' + y + '年1月〜12月）</b>'
      : y === now - 1 ? '<b>去年（' + y + '年1月〜12月）</b>'
        : y + '年1月〜12月';
    var ry = y + 1;                                  // 住民税の年度は所得の翌年
    var reiwaBun = y - 2018, reiwaDo = ry - 2018;    // 令和◯年分／令和◯年度
    $('yearNote').innerHTML =
      '令和' + reiwaBun + '年分＝' + when + 'に稼いだ分です。' +
      'これで決まるのは <b>令和' + reiwaDo + '年度（' + ry + '年度）の住民税</b>' +
      '（' + ry + '年6月〜' + (ry + 1) + '年5月に納めるもの）と、' +
      ry + '年度の国民健康保険料・JASSOの支援区分です。' +
      (y === 2025
        ? '　<b>制度が確定している年分です。</b>'
        : '　令和8年度税制改正（基礎控除104万円・給与所得控除の最低保障74万円など）を反映しています。' +
          (y >= now ? '<b>年の途中なので見込みになります。</b>' : ''));
  }

  /* 起動時の組み立てを、少しずつ区切って進める。
   *
   * STEP 4・5・6 の入力欄は、ここで 800 個ほどの要素を作っている。それを一度に
   * 作ると、ブラウザがそれらを並べ直すのに約300ミリ秒かかり、その間ページは
   * タップにも入力にも反応しない（実測。Lighthouse の Total Blocking Time が
   * 295ms→72ms なので、体感できる差がある）。
   * 区切って渡すと、合間にブラウザが描画と操作を挟めるようになる。
   * 合計の時間は変わらないが、固まる時間がなくなる。
   *
   * setTimeout(…, 0) を使っているのは、requestAnimationFrame と違って
   * 「描画のあと」に確実に戻ってくるため。scheduler.yield は対応状況が狭い。 */
  function stepByStep(steps) {
    var i = 0;
    (function next() {
      steps[i++]();
      if (i < steps.length) setTimeout(next, 0);
    })();
  }

  function init() {
    /* 先に軽いものだけ済ませ、重い組み立ては下の stepByStep にまとめて渡す。
     * 操作の受け口（イベント）は同期で登録しておくので、組み立ての途中で
     * 押されても取りこぼさない。 */
    updateYearNote();

    $('sourceList').innerHTML = D.SOURCES.map(function (s) {
      return '<div class="sourceline"><span class="cat">' + s.c + '</span>' + esc(s.t) +
        '<br><a href="' + s.u + '" target="_blank" rel="noopener">' + s.u + '</a></div>';
    }).join('');
    var total = Object.values(CK).reduce(function (a, b) { return a + b.length; }, 0).toLocaleString('ja-JP');
    ['cityCount', 'cityCount2'].forEach(function (id) { if ($(id)) $(id).textContent = total; });

    /* 税制データの鮮度を画面に出す。
     * 税制は毎年変わるので、古いデータのまま気づかず使われるのが一番こわい。
     * 次回確認日を過ぎていたら、結果を鵜呑みにしないよう注意を出す。 */
    if ($('freshness')) {
      var vd = new Date(D.VERIFIED_AT + 'T00:00:00');
      var nd = new Date(D.NEXT_REVIEW + 'T00:00:00');
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var fmt = function (d) { return d.toLocaleDateString('ja-JP'); };
      var stale = today > nd;
      var days = Math.floor((today - nd) / 86400000);
      $('freshness').className = stale ? 'warn' : 'hint';
      $('freshness').innerHTML = stale
        ? '<b>⚠ 税制データの確認予定日（' + fmt(nd) + '）を ' + days + '日 過ぎています。</b>' +
          'この間に法改正があった場合、結果が実際と合わないことがあります。' +
          '最終確認は ' + fmt(vd) + ' です。必ずお住まいの自治体・国税庁の最新情報でご確認ください。'
        : '税制データの最終確認：<b>' + fmt(vd) + '</b>　／　次回の確認予定：' + fmt(nd) +
          '（毎月18日に自動で公表資料と突き合わせています）';
    }

    $('pref').addEventListener('change', function () { fillCity(); refreshAll(); });
    $('city').addEventListener('change', function () { syncRegion(); refreshAll(); });
    $('year').addEventListener('change', function () { updateYearNote(); refreshAll(); });
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        // 立場を変えたら奨学金の判定も既定値に戻す（学生・夫婦は判定する／ひとりはしない）
        $('useJasso').checked = MODE_LABEL[mode()].jasso;
        renderRoster();
        refreshAll();
      });
    });
    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { addMember(b.dataset.add); });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('[data-addb]')) { meta.B.wanted = true; renderRoster(); refreshAll(); return; }
      if (e.target.closest('[data-delb]')) { meta.B.wanted = false; renderRoster(); refreshAll(); return; }
      var d = e.target.closest('[data-del]');
      if (!d) return;
      roster = roster.filter(function (m) { return String(m.id) !== d.dataset.del; });
      renderRoster(); refreshAll();
    });
    $('calcBtn').addEventListener('click', run);
    $('printBtn').addEventListener('click', function () {
      if ($('results').querySelector('.empty')) { alert('先に［下に判定結果を表示する］を押してください。'); return; }
      var all = val('printScope') === 'all';
      document.body.classList.toggle('print-all', all);
      if (all) document.querySelectorAll('details.guide').forEach(function (d) { d.open = true; });
      window.print();
    });
    $('resetBtn').addEventListener('click', function () {
      if (confirm('入力内容をすべてリセットします。よろしいですか？')) location.reload();
    });

    /* 配色の切替。theme.js が <head> で先に適用済みなので、ここでは
     * ボタンの押下状態を実際の設定に合わせるだけでよい。 */
    var themeBtns = document.querySelectorAll('[data-theme-set]');
    var syncTheme = function () {
      var now = window.TaxTheme ? window.TaxTheme.get() : 'auto';
      themeBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.themeSet === now));
      });
    };
    themeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (window.TaxTheme) window.TaxTheme.set(b.dataset.themeSet);
        syncTheme();
      });
    });
    if (window.TaxTheme) window.TaxTheme.onChange(syncTheme);
    syncTheme();

    var isMoney = function (el) { return el && el.classList && el.classList.contains('money'); };
    document.addEventListener('input', function (e) {
      if (isMoney(e.target)) commafy(e.target);
      refreshAll();
    });
    document.addEventListener('change', function (e) {
      // 「この人の税金も詳しく計算する」の切り替え
      if (e.target.dataset && e.target.dataset.detail) {
        var m = roster.filter(function (x) { return String(x.id) === e.target.dataset.detail; })[0];
        if (m) { m.detail = e.target.checked; renderRoster(); refreshAll(); }
        return;
      }
      // 学生本人を自分で選んだら、以後は自動で上書きしない
      if (e.target.id === 'j_student') e.target.dataset.touched = '1';
      // 生計維持者の続柄。父母が重複したらもう一方を入れ替えて、扶養先の選択肢名も作り直す
      if (e.target.id === 'A_rel' || e.target.id === 'B_rel') {
        var w = e.target.id.charAt(0), o = w === 'A' ? 'B' : 'A';
        meta[w].rel = e.target.value;
        if (meta[o].rel === meta[w].rel && meta[w].rel !== 'other') {
          meta[o].rel = meta[w].rel === 'father' ? 'mother' : 'father';
        }
        renderRoster(); refreshAll();
        return;
      }
      refreshAll();
    });
    document.addEventListener('focusin', function (e) {
      if ((isMoney(e.target) || e.target.type === 'number') && e.target.value === '0') e.target.value = '';
    });
    document.addEventListener('focusout', function (e) {
      if (isMoney(e.target)) { if (e.target.value === '') e.target.value = '0'; else commafy(e.target); }
      else if (e.target.type === 'number' && e.target.value === '') e.target.value = '0';
    });
    // ステップナビの現在地
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (!en.isIntersecting) return;
        document.querySelectorAll('#stepNav a').forEach(function (a) {
          a.classList.toggle('on', a.dataset.target === en.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('.step').forEach(function (s) { obs.observe(s); });

    /* ここから先が重い組み立て。上から順に、1区切りずつ進める。
     * 1区切りを50ミリ秒より短くしたいので、入力欄は①〜⑥のまとまり単位で入れる
     * （まとめて入れると1区切りが約300ミリ秒になり、その間操作できない）。
     * 順番には意味がある：入力欄 → 選択肢 → 世帯員 → 最初の計算。 */
    var chunks = [];
    ['A', 'B'].forEach(function (p) {
      personFormGroups(p).forEach(function (html) {
        chunks.push(function () { $('form' + p).insertAdjacentHTML('beforeend', html); });
      });
    });
    chunks.push(function () { fillPref(); fillCity(); });
    // 初期の世帯構成：学生本人モードなので、学生1人を「詳しく計算する」状態で置く
    chunks.push(function () { addMember('child', true); });
    chunks.push(function () { buildStepNav(); });
    // 制度の解説にある表（HTMLに直接書いてあるもの）にも列の見出しを持たせる。
    // 狭い画面ではこれを使って縦に積み直すため。
    chunks.push(function () { labelTableCells(document); });
    chunks.push(function () { refreshAll(); document.body.dataset.ready = '1'; });
    stepByStep(chunks);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
