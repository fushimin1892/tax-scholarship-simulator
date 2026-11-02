/* 都道府県の超過課税（道府県民税均等割の上乗せ）を公式ページの生HTMLで検証する
 *   node test/verify-prefectures.js            … 全件検証
 *   node test/verify-prefectures.js 群馬県     … 指定した県だけ
 *
 * 要約モデルを通さず、取得したHTMLからタグを除いた本文をそのまま検査するため、
 * 「◯◯円」という記載が実際にあるかを確かめられる。 */
const D = require('../assets/data.js');

/* 各都道府県の一次情報ページ。県の税務／林政担当課のページを優先し、
 * 見つからない場合は当該県内の市区町村（自治体）の個人住民税ページを使う。 */
const SOURCES = {
  '北海道':   ['https://www.pref.hokkaido.lg.jp/sm/zim/tax/kozin_d02.html'],
  '青森県':   ['https://www.pref.aomori.lg.jp/soshiki/zaimu/zeimu/003_01koken.html'],
  '岩手県':   ['https://www.pref.iwate.jp/kensei/zei/gaiyou/kojin/1011185.html'],
  '宮城県':   ['https://www.pref.miyagi.jp/soshiki/zeimu/kojinkenmin.html'],
  '秋田県':   ['https://www.pref.akita.lg.jp/pages/archive/77619'],
  '山形県':   ['https://www.pref.yamagata.jp/020007/zei_shitsumon/midori/midori.html'],
  '福島県':   ['https://www.pref.fukushima.lg.jp/sec/01115d/zeimu23.html'],
  '茨城県':   ['https://www.pref.ibaraki.jp/nourinsuisan/rinsei/shinkozei/tax/gaiyou/index.html'],
  '栃木県':   ['https://www.pref.tochigi.lg.jp/d01/eco/shinrin/zenpan/1216274969214.html'],
  '群馬県':   ['https://www.pref.gunma.jp/site/tax/5384.html', 'https://www.pref.gunma.jp/page/7190.html'],
  '埼玉県':   ['https://www.pref.saitama.lg.jp/a0209/z-kurashiindex/z-2-1.html'],
  '千葉県':   ['https://www.pref.chiba.lg.jp/zeimu/aramashi/shurui/kojin-kenminzei/index.html'],
  '東京都':   ['https://www.tax.metro.tokyo.lg.jp/kazei/life/kojin_ju'],
  '神奈川県': ['https://www.pref.kanagawa.jp/zei/kenzei/a001/b001/002.html'],
  '新潟県':   ['https://www.pref.niigata.lg.jp/sec/zeimu/kkenmin.html'],
  '富山県':   ['https://www.pref.toyama.jp/1107/kurashi/seikatsu/zeikin/kenzei/m01-00/m01-01.html'],
  '石川県':   ['https://www.pref.ishikawa.lg.jp/zei/oshirase/shinrinkankyouzei.html'],
  '福井県':   ['https://www.pref.fukui.lg.jp/doc/zeimu/type/kojinkenmin.html'],
  '山梨県':   ['https://www.pref.yamanashi.jp/zeimu/kojin_kenminzei.html'],
  '長野県':   ['https://www.pref.nagano.lg.jp/zeimu/kurashi/kenze/aramashi/aramashi/kojinkenmin/index.html'],
  '岐阜県':   ['https://www.pref.gifu.lg.jp/page/8460.html'],
  '静岡県':   ['https://www.pref.shizuoka.jp/kurashikankyo/zei/kenzeigaiyou/1002336/1011827.html'],
  '愛知県':   ['https://www.pref.aichi.jp/soshiki/zeimu/0000019017.html'],
  '三重県':   ['https://www.city.inabe.mie.jp/kurashi/zeikin/shikenminzei/1000658.html'],
  '滋賀県':   ['https://www.pref.shiga.lg.jp/ippan/kurashi/zeikin/20003.html'],
  '京都府':   ['https://www.pref.kyoto.jp/zeimu/11600031.html'],
  '大阪府':   ['https://www.pref.osaka.lg.jp/o050040/zei/alacarte/qakojnfmina2.html'],
  '兵庫県':   ['https://web.pref.hyogo.lg.jp/kk22/pa04_000000003.html'],
  '奈良県':   ['https://www.city.nara.lg.jp/soshiki/13/9860.html'],
  '和歌山県': ['https://www.pref.wakayama.lg.jp/prefg/010500/kenzei/kojinkenmin/kojinkenmin.html'],
  '鳥取県':   ['https://www.city.sakaiminato.lg.jp/index.php?view=110590',
               'https://www.city.kurayoshi.lg.jp/1950.htm'],
  '島根県':   ['https://www.pref.shimane.lg.jp/life/zei/ken/syurui/mizuto/mizuto.html'],
  '岡山県':   ['https://www.town.hayashima.lg.jp/soshiki/zeimu/gyomu/zeikin/kojinjuminzei/2096.html',
               'https://www.town.kumenan.lg.jp/living/tax/tax/kojin_jumin.html'],
  '広島県':   ['https://www.pref.hiroshima.lg.jp/site/zei/kojinkenmin.html'],
  '山口県':   ['https://www.pref.yamaguchi.lg.jp/soshiki/5/12445.html'],
  '徳島県':   ['https://www.pref.tokushima.lg.jp/FAQ/docs/00003513/'],
  '香川県':   ['https://www.city.takamatsu.kagawa.jp/kurashi/kurashi/tax/siminzei/kazei/kazeinosikumi.html'],
  '愛媛県':   ['https://www.pref.ehime.jp/h10500/1191372_1874.html'],
  '高知県':   ['https://www.pref.kochi.lg.jp/doc/zei-shikumi/'],
  '福岡県':   ['https://www.pref.fukuoka.lg.jp/contents/kojinkenminzei.html'],
  '佐賀県':   ['https://www.city.saga.lg.jp/kurashi/zeikin/4/1/2555.html'],
  '長崎県':   ['https://www.city.nagasaki.lg.jp/page/5904.html'],
  '熊本県':   ['https://www.pref.kumamoto.jp/soshiki/16/1678.html'],
  '大分県':   ['https://www.pref.oita.jp/site/zei/koken.html'],
  '宮崎県':   ['https://www.city.miyakonojo.miyazaki.jp/soshiki/25/2337.html',
               'https://eco.pref.miyazaki.lg.jp/forest/tax/'],
  '鹿児島県': ['http://www.pref.kagoshima.jp/ab07/kurashi-kankyo/zei/aramashi/shigoto/sigoto1.html'],
  '沖縄県':   ['https://www.city.naha.okinawa.jp/kurasitetuduki/zei/1001798/1001799.html']
};

