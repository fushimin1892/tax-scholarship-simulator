/* 入力欄が計算に届いているかの検証（node test/verify-wiring.js　要 Chrome）
 *
 * なぜこれが要るか。
 * verify / verify-calc / verify-matrix は calc.js を直接呼んで計算を確かめている。
 * つまり「計算式は正しいが、画面の入力欄がそこまで届いていない」という配線の
 * 切れは、原理的に見つからない。実際、国保の軽減判定で繰越控除が反映されない
 * 不具合がこの形で起きた（計算側は正しく、集計側が別の値を渡していた）。
 *
 * ここでは画面から入力欄を1つずつ動かして、判定結果の文字列が変わることを見る。
 * 変わらなければ、その欄はどこにも効いていないか、効くはずの経路が切れている。
 *
 * 注意：ただ0→適当な額にするだけでは「変わらないのが正しい」場合がある。
 *   ・一時所得・総合譲渡・山林の特別控除50万円の中に収まる額
 *   ・退職所得控除の最低80万円の中に収まる額
 *   ・負債利子は配当が、繰越損失は譲渡益が、補填額は医療費がないと効かない
 *   ・所得の条件がある控除（勤労学生・未成年など）は高所得だとロックされる
 * そこで欄ごとに前提を用意し、控除枠を確実に超える額で動かす。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || 'google-chrome';
const PORT = 9411;
const pageUrl = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

/* 欄ごとの前提。書いていない欄は「給与500万・社保75万」の土台だけで見る。 */
const SETUP = {
  A_dividendDebt: { A_dividendGeneral: 1000000 },
  A_temporaryExpense: { A_temporaryRevenue: 3000000 },
  A_transferShortExpense: { A_transferShortRevenue: 3000000 },
  A_transferLongExpense: { A_transferLongRevenue: 3000000 },
  A_medicalComp: { A_medical: 1500000 },
  A_retirementYears: { A_retirementRevenue: 20000000 },
  A_retirementOfficer: { A_retirementRevenue: 20000000, A_retirementYears: 4 },
  A_retirementShort: { A_retirementRevenue: 20000000, A_retirementYears: 4 },
  A_retirementDisability: { A_retirementRevenue: 20000000, A_retirementYears: 10 },
  A_forestExpense: { A_forestRevenue: 5000000 },
  A_coStockLoss: { A_stockTransfer: 3000000 },
  A_coNetLoss: { A_business: 3000000 },
  A_coCasualtyLoss: { A_business: 3000000 },
  /* 所得の条件がある控除は、条件を満たす低い所得に置き換えてから見る */
  A_student: { A_salary: 1000000 },
  A_minor: { A_salary: 1000000 },
  A_widow: { A_salary: 1000000 },
  A_singleParent: { A_salary: 1000000 },
  A_welfare: { A_salary: 1000000 }
};
/* 特別控除を確実に超える額にする欄 */
const BIG = {
  A_temporaryRevenue: 3000000, A_transferShortRevenue: 3000000, A_transferLongRevenue: 3000000,
  A_retirementRevenue: 20000000, A_retirementYears: 10, A_forestRevenue: 5000000,
  A_medical: 1500000, A_dividendGeneral: 1000000, A_salary: 8000000
};

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(ROOT, 'test', '.chrome-profile-wiring'),
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

/* ページ側に注入するヘルパ */
const H = `const s=(id,v)=>{const e=document.getElementById(id); if(!e) return false;
    if(e.type==='checkbox'){e.checked=!!v;} else {e.value=String(v);
      e.dispatchEvent(new Event('input',{bubbles:true}));}
    e.dispatchEvent(new Event('change',{bubbles:true})); return true;};
  const locked=(id)=>{const e=document.getElementById(id); return !!(e&&e.disabled);};
  const snap=()=>{TaxWizard.go(TaxWizard.LAST);
    return document.getElementById('results').textContent.replace(/\\s+/g,' ');};
  const clearAll=()=>{
    document.querySelectorAll('#formA input').forEach(e=>{
      if(e.type==='checkbox') e.checked=false; else e.value='0';});
    document.querySelectorAll('#formA select').forEach(e=>{e.selectedIndex=0;});};`;

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) { }
    if (!target) await sleep(400);
  }
  if (!target) { console.error('Chrome に接続できませんでした'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: '(()=>{' + H + expr + '})()', returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  await send('Page.navigate', { url: pageUrl });
  for (let k = 0; k < 100; k++) {
    if (await ev('return document.body && document.body.dataset.ready === "1";')) break;
    await sleep(100);
  }

  const list = JSON.parse(await ev(`
    const out=[];
    document.querySelectorAll('#formA input, #formA select').forEach(function(e){
      if(!e.id) return;
      const f=e.closest('.field');
      const lab=f?((f.querySelector('span,.lbl')||{}).textContent||''):'';
      out.push({id:e.id, type:e.type, tag:e.tagName,
        opts:e.tagName==='SELECT'?[...e.options].map(o=>o.value):null,
        label:lab.trim().split('\\n')[0].slice(0,30)});
    });
    return JSON.stringify(out);`));

  const baseAnd = (extra) => `clearAll(); s('A_salary',5000000); s('A_social',750000);` +
    Object.entries(extra || {}).map(([k, v]) => `s('${k}',${JSON.stringify(v)});`).join('') + `return 1;`;

  let pass = 0; const dead = [], skipped = [];
  for (const f of list) {
    if (f.id === 'A_social') continue;                 // 土台に使っている
    let value;
    if (f.type === 'checkbox') value = true;
    else if (f.tag === 'SELECT') {
      value = (f.opts || []).find(o => o && o !== 'none');
      if (!value) { skipped.push(f.id + '（選べる値がない）'); continue; }
    } else value = BIG[f.id] || 800000;

    await ev(baseAnd(SETUP[f.id]));
    await sleep(30);
    if (await ev(`return locked('${f.id}');`)) { skipped.push(f.id + '（ロック中）'); continue; }
    const before = await ev('return snap();');
    await ev(`s('${f.id}', ${JSON.stringify(value)}); return 1;`);
    await sleep(30);
    const after = await ev('return snap();');
    if (before === after) dead.push('  ❌ ' + f.id + '（' + f.label + '）に ' + JSON.stringify(value) + ' を入れても結果が変わらない');
    else pass++;
  }

  console.log('入力欄 ' + list.length + ' 個のうち ' + (pass + dead.length) + ' 個を実際に動かして確認しました');
  if (skipped.length) console.log('  対象外 ' + skipped.length + ' 個：' + skipped.join(' / '));
  dead.forEach(d => console.log(d));
  if (errors.length) { console.log('\nJSエラー:'); errors.forEach(e => console.log('  ❌ ' + e)); }
  console.log('\n===== 配線の検証 ' + (pass + dead.length) + ' 件：成功 ' + pass + ' / 失敗 ' + dead.length + ' =====');
  ws.close(); chrome.kill();
  process.exit(dead.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
