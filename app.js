// =============================================================
// 訓練日誌 PWA — 主程式
// 結構：1 Firebase 初始化 → 2 預設課表 → 3 小工具 → 4 狀態
//       → 5 登入 → 6 讀寫資料 → 7 畫面 → 8 事件
// =============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// 每次修改程式就改這個字串，到「設定 → 帳號」可以確認手機跑的是哪一版
const APP_VERSION = '2026-10-01 快速啟動版';

/* ---------- 1. Firebase 初始化 ---------- */
const CONFIGURED = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR'));
let auth = null, db = null;
if (CONFIGURED){
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    // 離線快取：沒網路時照樣能讀寫，連線後自動上傳
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = getFirestore(app);
  }
}
// 每個人的資料都放在 users/<自己的 uid>/ 底下（安全規則只允許本人讀寫）
const R = {
  sessCol: uid => collection(db, 'users', uid, 'sessions'),
  sess:   (uid, d) => doc(db, 'users', uid, 'sessions', d),
  body:    uid => doc(db, 'users', uid, 'data', 'body'),
  tpl:     uid => doc(db, 'users', uid, 'data', 'template')
};

/* ---------- 2. 預設課表（新帳號第一次登入時複製一份給他） ---------- */
const DEFAULT_T = {
  upper:{label:'上肢', ex:[
    {n:'槓鈴臥推',s:3,r:'5-8'},
    {n:'坐姿划船',s:3,r:'8-12'},
    {n:'啞鈴肩推',s:3,r:'8-12'},
    {n:'滑輪下拉',s:3,r:'8-12'},
    {n:'側平舉',s:3,r:'12-20'},
    {n:'臉拉',s:3,r:'12-20'},
    {n:'繩索捲腹',s:3,r:'10-15'},
    {n:'懸吊抬腿',s:3,r:'10-15'}
  ]},
  lower:{label:'下肢', ex:[
    {n:'深蹲',s:3,r:'5-8'},
    {n:'保加利亞分腿蹲',s:3,r:'8-12',note:'每邊'},
    {n:'腿後彎舉',s:3,r:'10-15'},
    {n:'臀推',s:3,r:'8-12',opt:true},
    {n:'大腿外展',s:3,r:'12-20'},
    {n:'小腿提踵',s:3,r:'12-20'},
    {n:'懸吊抬膝',s:3,r:'10-15'},
    {n:'繩索捲腹',s:3,r:'10-15'}
  ]},
  full:{label:'全身', ex:[
    {n:'羅馬尼亞硬舉',s:3,r:'6-10'},
    {n:'上斜啞鈴臥推',s:3,r:'8-12'},
    {n:'單臂啞鈴划船',s:3,r:'10-12'},
    {n:'腿推',s:3,r:'10-15'},
    {n:'二頭彎舉',s:3,r:'10-15'},
    {n:'三頭下壓',s:3,r:'10-15'},
    {n:'側平舉',s:3,r:'12-20',opt:true},
    {n:'臉拉',s:3,r:'12-20',opt:true},
    {n:'繩索斜向捲腹',s:3,r:'10-15'},
    {n:'負重懸吊抬腿',s:3,r:'10-15'}
  ]},
  // 有氧：kind:'cardio' 的動作記錄「分鐘＋距離」；s = 幾段，r = 目標分鐘區間
  cardio:{label:'有氧', ex:[
    {n:'跑步機（快走／慢跑）',s:1,r:'20-40',kind:'cardio'},
    {n:'飛輪',s:1,r:'20-40',kind:'cardio'},
    {n:'划船機',s:1,r:'10-20',kind:'cardio'},
    {n:'滑步機',s:1,r:'20-40',kind:'cardio',opt:true}
  ]}
};
const DAYS = ['upper','lower','full','cardio'];
const WK = '日一二三四五六';

/* ---------- 3. 小工具 ---------- */
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (s,n) => { const d = parse(s); d.setDate(d.getDate()+n); return ymd(d); };
const md = s => { const d = parse(s); return `${d.getMonth()+1}/${d.getDate()}`; };
const mdw = s => `${md(s)}（${WK[parse(s).getDay()]}）`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',','.')); return isFinite(n) ? n : null; };
const r1 = n => Math.round(n*10)/10;
const fmtW = w => w == null ? '—' : (w === 0 ? '自重' : `${+(+w).toFixed(2)}kg`);
const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const clone = o => JSON.parse(JSON.stringify(o));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const hiRep = r => { const p = String(r || '').split('-'); return Number(p[p.length-1]); };  // '8-12' → 12
// 一組資料：重訓 {w 重量, r 次數}；有氧 {m 分鐘, d 距離km}
const SET_KEYS = ['w','r','m','d'];
function normSet(x){ const o = {}; for (const k of SET_KEYS){ const v = x && x[k] != null && x[k] !== '' ? +x[k] : null; if (v != null && isFinite(v)) o[k] = v; } return o; }
const hasData = x => !!x && SET_KEYS.some(k => x[k] != null);
const isDone = x => !!x && ((x.r > 0) || (x.m > 0));
const fmtSet = x => (x.m != null || x.d != null)
  ? `${x.m != null ? +x.m + '分' : '—'}${x.d != null ? ' ' + (+x.d) + 'km' : ''}`
  : `${fmtW(x.w)}×${x.r}`;
const $ = sel => document.querySelector(sel);
const view = $('#view');
const nav = $('nav.tabs');

/* ---------- 4. 狀態 ---------- */
// 記住「這台手機登入過」：重新開啟 app 時先顯示載入畫面，而不是閃一下登入畫面
const HINT = 'gymlog.signedIn';
const hint = { get(){ try { return localStorage.getItem(HINT) === '1'; } catch(e){ return false; } },
               set(v){ try { v ? localStorage.setItem(HINT, '1') : localStorage.removeItem(HINT); } catch(e){} } };
function freshState(){
  return {
    tab:'train', date:today(), sessions:{}, body:{weights:{}, waists:{}},
    tpl:normTemplate(null), tplDay:'upper',
    edited:new Set(), open:null, range:30, bodyDate:today(), needRender:false,
    mode: !CONFIGURED ? 'setup' : (hint.get() ? 'boot' : 'auth'),   // setup | boot | auth | loading | ready
    user:null, authMode:'login', authMsg:'', authErr:false, authBusy:false,
    ready:{sess:false, body:false, tpl:false}, pending:{sess:false, body:false, tpl:false},
    syncErr:null, todayAtOpen:today()
  };
}
let S = freshState();

