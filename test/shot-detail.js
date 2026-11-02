/* 特定のカードだけを拡大してスクリーンショットする（レイアウト確認用）
 * node test/shot-detail.js */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const PROFILE = path.join(ROOT, 'test', '.chrome-profile2').replace(/\\/g, '/');
const SHOT = path.join(ROOT, 'test', 'shots').replace(/\\/g, '/');
fs.mkdirSync(SHOT, { recursive: true });
const pageUrl = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
  '--window-size=1060,900', '--force-device-scale-factor=2', '--allow-file-access-from-files', pageUrl], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const H = `
const set=(id,v)=>{const e=document.getElementById(id); if(!e) return;
  if(e.type==='checkbox'){e.checked=v;} else {e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));}
  e.dispatchEvent(new Event('change',{bubbles:true}));};
const pick=(id,t)=>{const e=document.getElementById(id);
  const i=[...e.options].findIndex(o=>o.value===t||o.textContent===t); if(i<0) return;
  e.selectedIndex=i; e.dispatchEvent(new Event('change',{bubbles:true}));};
const addMember=(rel)=>{document.querySelector('[data-add="'+rel+'"]').click();};
const memberIds=()=>[...document.querySelectorAll('.member:not(.fixed)')].map(e=>e.id.replace('row_',''));
`;

(async () => {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await getJson(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) { }
    if (!target) await sleep(400);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: pageUrl }); await sleep(1600);

  const ev = async e => (await send('Runtime.evaluate', { expression: '(()=>{' + H + e + '})()', returnByValue: true })).result.value;

  // 学生（詳細入力ON・アルバイト100万＋株の譲渡益30万）・中学生・祖母がいる世帯
  await ev(`pick('pref','神奈川県'); pick('city','横浜市');
    const ids=memberIds(); set(ids[0]+'_age',19); set(ids[0]+'_kokuho',true);
    addMember('child'); addMember('parent'); return 1;`);
  await sleep(300);
  await ev(`const ids=memberIds();
    set(ids[1]+'_age',14); set(ids[1]+'_kokuho',true);
    set(ids[2]+'_age',78); set(ids[2]+'_pension','1200000'); set(ids[2]+'_live',true); set(ids[2]+'_kokuho',true);
    set('A_salary','3800000'); set('A_social','560000'); set('A_kokuho',true);
    set('B_salary','1000000'); set('B_kokuho',true);
    set('md1_salary','1000000'); set('md1_stockTransfer','300000');
    return 1;`);
  await sleep(500);

  const clip = async (selector, name, index) => {
    const box = await ev(`const els=document.querySelectorAll('${selector}');
      const el=els[${index || 0}]; if(!el) return null;
      const r=el.getBoundingClientRect();
      return {x:r.left+scrollX, y:r.top+scrollY, w:r.width, h:r.height};`);
    if (!box) { console.log('  見つかりません:', selector, index); return; }
    const r = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: box.x, y: box.y, width: box.w, height: Math.min(box.h, 3200), scale: 1.35 }
    });
    fs.writeFileSync(path.join(SHOT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸', name + '.png', Math.round(box.w) + '×' + Math.round(box.h));
  };

  await clip('#step1', 'z1-mode');
  await clip('#step3', 'z2-roster');
  await clip('#step6', 'z3-detail-person');
  await ev('document.getElementById("calcBtn").click(); return 1;'); await sleep(900);
  await clip('#results > .card', 'z4-kokuho-result', 2);
  await clip('#step7', 'z8-kokuho-input');
  // Bを削除したとき（ひとり親）の表示
  await ev("document.querySelector('[data-delb]').click(); return 1;"); await sleep(400);
  await clip('#step3', 'z5-roster-nob');
  await ev("document.querySelector('[data-addb]').click(); return 1;"); await sleep(400);
  // ロック表示
  await ev(`set('A_salary','8000000'); return 1;`);
  await sleep(300);
  await clip('#formA fieldset.group', 'z6-locks', 2);
  await ev(`set('A_salary','3800000'); document.getElementById('calcBtn').click(); return 1;`);
  await sleep(900);
  await clip('#results > .card', 'z7-summary', 0);

  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