/* 全角の数字・カンマ・記号を半角に直す（自治体のページは全角表記が多い） */
const toHalf = (s) => s
  .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .replace(/[，、]/g, ',').replace(/[　]/g, ' ');

const stripTags = (html) => toHalf(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'))
  .replace(/\s+/g, ' ');

/* 本文中の「◯◯円」を拾う（均等割の上乗せは数百〜千数百円の範囲） */
function findAmounts(text) {
  const hits = new Set();
  for (const m of text.matchAll(/[0-9][0-9,]{1,6}\s*円/g)) {
    const v = Number(m[0].replace(/[^0-9]/g, ''));
    if (v >= 100 && v <= 3000) hits.add(v);
  }
  return [...hits].sort((a, b) => a - b);
}
function contextAround(text, keyword, span) {
  const i = text.indexOf(keyword);
  if (i < 0) return '';
  return text.slice(Math.max(0, i - span), i + span);
}

(async () => {
  const only = process.argv[2];
  const targets = D.PREFECTURES.filter(p => !only || p.n === only);
  let ok = 0, ng = 0, unknown = 0;
  console.log('都道府県 | 収録値 | 公式ページで確認できた金額 | 判定');
  console.log('---------|--------|--------------------------|------');

  for (const pref of targets) {
    const urls = SOURCES[pref.n] || [];
    let text = '', status = '';
    for (const u of urls) {
      try {
        const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (local-tax-tool)' }, redirect: 'follow' });
        status = res.status;
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        // 文字コード判定（UTF-8以外はShift_JIS/EUC-JPの可能性）
        let html = buf.toString('utf8');
        if (/charset=["']?(shift_jis|sjis|windows-31j)/i.test(html.slice(0, 2000))) {
          html = new TextDecoder('shift_jis').decode(buf);
        } else if (/charset=["']?euc-jp/i.test(html.slice(0, 2000))) {
          html = new TextDecoder('euc-jp').decode(buf);
        }
        text = stripTags(html);
        if (text.length > 500) break;
      } catch (e) { status = e.code || 'ERR'; }
    }

    const expected = pref.add;
    if (!text) {
      unknown++;
      console.log(`${pref.n} | ${expected}円 | 取得失敗(${status}) | ⚠ 未確認`);
      continue;
    }
    /* 二重の証拠で判定する。
     *   証拠A … 上乗せ額そのもの（例：500円）が本文にある
     *   証拠B … 道府県民税均等割の総額（標準税率1,000円＋上乗せ）が本文にある
     * ページによってどちらの書き方をするかが違うため、どちらか一方でも
     * 一致すれば ✅、両方あれば ✅✅（強い証拠）とする。
     * 上乗せなしの県は「1,000円」＝証拠Bだけで判定できる。 */
    const amounts = findAmounts(text);
    const total = 1000 + expected;          // 道府県民税均等割の年額
    const hasAdd = expected > 0 && amounts.includes(expected);
    const hasTotal = amounts.includes(total);
    const found = expected === 0 ? hasTotal : (hasAdd || hasTotal);
    const mark = (hasAdd && hasTotal) ? '✅✅ 一致（上乗せ額・均等割総額とも）'
               : hasAdd ? '✅ 一致（上乗せ額）'
               : hasTotal ? `✅ 一致（均等割総額${total.toLocaleString()}円）`
               : '❌ 要確認';
    const label = expected === 0 ? '上乗せなし(均等割1,000円)' : `${expected}円`;
    if (found) {
      ok++;
      console.log(`${pref.n} | ${label} | ${amounts.join(',')} | ${mark}`);
    } else {
      ng++;
      const ctx = contextAround(text, '均等割', 120).slice(0, 200);
      console.log(`${pref.n} | ${label} | 見つからず 候補:[${amounts.join(',')}] | ❌ 要確認`);
      if (ctx) console.log(`        文脈: …${ctx}…`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n一致 ${ok} / 要確認 ${ng} / 目視要 ${unknown}`);
})();