function normTemplate(o){
  const out = {};
  for (const k of DAYS){
    const def = DEFAULT_T[k];
    const src = o && o.days && o.days[k];
    const label = src && typeof src.label === 'string' && src.label.trim() ? src.label.trim().slice(0, 10) : def.label;
    const list = src && Array.isArray(src.ex) ? src.ex : def.ex;
    out[k] = { label, ex: list.filter(e => e && e.n != null).map(e => ({
      n: String(e.n).slice(0, 30), s: clampInt(e.s, 1, 10, 3), r: String(e.r || '8-12').slice(0, 9),
      note: e.note ? String(e.note).slice(0, 10) : '', opt: !!e.opt,
      kind: e.kind === 'cardio' ? 'cardio' : 'strength'
    })) };
  }
  return out;
}
const tplDoc = () => ({ days: S.tpl, updated: Date.now() });

/* ---------- 5. 登入 ---------- */
const AUTH_ERR = {
  'auth/invalid-email':'Email 格式不正確',
  'auth/invalid-credential':'Email 或密碼錯誤',
  'auth/wrong-password':'Email 或密碼錯誤',
  'auth/user-not-found':'Email 或密碼錯誤',
  'auth/missing-password':'請輸入密碼',
  'auth/email-already-in-use':'這個 Email 已經註冊過，請直接登入',
  'auth/weak-password':'密碼至少要 6 個字元',
  'auth/too-many-requests':'嘗試太多次，請稍後再試',
  'auth/network-request-failed':'網路連線失敗，請檢查網路',
  'auth/operation-not-allowed':'Firebase 尚未開啟 Email 登入（見教學步驟二）',
  'auth/admin-restricted-operation':'目前不開放註冊新帳號'
};
const errMsg = e => (e && (AUTH_ERR[e.code] || (e.code === 'permission-denied' ? '沒有權限（請檢查 Firestore 安全規則）' : e.code))) || '發生錯誤';

let unsubs = [];
if (CONFIGURED){
  onAuthStateChanged(auth, u => { if (u) startUser(u); else stopUser(); });
  // 保險：萬一 10 秒都沒有結果，就顯示登入畫面
  setTimeout(() => { if (S.mode === 'boot'){ S.mode = 'auth'; render(); } }, 10000);
}

function startUser(u){
  stopListeners();
  const keepTab = S.tab;
  S = freshState();
  S.tab = keepTab === 'set' ? 'set' : 'train';
  S.user = { uid:u.uid, email:u.email || '' };
  S.mode = 'loading';
  hint.set(true);
  const uid = u.uid;
  const onErr = e => { S.syncErr = errMsg(e); updateSync(); };

  unsubs.push(onSnapshot(R.sessCol(uid), { includeMetadataChanges:true }, snap => {
    S.pending.sess = snap.metadata.hasPendingWrites;
    if (!S.ready.sess || snap.docChanges().length){
      const m = {}; snap.docs.forEach(d => { m[d.id] = d.data(); }); applySessions(m);
    }
    S.ready.sess = true; afterSnap();
  }, onErr));

  unsubs.push(onSnapshot(R.body(uid), { includeMetadataChanges:true }, snap => {
    S.pending.body = snap.metadata.hasPendingWrites;
    if (!timers.body) applyBody(snap.exists() ? snap.data() : null);
    S.ready.body = true; afterSnap();
  }, onErr));

  unsubs.push(onSnapshot(R.tpl(uid), { includeMetadataChanges:true }, snap => {
    S.pending.tpl = snap.metadata.hasPendingWrites;
    if (snap.exists()){
      if (!timers.tpl) { S.tpl = normTemplate(snap.data()); softRender(); }
      S.ready.tpl = true;
    } else if (!snap.metadata.fromCache){
      // 伺服器確認這個帳號還沒有課表 → 複製預設課表給他（只會發生一次）
      S.tpl = normTemplate(null);
      setDoc(R.tpl(uid), tplDoc()).catch(onErr);
      S.ready.tpl = true;
    }
    afterSnap();
  }, onErr));

  // 第一次在沒網路的情況下開啟時，不要一直卡在「載入中」
  setTimeout(() => {
    if (S.mode === 'loading' && S.user && S.user.uid === uid){ S.ready = {sess:true, body:true, tpl:true}; afterSnap(); }
  }, 6000);

  nav.hidden = false;
  render(); updateSync();
}
function stopListeners(){ unsubs.forEach(f => { try { f(); } catch(e){} }); unsubs = []; }
function stopUser(){
  stopListeners();
  hint.set(false);
  Object.keys(timers).forEach(k => { clearTimeout(timers[k]); delete timers[k]; });
  S = freshState();
  nav.hidden = true;
  render(); updateSync();
}
function afterSnap(){
  if (S.mode === 'loading' && S.ready.sess && S.ready.body && S.ready.tpl){ S.mode = 'ready'; softRender(); }
  updateSync();
}

/* ---------- 6. 讀寫資料 ---------- */
function normSession(o, k){
  const sets = {};
  if (o && o.sets && typeof o.sets === 'object'){
    for (const n in o.sets){ if (Array.isArray(o.sets[n])) sets[n] = o.sets[n].map(normSet); }
  }
  return {date:k, day: DAYS.includes(o && o.day) ? o.day : 'upper', sets, extras: Array.isArray(o && o.extras) ? o.extras.map(String) : []};
}
function applySessions(m){
  const next = {};
  for (const k in m) next[k] = normSession(m[k], k);
  // 還沒存出去的本機修改優先，避免被舊資料蓋掉
  for (const k of S.edited){ if (S.sessions[k]) next[k] = S.sessions[k]; else delete next[k]; }
  S.sessions = next;
  softRender();
}
function applyBody(o){
  S.body = {weights: Object.assign({}, o && o.weights), waists: Object.assign({}, o && o.waists)};
  softRender();
}
function clean(s){
  if (!s) return null;
  const sets = {};
  for (const k in s.sets){
    const a = (s.sets[k] || []).filter(hasData).map(normSet);
    if (a.length) sets[k] = a;
  }
  if (!Object.keys(sets).length && !(s.extras || []).length) return null;
  return {day:s.day, sets, extras:s.extras || [], updated:Date.now()};
}
function cleanAll(){ const o = {}; for (const d in S.sessions){ const c = clean(S.sessions[d]); if (c) o[d] = c; } return o; }

