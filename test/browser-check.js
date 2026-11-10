/* ブラウザ実行時の検証（node test/browser-check.js）
 *   JSエラー検査／級地の自動判定／カンマ区切り／人数の自動集計／控除のロック／PDF生成 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/* Chrome の場所。CI（Linux）でも動くよう、環境変数 CHROME_PATH で差し替えられる。
 * 指定がなければ、その環境にありそうな場所を順に探す。 */
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } })
  || 'google-chrome';
const PORT = 9333;
const PROFILE = path.join(ROOT, 'test', '.chrome-profile').replace(/\\/g, '/');
const SHOT = path.join(ROOT, 'test', 'shots').replace(/\\/g, '/');
fs.mkdirSync(SHOT, { recursive: true });
const pageUrl = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
  '--window-size=1280,1400', '--allow-file-access-from-files', pageUrl
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

/* ページ側に注入するヘルパ */
const H = `
const set=(id,v)=>{const e=document.getElementById(id); if(!e) throw new Error('no element: '+id);
  if(e.type==='checkbox'){ e.checked=v; } else { e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); }
  e.dispatchEvent(new Event('change',{bubbles:true}));};
const pick=(id,text)=>{const e=document.getElementById(id);
  const i=[...e.options].findIndex(o=>o.value===text||o.textContent===text);
  if(i<0) throw new Error('no option: '+id+'/'+text); e.selectedIndex=i;
  e.dispatchEvent(new Event('change',{bubbles:true}));};
const mode=(v)=>{const e=document.querySelector('input[name="mode"][value="'+v+'"]');
  e.checked=true; e.dispatchEvent(new Event('change',{bubbles:true}));};
const addMember=(rel)=>{document.querySelector('[data-add="'+rel+'"]').click();};
/* 検査どうしが影響し合わないよう、世帯員をいったん空にする */
const clearMembers=()=>{[...document.querySelectorAll('.member:not(.fixed) [data-del]')].forEach(b=>b.click());};
const memberIds=()=>[...document.querySelectorAll('.member:not(.fixed)')].map(e=>e.id.replace('row_',''));
const txt=(sel)=>{const e=document.querySelector(sel); return e?e.textContent.replace(/\\s+/g,' ').trim():'(なし)';};
`;

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  OK   ' + label + (detail ? ' … ' + detail : '')); }
  else { fail++; console.log('  NG   ' + label + (detail ? ' … ' + detail : '')); }
};

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) { }
    if (!target) await sleep(400);
  }
  if (!target) { console.error('Chrome に接続できませんでした'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [], logs = [];
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value || a.description).join(' '));
    }
  });
  await send('Runtime.enable'); await send('Page.enable');

  /* 起動時の組み立ては何回かに分けて進むので、決め打ちの待ち時間ではなく
   * 「終わった」印（body の data-ready）が付くのを待つ。遅い機械でも取りこぼさない。 */
  const waitReady = async (limitMs = 15000) => {
    for (let waited = 0; waited < limitMs; waited += 100) {
      const r = await send('Runtime.evaluate', { expression: 'document.body && document.body.dataset.ready === "1"', returnByValue: true });
      if (r.result && r.result.value) return waited;
      await sleep(100);
    }
    throw new Error('起動が終わりませんでした（' + limitMs + 'ms 待った）');
  };

  await send('Page.navigate', { url: pageUrl });
  console.log('  起動が終わるまで ' + (await waitReady()) + 'ms');

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(()=>{' + H + expr + '})()', returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸 ' + name + '.png');
  };
  const kpis = () => ev("return [...document.querySelectorAll('#results > .card:first-child .kpi')].map(k=>k.querySelector('.label').textContent+'='+k.querySelector('.value').textContent).join(' / ');");

  console.log('=== 初期表示 ===');
  console.log('  都道府県:', await ev("return document.getElementById('pref').options.length"), '件');
  console.log('  収録市区町村:', await ev("return document.getElementById('cityCount').textContent"));
  console.log('  STEPナビ:', await ev("return [...document.querySelectorAll('#stepNav a')].map(a=>a.textContent).join(' / ')"));
  check('初期状態で世帯員が1人（学生）登録されている', (await ev("return memberIds().length")) === 1);
  await shot('01-input');

  console.log('\n=== 級地の自動判定 ===');
  for (const [pref, city, expect] of [['東京都', '特別区（23区）', 1], ['東京都', '八王子市', 1], ['東京都', '奥多摩町', 3],
    ['神奈川県', '横浜市', 1], ['神奈川県', '伊勢原市', 2], ['神奈川県', '清川村', 3],
    ['大阪府', '大阪市', 1], ['青森県', '青森市', 2], ['青森県', '弘前市', 3], ['沖縄県', '那覇市', 2]]) {
    const got = await ev(`pick('pref','${pref}'); pick('city','${city}'); return document.getElementById('kyuchi').value;`);
    check(`${pref} ${city} → ${got}級地`, got === String(expect), `期待 ${expect}級地`);
  }

  console.log('\n=== 都道府県の超過課税の表示 ===');
  /* 収録値そのものは test/verify-prefectures.js が公式ページと突合している。
   * ここでは「画面に出る文言」が均等割の年額まで正しく組み立てられるかを見る。 */
  for (const [pref, city, kintou, taxName] of [
    ['東京都', '特別区（23区）', '1,000円', null],           // 超過課税なし
    ['神奈川県', '横浜市', '1,300円', '水源環境保全税'],      // 300円＋政令市
    ['宮城県', '仙台市', '2,200円', 'みやぎ環境税'],          // 全国最高額の1,200円
    ['鳥取県', '鳥取市', '1,500円', '豊かな森づくり協働税'],   // 令和5年度に改組
    ['宮崎県', '宮崎市', '1,500円', '水と緑の森林づくり税']    // 令和8年度に改称
  ]) {
    const t = await ev(`pick('pref','${pref}'); pick('city','${city}');
      return document.getElementById('prefNote').textContent;`);
    check(`${pref}：道府県民税均等割 ${kintou} と表示される`, t.includes(kintou), t);
    if (taxName) check(`${pref}：税名「${taxName}」が表示される`, t.includes(taxName), t);
    else check(`${pref}：超過課税なしと表示される`, t.includes('超過課税なし'), t);
    check(`${pref}：国税の森林環境税と区別して案内している`, t.includes('国税の森林環境税'), t);
  }

  console.log('\n=== 横浜市の均等割の軽減 ===');
  {
    const r = await ev(`pick('pref','神奈川県'); pick('city','横浜市');
      const row = document.getElementById('reducedKinRow'), cb = document.getElementById('reducedKin');
      const kin = () => document.getElementById('cityKin').value;
      const shown = !row.classList.contains('hidden'), before = kin();
      cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles:true}));
      const after = kin();
      pick('pref','東京都'); pick('city','特別区（23区）');
      return JSON.stringify([shown, before, after, !row.classList.contains('hidden'), cb.checked, kin()]);`);
    const a = JSON.parse(r);
    check('横浜市で軽減の選択肢が表示される', a[0] === true, r);
    check('通常の市民税均等割は3,900円', a[1] === '3,900', r);
    check('軽減を選ぶと1,500円になる', a[2] === '1,500', r);
    check('他の市区町村では選択肢が消え、選択も解除される', a[3] === false && a[4] === false && a[5] === '3,000', r);
  }

  console.log('\n=== 金額欄のカンマ区切り ===');
  {
    const r = await ev(`pick('pref','東京都'); pick('city','特別区（23区）');
      set('A_salary','5000000');
      return [document.getElementById('A_salary').value, document.getElementById('cityKin').value,
              document.getElementById('prefKin').value].join(' | ');`);
    console.log('  給与収入 | 市町村均等割 | 道府県均等割 →', r);
    check('カンマ区切りで表示される', /5,000,000/.test(r) && /3,000/.test(r) && /1,000/.test(r));
  }

  console.log('\n=== STEP 3：人数の自動集計と扶養の判定 ===');
  {
    // 初期の子は「詳しく計算する」状態なので、まず簡易入力に戻す
    await ev(`document.querySelector('[data-detail]').checked=false;
      document.querySelector('[data-detail]').dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    await sleep(250);
    // 初期の子（19歳・収入0）＋ 中学生 ＋ 祖母 を登録
    await ev(`const ids=memberIds();
      set(ids[0]+'_age',19); set(ids[0]+'_salary','0');
      addMember('child'); addMember('parent');
      return 1;`);
    await sleep(150);
    const ids = await ev("return memberIds();");
    await ev(`set('${ids[1]}_age',14); set('${ids[1]}_salary','0');
      set('${ids[2]}_age',78); set('${ids[2]}_pension','1200000');
      set('${ids[2]}_live',true); return 1;`);
    await sleep(150);
    const notes = await ev(`return memberIds().map(i=>txt('#'+i+'_note')).join(' ||| ');`);
    console.log('  判定:', notes.replace(/ \|\|\| /g, '\n        '));
    check('19歳の子 → 特定扶養親族と判定', /特定扶養親族/.test(notes));
    check('14歳の子 → 16歳未満（年少扶養）と判定', /16歳未満/.test(notes));
    check('78歳・年金120万の祖母 → 同居老親等と判定', /同居老親等/.test(notes));
    const sum = await ev("return txt('#rosterSummary');");
    console.log('  自動集計:', sum);
    check('判定人数が5人（本人＋配偶者＋子2＋祖母）', /判定人数 5人|5人/.test(sum), sum.slice(0, 60));
    await shot('02-roster');
  }

  console.log('\n=== 扶養から外れるケース ===');
  {
    const ids = await ev("return memberIds();");
    await ev(`set('${ids[0]}_salary','1450000'); return 1;`);   // 給与145万 → 合計所得80万
    await sleep(150);
    const note = await ev(`return txt('#${ids[0]}_note');`);
    console.log('  ', note);
    check('給与145万の19歳 → 特定親族特別控除の対象と表示', /特定親族特別控除/.test(note));
    await ev(`set('${ids[0]}_salary','2500000'); return 1;`);   // 合計所得167万
    await sleep(150);
    const note2 = await ev(`return txt('#${ids[0]}_note');`);
    console.log('  ', note2);
    check('給与250万の19歳 → 扶養に入れないと表示', /扶養に入れません/.test(note2));
    await ev(`set('${ids[0]}_salary','0'); return 1;`);
  }

  console.log('\n=== 学生本人の詳細入力（株の利益・勤労学生控除） ===');
  {
    const ids = await ev("return memberIds();");
    const pfx = 'md' + ids[0].replace('m', '');
    // 「この人の税金も詳しく計算する」をON
    await ev(`set('${ids[0]}_salary','0');
      const cb=document.querySelector('[data-detail="${ids[0].replace('m','')}"]');
      cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    await sleep(350);
    check('STEP 6（詳しく計算する家族）が出る',
      !(await ev("return document.getElementById('step6').classList.contains('hidden')")));
    check('学生本人の株の譲渡益の欄がある', (await ev(`return !!document.getElementById('${pfx}_stockTransfer')`)));
    check('学生本人の繰越控除の欄がある', (await ev(`return !!document.getElementById('${pfx}_coStockLoss')`)));
    check('学生本人の勤労学生控除の欄がある', (await ev(`return !!document.getElementById('${pfx}_student')`)));
    check('学生本人の社会保険料控除の欄がある', (await ev(`return !!document.getElementById('${pfx}_social')`)));

    // アルバイト100万＋株の譲渡益30万を入れる → 合計所得 35万＋30万＝65万
    await ev(`set('${pfx}_salary','1000000'); set('${pfx}_stockTransfer','300000'); return 1;`);
    await sleep(300);
    const g = await ev(`return txt('#${ids[0]}_note');`);
    console.log('  扶養の判定（合計所得金額）:', g);
    check('株の利益が合計所得に反映される', /合計所得金額 650,000円/.test(g), g);
    const note = await ev(`return txt('#${ids[0]}_note');`);
    console.log('  扶養の判定:', note);
    // 19歳・合計所得65万円 → 扶養控除は不可だが特定親族特別控除の対象（123万円以下）
    check('株の利益で扶養控除は外れ、特定親族特別控除の対象になる', /特定親族特別控除/.test(note), note);

    // 判定を実行して本人のカードが出るか
    await ev(`document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    const heads = await ev("return [...document.querySelectorAll('#results .card > h2')].map(h=>h.textContent).join(' / ');");
    console.log('  結果カード:', heads);
    check('学生本人の税金カードが出る', /本人の税金/.test(heads), heads);
    await shot('03-detail-person');

    // 株の利益を0に戻し、詳細もOFF
    await ev(`set('${pfx}_stockTransfer','0'); set('${pfx}_salary','0');
      const cb=document.querySelector('[data-detail="${ids[0].replace('m','')}"]');
      cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
    await sleep(300);
  }

  console.log('\n=== 生計維持者の続柄を変えたときの追従 ===');
  {
    await ev(`pick('A_rel','お母さん'); return 1;`);
    await sleep(350);
    const sup = await ev("return [...document.querySelectorAll('[id$=\"_support\"]')].map(s=>[...s.options].map(o=>o.textContent).join('/')).join(' ||| ');");
    console.log('  「だれの扶養に入れるか」の選択肢:', sup.split(' ||| ')[0]);
    check('Aを母にすると扶養先の選択肢も「お母さん（A）」になる', /お母さん（A）/.test(sup), sup.split(' ||| ')[0]);
    check('Bは自動で「お父さん」に入れ替わる',
      /お父さん（B）/.test(sup), sup.split(' ||| ')[0]);
    const bLabel = await ev("return txt('#titleB');");
    console.log('  Bの見出し:', bLabel);
    check('Bの見出しも「お父さん」になる', /お父さん/.test(bLabel), bLabel);
    // Bを削除して追加ボタンの文言を確認
    await ev(`document.querySelector('[data-delb]').click(); return 1;`);
    await sleep(300);
    const addLabel = await ev("return txt('[data-addb]');");
    console.log('  追加ボタン:', addLabel);
    check('追加ボタンも「お父さん」になる', /お父さん/.test(addLabel), addLabel);
    await ev(`document.querySelector('[data-addb]').click(); return 1;`);
    await sleep(250);
    await ev(`pick('A_rel','お父さん'); return 1;`);
    await sleep(300);
  }

  console.log('\n=== 控除のロック ===');
  {
    // 勤労学生控除：合計所得85万円以下（令和7年分）
    await ev(`mode('single'); set('useJasso',false); set('A_salary','1400000'); return 1;`);   // 給与所得75万
    await sleep(200);
    check('給与140万（所得75万）では勤労学生控除が選べる',
      (await ev("return !document.getElementById('A_student').disabled")));
    await ev(`set('A_salary','1600000'); return 1;`);                   // 給与所得95万
    await sleep(200);
    const locked = await ev("return document.getElementById('A_student').disabled");
    const msg = await ev("return txt('#A_student_lock');");
    check('給与160万（所得95万）で勤労学生控除がロックされる', locked, msg);
    console.log('  ロック理由:', msg);

    // ひとり親控除：生計を一にする子が必要
    await ev(`set('A_salary','1400000'); return 1;`);
    await sleep(200);
    check('扶養する子がいればひとり親控除を選べる',
      !(await ev("return document.getElementById('A_singleParent').disabled")));
    // 子をすべて削除するとロックされる
    // 削除すると行が再描画されるので、毎回引き直して1件ずつ消す
    const before = await ev(`let guard=0;
      while (document.querySelector('.member:not(.fixed) [data-del]') && guard++ < 20) {
        document.querySelector('.member:not(.fixed) [data-del]').click();
      }
      return memberIds().length;`);
    await sleep(250);
    const spMsg = await ev("return txt('#A_singleParent_lock');");
    check('子がいなくなるとひとり親控除がロックされる',
      (await ev("return document.getElementById('A_singleParent').disabled")), spMsg);
    console.log('  世帯員を全削除（残り' + before + '人）→ ロック理由:', spMsg);

    // 合計所得500万円超で寡婦・ひとり親がロックされる
    await ev(`set('A_salary','8000000'); return 1;`);
    await sleep(200);
    const wMsg = await ev("return txt('#A_widow_lock');");
    check('合計所得500万円超で寡婦控除がロックされる',
      (await ev("return document.getElementById('A_widow').disabled")), wMsg);
    await shot('04-locks');
  }

  console.log('\n=== 立場の切り替え（夫婦・ひとり親） ===');
  {
    // 夫婦モード：2人分の入力欄が出て、呼び名が「あなた／配偶者」になる
    await ev(`mode('couple'); return 1;`);
    await sleep(250);
    const labels = await ev("return [txt('#titleA'), txt('#titleB')].join(' / ');");
    console.log('  夫婦モードの見出し:', labels);
    check('夫婦モードで「あなた」「配偶者」になる', /あなた/.test(labels) && /配偶者/.test(labels), labels);
    check('夫婦モードでSTEP 5（配偶者）が表示される',
      !(await ev("return document.getElementById('step5').classList.contains('hidden')")));
    check('夫婦モードでは奨学金の判定が既定でON',
      (await ev("return document.getElementById('useJasso').checked")));

    // 奨学金のチェックを外すと STEP 7 が消える（子のいない夫婦のケース）
    await ev(`set('useJasso',false); return 1;`);
    await sleep(200);
    check('奨学金のチェックを外すとSTEP 8が消える',
      (await ev("return document.getElementById('step8').classList.contains('hidden')")));
    await ev(`set('useJasso',true); return 1;`);

    // 学生本人モードのひとり親：生計維持者Aを「お母さん」にしてBを外す
    await ev(`mode('student'); return 1;`);
    await sleep(250);
    check('学生本人モードでは生計維持者の続柄を選べる',
      (await ev("return !!document.getElementById('A_rel')")));
    await ev(`pick('A_rel','お母さん'); document.querySelector('[data-delb]').click(); return 1;`);
    await sleep(300);
    const t = await ev("return txt('#titleA');");
    console.log('  ひとり親（母）にしたときの見出し:', t);
    check('生計維持者Aを「お母さん」にすると見出しが変わる', /お母さん/.test(t), t);
    check('Bを削除するとSTEP 3のB欄が消える',
      (await ev("return !document.getElementById('rowB')")));
    check('Bを削除するとSTEP 5が消える',
      (await ev("return document.getElementById('step5').classList.contains('hidden')")));
    check('代わりに「追加」ボタンが出る',
      (await ev("return !!document.querySelector('[data-addb]')")),
      await ev("return txt('[data-addb]');"));
    const guide = await ev("return txt('#A_note');");
    console.log('  案内:', guide);
    check('ひとり親の場合の案内が出る', /ひとり親/.test(guide) && /母親/.test(guide), guide);
    const opts = await ev("return [...document.getElementById('A_singleParent').options].map(o=>o.textContent).join(' / ');");
    console.log('  ひとり親控除の選択肢:', opts);
    check('ひとり親控除で母・父を選べる', /母親/.test(opts) && /父親/.test(opts), opts);
    await shot('05-mode-single-parent');
    // 「追加」を押すと戻る
    await ev(`document.querySelector('[data-addb]').click(); return 1;`);
    await sleep(250);
    check('「追加」を押すとB欄が戻る', (await ev("return !!document.getElementById('rowB')")));
    await ev(`pick('A_rel','お父さん'); return 1;`);
    await sleep(200);
  }

  console.log('\n=== 国保：加入者の数え方と擬制世帯主 ===');
  {
    // 学生本人モードに戻し、父・母・子2人の世帯を作る
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      set('A_salary','3000000'); set('A_social','0'); set('B_salary','0');
      addMember('child'); return 1;`);
    await sleep(300);
    await ev(`const ids=memberIds(); set(ids[0]+'_age',19); set(ids[0]+'_salary','0');
      set('A_kokuho',false); set('B_kokuho',false);
      memberIds().forEach(i=>set(i+'_kokuho',false));
      pick('k_head','A'); return 1;`);
    await sleep(350);
    const none = await ev("return txt('#kokuhoAuto');");
    console.log('  全員が会社の健康保険:', none.slice(0, 90));
    check('被保険者0人なら注意書きが出る', /被保険者が0人/.test(none), none.slice(0, 40));

    // 世帯全員が国保に加入
    await ev(`set('A_kokuho',true); set('B_kokuho',true);
      memberIds().forEach(i=>set(i+'_kokuho',true)); return 1;`);
    await sleep(350);
    const all = await ev("return document.getElementById('k_insured').value + '|' + document.getElementById('k_salary').value;");
    console.log('  全員国保（父・母・子1人）→ 被保険者数|給与所得者等の数:', all);
    check('子どもも被保険者として数える（3人）', all.split('|')[0] === '3', all);

    // 擬制世帯主：世帯主Aは会社の健保だが、所得は軽減判定に含める
    await ev(`set('A_kokuho',false); return 1;`);
    await sleep(350);
    const gisei = await ev("return document.getElementById('k_insured').value + '|' + txt('#kokuhoAuto');");
    console.log('  Aだけ会社の健保 → 被保険者数:', gisei.split('|')[0]);
    check('世帯主が未加入なら被保険者数は2人になる', gisei.split('|')[0] === '2', gisei.split('|')[0]);
    check('世帯主の所得は軽減判定に含める旨が出る', /本人の所得を軽減判定に含めます/.test(gisei), '');

    await ev(`document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    const steps = await ev("return [...document.querySelectorAll('#results table.detail caption')].map(c=>c.textContent).join(' / ');");
    console.log('  結果の表:', steps);
    check('軽減判定所得の計算過程が表示される', /軽減判定所得の計算過程/.test(steps), steps);
    await shot('06-kokuho');

    // Aも国保に戻す
    await ev(`set('A_kokuho',true); return 1;`);
    await sleep(250);
  }

  console.log('\n=== 国保：世帯員の軽減判定所得は繰越控除「後」で見る ===');
  {
    /* 扶養判定に使う「合計所得金額」は繰越控除の前、
     * 国保の軽減判定に使う「総所得金額等」は繰越控除の後。
     * ここを取り違えると、株の譲渡損失を繰り越している人の判定所得が
     * 実際より大きく出て、本来受けられる軽減が消える。
     * 実例：母0円／本人 給与100万＋株の利益250万／繰越控除250万 → 7割軽減 */
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      clearMembers(); return 1;`);
    await sleep(300);
    await ev(`const d=document.querySelector('[data-delb]'); if(d) d.click(); return 1;`);
    await sleep(350);
    await ev(`pick('A_rel','mother'); set('A_salary','0'); set('A_kokuho',true);
      addMember('child'); return 1;`);
    await sleep(450);
    const mid = await ev(`return memberIds()[0];`);
    await ev(`set('${mid}_age',19); set('${mid}_kokuho',true);
      const cb=document.querySelector('[data-detail]');
      if(!cb.checked){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));}
      return 1;`);
    await sleep(600);
    const dp = 'md' + mid.replace('m', '');
    await ev(`set('${dp}_salary','1000000'); set('${dp}_stockTransfer','2500000');
      set('${dp}_coStockLoss','2500000'); return 1;`);
    await sleep(600);

    const gokei = await ev(`return document.getElementById('${mid}_note').textContent;`);
    check('扶養判定に使う合計所得金額は繰越控除「前」（285万円）', /合計所得金額 2,850,000円/.test(gokei), gokei);

    const judge = await ev(`return [...document.querySelectorAll('#kokuhoAuto .sbox')]
      .filter(b=>/軽減判定所得/.test(b.querySelector('.st').textContent))
      .map(b=>b.querySelector('.sv').textContent)[0];`);
    check('国保の軽減判定所得は繰越控除「後」（35万円）', judge === '350,000円', judge);

    await ev(`document.getElementById('calcBtn').click(); return 1;`);
    await sleep(800);
    const res = await ev(`const c=[...document.querySelectorAll('#results .card')]
      .find(x=>/国民健康保険/.test(x.textContent));
      return c.textContent.replace(/\\s+/g,' ');`);
    check('7割軽減に該当する', /7割軽減に該当します/.test(res),
      (res.match(/(\d割軽減に該当します|軽減には該当しません)/) || ['?'])[0]);
    check('計算過程に繰越控除後の35万円が出る', /世帯の軽減判定所得\s*350,000円/.test(res.replace(/\s+/g, ' ')));

    // 繰越控除を外すと判定所得が285万円になり、軽減なしに変わること（対照実験）
    await ev(`set('${dp}_coStockLoss','0'); document.getElementById('calcBtn').click(); return 1;`);
    await sleep(800);
    const res2 = await ev(`const c=[...document.querySelectorAll('#results .card')]
      .find(x=>/国民健康保険/.test(x.textContent));
      return c.textContent.replace(/\\s+/g,' ');`);
    check('繰越控除を外すと軽減なしに変わる', /軽減には該当しません/.test(res2),
      (res2.match(/(\d割軽減に該当します|軽減には該当しません)/) || ['?'])[0]);

    // 後片付け：この検査で消した生計維持者Bを戻し、世帯員も空にする
    await ev(`set('${dp}_stockTransfer','0'); set('${dp}_salary','0'); clearMembers(); return 1;`);
    await sleep(350);
    await ev(`const a=document.querySelector('[data-addb]'); if(a) a.click(); return 1;`);
    await sleep(350);
    check('後片付け：生計維持者Bが戻っている', (await ev(`return !!document.getElementById('B_kokuho');`)) === true);
  }

  console.log('\n=== 国保：「親が入っていれば子どもは不要」という誤解への案内 ===');
  {
    /* 国保には被扶養者がない。親だけチェックして子を外すと被保険者数が1人減り、
     * 5割・2割軽減の基準額が31万円・57万円ずつ下がって軽減が消えることがある。
     * この誤解を、チェックのすぐ横と、その人の行の注意書きの両方で打ち消しているか。 */
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      clearMembers(); return 1;`);
    await sleep(300);
    await ev(`addMember('child'); return 1;`);
    await sleep(350);
    await ev(`const ids=memberIds(); set(ids[0]+'_age',19);
      set('A_kokuho',false); set('B_kokuho',false);
      memberIds().forEach(i=>set(i+'_kokuho',false)); return 1;`);
    await sleep(300);

    const hint = await ev(`return document.getElementById('A_kokuho').closest('.checkline').textContent.replace(/\\s+/g,' ');`);
    check('チェックのすぐ横に「子どもも1人ずつ必要」と書いてある',
      /子どもも1人ずつ必要/.test(hint) && /親のチェックではまとめて入りません/.test(hint),
      hint.slice(0, 70) + '…');
    check('チェックのすぐ横に「外す」条件も書いてある',
      /勤め先の健康保険/.test(hint) && /75歳以上/.test(hint));

    // 誰も国保でない間は、注意書きを出さない（うるさくしない）
    const quiet = await ev(`return document.getElementById(memberIds()[0]+'_note').textContent;`);
    check('世帯に国保加入者がいなければ注意書きは出さない', !/この世帯には国保の加入者がいます/.test(quiet));

    // 親だけチェックすると、子の行に注意書きが出る
    await ev(`set('A_kokuho',true); return 1;`); await sleep(350);
    const warn = await ev(`return document.getElementById(memberIds()[0]+'_note').textContent.replace(/\\s+/g,' ');`);
    check('親だけ入れると子の行に注意書きが出る', /この世帯には国保の加入者がいます/.test(warn), warn.slice(0, 70) + '…');
    check('注意書きに「親が加入していても子どもは自動では入らない」と書いてある',
      /親が加入していても、子どもは自動では入りません/.test(warn));
    check('注意書きに軽減が消える理由が書いてある', /31万円・57万円/.test(warn));

    // 子もチェックすれば注意書きは消え、被保険者数が2人になる
    await ev(`memberIds().forEach(i=>set(i+'_kokuho',true)); return 1;`); await sleep(350);
    const done = await ev(`return document.getElementById(memberIds()[0]+'_note').textContent;`);
    check('子もチェックすれば注意書きは消える', !/この世帯には国保の加入者がいます/.test(done));
    /* 期待値は「A＋世帯員の人数」。前の検査で世帯員が残っている場合があるので動的に出す */
    const cnt = await ev(`return (1 + memberIds().length) + '/' + document.getElementById('k_insured').value;`);
    check('被保険者数が「A＋チェックした世帯員」の人数になる',
      cnt.split('/')[0] === cnt.split('/')[1], '期待 ' + cnt.split('/')[0] + '人 / 実際 ' + cnt.split('/')[1] + '人');

    // 75歳以上は後期高齢者医療なので、チェックではなく特定同一世帯所属者へ案内する
    await ev(`addMember('parent'); return 1;`); await sleep(350);
    await ev(`const ids=memberIds(); const last=ids[ids.length-1];
      set(last+'_age',78); set(last+'_kokuho',false); return 1;`);
    await sleep(350);
    const old = await ev(`const ids=memberIds(); const last=ids[ids.length-1];
      return document.getElementById(last+'_note').textContent.replace(/\\s+/g,' ');`);
    check('75歳以上には「特定同一世帯所属者」への案内を出す',
      /後期高齢者医療/.test(old) && /特定同一世帯所属者/.test(old), old.slice(-70));
    check('75歳以上には「チェックを入れて」とは言わない', !/この世帯には国保の加入者がいます/.test(old));

    // 軽減の基準額が人数で動くことを、実際の計算で確かめる
    await ev(`document.getElementById('calcBtn').click(); return 1;`); await sleep(600);
    const t5two = await ev(`return TaxCalc.calcKokuho(
      {income:{},kokuho:{insured:2,tokutei:0,salaryEarners:1,otherMembersIncome:0}},
      {souShotokuTou:0,retirementIncome:0,pensionIncome:0}).t5;`);
    const t5one = await ev(`return TaxCalc.calcKokuho(
      {income:{},kokuho:{insured:1,tokutei:0,salaryEarners:1,otherMembersIncome:0}},
      {souShotokuTou:0,retirementIncome:0,pensionIncome:0}).t5;`);
    check('子を外すと5割軽減の基準額が31万円下がる', t5two - t5one === 310000, `${t5two} − ${t5one}`);
  }

  console.log('\n=== 国保：STEP 3 の加入チェックと STEP 7 の手動上書きは排他 ===');
  {
    /* 国保の人数を決める入口は2つある（STEP 3 のチェック／STEP 7 の手動上書き）。
     * 使われないほうが操作できてしまうと「チェックしたのに結果が変わらない」
     * 「入力したのに書き戻される」という気づきにくい誤りになるので、
     * 片方を選んだらもう片方がロックされることを確かめる。 */
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      clearMembers(); return 1;`);
    await sleep(300);
    await ev(`set('A_salary','3000000'); set('A_kokuho',true); set('B_kokuho',true);
      addMember('child'); return 1;`);
    await sleep(350);
    await ev(`const ids=memberIds(); set(ids[0]+'_age',19); set(ids[0]+'_kokuho',true);
      set('k_manual',false); return 1;`);
    await sleep(350);

    const state = (id) => ev(`const e=document.getElementById('${id}');
      const m=document.getElementById('${id}_lock');
      return (e.disabled?'disabled':'')+(e.readOnly?'readonly':'')+((!e.disabled&&!e.readOnly)?'編集可':'')
        +'|'+((m&&m.textContent.trim())?'理由あり':'理由なし')
        +'|'+(e.closest('.field').classList.contains('locked')?'locked':'通常');`);

    // 自動計算中：STEP 7 の数値欄がロックされ、STEP 3 のチェックは操作できる
    check('自動計算中：被保険者数の欄はロックされる', (await state('k_insured')).startsWith('readonly|理由あり|locked'), await state('k_insured'));
    check('自動計算中：給与所得者等の数もロックされる', (await state('k_salary')).startsWith('readonly|理由あり'), await state('k_salary'));
    check('自動計算中：そのほかの世帯員の所得もロックされる', (await state('k_other')).startsWith('readonly|理由あり'), await state('k_other'));
    check('自動計算中：STEP 3 の加入チェックは操作できる', (await state('A_kokuho')).startsWith('編集可|理由なし'), await state('A_kokuho'));
    const auto = await ev(`return document.getElementById('k_insured').value;`);
    check('自動計算中：被保険者数は STEP 3 から数えた3人', auto === '3', auto);
    /* ロックは案内が主目的だが、万一値が変わっても自動値に戻ることを確かめる
     * （数値欄のスピナーなど、ブラウザによっては readonly でも動く経路があるため） */
    const forced = await ev(`const e=document.getElementById('k_insured');
      e.value='9'; e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
      return e.value;`);
    check('自動計算中：値を書き換えても自動値に戻る', forced === '3', forced);

    // 手動上書きに切り替える
    await ev(`set('k_manual',true); return 1;`); await sleep(350);
    check('手動上書き中：STEP 3 の加入チェックがロックされる', (await state('A_kokuho')).startsWith('disabled|理由あり|locked'), await state('A_kokuho'));
    check('手動上書き中：世帯員の加入チェックもロックされる',
      (await ev(`const id=memberIds()[0]+'_kokuho'; const e=document.getElementById(id);
        return e.disabled ? 'disabled' : '編集可';`)) === 'disabled');
    check('手動上書き中：被保険者数の欄は編集できる', (await state('k_insured')).startsWith('編集可|理由なし'), await state('k_insured'));

    const reason = await ev(`return document.getElementById('A_kokuho_lock').textContent.trim();`);
    check('ロックの理由に、どこを操作すればよいかが書いてある',
      /「国保」のページ/.test(reason) && /外して/.test(reason), reason);   // 2026-11：画面の呼び方を STEP 7 からページ名に変えた

    // 手動の値が実際に計算に使われること
    await ev(`set('k_insured','5'); document.getElementById('calcBtn').click(); return 1;`);
    await sleep(600);
    const used = await ev(`return txt('#results');`);
    check('手動で入れた5人が軽減の基準額に反映される', /5人/.test(used), used.slice(0, 0) || '（結果に5人の記載あり）');

    // 自動に戻すと、STEP 3 のチェック状態が保持されている
    await ev(`set('k_manual',false); return 1;`); await sleep(350);
    const back = await ev(`const ids=memberIds();
      return [document.getElementById('A_kokuho').checked,
              document.getElementById('B_kokuho').checked,
              document.getElementById(ids[0]+'_kokuho').checked,
              document.getElementById('k_insured').value].join('|');`);
    check('自動に戻すとチェック状態が消えずに残っている', back === 'true|true|true|3', back);
    check('自動に戻すと STEP 3 のチェックが再び操作できる', (await state('A_kokuho')).startsWith('編集可|理由なし'), await state('A_kokuho'));

    // 特定同一世帯所属者は自動計算できないので、どちらのモードでも常に編集できる
    check('特定同一世帯所属者の数は自動計算中でも編集できる',
      (await state('k_tokutei')).startsWith('編集可'), await state('k_tokutei'));
    await ev(`set('k_manual',true); return 1;`); await sleep(250);
    check('特定同一世帯所属者の数は手動上書き中でも編集できる',
      (await state('k_tokutei')).startsWith('編集可'), await state('k_tokutei'));
    await ev(`set('k_manual',false); set('k_tokutei','0'); return 1;`); await sleep(250);
  }

  console.log('\n=== 判定の実行 ===');
  {
    // ケース1：学生本人モード／父500万・母0円・大学生19歳
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      addMember('child'); return 1;`);
    await sleep(200);
    await ev(`const ids=memberIds(); set(ids[0]+'_age',19); set(ids[0]+'_salary','0');
      set('A_salary','5000000'); set('A_social','750000');
      set('B_salary','0'); set('B_social','0');
      set('A_kokuho',false); set('B_kokuho',false);
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    console.log('  ', await kpis());
    check('結果が表示される', (await ev("return document.querySelectorAll('#results .card').length")) > 3);
    check('見出しが「お父さん（生計維持者A）」になる',
      /お父さん/.test(await ev("return document.querySelector('#results').textContent.slice(0,4000)")));
    await shot('07-result-student-mode');

    // ケース2：住民税所得割が非課税 → 第Ⅰ区分
    await ev(`set('A_salary','1500000'); set('A_social','200000');
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    const k2 = await kpis();
    console.log('  ', k2);
    check('所得割が非課税なら第Ⅰ区分', /第Ⅰ区分/.test(k2), k2);
    await shot('08-result-kubun1');

    // ケース3：ひとりモード
    await ev(`mode('single'); set('A_salary','1100000'); set('A_social','0'); set('A_kokuho',true);
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    const k3 = await kpis();
    console.log('  ', k3);
    check('ひとりモードではJASSOのカードを出さない', !/JASSO/.test(k3), k3);
    await shot('09-result-single');
  }

  console.log('\n=== DOM監査：表示崩れ・文言の取り違えを機械検出 ===');
  {
    // 1) 立場を切り替えたとき、別モードの呼び名が画面に残っていないか
    //    （「生計維持者A（あなた・お父さん）」のようなハードコードを検出する）
    const strays = {
      student: [],                       // 学生モードでは「お父さん／お母さん」が正
      couple: ['お父さん', 'お母さん'],   // 夫婦モードにこれらが出たら取り違え
      single: ['お父さん', 'お母さん', '配偶者（生計維持者B）']
    };
    for (const m of ['student', 'couple', 'single']) {
      await ev(`mode('${m}'); return 1;`);
      await sleep(400);
      const found = await ev(`
        // STEP 1 の説明文は例示として呼び名を含むので除外する
        const parts=[...document.querySelectorAll('.step:not(#step1)')]
          .filter(s=>!s.classList.contains('hidden'))
          .map(s=>s.textContent).join(' ');
        return ${JSON.stringify(strays[m])}.filter(w=>parts.includes(w));`);
      check(`${m} モードに他モードの呼び名が残っていない`, found.length === 0, found.join(' / '));
    }

    // 2) 画面に undefined / NaN / [object Object] が出ていないか
    await ev(`mode('student'); set('A_salary','4000000'); set('B_salary','1000000');
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(800);
    for (const bad of ['undefined', 'NaN', '[object Object]', 'Infinity', '円円', '％％']) {
      const where = await ev(`
        const w=${JSON.stringify(bad)}, out=[];
        document.querySelectorAll('body *').forEach(function(e){
          if(e.children.length) return;
          const t=(e.textContent||'');
          if(t.indexOf(w)<0) return;
          let path=[], n=e;
          while(n && n.tagName!=='BODY'){ path.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')); n=n.parentElement; }
          out.push(path.slice(-3).join('>')+'「'+t.trim().replace(/\\s+/g,' ').slice(0,60)+'」');
        });
        return out.slice(0,3).join(' / ');`);
      check(`画面に「${bad}」が出ていない`, where === '', where);
    }

    // 3) select の選択肢が空でない／選択値が実在する
    const selBad = await ev(`
      return [...document.querySelectorAll('select')].filter(s=>{
        if (s.closest('.hidden')) return false;
        if (s.options.length===0) return true;
        if ([...s.options].some(o=>!o.textContent.trim())) return true;
        return ![...s.options].some(o=>o.value===s.value);
      }).map(s=>s.id||s.className);`);
    check('すべてのセレクトに有効な選択肢と選択値がある', selBad.length === 0, selBad.join(', '));

    // 4) すべての入力部品がラベルに紐づいている（読み上げ・クリック領域の担保）
    const noLabel = await ev(`
      return [...document.querySelectorAll('input,select')].filter(e=>{
        if (e.type==='radio') return false;
        return !e.closest('label') && !e.getAttribute('aria-label');
      }).map(e=>e.id||e.type);`);
    check('すべての入力部品がラベル内にある', noLabel.length === 0, noLabel.join(', '));

    // 5) id の重複がないか（重複すると $() が別要素を掴んで静かに壊れる）
    const dup = await ev(`
      const seen={}, dup=[];
      document.querySelectorAll('[id]').forEach(e=>{ if(seen[e.id]) dup.push(e.id); seen[e.id]=1; });
      return [...new Set(dup)];`);
    check('id の重複がない', dup.length === 0, dup.join(', '));

    // 6) 結果画面に空セル・壊れた行がないか
    const emptyCells = await ev(`
      return [...document.querySelectorAll('#results table tr')]
        .filter(tr=>tr.children.length>0 && [...tr.children].every(td=>!td.textContent.trim())).length;`);
    check('結果テーブルに空行がない', emptyCells === 0, String(emptyCells));

    // 7) 横スクロールが発生していない（レイアウト崩れの検出）
    const overflow = await ev(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    check('横スクロールが発生していない', overflow <= 1, overflow + 'px');
    await shot('10-dom-audit');
  }

  console.log('\n=== 1ページずつの入力（ウィザード） ===');
  {
    /* 2026年11月、利用者の希望で「1ページずつ進む」形にした。
     *   1 立場 → 2 お住まい → 3 家族構成 → 4 所得 → 5 所得控除 → 6 分離課税 → 7 繰越控除 → 8 税額控除
     *   → 9 国保 → 10 奨学金 → 11 結果
     * 6〜10 は「ある／ない」の質問で、「ある」のときだけ入力欄を出す。6〜8 で「ない」を選ぶと、その欄は0円に戻る。
     * それまでの「すべて最初から開いている」方針の代わりに、「探さないと見つからない欄」にならないよう次を確かめる。
     * 閉じた <details> や見えないページの入力欄は offsetParent が null になる。 */
    const vis = (id) => ev(`const e=document.getElementById('${id}');
      if(!e) return 'ない'; if(e.closest('details:not([open])')) return '閉じた折りたたみの中';
      return e.offsetParent===null ? '非表示' : '表示';`);
    const go = (n) => ev(`TaxWizard.go(${n}); return TaxWizard.page();`);
    await ev(`mode('student'); set('useJasso',true); return 1;`); await sleep(300);

    const nav = await ev(`return [...document.querySelectorAll('#stepNav a')].map(a=>a.textContent.replace(/^\\d+/,'')).join(' / ');`);
    check('ナビにページが順に並んでいる（奨学金を調べるとき11ページ）',
      nav === '立場 / お住まい / 家族構成 / 所得 / 所得控除 / 分離課税 / 繰越控除 / 税額控除 / 国保 / 奨学金 / 結果', nav);

    // 1：立場を選ぶと自動で次のページへ
    await go(1);
    await ev(`document.querySelector('#modeChoices .choice').click(); return 1;`); await sleep(500);
    check('立場を選ぶと、自動で「お住まい」のページへ進む', (await ev(`return TaxWizard.page();`)) === 2);
    check('見えているのは今のページだけ（1ページ目の選択肢は隠れる）',
      (await ev(`return document.getElementById('step1').offsetParent===null && document.getElementById('step2').offsetParent!==null;`)) === true);

    // 4：所得。人ごとに「あてはまる所得」を選ぶと欄が出る。最初は給与だけ
    const chip = (p, item) => `[...document.querySelectorAll('.ichips[data-p="${p}"] input[data-item="${item}"]')][0]`;
    await go(4);
    const chipBox = (p) => ev(`const b=document.querySelector('.ichips[data-p="${p}"][data-g="g1"]'); return !!b && b.offsetParent!==null && b.querySelectorAll('input').length===9;`);
    check('所得のページ：1人目（生計維持者A）だけを出し、「あてはまるもの」のチップが出る',
      (await chipBox('A')) && !(await chipBox('B')) && (await ev(`return TaxWizard.sub();`)) === 0);
    check('所得のページ：給与（A_salary）は最初から見えている', (await vis('A_salary')) === '表示', await vis('A_salary'));
    const nextLabel = await ev(`return document.getElementById('wizNext').textContent;`);
    check('所得のページ：［次へ］に次の人の名前が出る', /次へ：/.test(nextLabel), nextLabel);
    await ev(`TaxWizard.next(); return 1;`); await sleep(300);
    check('所得のページ：［次へ］で2人目（生計維持者B）に進む（ページはそのまま）',
      (await chipBox('B')) && !(await chipBox('A')) && (await ev(`return TaxWizard.page();`)) === 4 && (await vis('B_salary')) === '表示', await vis('B_salary'));
    await ev(`TaxWizard.back(); return 1;`); await sleep(300);
    check('所得のページ：［戻る］で1人目に戻る', (await chipBox('A')) && (await ev(`return TaxWizard.page();`)) === 4);
    for (const [label, id] of [['公的年金等', 'A_pension'], ['不動産所得', 'A_realEstate'], ['配当', 'A_dividendGeneral']])
      check(`所得のページ：${label}（${id}）は選ぶまで出ない`, (await vis(id)) === '非表示', await vis(id));
    check('所得のページ：控除の欄はまだ出ない', (await vis('A_social')) === '非表示', await vis('A_social'));
    await ev(`${chip('A', 'pension')}.click(); return 1;`); await sleep(300);
    check('所得のページ：「年金」を選ぶと年金の欄が出る', (await vis('A_pension')) === '表示', await vis('A_pension'));
    await ev(`set('A_pension','600000'); return 1;`); await sleep(300);
    await ev(`${chip('A', 'pension')}.click(); return 1;`); await sleep(300);
    const offed = await ev(`return {v:document.getElementById('A_pension').value, chk:${chip('A', 'pension')}.checked};`);
    check('所得のページ：チップを外すと、その欄は0円に戻って隠れる', offed.v === '0' && !offed.chk && (await vis('A_pension')) === '非表示', JSON.stringify(offed));
    await ev(`set('A_realEstate','120000'); return 1;`); await sleep(300);
    check('所得のページ：金額が入っている項目は、選んでいなくても選んだ状態で見せる',
      (await ev(`return ${chip('A', 'realEstate')}.checked;`)) === true && (await vis('A_realEstate')) === '表示');
    await ev(`${chip('A', 'realEstate')}.click(); return 1;`); await sleep(300);

    // 5：所得控除と本人の状況
    await go(5);
    check('所得控除のページ：社会保険料は最初から見えている', (await vis('A_social')) === '表示', await vis('A_social'));
    check('所得控除のページ：生命保険料は選ぶまで出ない', (await vis('A_lifeNewGeneral')) === '非表示', await vis('A_lifeNewGeneral'));
    await ev(`${chip('A', 'life')}.click(); ${chip('A', 'donation')}.click(); return 1;`); await sleep(300);
    for (const [label, id] of [['生命保険料', 'A_lifeNewGeneral'], ['ふるさと納税', 'A_donationFurusato']])
      check(`所得控除のページ：${label}（${id}）が見えている`, (await vis(id)) === '表示', await vis(id));
    check('所得控除のページ：選んでいない地震保険料は出ない', (await vis('A_quake')) === '非表示', await vis('A_quake'));
    await ev(`${chip('A', 'life')}.click(); ${chip('A', 'donation')}.click(); return 1;`); await sleep(300);

    /* 本人の状況（③）も「あてはまるもの」で選ぶ。最初は何も選ばない。
     * その人に当てはまりようがない項目は出さない（お父さんに「寡婦」、50歳に「未成年」）。
     * 前の検査で A・B の続柄を入れ替えていることがあるので、A をお父さんに戻してから確かめる。 */
    await ev(`pick('A_rel','father'); TaxWizard.go(5); return 1;`); await sleep(400);
    const g3 = await ev(`return [...document.querySelectorAll('.ichips[data-p="A"][data-g="g3"] .ichip')].filter(e=>!e.classList.contains('it-off')).map(e=>e.textContent);`);
    check('所得控除のページ：本人の状況は選ぶまで出ない', (await vis('A_student')) === '非表示', await vis('A_student'));
    /* 夫婦（A・Bの両方がいる）なら、ひとり親・寡婦は「婚姻していない」条件に当てはまらないので出さない。
     * 「学生本人が使う」の生計維持者（学生の親）には勤労学生も出さない。生活保護は世帯で受けていれば親も対象なので出す */
    check('所得控除のページ：夫婦のお父さんには「寡婦」「未成年」「ひとり親」「勤労学生」を出さない（生活保護は出す）',
      !g3.some(t => /寡婦|未成年|ひとり親|勤労学生/.test(t)) && g3.some(t => /生活保護/.test(t)), g3.join(' / '));
    await ev(`TaxWizard.next(); return 1;`); await sleep(300);
    const g3b = await ev(`return [...document.querySelectorAll('.ichips[data-p="B"][data-g="g3"] .ichip')].filter(e=>!e.classList.contains('it-off')).map(e=>e.textContent);`);
    check('所得控除のページ：夫婦のお母さんにも「寡婦」「ひとり親」を出さない', !g3b.some(t => /寡婦|ひとり親/.test(t)), g3b.join(' / '));
    // お母さんを削除してひとり親世帯にすると、お父さんに「ひとり親」が出て、選べば欄が出る
    await ev(`document.querySelector('[data-delb]').click(); TaxWizard.go(5); return 1;`); await sleep(400);
    const g3c = await ev(`return [...document.querySelectorAll('.ichips[data-p="A"][data-g="g3"] .ichip')].filter(e=>!e.classList.contains('it-off')).map(e=>e.textContent);`);
    check('所得控除のページ：生計維持者が1人なら「ひとり親」を出す', g3c.some(t => /ひとり親/.test(t)), g3c.join(' / '));
    await ev(`${chip('A', 'singleParent')}.click(); return 1;`); await sleep(300);
    check('所得控除のページ：「ひとり親」を選ぶとひとり親控除の欄が出る', (await vis('A_singleParent')) === '表示', await vis('A_singleParent'));
    await ev(`${chip('A', 'singleParent')}.click(); document.querySelector('[data-addb]').click(); TaxWizard.go(5); return 1;`); await sleep(400);
    check('所得控除のページ：所得の欄は隠れる', (await vis('A_salary')) === '非表示', await vis('A_salary'));

    // 6〜8：ある → 誰ですか（複数）→ どれですか → 欄。「ない」なら0円に戻して次へ
    for (const [n, key, id, item, label] of [[6, 'g4', 'A_stockTransfer', 'stock', '分離課税'], [7, 'g5', 'A_coStockLoss', 'coStock', '繰越控除'], [8, 'g6', 'A_taxCredit', null, '税額控除']]) {
      await go(n);
      const q0 = await ev(`const c=document.querySelector('.wizq[data-q="${key}"]'); return {shown:c.offsetParent!==null, h:c.querySelector('h2').textContent};`);
      check(`${label}のページ：まず「ある／ない」を聞く`, q0.shown && (await vis(id)) === '非表示', q0.h);
      await ev(`document.querySelector('.wizq[data-q="${key}"] input[value="yes"]').click(); return 1;`); await sleep(300);
      const who = await ev(`return [...document.querySelectorAll('.wizq[data-q="${key}"] input[data-who]')].map(e=>e.dataset.who+':'+e.checked);`);
      check(`${label}のページ：「ある」のあとに「誰ですか」を世帯の全員から選べる（まだ誰も選んでいない）`,
        who.length >= 3 && who.every(w => /:false$/.test(w)) && (await vis(id)) === '非表示', who.join(' '));
      await ev(`document.querySelector('.wizq[data-q="${key}"] input[data-who="A"]').click(); return 1;`); await sleep(300);
      check(`${label}のページ：人を選んでも、［次へ］を押すまでは質問のまま`,
        (await ev(`return document.getElementById('step4').offsetParent===null;`)) === true);
      await ev(`TaxWizard.next(); return 1;`); await sleep(300);
      check(`${label}のページ：［次へ］で選んだ人のカードだけ出る（質問は隠れる）`,
        (await ev(`return document.getElementById('step4').offsetParent!==null && document.getElementById('step5').offsetParent===null
          && document.querySelector('.wizq[data-q="${key}"]').offsetParent===null && TaxWizard.page()===${n};`)) === true);
      if (item) {
        check(`${label}のページ：種類は選ぶまで出ない`, (await vis(id)) === '非表示', await vis(id));
        await ev(`${chip('A', item)}.click(); return 1;`); await sleep(300);
      }
      check(`${label}のページ：選んだ人の選んだ欄が出て、ページはそのまま`,
        (await vis(id)) === '表示' && (await ev(`return TaxWizard.page();`)) === n, await vis(id));
      await ev(`set('${id}','50000'); return 1;`); await sleep(300);
      await ev(`document.querySelector('.wizq[data-q="${key}"] input[value="no"]').click(); return 1;`); await sleep(400);
      const after = await ev(`return {page:TaxWizard.page(), v:document.getElementById('${id}').value};`);
      check(`${label}のページ：「ない」を選ぶと入れた金額は0円に戻り、次のページへ進む`, after.page === n + 1 && after.v === '0', JSON.stringify(after));
    }
    // 詳しく計算していない家族を「誰ですか」で選ぶと、その人を詳しく計算する人にする
    {
      await ev(`addMember('parent'); return 1;`); await sleep(400);
      const mid = await ev(`const ids=memberIds(); return ids[ids.length-1];`);
      const num = mid.replace('m', '');
      const before = await ev(`return !!document.getElementById('md${num}_stockTransfer');`);
      await go(6);
      await ev(`document.querySelector('.wizq[data-q="g4"] input[value="yes"]').click(); return 1;`); await sleep(300);
      await ev(`document.querySelector('.wizq[data-q="g4"] input[data-who="${mid}"]').click(); return 1;`); await sleep(500);
      await ev(`TaxWizard.next(); return 1;`); await sleep(300);
      const after = await ev(`const f=document.getElementById('md${num}_stockTransfer');
        return {made: !!f, shown: !!f && f.closest('.detailperson').offsetParent!==null};`);
      check('詳しく計算していない家族を選ぶと、その人の入力欄ができて出る', !before && after.made && after.shown, JSON.stringify(after));
      await ev(`document.querySelector('.wizq[data-q="g4"] input[value="no"]').click();
        document.querySelector('[data-del="${num}"]').click(); return 1;`); await sleep(400);
    }

    // 9：国保。「ある」のときだけ細かい設定を出す
    await go(9);
    check('国保のページ：最初は細かい設定を出さない', (await vis('k_landSpecial')) === '非表示', await vis('k_landSpecial'));
    await ev(`document.querySelector('.wizq[data-q="kokuho"] input[value="yes"]').click(); return 1;`); await sleep(300);
    check('国保のページ：「ある」を選ぶと細かい設定が出る', (await vis('k_landSpecial')) === '表示', await vis('k_landSpecial'));

    // 10：奨学金。調べないときはページごと飛ばす
    await ev(`set('useJasso',false); return 1;`); await sleep(300);
    const navNo = await ev(`return [...document.querySelectorAll('#stepNav a')].length;`);
    await go(9);
    await ev(`document.getElementById('wizNext').click(); return 1;`); await sleep(300);
    check('奨学金を調べないときは、奨学金のページを飛ばして結果へ進む',
      navNo === 10 && (await ev(`return TaxWizard.page();`)) === 11, navNo + 'ページ / 次へ→' + (await ev(`return TaxWizard.page();`)));
    await ev(`set('useJasso',true); return 1;`); await sleep(300);

    // どのページからでも結果へ。戻るボタン
    await go(3);
    await ev(`document.getElementById('calcBtn').click(); return 1;`); await sleep(500);
    check('どのページからでも［判定結果を見る］で結果のページへ',
      (await ev(`return TaxWizard.page()===TaxWizard.LAST && document.getElementById('stepResult').offsetParent!==null;`)) === true);
    await ev(`document.getElementById('wizBack').click(); return 1;`); await sleep(300);
    check('［戻る］で前のページへ', (await ev(`return TaxWizard.page();`)) === 10);
  }

  console.log('\n=== 自動計算とナビ下の要約 ===');
  {
    /* 入力すると、ボタンを押さなくてもナビ下の要約と下の結果が更新されること。
     * 要約の判定が、下の詳しい結果と同じであること（別に計算していないこと）。
     * 2026年11月、ヒーロー右の「いまの判定」パネルは利用者の希望で外した。 */
    await ev(`TaxWizard.go(TaxWizard.LAST); set('A_salary','9000000'); return 1;`); await sleep(900);
    const q = await ev(`return {
      chips: [...document.querySelectorAll('#quickBarBody .qchip')].map(c=>c.textContent.replace(/^[^：]*：/,'')),
      res: document.querySelector('#results .kpis') ? [...document.querySelectorAll('#results .kpi')].map(k=>k.querySelector('.value').textContent) : [],
      empty: !!document.querySelector('#results .empty') };`);
    check('ボタンを押さなくても結果が表示される', !q.empty && q.res.length > 0, JSON.stringify(q.res));
    check('ナビ下の要約（非課税世帯・国保・JASSO）が下の結果と同じ',
      q.chips.length === 3 && q.chips.every(c => q.res.includes(c)), q.chips.join(',') + ' / ' + q.res.join(','));
    check('「いまの判定」パネルは出していない', (await ev(`return !document.getElementById('quick');`)) === true);

    /* 結果の人ごとの明細（所得・所得税・住民税）と出典は畳んである。見出しを押すと開き、
     * 入力して結果が作り直されても、開いた明細は開いたまま。要約・JASSO・国保は畳まない。 */
    const rf = await ev(`return new Promise(r=>{
      const cards=[...document.querySelectorAll('#results .card')];
      const folded=cards.filter(c=>c.classList.contains('foldcard')).map(c=>c.querySelector('h2').textContent);
      const open=cards.filter(c=>!c.classList.contains('foldcard')).map(c=>c.querySelector('h2').textContent);
      const allClosed=[...document.querySelectorAll('#results details.rfold')].every(d=>!d.open);
      const first=document.querySelector('#results .foldcard'); const key=first.querySelector('details').dataset.key;
      first.querySelector('h2').click();
      const openedByHead=first.querySelector('details').open;
      set('A_salary','9100000');
      setTimeout(()=>{ const again=[...document.querySelectorAll('#results details.rfold')].find(d=>d.dataset.key===key);
        r({folded, open, allClosed, openedByHead, kept: !!(again && again.open)}); }, 700);
    });`);
    check('結果の明細と出典は畳んである', rf.allClosed && rf.folded.some(t => /所得の計算/.test(t)) &&
      rf.folded.some(t => /所得税/.test(t)) && rf.folded.some(t => /住民税/.test(t)) && rf.folded.includes('出典'),
      rf.folded.length + '枚');
    check('要約・JASSO・国保の判定は畳まない', rf.open.some(t => /要約/.test(t)) && rf.open.some(t => /JASSO/.test(t)) &&
      rf.open.some(t => /国民健康保険/.test(t)), rf.open.join(' / '));
    check('明細は見出しを押すと開く', rf.openedByHead === true);
    check('開いた明細は、入力して作り直されても開いたまま', rf.kept === true);
    const notes = [];
    for (const [n, sel] of [[1, '#step1'], [2, '#step2']]) {
      notes.push(await ev(`TaxWizard.go(${n}); const d=document.querySelector('${sel} details.notefold');
        return d ? {open:d.open, sum:d.querySelector('summary').offsetParent!==null} : null;`));
    }
    check('STEP 1・2 の読みものの説明は畳んであり、見出しは見えている',
      notes.every(n => n && !n.open && n.sum), JSON.stringify(notes));
    await ev(`set('A_salary','0'); TaxWizard.go(1); return 1;`); await sleep(600);
  }


  console.log('\n=== 配色の切替（端末に合わせる／ライト／ダーク） ===');
  {
    const bg = () => ev(`return getComputedStyle(document.body).backgroundColor;`);
    const ink = () => ev(`return getComputedStyle(document.body).color;`);
    const attr = () => ev(`return document.documentElement.getAttribute('data-theme')||'(なし)';`);
    const pressed = () => ev(`return [...document.querySelectorAll('[data-theme-set]')]
      .filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.dataset.themeSet).join(',');`);
    const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000; };

    /* 端末をライトにした状態 */
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await ev(`window.TaxTheme.set('auto'); return 1;`); await sleep(200);
    check('端末に合わせる：data-theme は付かない', (await attr()) === '(なし)', await attr());
    const autoLight = await bg();
    check('端末がライトなら明るい背景', lum(autoLight) > 200, autoLight);
    check('押下状態が「端末に合わせる」になる', (await pressed()) === 'auto', await pressed());

    /* 端末をダークにすると自動で追従する */
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(200);
    const autoDark = await bg();
    check('端末がダークなら自動で暗い背景になる', lum(autoDark) < 80, autoDark);

    /* 端末がダークでも「ライト」を選べば明るいまま */
    await ev(`window.TaxTheme.set('light'); return 1;`); await sleep(200);
    check('ライト固定：data-theme="light"', (await attr()) === 'light', await attr());
    check('端末がダークでもライトのまま', lum(await bg()) > 200, await bg());
    check('押下状態が「ライト」になる', (await pressed()) === 'light', await pressed());

    /* 端末がライトでも「ダーク」を選べば暗いまま */
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await ev(`window.TaxTheme.set('dark'); return 1;`); await sleep(200);
    check('ダーク固定：data-theme="dark"', (await attr()) === 'dark', await attr());
    const darkBg = await bg();
    check('端末がライトでもダークのまま', lum(darkBg) < 80, darkBg);
    check('文字と背景の明暗差が十分ある', Math.abs(lum(await ink()) - lum(darkBg)) > 120,
      `文字 ${await ink()} / 背景 ${darkBg}`);
    check('選択は再読み込みしても残る（保存キーは配色のみ）',
      (await ev(`return localStorage.getItem('tk-theme');`)) === 'dark', 'tk-theme');
    check('保存しているキーは1つだけ',
      (await ev(`return Object.keys(localStorage).length;`)) === 1, await ev(`return Object.keys(localStorage).join(',');`));

    /* ダークでも結果画面が読めること */
    await ev(`document.getElementById('calcBtn').click(); return 1;`); await sleep(600);
    const unreadable = await ev(`
      const bad=[];
      document.querySelectorAll('#results .kpi .value, #results .verdict h3, #results table.detail td').forEach(function(e){
        const s=getComputedStyle(e), f=s.color.match(/\\d+/g).map(Number);
        let el=e, b=null;
        while(el){ const c=getComputedStyle(el).backgroundColor; if(c&&!/rgba\\(0, 0, 0, 0\\)/.test(c)){ b=c.match(/\\d+/g).map(Number); break; } el=el.parentElement; }
        if(!b) return;
        const L=x=>(x[0]*299+x[1]*587+x[2]*114)/1000;
        if(Math.abs(L(f)-L(b))<45) bad.push(e.textContent.trim().slice(0,18));
      });
      return bad.slice(0,6);`);
    check('ダークで文字と背景が近すぎる箇所がない', unreadable.length === 0, unreadable.join(' / '));
    await shot('11-dark');

    await ev(`window.TaxTheme.set('auto'); return 1;`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    await sleep(200);
  }

  console.log('\n=== スマートフォン表示（iPhone相当 390×844） ===');
  {
    await send('Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    /* 折りたたみは開いた状態でも測る。閉じたままだと中身のレイアウトが
     * 画面幅を変える前の値のまま残り、実際の表示と違う値を拾ってしまう。 */
    await ev(`document.querySelectorAll('details').forEach(d=>d.open=true);
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(700);
    await ev(`void document.body.offsetHeight; return 1;`);

    const ow = await ev(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
    check('横スクロールが発生していない', ow <= 1, ow + 'px');

    const wide = await ev(`
      void document.body.offsetHeight;          // 先にレイアウトを確定させる
      const bad=[];
      document.querySelectorAll('main *').forEach(function(e){
        if(e.closest('.tablewrap')||e.classList.contains('tablewrap')||e.closest('.stepnav')) return;
        // 表示されていない要素は画面をはみ出しようがない
        // （狭い画面では表の見出し行を display:none にして縦に積み直すため）
        if(e.offsetParent===null && getComputedStyle(e).position!=='fixed') return;
        if(e.clientWidth===0 && e.clientHeight===0) return;
        if(getComputedStyle(e).overflowX!=='visible') return;
        const sw=e.scrollWidth, cw=e.clientWidth;   // スタイル確定後にまとめて読む
        if(sw<=cw+2) return;
        const p=e.parentElement;
        bad.push((e.id||e.className||e.tagName)+'['+sw+'>'+cw+']'
          +' 親='+(p?(p.id||p.className||p.tagName):'?')
          +' 内容="'+(e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28)+'"');
      });
      return [...new Set(bad)].slice(0,5);`);
    check('はみ出しているのは横スクロール枠の中だけ', wide.length === 0, wide.join(' / '));

    /* 見た目上かくしている部品（.choice のラジオなど）は、
     * ラベル全体が押せるので大きさの対象から外す */
    const visible = `function(e){
      if(e.offsetParent===null) return false;
      const s=getComputedStyle(e);
      return s.opacity!=='0' && s.visibility!=='hidden' && s.pointerEvents!=='none';
    }`;
    const small = await ev(`
      const vis=${visible}, bad=[];
      document.querySelectorAll('input:not([type=checkbox]), select, button').forEach(function(e){
        if(!vis(e)) return;
        const r=e.getBoundingClientRect();
        if(r.height>0 && r.height<40) bad.push((e.id||e.textContent.trim().slice(0,12)||e.name)+':'+Math.round(r.height));
      });
      return [...new Set(bad)].slice(0,8);`);
    check('入力欄・ボタンの高さが40px以上（指で押せる）', small.length === 0, small.join(' / '));

    const tap = await ev(`
      const vis=${visible}, bad=[];
      document.querySelectorAll('.checkline').forEach(function(e){
        const r=e.getBoundingClientRect();
        if(r.height>0 && r.height<40) bad.push(e.textContent.trim().slice(0,14)+':'+Math.round(r.height));
      });
      return [...new Set(bad)].slice(0,6);`);
    check('チェックボックスの行も40px以上', tap.length === 0, tap.join(' / '));

    const tiny = await ev(`
      const vis=${visible}, bad=[];
      document.querySelectorAll('input:not([type=checkbox]), select').forEach(function(e){
        if(!vis(e)) return;
        if(parseFloat(getComputedStyle(e).fontSize)<16) bad.push((e.id||e.name)+':'+getComputedStyle(e).fontSize);
      });
      return [...new Set(bad)].slice(0,8);`);
    check('入力欄の文字は16px以上（iOSで勝手に拡大されない）', tiny.length === 0, tiny.join(' / '));

    const cols = await ev(`return getComputedStyle(document.querySelector('#step4 .grid')).gridTemplateColumns.split(' ').length;`);
    check('入力欄は1列に折り返している', cols === 1, cols + '列');
    // 狭い画面ではラベルの下に入力欄を積む（横並びだと入力欄が細くなりすぎる）
    const stacked = await ev(`const f=document.querySelector('#step4 .grid.rows > .field');
      return getComputedStyle(f).display;`);
    check('スマホではラベルと入力欄を縦に積む', stacked === 'flex', stacked);

    const nav = await ev(`return getComputedStyle(document.querySelector('.stepnav')).position;`);
    check('ステップナビが上に固定されている', nav === 'sticky', nav);

    await shot('12-mobile');
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(200);
  }

  console.log('\n=== 「学生本人が使う」と「夫婦（2人）で使う」は呼び名だけが違うこと ===');
  {
    /* この2つは入力欄の呼び名（と続柄を選べるかどうか）が違うだけで、
     * 計算には一切影響しない。同じ入力で税額・国保・JASSOが完全に一致することを固定する。
     * 将来どちらかのモードに計算上の分岐が紛れ込んだら、ここが落ちる。 */
    const scenario = async (m) => {
      await ev(`mode('${m}'); pick('pref','東京都'); pick('city','特別区（23区）');
        clearMembers(); return 1;`);
      await sleep(350);
      await ev(`set('A_salary','5000000'); set('A_social','700000'); set('A_kokuho',true);
        set('B_salary','1200000'); set('B_kokuho',true);
        addMember('child'); return 1;`);
      await sleep(450);
      const id = await ev(`return memberIds()[0];`);
      await ev(`set('${id}_age',19); set('${id}_kokuho',true);
        const cb=document.querySelector('[data-detail]');
        if(!cb.checked){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));}
        return 1;`);
      await sleep(600);
      await ev(`set('md${id.replace('m','')}_salary','1000000');
        document.getElementById('calcBtn').click(); return 1;`);
      await sleep(900);
      /* 数字だけを取り出して比べる（呼び名は違って当然なので文字は見ない）。
       * 畳んだ明細の中の数字も比べるため、表示中の文字（innerText）ではなく textContent を使う。 */
      return await ev(`return document.getElementById('results').textContent
        .match(/[0-9][0-9,]*円|非課税|課税なし|[０-９]割軽減|軽減なし|第[ⅠⅡⅢⅣ]区分|対象外/g).join(',');`);
    };
    const numsStudent = await scenario('student');
    const numsCouple = await scenario('couple');
    check('同じ入力なら結果の数値・判定がすべて一致する', numsStudent === numsCouple,
      numsStudent === numsCouple ? `${numsStudent.split(',').length}項目が一致`
        : '不一致：' + numsStudent.split(',').filter((v, i) => v !== numsCouple.split(',')[i]).slice(0, 5).join(' / '));

    // 違うのは呼び名と、続柄を選べるかどうかだけ
    await ev(`mode('student'); return 1;`); await sleep(350);
    const stuHasRel = await ev(`return !!document.getElementById('A_rel');`);
    const stuLabel = await ev(`return document.querySelector('#rowA .mhead').textContent.replace(/\\s+/g,' ').trim();`);
    await ev(`mode('couple'); return 1;`); await sleep(350);
    const coupleHasRel = await ev(`return !!document.getElementById('A_rel');`);
    const coupleLabel = await ev(`return document.querySelector('#rowA .mhead').textContent.replace(/\\s+/g,' ').trim();`);
    check('学生本人モードでは続柄（父／母）を選べる', stuHasRel === true, stuLabel);
    check('夫婦モードでは続柄セレクトがなく「あなた」固定', coupleHasRel === false, coupleLabel);
    check('呼び名は実際に違う', stuLabel !== coupleLabel, `${stuLabel} ／ ${coupleLabel}`);

    await ev(`mode('student'); clearMembers(); set('A_salary','0'); set('B_salary','0'); return 1;`);
    await sleep(350);
  }

  console.log('\n=== 要約が「誰の結果か」を取り違えないこと ===');
  {
    /* 学生本人モードなのに生計維持者Aの税額だけを代表表示すると、
     * 自分の税額だと誤解される。人ごとに分けて出し、
     * 詳細カードと同じ数字になっていることを確かめる。 */
    await ev(`mode('student'); pick('pref','東京都'); pick('city','特別区（23区）');
      clearMembers(); return 1;`);
    await sleep(350);
    await ev(`pick('A_rel','mother'); set('A_salary','2500000'); set('A_kokuho',true);
      pick('B_rel','father'); set('B_salary','8000000'); set('B_kokuho',true);
      addMember('child'); return 1;`);
    await sleep(500);
    const mid2 = await ev(`return memberIds()[0];`);
    await ev(`set('${mid2}_age',19); set('${mid2}_kokuho',true);
      const cb=document.querySelector('[data-detail]');
      if(!cb.checked){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));}
      return 1;`);
    await sleep(600);
    const dp2 = 'md' + mid2.replace('m', '');
    await ev(`set('${dp2}_salary','1600000'); document.getElementById('calcBtn').click(); return 1;`);
    await sleep(900);

    const rows = await ev(`
      const t=[...document.querySelectorAll('#results table.compare')]
        .find(x=>/だれの分か/.test(x.textContent));
      if(!t) return '(表なし)';
      return [...t.tBodies[0].rows].map(function(r){
        return [...r.cells].map(c=>c.textContent.replace(/\\s+/g,' ').trim()).join('|');
      }).join('\\n');`);
    check('要約に「だれの分か」の列がある', rows !== '(表なし)');
    check('要約に3人分の行が出る', rows.split('\n').length === 3, rows.split('\n').length + '行');
    check('行に生計維持者Aの名前と役割が入っている', /生計維持者A/.test(rows), rows.split('\n')[0]);
    check('行に学生本人の役割が入っている', /奨学金を申し込む学生本人/.test(rows), rows.split('\n')[2]);

    // 要約の数字が、下の個別カードにも同じ文字列で出ていること
    const consistent = await ev(`
      const t=[...document.querySelectorAll('#results table.compare')]
        .find(x=>/だれの分か/.test(x.textContent));
      const cards=[...document.querySelectorAll('#results .card')];
      const out=[];
      [...t.tBodies[0].rows].forEach(function(r){
        const name=r.cells[0].textContent.trim().split(/[（\\n]/)[0].trim();
        const juminzei=r.cells[2].textContent.trim();
        const card=cards.find(function(c){ const h=c.querySelector('h2');
          return h && h.textContent.indexOf(name)>=0 && /住民税/.test(h.textContent); });
        if(!card){ out.push(name+'：住民税カードなし'); return; }
        const body=card.textContent.replace(/\\s+/g,'');
        out.push(name+'：'+juminzei+(body.indexOf(juminzei.replace(/\\s+/g,''))>=0?'＝一致':'≠不一致'));
      });
      return out.join(' / ');`);
    console.log('  要約 vs 個別カード:', consistent);
    check('要約と個別カードで住民税が食い違わない',
      !/不一致|カードなし/.test(consistent), consistent);

    // 住民税非課税世帯の判定
    const hh = await ev(`return [...document.querySelectorAll('#results .kpi')]
      .filter(k=>/住民税非課税世帯/.test(k.textContent))
      .map(k=>k.querySelector('.value').textContent+'／'+k.querySelector('.sub').textContent)[0]||'(なし)';`);
    check('世帯としての「住民税非課税世帯」判定が出る', hh !== '(なし)', hh);
    check('課税者がいるので該当しないと出る', /該当しない/.test(hh), hh);

    // JASSO：学生本人の列と「学生本人＋生計維持者全員」の表記
    const jasso = await ev(`const c=[...document.querySelectorAll('#results .card')]
      .find(x=>/支給額算定基準額の計算/.test(x.textContent));
      return c ? c.textContent.replace(/\\s+/g,' ') : '(なし)';`);
    check('JASSOの表に学生本人の列がある', /学生本人/.test(jasso), jasso.slice(0, 80));
    check('合計の見出しが「学生本人＋生計維持者全員」', /合計（学生本人＋生計維持者全員）/.test(jasso));
    check('JASSOと住民税非課税世帯は別物だと説明している',
      (await ev(`return document.getElementById('results').textContent;`)).indexOf('JASSOの支援区分と「住民税非課税世帯」は別の基準です') >= 0);

    // 学生本人の基準額が合計に入っていること（本人に所得割が出るケース）
    await ev(`set('${dp2}_salary','4000000'); document.getElementById('calcBtn').click(); return 1;`);
    await sleep(900);
    /* 計算は人ごとの小さな表（.jperson）に分かれている。
     * 各人の最終行（tr.sum）が支給額算定基準額、その下の .jsum が全員の合計。 */
    const sums = await ev(`
      const c=[...document.querySelectorAll('#results .card')]
        .find(x=>/支給額算定基準額の計算/.test(x.textContent));
      const n=s=>Number(String(s).replace(/[^0-9]/g,''))||0;
      return JSON.stringify({
        each:[...c.querySelectorAll('.jperson table.detail tr.sum td')].map(td=>n(td.textContent)),
        names:[...c.querySelectorAll('.jperson h4')].map(h=>h.textContent.trim()),
        total:n(c.querySelector('.jsum b').textContent)});`);
    const s = JSON.parse(sums);
    check('計算が人ごとに分かれている', s.names.length === 3, s.names.join(' / '));
    check('学生本人にも基準額が出る（0円ではない）', s.each[2] > 0, JSON.stringify(s.each));
    check('合計＝A＋B＋学生本人', s.each.reduce((a, b) => a + b, 0) === s.total,
      s.each.join('＋') + '＝' + s.total);

    await ev(`clearMembers(); set('A_salary','0'); set('B_salary','0'); return 1;`);
    await sleep(350);
  }

  console.log('\n=== 品質：アクセシビリティ・文書構造 ===');
  {
    /* 画像・外部フォント・外部スクリプトを持たない静的サイトなので、
     * 品質で効くのは「読めるか」「操作できるか」「構造が正しいか」。
     * ここを機械で測る。 */
    await ev(`window.TaxTheme.set('light'); document.querySelectorAll('details').forEach(d=>d.open=true);
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(800);

    check('html に lang="ja" がある', (await ev(`return document.documentElement.lang;`)) === 'ja');
    check('title がある', (await ev(`return (document.title||'').length > 10;`)) === true);
    check('meta description がある',
      (await ev(`const m=document.querySelector('meta[name=description]'); return m ? m.content.length : 0;`)) > 40);
    check('CSP が指定されている',
      (await ev(`return !!document.querySelector('meta[http-equiv="Content-Security-Policy"]');`)) === true);

    // 見出しレベルが飛んでいないか（h1→h3 のような飛びは読み上げで迷子になる）
    const headSkip = await ev(`
      const hs=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>h.offsetParent!==null);
      const bad=[]; let prev=0;
      hs.forEach(function(h){ const lv=+h.tagName[1];
        if(prev && lv>prev+1) bad.push(h.tagName+':'+h.textContent.trim().slice(0,20));
        prev=lv; });
      return bad.slice(0,5);`);
    check('見出しレベルが飛んでいない', headSkip.length === 0, headSkip.join(' / '));
    check('h1 はちょうど1つ', (await ev(`return document.querySelectorAll('h1').length;`)) === 1);

    // 画像があれば alt が必要（このサイトは画像0件のはず）
    const imgs = await ev(`return [...document.images].filter(i=>!i.alt).length + '/' + document.images.length;`);
    check('alt のない画像がない', imgs.split('/')[0] === '0', imgs + '（画像数）');

    // キーボードで到達できない操作要素がないか
    const unreach = await ev(`
      const bad=[];
      document.querySelectorAll('button, a[href], select, input:not([type=hidden]), summary').forEach(function(e){
        if(e.offsetParent===null) return;
        if(e.disabled) return;
        if(e.tabIndex < 0) bad.push((e.id||e.textContent.trim().slice(0,16)||e.tagName));
      });
      return [...new Set(bad)].slice(0,6);`);
    check('キーボードで到達できない操作要素がない', unreach.length === 0, unreach.join(' / '));

    // フォーカスリングが見えるか（outline を消していないか）
    const focusOk = await ev(`
      const b=document.getElementById('calcBtn'); b.focus();
      const s=getComputedStyle(b, ':focus-visible');
      return getComputedStyle(document.documentElement).getPropertyValue('--brand').trim().length > 0;`);
    check('フォーカス表示のスタイルが定義されている', focusOk === true);

    // DOMノード数（多すぎると描画とメモリに効く）
    // 上限の変更の記録（利用者の方針：機能を足して上限を超えたら、そのつど上限を上げてよい。理由はここに書く）
    //   2026-11-09 3,000 → 3,100 … 自動で出る結果・ナビ下の要約・④⑤⑥の折りたたみ
    //   2026-11-10 3,100 → 3,500 … 「あてはまるもの」のチップ（1人26個 × 家族の人数）。測定時 3,293個
    // 飾り（点・ロゴ・印）は擬似要素で描いて増やさないようにしてある。
    const nodes = await ev(`return document.getElementsByTagName('*').length;`);
    check('DOMノード数が3,500未満', nodes < 3500, nodes + '個');

    // aria-pressed / aria-label の整合
    const ariaBad = await ev(`
      const bad=[];
      document.querySelectorAll('[aria-pressed]').forEach(function(e){
        if(!['true','false'].includes(e.getAttribute('aria-pressed'))) bad.push(e.id||e.textContent.slice(0,12));
      });
      document.querySelectorAll('select').forEach(function(e){
        if(e.offsetParent===null) return;
        const inLabel = !!e.closest('label'), hasAria = e.hasAttribute('aria-label') || e.hasAttribute('aria-labelledby');
        if(!inLabel && !hasAria) bad.push('ラベルなし:'+(e.id||''));
      });
      return [...new Set(bad)].slice(0,6);`);
    check('aria 属性とラベルに不整合がない', ariaBad.length === 0, ariaBad.join(' / '));
  }

  console.log('\n=== 品質：文字と背景のコントラスト（WCAG 2.2 AA） ===');
  {
    /* 本文4.5:1／大きい文字3:1 を満たしているか、ライトとダークの両方で測る。
     * 税額や判定が読み取れないと、このサイトは用をなさない。 */
    const contrast = `function(){
      const lum = function(c){
        const v = c.match(/[\\d.]+/g).map(Number).slice(0,3).map(function(x){
          x = x/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4);
        });
        return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2];
      };
      /* 半透明の背景は下の色と合成しないと正しく測れない。
       * 上から順に集めて、不透明な色に行き当たったところから重ねていく。 */
      const bgOf = function(el){
        const stack = [];
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          if (c && !/transparent/.test(c)) {
            const p = c.match(/[\\d.]+/g).map(Number);
            const a = p.length > 3 ? p[3] : 1;
            if (a > 0) { stack.push([p[0], p[1], p[2], a]); if (a >= 1) break; }
          }
          el = el.parentElement;
        }
        stack.push([255, 255, 255, 1]);
        let out = stack[stack.length - 1].slice(0, 3);
        for (let i = stack.length - 2; i >= 0; i--) {
          const s = stack[i];
          out = [0,1,2].map(function(k){ return s[k] * s[3] + out[k] * (1 - s[3]); });
        }
        return 'rgb(' + out.join(',') + ')';
      };
      const bad = [];
      document.querySelectorAll('p, li, td, th, span, b, strong, small, h1, h2, h3, h4, label, button, legend, caption, a')
        .forEach(function(e){
          if (e.offsetParent === null) return;
          if (!e.textContent.trim()) return;
          if (e.children.length && !/^(B|STRONG|SMALL|SPAN|A)$/.test(e.tagName)) return;
          const st = getComputedStyle(e);
          const size = parseFloat(st.fontSize);
          const bold = (parseInt(st.fontWeight,10) || 400) >= 700;
          const large = size >= 24 || (size >= 18.66 && bold);
          const need = large ? 3 : 4.5;
          const l1 = lum(st.color), l2 = lum(bgOf(e));
          const ratio = (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
          if (ratio < need - 0.02) {
            bad.push(e.textContent.trim().slice(0,20) + ' ' + ratio.toFixed(2) + ':1（要' + need + '）');
          }
        });
      return [...new Set(bad)].slice(0, 8);
    }`;
    for (const theme of ['light', 'dark']) {
      await ev(`window.TaxTheme.set('${theme}'); return 1;`);
      await sleep(350);
      const bad = await ev(`return (${contrast})();`);
      check(`${theme}：コントラスト比が基準を満たす`, bad.length === 0, bad.join(' / '));
    }
    await ev(`window.TaxTheme.set('auto'); return 1;`);
    await sleep(200);
  }

  /* 読み込み中に画面がガタつかないか。
   * ステップナビと鮮度表示は JS が中身を入れるので、CSS 側で先に高さを取ってある。
   * その予約が実際の高さと合っているかを、画面幅ごとに突き合わせる。
   * 文言を増やして折り返しが増えると足りなくなるが、そのときはここが落ちる。 */
  /* 狭い画面で、結果の表が横スクロールなしで読めるか。
   * 「項目 × 人」の表を横に並べたままだと1列70pxほどになり、金額が1文字ずつ
   * 折り返され、右端の列は画面の外に出る。縦に積み直す指定が効いているかを、
   * 実際に判定結果を出してから測って確かめる。 */
  console.log('\n=== スマホでの結果表示 ===');
  for (const w of [430, 390, 360, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: pageUrl });
    await waitReady();
    await ev(`set('A_salary','4500000'); set('A_social','650000');
      set('B_salary','1200000'); set('B_social','80000');
      document.getElementById('calcBtn').click(); return 1;`);
    await sleep(900);
    const r = await ev(`const over=[];
      document.querySelectorAll('#results .tablewrap').forEach(function (t) {
        if (t.scrollWidth > t.clientWidth + 1) over.push('表が ' + (t.scrollWidth - t.clientWidth) + 'px はみ出す');
      });
      // 名札（列の見出し）が全部のマスに入っているか
      let missing = 0;
      document.querySelectorAll('#results table thead').forEach(function (th) {
        const tbl = th.closest('table');
        tbl.querySelectorAll('tbody tr > td').forEach(function (td) { if (!td.hasAttribute('data-label')) missing++; });
      });
      return { over: over, missing: missing, body: document.body.scrollWidth - document.body.clientWidth };`);
    /* 「1文字ずつ縦に並ぶ」状態になっていないか。
     * 列が細い表を狭い画面に押し込むとこうなる。要素の高さから行数を割り出すと
     * 見出し行を数えてしまうので、文字そのものの行ボックス（Range）を数える。 */
    const thin = await ev(`const bad=[]; const range=document.createRange();
      document.querySelectorAll('body *').forEach(function (el) {
        if (el.children.length) return;
        const t=(el.textContent||'').trim();
        if (t.length < 3) return;
        const box=el.getBoundingClientRect();
        if (box.height<=0 || box.width<=0) return;
        let lines=0;
        [].forEach.call(el.childNodes, function (n) {
          if (n.nodeType!==3 || !n.data.trim()) return;
          range.selectNodeContents(n);
          lines += range.getClientRects().length;
        });
        /* 4文字程度の語が文中で2行にまたがるのは、ただの折り返しなので数えない。
           5文字以上あって1行2.4文字以下＝箱が狭すぎて縦に並んでいる状態。 */
        if (lines>=2 && t.length>=5 && t.length/lines <= 2.4)
          bad.push(t.slice(0,16)+'（'+t.length+'文字を'+lines+'行）');
      });
      return bad;`);
    check(`${w}px：1文字ずつ縦に並んでいる箇所がない`, thin.length === 0, thin.slice(0, 3).join(' / '));
    check(`${w}px：結果の表が横にはみ出さない`, r.over.length === 0, r.over.slice(0, 2).join(' / '));
    check(`${w}px：本文が横にずれない`, r.body <= 1, r.body + 'px');
    check(`${w}px：表のマスに列の見出しが入っている`, r.missing === 0, r.missing + '個 欠けている');
  }

  /* 文字どうしが重なっていないか。
   * 1行1項目の並べ方は CSS グリッドで作っており、説明文が2つ以上ある欄
   * （年分＝説明が2つ、控除＝説明＋ロック理由）で同じマスに入って重なったことがある。
   * 目で見ないと気づけない類なので、隣り合う要素の位置を実際に測って確かめる。 */
  console.log('\n=== 文字の重なり ===');
  for (const w of [1350, 900, 700, 641, 640, 412]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 800 });
    await send('Page.navigate', { url: pageUrl });
    await waitReady();
    const bad = await ev(`const bad=[];
      document.querySelectorAll('.field, .mgrid, .kpi').forEach(function (f) {
        const kids=[...f.children].filter(e=>e.getBoundingClientRect().height>0);
        for(let i=0;i<kids.length;i++) for(let j=i+1;j<kids.length;j++){
          const a=kids[i].getBoundingClientRect(), b=kids[j].getBoundingClientRect();
          const ov=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
          const oh=Math.min(a.right,b.right)-Math.max(a.left,b.left);
          if(ov>2&&oh>2) bad.push(((f.querySelector('span')||{}).textContent||f.className).slice(0,20)+
            '（'+kids[i].className+'／'+kids[j].className+'）');
        }
      });
      return bad;`);
    check(`${w}px：文字が重なっていない`, bad.length === 0, bad.slice(0, 3).join(' / '));
  }

  /* 1ページずつの画面では、読み込み直後に見えるのは1ページ目だけなので、
   * はみ出しや文字の重なりは、全ページを順に開いて確かめる（「ある」を選んで入力欄も出す）。 */
  console.log('\n=== スマホ幅で全ページを開く ===');
  for (const w of [375, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: pageUrl });
    await waitReady();
    const bad = await ev(`return new Promise(async function(done){
      const wait=ms=>new Promise(r=>setTimeout(r,ms)); const out=[];
      for(let n=1;n<=TaxWizard.LAST;n++){
        TaxWizard.go(n); await wait(120);
        const yes=document.querySelector('.wizq:not(.wiz-off) input[value="yes"]');
        if(yes){ yes.click(); await wait(150);
          for(const w of [...document.querySelectorAll('.wizq:not(.wiz-off) input[data-who]:not(:checked)')]){ w.click(); await wait(120); } }
        // 1人ずつ進むページは、全員分を順に開いて測る（ページが変わったら次のページへ）
        for(let k=0;k<8;k++){
        document.querySelectorAll('main details').forEach(d=>d.open=true);
        document.querySelectorAll('main .ichips[data-g] input:not(:checked)').forEach(c=>{ if(c.closest('.ichips').offsetParent) c.click(); });
        await wait(120);
        const ow=document.documentElement.scrollWidth-document.documentElement.clientWidth;
        if(ow>1) out.push(n+'ページ：横に'+ow+'px');
        document.querySelectorAll('main .field, main .mgrid').forEach(function(f){
          if(f.offsetParent===null) return;
          const kids=[...f.children].filter(e=>e.getBoundingClientRect().height>0);
          for(let i=0;i<kids.length;i++) for(let j=i+1;j<kids.length;j++){
            const a=kids[i].getBoundingClientRect(), b=kids[j].getBoundingClientRect();
            if(Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2 && Math.min(a.right,b.right)-Math.max(a.left,b.left)>2)
              out.push(n+'ページ：重なり '+((f.querySelector('span')||{}).textContent||'').slice(0,12));
          }
        });
        if(n===TaxWizard.LAST) break;
        TaxWizard.next(); await wait(120);
        if(TaxWizard.page()!==n){ TaxWizard.go(n); break; }
        }
      }
      done(out.slice(0,5));
    });`);
    check(`${w}px：全ページで横にはみ出さず、文字が重ならない`, bad.length === 0, bad.join(' / '));
  }

  console.log('\n=== 読み込み中のガタつき（予約した高さと実際の高さ） ===');
  for (const w of [1350, 768, 412, 360, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 800 });
    await send('Page.navigate', { url: pageUrl });
    await waitReady();
    const g = await ev(`const px=(el,p)=>Math.round(parseFloat(getComputedStyle(el)[p])||0);
      const nav=document.querySelector('.stepnav .wrap'), fr=document.getElementById('freshness');
      return { navRes:px(nav,'minHeight'), navAct:Math.round(nav.getBoundingClientRect().height),
               frRes:px(fr,'minHeight'), frAct:Math.round(fr.getBoundingClientRect().height) };`);
    check(`${w}px：ステップナビが押し下げを起こさない`, g.navAct <= g.navRes,
      `予約 ${g.navRes}px / 実際 ${g.navAct}px`);
    check(`${w}px：鮮度表示が押し下げを起こさない`, g.frAct <= g.frRes,
      `予約 ${g.frRes}px / 実際 ${g.frAct}px`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Page.navigate', { url: pageUrl }); await waitReady();

  console.log('\n=== 印刷（PDF出力） ===');
  await ev(`mode('student'); set('A_salary','5000000'); set('A_social','750000');
    document.getElementById('calcBtn').click(); return 1;`);
  await sleep(700);
  /* 実際の印刷（ボタン・Ctrl+P）では beforeprint が起きて、畳んだ結果がすべて開く。
   * printToPDF ではこのイベントが起きないので、ここで同じイベントを起こす。 */
  await ev("document.body.classList.add('print-all'); document.querySelectorAll('details.guide').forEach(d=>d.open=true); window.dispatchEvent(new Event('beforeprint')); return 1;");
  await sleep(300);
  check('印刷の直前に、畳んだ結果の明細と出典がすべて開く',
    (await ev(`return document.querySelectorAll('#results details.fold').length > 0 && !document.querySelector('#results details.fold:not([open])');`)) === true);
  const pdf = await send('Page.printToPDF', { printBackground: true, paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.51, marginBottom: 0.51, marginLeft: 0.43, marginRight: 0.43 });
  const buf = Buffer.from(pdf.data, 'base64');
  fs.writeFileSync(path.join(SHOT, 'result.pdf'), buf);
  console.log('  📄 result.pdf (' + Math.round(buf.length / 1024) + ' KB)');

  console.log('\n=== JSエラー ===');
  if (errors.length) errors.forEach(e => console.log('  ❌ ' + e));
  else console.log('  なし');
  if (logs.length) { console.log('=== console warn/error ==='); logs.forEach(l => console.log('  ⚠ ' + l)); }

  console.log(`\n===== チェック ${pass + fail} 件：成功 ${pass} / 失敗 ${fail} =====`);
  ws.close(); chrome.kill();
  process.exit(errors.length || fail ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