// 輸入時先等 0.7 秒再存，避免每打一個字就寫一次
const timers = {};
function scheduleSave(key, delay){
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => { delete timers[key]; flush(key); }, delay == null ? 700 : delay);
  updateSync();
}
function flush(key){
  if (!S.user) return;
  const uid = S.user.uid;
  let p;
  if (key === 'body') p = setDoc(R.body(uid), {weights:S.body.weights, waists:S.body.waists, updated:Date.now()});
  else if (key === 'tpl') p = setDoc(R.tpl(uid), tplDoc());
  else {
    const d = key.slice(2), c = clean(S.sessions[d]);
    p = c ? setDoc(R.sess(uid, d), c) : deleteDoc(R.sess(uid, d));
    // 還有剛新增、尚未填寫的空白組時，保留本機版本，避免空白列被雲端資料蓋掉
    const ss = S.sessions[d];
    if (!(ss && Object.values(ss.sets).some(a => a.some(x => !hasData(x))))) S.edited.delete(d);
  }
  // 不 await：Firestore 會先寫進手機，離線時等連線後自動上傳
  p.then(() => { S.syncErr = null; updateSync(); }).catch(e => { S.syncErr = errMsg(e); updateSync(); });
  updateSync();
}
function flushAll(){ for (const k of Object.keys(timers)){ clearTimeout(timers[k]); delete timers[k]; flush(k); } }

function updateSync(){
  const el = $('#sync');
  const err = !!S.syncErr;
  el.classList.toggle('err', err);
  if (S.mode === 'setup' || S.mode === 'auth' || S.mode === 'boot'){ el.textContent = ''; return; }
  if (err) el.textContent = S.syncErr;
  else if (S.mode === 'loading') el.textContent = '載入中…';
  else if (Object.keys(timers).length) el.textContent = '儲存中…';
  else if (S.pending.sess || S.pending.body || S.pending.tpl) el.textContent = navigator.onLine ? '上傳中…' : '離線中，已存在手機';
  else el.textContent = '已同步';
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', updateSync);

let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ---------- 訓練日小工具 ---------- */
function defaultDay(date){
  const w = parse(date).getDay();
  return ({0:'cardio',1:'upper',2:'upper',3:'lower',4:'lower',5:'full',6:'full'})[w] || 'upper';
}
function getSession(create){
  let s = S.sessions[S.date];
  if (!s && create){ s = {date:S.date, day:defaultDay(S.date), sets:{}, extras:[]}; S.sessions[S.date] = s; }
  return s;
}
function exList(day, s){
  const tpl = S.tpl[day].ex.filter(e => e.n.trim()).map(e => Object.assign({}, e, {n:e.n.trim()}));
  const names = new Set(tpl.map(e => e.n));
  const extra = [];
  const cardioDay = day === 'cardio';
  const add = n => { if (!names.has(n)){ names.add(n); extra.push({n, s:cardioDay ? 1 : 3, r:cardioDay ? '20-40' : '8-12', custom:true, kind:cardioDay ? 'cardio' : 'strength'}); } };
  (s ? s.extras : []).forEach(add);
  Object.keys(s ? s.sets : {}).forEach(add);
  return tpl.concat(extra);
}
function lastFor(name, before){
  const ds = Object.keys(S.sessions).filter(d => d < before).sort().reverse();
  for (const d of ds){
    const st = (S.sessions[d].sets || {})[name];
    const done = (st || []).filter(isDone);
    if (done.length) return {date:d, sets:done};
  }
  return null;
}
const doneCount = arr => (arr || []).filter(isDone).length;
function markEdit(){ S.edited.add(S.date); }

/* ---------- 7. 畫面 ---------- */
function softRender(){
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && view.contains(a)){ S.needRender = true; return; }
  render();
}
function render(){
  S.needRender = false;
  if (S.mode === 'setup'){ view.innerHTML = setupView(); return; }
  if (S.mode === 'boot'){ view.innerHTML = '<p class="empty">正在開啟…</p>'; return; }
  if (S.mode === 'auth'){ view.innerHTML = authView(); return; }
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  if (S.mode === 'loading' && S.tab !== 'set'){ view.innerHTML = '<p class="empty">正在載入你的資料…</p>'; return; }
  if (S.tab === 'train') view.innerHTML = trainView();
  else if (S.tab === 'body') view.innerHTML = bodyView();
  else if (S.tab === 'hist') view.innerHTML = histView();
  else view.innerHTML = setView();
}

function setupView(){
  return `<div class="setup"><b>還沒設定 Firebase。</b><p>請打開 <code>firebase-config.js</code>，貼上 Firebase 主控台給你的設定後重新上傳（教學步驟一、三）。</p></div>`;
}

function authView(){
  const signup = S.authMode === 'signup';
  return `<div class="auth">
    <h2>${signup ? '建立帳號' : '登入'}</h2>
    <p class="sub">每個帳號的課表與紀錄各自獨立，只有本人看得到。</p>
    <form id="authForm" novalidate>
      <label class="sr" for="aEmail">Email</label>
      <input class="tf" id="aEmail" type="email" inputmode="email" autocomplete="username" placeholder="Email" required>
      <label class="sr" for="aPw">密碼</label>
      <input class="tf" id="aPw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="密碼${signup ? '（至少 6 個字元）' : ''}" required>
      ${signup ? '<label class="sr" for="aPw2">再輸入一次密碼</label><input class="tf" id="aPw2" type="password" autocomplete="new-password" placeholder="再輸入一次密碼" required>' : ''}
      <button type="submit" class="btn" ${S.authBusy ? 'disabled' : ''}>${S.authBusy ? '請稍候…' : (signup ? '建立帳號' : '登入')}</button>
    </form>
    <div class="row">
      <button type="button" class="ghost" id="aSwitch">${signup ? '已有帳號？登入' : '沒有帳號？建立一個'}</button>
      ${signup ? '' : '<button type="button" class="ghost" id="aForgot">忘記密碼</button>'}
    </div>
    <p class="msg ${S.authErr ? 'err' : ''}" role="status">${esc(S.authMsg)}</p>
  </div>`;
}

function trainView(){
  const s = getSession(false);
  const day = s ? s.day : defaultDay(S.date);
  const exs = exList(day, s);
  const total = s ? Object.values(s.sets).reduce((a, arr) => a + doneCount(arr), 0) : 0;
  const t = today();
  const d = parse(S.date);
  return `
  <div class="daterow">
    <div class="bigdate" aria-label="訓練日期">${d.getMonth()+1}/${d.getDate()}<small>週${WK[d.getDay()]}</small></div>
    <div class="datectl">
      <label class="sr" for="dateIn">選擇日期</label>
      <input type="date" id="dateIn" value="${S.date}" max="${t}">
      ${S.date !== t ? '<button type="button" class="ghost" id="todayBtn">今天</button>' : ''}
    </div>
  </div>
  <div class="chips" role="group" aria-label="訓練日類型">
    ${DAYS.map(k => `<button type="button" class="chip d-${k} ${k === day ? 'on' : ''}" data-day="${k}" aria-pressed="${k === day}"><span class="plate"></span>${esc(S.tpl[k].label)}</button>`).join('')}
  </div>
  <p class="summary">這天已記錄<b id="total">${total}</b>組。灰色數字是上次的重量和次數，照著推進就好。</p>
  <div class="d-${day}">${exs.length ? exs.map(e => card(e, s)).join('') : '<p class="empty">這個訓練日還沒有動作，到「設定」分頁編輯課表。</p>'}</div>
  <div class="addex">
    <label class="sr" for="newEx">新增其他動作</label>
    <input id="newEx" maxlength="30" placeholder="新增其他動作，例如：引體向上">
    <button type="button" class="btn" id="addEx">新增</button>
  </div>`;
}
function card(e, s){
  const sets = (s && s.sets[e.n]) || [];
  const last = lastFor(e.n, S.date);
  const hi = hiRep(e.r);
  const cardio = e.kind === 'cardio';
  const up = !e.custom && isFinite(hi) && last && last.sets.length >= e.s && last.sets.every(x => (cardio ? x.m : x.r) >= hi);
  const lastTxt = last ? `上次 ${md(last.date)}：` + last.sets.map(fmtSet).join('、') : '第一次記錄這個動作';
  const done = doneCount(sets);
  const rows = sets.map((x, i) => {
    const ph = last && (last.sets[i] || last.sets[last.sets.length-1]);
    if (cardio) return `<div class="set" data-i="${i}">
      <span class="idx">${i+1}</span>
      <label class="fld"><input class="m" inputmode="decimal" autocomplete="off" aria-label="第${i+1}段時間（分鐘）" value="${x.m == null ? '' : x.m}" placeholder="${ph && ph.m != null ? ph.m : ''}"><span>分</span></label>
      <label class="fld"><input class="d" inputmode="decimal" autocomplete="off" aria-label="第${i+1}段距離（公里，選填）" value="${x.d == null ? '' : x.d}" placeholder="${ph && ph.d != null ? ph.d : ''}"><span>km</span></label>
      <button type="button" class="del" aria-label="刪除第${i+1}段">×</button>
    </div>`;
    return `<div class="set" data-i="${i}">
      <span class="idx">${i+1}</span>
      <label class="fld"><input class="w" inputmode="decimal" autocomplete="off" aria-label="第${i+1}組重量（公斤，自重填 0）" value="${x.w == null ? '' : x.w}" placeholder="${ph && ph.w != null ? ph.w : ''}"><span>kg</span></label>
      <label class="fld"><input class="r" inputmode="numeric" autocomplete="off" aria-label="第${i+1}組次數" value="${x.r == null ? '' : x.r}" placeholder="${ph ? ph.r : ''}"><span>下</span></label>
      <button type="button" class="del" aria-label="刪除第${i+1}組">×</button>
    </div>`;
  }).join('');
  return `<article class="ex${e.opt ? ' opt' : ''}" data-ex="${esc(e.n)}" data-target="${e.s}">
    <div class="exh">
      <h3>${esc(e.n)}</h3>
      <span class="tgt">${e.custom ? '自訂' : (cardio ? `${e.s > 1 ? e.s + ' 段 × ' : ''}${esc(e.r)} 分鐘` : `${e.s} × ${esc(e.r)}`) + (e.note ? ' ' + esc(e.note) : '')}</span>
      ${e.opt ? '<span class="badge">有時間再做</span>' : ''}
      <span class="cnt ${done >= e.s ? 'full' : ''}">${done}/${e.s}</span>
    </div>
    ${up ? `<span class="badge up">${cardio ? '上次達到目標時間，這次可以加快速度或阻力' : '上次全部達標，這次加重'}</span>` : ''}
    <p class="last">${esc(lastTxt)}</p>
    <div class="sets">${rows}</div>
    <button type="button" class="addset">＋ 新增一${cardio ? '段' : '組'}</button>
  </article>`;
}

function bodyView(){
  const W = S.body.weights, Wa = S.body.waists, t = today(), bd = S.bodyDate;
  const avg = (from, to) => { const v = Object.keys(W).filter(d => d >= from && d <= to).map(d => +W[d]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const a1 = avg(addDays(t,-6), t), a0 = avg(addDays(t,-13), addDays(t,-7)), a4 = avg(addDays(t,-34), addDays(t,-28));
  const f = v => v == null ? '—' : v.toFixed(1);
  const diff = (a1 != null && a0 != null) ? a1 - a0 : null;
  let msg;
  if (a1 != null && a4 != null){
    const d = a1 - a4, ds = `近四週 ${d >= 0 ? '+' : ''}${d.toFixed(1)}kg。`;
    if (Math.abs(d) < 0.1) msg = ds + '幾乎持平。想增肌的話，每天加一份已知熱量的食物（半碗飯或一瓶豆漿），觀察 2–3 週。';
    else if (d > 0 && d < 0.25) msg = ds + '上升得很慢，可以再多吃一點點。';
    else if (d >= 0.25 && d <= 0.6) msg = ds + '在增肌期每月 +0.25–0.5kg 的範圍內，搭配腰圍一起看。';
    else if (d > 0.6) msg = ds + '增加得偏快，留意腰圍；腰圍也在變大的話，稍微減量。';
    else msg = ds + '在下降。如果不是刻意減脂，可能吃得不夠。';
  } else msg = '累積四週以上的體重紀錄後，這裡會告訴你趨勢是否在增肌目標範圍內。';

  const waistDs = Object.keys(Wa).sort().reverse();
  const waistList = waistDs.slice(0, 8).map((d, i) => {
    const prev = waistDs[i+1]; const c = prev != null ? Wa[d] - Wa[prev] : null;
    return `<li><span class="d">${mdw(d)}</span><span class="val">${(+Wa[d]).toFixed(1)}</span><span class="chg">${c == null ? 'cm' : `cm（${c >= 0 ? '+' : ''}${c.toFixed(1)}）`}</span><button type="button" class="del" data-delwa="${d}" aria-label="刪除 ${md(d)} 的腰圍">×</button></li>`;
  }).join('');
  const wDs = Object.keys(W).sort().reverse();
  const wList = wDs.slice(0, 10).map(d => `<li><span class="d">${mdw(d)}</span><span class="val">${(+W[d]).toFixed(1)}</span><span class="chg">kg</span><button type="button" class="del" data-delw="${d}" aria-label="刪除 ${md(d)} 的體重">×</button></li>`).join('');

  return `
  <section class="panel">
    <h2>記錄</h2>
    <div class="formgrid">
      <div class="datefld"><label class="lbl" for="bDate">日期</label><input type="date" id="bDate" value="${bd}" max="${t}"></div>
      <div><label class="lbl" for="bW">體重</label><label class="fld"><input id="bW" inputmode="decimal" autocomplete="off" value="${W[bd] != null ? W[bd] : ''}" placeholder="62.0"><span>kg</span></label></div>
      <div><label class="lbl" for="bWa">腰圍（選填）</label><label class="fld"><input id="bWa" inputmode="decimal" autocomplete="off" value="${Wa[bd] != null ? Wa[bd] : ''}" placeholder="75.0"><span>cm</span></label></div>
      <button type="button" class="btn" id="bSave">儲存</button>
    </div>
  </section>
  <section class="panel">
    <h2>體重趨勢</h2>
    <div class="stats">
      <div class="stat"><div class="v">${f(a1)}<small>kg</small></div><div class="k">近 7 天平均</div></div>
      <div class="stat"><div class="v">${f(a0)}<small>kg</small></div><div class="k">前 7 天平均</div></div>
      <div class="stat"><div class="v">${diff == null ? '—' : (diff >= 0 ? '+' : '') + diff.toFixed(1)}<small>kg</small></div><div class="k">週變化</div></div>
    </div>
    <p class="trend">${esc(msg)}</p>
  </section>
  <section class="panel">
    <div class="ranges" role="group" aria-label="圖表範圍">
      ${[[30,'30 天'],[90,'90 天'],[0,'全部']].map(([v, l]) => `<button type="button" data-range="${v}" class="${S.range === v ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    ${chart()}
  </section>
  <section class="panel">
    <h2>腰圍</h2>
    ${waistList ? `<ul class="list">${waistList}</ul>` : '<p class="empty">每兩週量一次，固定在肚臍高度、早上空腹時量。</p>'}
  </section>
  <section class="panel">
    <h2>最近的體重</h2>
    ${wList ? `<ul class="list">${wList}</ul>` : '<p class="empty">每天早上起床、上完廁所後量一次。</p>'}
  </section>`;
}

function chart(){
  const W = S.body.weights, t = today();
  const all = Object.keys(W).sort();
  const from = S.range ? addDays(t, -(S.range - 1)) : (all[0] || t);
  const pts = all.filter(d => d >= from && d <= t);
  if (pts.length < 2) return '<p class="empty">記錄兩天以上的體重，這裡就會出現曲線。</p>';
  const w = 640, h = 250, L = 44, R_ = 14, Tp = 14, B = 30;
  const t0 = parse(pts[0]).getTime(), t1 = parse(pts[pts.length-1]).getTime(), span = Math.max(t1 - t0, 86400000);
  const vals = pts.map(d => +W[d]);
  let mn = Math.min(...vals), mx = Math.max(...vals);
  const pv = Math.max(0.4, (mx - mn) * 0.15); mn -= pv; mx += pv;
  const X = d => L + (parse(d).getTime() - t0) / span * (w - L - R_);
  const Y = v => Tp + (mx - v) / (mx - mn) * (h - Tp - B);
  const roll = d => { const lo = addDays(d, -6); const v = all.filter(x => x >= lo && x <= d).map(x => +W[x]); return v.reduce((a, b) => a + b, 0) / v.length; };
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${X(d).toFixed(1)},${Y(roll(d)).toFixed(1)}`).join(' ');
  let grid = '';
  for (let i = 0; i <= 3; i++){
    const v = mn + (mx - mn) * i / 3, y = Y(v).toFixed(1);
    grid += `<line class="grid" x1="${L}" x2="${w - R_}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${(+y + 5).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`;
  }
  const xl = [pts[0], pts[Math.floor((pts.length - 1) / 2)], pts[pts.length - 1]].filter((d, i, a) => a.indexOf(d) === i);
  const xlab = xl.map((d, i) => `<text class="ax" x="${X(d).toFixed(1)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : (i === xl.length - 1 ? 'end' : 'middle')}">${md(d)}</text>`).join('');
  const dots = pts.map(d => `<circle class="dot" cx="${X(d).toFixed(1)}" cy="${Y(+W[d]).toFixed(1)}" r="3.5"><title>${md(d)} ${(+W[d]).toFixed(1)}kg</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="體重變化曲線">${grid}${dots}<path class="avg" d="${line}"/>${xlab}</svg>
  <p class="legend"><i class="ld"></i>每日體重<i class="ll"></i>7 天平均</p>`;
}

function histView(){
  const ds = Object.keys(S.sessions).filter(d => clean(S.sessions[d])).sort().reverse();
  if (!ds.length) return '<p class="empty">還沒有訓練紀錄。到「訓練」分頁記下第一組。</p>';
  return ds.map(d => {
    const s = S.sessions[d];
    const names = Object.keys(s.sets).filter(n => (s.sets[n] || []).some(hasData));
    const total = names.reduce((a, n) => a + doneCount(s.sets[n]), 0);
    const open = S.open === d;
    const detail = open ? `<div class="hbody">
      ${names.map(n => `<p><b>${esc(n)}</b>　<span class="nums">${s.sets[n].filter(isDone).map(fmtSet).join('、') || '—'}</span></p>`).join('')}
      <div class="hact"><button type="button" class="ghost" data-goto="${d}">到這天修改</button><button type="button" class="ghost danger" data-delsess="${d}">刪除這天</button></div>
    </div>` : '';
    return `<div class="hrow d-${s.day}">
      <button type="button" class="hhead" data-open="${d}" aria-expanded="${open}"><span class="plate"></span><span class="hd">${mdw(d)}</span><span class="hl">${esc(S.tpl[s.day].label)}</span><span class="hs">${names.length} 個動作，${total} 組</span></button>
      ${detail}
    </div>`;
  }).join('');
}

/* 設定分頁：我的課表、備份、帳號 */
function setView(){
  const k = S.tplDay, day = S.tpl[k];
  const rows = day.ex.map((e, i) => { const c = e.kind === 'cardio'; return `
    <div class="tpl-ex" data-ti="${i}">
      <div class="r1">
        <label class="sr" for="tn${i}">動作名稱</label>
        <input class="tin" id="tn${i}" data-tf="n" maxlength="30" value="${esc(e.n)}" placeholder="動作名稱">
      </div>
      <div class="r2">
        <div><label for="ts${i}">${c ? '段數' : '組數'}</label><input class="tin" id="ts${i}" data-tf="s" inputmode="numeric" value="${e.s}"></div>
        <div><label for="tr${i}">${c ? '分鐘區間' : '次數區間'}</label><input class="tin" id="tr${i}" data-tf="r" maxlength="9" value="${esc(e.r)}" placeholder="${c ? '20-40' : '8-12'}"></div>
        <div><label for="tno${i}">備註</label><input class="tin" id="tno${i}" data-tf="note" maxlength="10" value="${esc(e.note)}" placeholder="例：每邊"></div>
      </div>
      <div class="r3">
        <label><input type="checkbox" data-tf="opt" ${e.opt ? 'checked' : ''}> 選配</label>
        <label><input type="checkbox" data-tf="kind" ${c ? 'checked' : ''}> 有氧</label>
        <span class="sp"></span>
        <button type="button" class="mini" data-tmove="-1" aria-label="上移" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="mini" data-tmove="1" aria-label="下移" ${i === day.ex.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="mini danger" data-tdel aria-label="刪除這個動作">刪除</button>
      </div>
    </div>`; }).join('');
  const nS = Object.keys(cleanAll()).length;
  return `
  <section class="panel">
    <h2>我的課表</h2>
    <p class="hint">這裡只會改到你自己的課表，不會影響其他人。改動作名稱後，「上次」紀錄會用新名稱重新對應。勾選「有氧」的動作改記分鐘與距離。</p>
    <div class="chips" role="group" aria-label="選擇訓練日">
      ${DAYS.map(d => `<button type="button" class="chip d-${d} ${d === k ? 'on' : ''}" data-tday="${d}" aria-pressed="${d === k}"><span class="plate"></span>${esc(S.tpl[d].label)}</button>`).join('')}
    </div>
    <div class="tpl-label"><label class="lbl" for="tLabel" style="margin:0">名稱</label><input class="tin" id="tLabel" data-tf="label" maxlength="10" value="${esc(day.label)}"></div>
    <div class="d-${k}">${rows || '<p class="empty">還沒有動作。</p>'}</div>
    <div class="btnrow">
      <button type="button" class="btn" id="tAdd">＋ 新增動作</button>
      <button type="button" class="ghost" id="tReset">還原這天的預設課表</button>
    </div>
  </section>
  <section class="panel">
    <h2>備份</h2>
    <p class="hint">${nS} 天訓練、${Object.keys(S.body.weights).length} 筆體重、${Object.keys(S.body.waists).length} 筆腰圍。匯入檔案可從舊版 artifact 匯出。</p>
    <div class="btnrow">
      <button type="button" class="ghost" id="expBtn">匯出 JSON</button>
      <label class="ghost" for="impFile" style="display:flex;align-items:center;justify-content:center;cursor:pointer">匯入 JSON</label>
      <input type="file" id="impFile" accept="application/json,.json" hidden>
    </div>
  </section>
  <section class="panel">
    <h2>帳號</h2>
    <p class="hint">目前登入：${esc(S.user ? S.user.email : '')}<br>你的資料只有你自己看得到。<br>程式版本：${APP_VERSION}</p>
    <div class="btnrow">
      <button type="button" class="ghost" id="pwReset">寄送重設密碼信</button>
      <button type="button" class="ghost danger" id="logout">登出</button>
    </div>
  </section>`;
}

/* ---------- 匯出／匯入 ---------- */
function buildExport(){
  const sessions = {};
  for (const d of Object.keys(S.sessions).sort()){
    const c = clean(S.sessions[d]);
    if (c){ delete c.updated; sessions[d] = c; }
  }
  const sortObj = o => Object.keys(o).sort().reduce((a, k) => (a[k] = +o[k], a), {});
  return {
    format:'gymlog-export', version:1, exportedAt:new Date().toISOString(), source:'gymlog-pwa',
    templates:Object.fromEntries(DAYS.map(k => [k, {label:S.tpl[k].label, exercises:S.tpl[k].ex}])),
    sessions, body:{weights:sortObj(S.body.weights), waists:sortObj(S.body.waists)}
  };
}
async function doExport(){
  const name = `gymlog-${today()}.json`;
  const text = JSON.stringify(buildExport(), null, 2);
  const file = new File([text], name, {type:'application/json'});
  // iPhone：優先用分享選單（可存到「檔案」或傳給自己）
  if (navigator.canShare && navigator.canShare({files:[file]})){
    try { await navigator.share({files:[file], title:name}); return; }
    catch(e){ if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function doImport(file){
  let o;
  try { o = JSON.parse(await file.text()); } catch(e){ toast('檔案不是有效的 JSON'); return; }
  if (!o || o.format !== 'gymlog-export' || !o.sessions || typeof o.sessions !== 'object'){ toast('這不是訓練日誌的匯出檔'); return; }
  const dates = Object.keys(o.sessions).filter(isDate);
  const bw = (o.body && o.body.weights) || {}, bwa = (o.body && o.body.waists) || {};
  const exist = dates.filter(d => S.sessions[d]).length;
  if (!confirm(`匯入 ${dates.length} 天訓練、${Object.keys(bw).length} 筆體重、${Object.keys(bwa).length} 筆腰圍？` + (exist ? `\n其中 ${exist} 天你已經有紀錄，會被檔案內容取代。` : ''))) return;
  const useTpl = !!o.templates && confirm('檔案裡也有課表。要用它取代你目前的課表嗎？\n（按「取消」則保留目前課表）');

  const uid = S.user.uid;
  const commits = [];
  let batch = writeBatch(db), n = 0;
  const put = (ref, data) => { batch.set(ref, data); if (++n >= 400){ commits.push(batch.commit()); batch = writeBatch(db); n = 0; } };

  for (const d of dates){
    const ns = normSession(o.sessions[d], d), c = clean(ns);
    if (c){ S.sessions[d] = ns; S.edited.delete(d); put(R.sess(uid, d), c); }
  }
  const W = Object.assign({}, S.body.weights), Wa = Object.assign({}, S.body.waists);
  for (const k in bw){ const v = num(bw[k]); if (isDate(k) && v != null) W[k] = r1(v); }
  for (const k in bwa){ const v = num(bwa[k]); if (isDate(k) && v != null) Wa[k] = r1(v); }
  S.body = {weights:W, waists:Wa};
  put(R.body(uid), {weights:W, waists:Wa, updated:Date.now()});
  if (useTpl){
    const days = {};
    for (const k of DAYS){ const t = o.templates[k]; if (t) days[k] = {label:t.label, ex:t.ex || t.exercises}; }
    S.tpl = normTemplate({days});
    put(R.tpl(uid), tplDoc());
  }
  commits.push(batch.commit());
  render(); toast('匯入中…');
  Promise.all(commits).then(() => toast('匯入完成')).catch(e => toast('匯入失敗：' + errMsg(e)));
}

/* ---------- 8. 事件 ---------- */
function updateCount(cardEl, name){
  const s = getSession(false);
  const done = doneCount(s && s.sets[name]);
  const target = +cardEl.dataset.target;
  const c = cardEl.querySelector('.cnt');
  c.textContent = `${done}/${target}`;
  c.classList.toggle('full', done >= target);
  const tot = $('#total');
  if (tot && s) tot.textContent = Object.values(s.sets).reduce((a, arr) => a + doneCount(arr), 0);
}

function editTpl(t){
  const day = S.tpl[S.tplDay], f = t.dataset.tf;
  if (f === 'label'){ day.label = t.value.slice(0, 10); }
  else {
    const i = +t.closest('.tpl-ex').dataset.ti, e = day.ex[i]; if (!e) return;
    if (f === 'n') e.n = t.value.slice(0, 30);
    else if (f === 's') e.s = clampInt(t.value, 1, 10, e.s);
    else if (f === 'r') e.r = t.value.replace(/[–—~～]/g, '-').replace(/\s/g, '').slice(0, 9);
    else if (f === 'note') e.note = t.value.slice(0, 10);
    else if (f === 'opt') e.opt = t.checked;
    else if (f === 'kind'){
      e.kind = t.checked ? 'cardio' : 'strength';
      if (t.checked && /^\d+-\d+$/.test(e.r) && hiRep(e.r) <= 20 && e.s === 3){ e.s = 1; e.r = '20-40'; }
      render();
    }
  }
  scheduleSave('tpl', 800);
}

view.addEventListener('input', ev => {
  const t = ev.target;
  if (t.dataset.tf){ if (t.type !== 'checkbox') editTpl(t); return; }
  const fk = ['w','r','m','d'].find(c => t.classList.contains(c));
  if (!fk) return;
  const cardEl = t.closest('.ex'); if (!cardEl) return;
  const name = cardEl.dataset.ex, i = +t.closest('.set').dataset.i;
  const s = getSession(true);
  const arr = s.sets[name] || (s.sets[name] = []);
  const o = arr[i] || (arr[i] = {});
  const n = num(t.value);
  if (n == null) delete o[fk];
  else o[fk] = fk === 'r' ? Math.max(0, Math.round(n)) : Math.max(0, n);
  markEdit(); updateCount(cardEl, name); scheduleSave('S:' + S.date);
});

view.addEventListener('focusout', ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.tf === 'r' && t.value && !/^\d+(-\d+)?$/.test(t.value)) toast('次數區間請寫成「8-12」或「10」');
  setTimeout(() => {
    const a = document.activeElement;
    if (S.needRender && !(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && view.contains(a))) render();
  }, 60);
});

view.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'dateIn'){ S.date = t.value || today(); render(); }
  else if (t.id === 'bDate'){ S.bodyDate = t.value || today(); render(); }
  else if (t.id === 'impFile'){ const f = t.files && t.files[0]; t.value = ''; if (f) doImport(f); }
  else if (t.dataset.tf === 'opt' || t.dataset.tf === 'kind'){ editTpl(t); }
  else if (t.dataset.tf === 'label'){ render(); }
});

view.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.id === 'newEx'){ ev.preventDefault(); $('#addEx').click(); }
  if (ev.key === 'Enter' && (ev.target.id === 'bW' || ev.target.id === 'bWa')){ ev.preventDefault(); $('#bSave').click(); }
});

view.addEventListener('submit', async ev => {
  if (ev.target.id !== 'authForm') return;
  ev.preventDefault();
  const email = $('#aEmail').value.trim(), pw = $('#aPw').value;
  const signup = S.authMode === 'signup';
  const say = (m, err) => { S.authMsg = m; S.authErr = !!err; const el = view.querySelector('.msg'); if (el){ el.textContent = m; el.classList.toggle('err', !!err); } };
  if (!email || !pw){ say('請輸入 Email 和密碼', true); return; }
  if (signup && pw !== $('#aPw2').value){ say('兩次輸入的密碼不一樣', true); return; }
  const btn = ev.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = '請稍候…';
  try {
    if (signup) await createUserWithEmailAndPassword(auth, email, pw);
    else await signInWithEmailAndPassword(auth, email, pw);
    // 成功後 onAuthStateChanged 會接手切換畫面
  } catch(e){
    btn.disabled = false; btn.textContent = signup ? '建立帳號' : '登入';
    say(errMsg(e), true);
  }
});

view.addEventListener('click', async ev => {
  const t = ev.target.closest('button'); if (!t) return;
  const cardEl = t.closest('.ex');

  /* 登入畫面 */
  if (t.id === 'aSwitch'){ S.authMode = S.authMode === 'login' ? 'signup' : 'login'; S.authMsg = ''; render(); return; }
  if (t.id === 'aForgot'){
    const email = $('#aEmail').value.trim();
    if (!email){ S.authMsg = '先在上方輸入 Email，再按「忘記密碼」'; S.authErr = true; render(); $('#aEmail').focus(); return; }
    try { await sendPasswordResetEmail(auth, email); S.authMsg = '如果這個 Email 有註冊，重設密碼信已寄出（也看看垃圾郵件）'; S.authErr = false; }
    catch(e){ S.authMsg = errMsg(e); S.authErr = true; }
    const keep = email; render(); $('#aEmail').value = keep; return;
  }

  /* 訓練分頁 */
  if (t.classList.contains('addset') && cardEl){
    const name = cardEl.dataset.ex, s = getSession(true);
    const arr = s.sets[name] || (s.sets[name] = []);
    const cardio = !!cardEl.querySelector('.addset') && exList(s.day, s).some(e => e.n === name && e.kind === 'cardio');
    const prev = arr[arr.length - 1];
    const last = lastFor(name, S.date);
    const row = {};
    if (!cardio){
      let w = null;
      if (prev && prev.w != null) w = prev.w;
      else if (last) w = (last.sets[arr.length] || last.sets[last.sets.length - 1]).w;
      if (w != null) row.w = w;
    }
    arr.push(row);
    markEdit(); render(); scheduleSave('S:' + S.date);
    const inp = view.querySelector(`.ex[data-ex="${CSS.escape(name)}"] .set:last-child ${cardio ? '.m' : '.r'}`); if (inp) inp.focus();
    return;
  }
  if (t.classList.contains('del') && cardEl){
    const name = cardEl.dataset.ex, i = +t.closest('.set').dataset.i, s = getSession(false);
    if (!s || !s.sets[name]) return;
    s.sets[name].splice(i, 1);
    if (!s.sets[name].length) delete s.sets[name];
    markEdit(); render(); scheduleSave('S:' + S.date);
    return;
  }
  if (t.dataset.day){
    const s = getSession(true);
    if (s.day !== t.dataset.day){ s.day = t.dataset.day; markEdit(); render(); if (clean(s)) scheduleSave('S:' + S.date); }
    return;
  }
  if (t.id === 'todayBtn'){ S.date = today(); render(); return; }
  if (t.id === 'addEx'){
    const inp = $('#newEx'); const name = inp.value.trim().slice(0, 30);
    if (!name){ inp.focus(); return; }
    const s = getSession(true);
    if (exList(s.day, s).some(e => e.n === name)){ toast('這個動作已經在清單裡'); return; }
    s.extras.push(name); markEdit(); render(); scheduleSave('S:' + S.date);
    toast('已新增「' + name + '」');
    return;
  }

  /* 體重腰圍分頁 */
  if (t.id === 'bSave'){
    const d = $('#bDate').value || today();
    const w = num($('#bW').value), wa = num($('#bWa').value);
    if (w == null && wa == null){ toast('先輸入體重或腰圍'); return; }
    if (w != null && (w < 25 || w > 250)){ toast('體重數字看起來不太對'); return; }
    if (wa != null && (wa < 40 || wa > 200)){ toast('腰圍數字看起來不太對'); return; }
    if (w != null) S.body.weights[d] = r1(w);
    if (wa != null) S.body.waists[d] = r1(wa);
    scheduleSave('body', 0); render(); toast('已儲存');
    return;
  }
  if (t.dataset.delw){ delete S.body.weights[t.dataset.delw]; scheduleSave('body', 0); render(); return; }
  if (t.dataset.delwa){ delete S.body.waists[t.dataset.delwa]; scheduleSave('body', 0); render(); return; }
  if (t.dataset.range != null){ S.range = +t.dataset.range; render(); return; }

  /* 歷史分頁 */
  if (t.dataset.open){ S.open = S.open === t.dataset.open ? null : t.dataset.open; render(); return; }
  if (t.dataset.goto){ S.date = t.dataset.goto; S.tab = 'train'; render(); window.scrollTo(0, 0); return; }
  if (t.dataset.delsess){
    const d = t.dataset.delsess;
    if (!confirm(`刪除 ${md(d)} 的訓練紀錄？刪除後無法復原。`)) return;
    delete S.sessions[d]; S.edited.add(d); S.open = null; render(); scheduleSave('S:' + d, 0);
    return;
  }

  /* 設定分頁：課表 */
  if (t.dataset.tday){ S.tplDay = t.dataset.tday; render(); return; }
  if (t.id === 'tAdd'){
    const cd = S.tplDay === 'cardio';
    S.tpl[S.tplDay].ex.push({n:'', s:cd ? 1 : 3, r:cd ? '20-40' : '8-12', note:'', opt:false, kind:cd ? 'cardio' : 'strength'});
    render(); scheduleSave('tpl', 800);
    const ins = view.querySelectorAll('.tpl-ex input[data-tf="n"]'); if (ins.length) ins[ins.length - 1].focus();
    return;
  }
  if (t.dataset.tmove){
    const ex = S.tpl[S.tplDay].ex, i = +t.closest('.tpl-ex').dataset.ti, j = i + (+t.dataset.tmove);
    if (j < 0 || j >= ex.length) return;
    [ex[i], ex[j]] = [ex[j], ex[i]];
    render(); scheduleSave('tpl', 800); return;
  }
  if (t.hasAttribute('data-tdel')){
    const ex = S.tpl[S.tplDay].ex, i = +t.closest('.tpl-ex').dataset.ti;
    if (!confirm(`從課表移除「${ex[i].n || '未命名動作'}」？過去的紀錄不會被刪除。`)) return;
    ex.splice(i, 1); render(); scheduleSave('tpl', 0); return;
  }
  if (t.id === 'tReset'){
    if (!confirm(`把「${S.tpl[S.tplDay].label}」還原成預設課表？你在這天做的課表修改會消失（訓練紀錄不受影響）。`)) return;
    S.tpl[S.tplDay] = normTemplate(null)[S.tplDay];
    render(); scheduleSave('tpl', 0); toast('已還原'); return;
  }

  /* 設定分頁：備份、帳號 */
  if (t.id === 'expBtn'){ doExport(); return; }
  if (t.id === 'pwReset'){
    try { await sendPasswordResetEmail(auth, S.user.email); toast('已寄出重設密碼信'); } catch(e){ toast(errMsg(e)); }
    return;
  }
  if (t.id === 'logout'){
    if (!confirm('確定要登出？')) return;
    flushAll();
    await signOut(auth);
    return;
  }
});

nav.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  S.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});

// app 切到背景時立刻存檔；隔天再打開時自動跳到今天
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden'){ flushAll(); return; }
  const t = today();
  if (t !== S.todayAtOpen){
    if (S.date === S.todayAtOpen) S.date = t;
    if (S.bodyDate === S.todayAtOpen) S.bodyDate = t;
    S.todayAtOpen = t; softRender();
  }
});

render(); updateSync();
