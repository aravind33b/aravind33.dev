"use strict";

/* ============================== CONFIG ============================== */

const CATEGORIES = [
  { id: "groceries", name: "Groceries", color: "#8AAE8C", icon: "🥬" },
  { id: "dining", name: "Dining", color: "#C08A4C", icon: "🍽️" },
  { id: "coffee", name: "Coffee", color: "#A9744E", icon: "☕" },
  { id: "shopping", name: "Shopping", color: "#8592C0", icon: "🛍️" },
  { id: "transport", name: "Transport", color: "#6FA3A8", icon: "🚕" },
  { id: "gas", name: "Gas & Fuel", color: "#B57A54", icon: "⛽" },
  { id: "utilities", name: "Utilities", color: "#7C8B99", icon: "💡" },
  { id: "health", name: "Health", color: "#C06B6B", icon: "💊" },
  { id: "entertainment", name: "Entertainment", color: "#A57BC0", icon: "🎬" },
  { id: "travel", name: "Travel", color: "#5B9BC0", icon: "✈️" },
  { id: "subscriptions", name: "Subscriptions", color: "#C0A24C", icon: "🔁" },
  { id: "other", name: "Other", color: "#8B948C", icon: "•" },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const DETAIL_RETENTION_MONTHS = 6;
const ROLLUP_RETENTION_MONTHS = 24;
const OCR_CONFIDENCE_THRESHOLD = 65; // below this mean confidence, fall back to Claude
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const SEED_MERCHANTS = {
  "STARBUCKS":"coffee","DUNKIN":"coffee","PEETS":"coffee","BLUE BOTTLE":"coffee",
  "MCDONALDS":"dining","CHIPOTLE":"dining","SUBWAY":"dining","CHICK FIL A":"dining",
  "PANERA":"dining","TACO BELL":"dining","DOMINOS":"dining","PIZZA HUT":"dining",
  "WENDYS":"dining","BURGER KING":"dining","SHAKE SHACK":"dining","PANDA EXPRESS":"dining",
  "WHOLE FOODS":"groceries","TRADER JOES":"groceries","KROGER":"groceries","SAFEWAY":"groceries",
  "ALDI":"groceries","PUBLIX":"groceries","COSTCO":"groceries","SAMS CLUB":"groceries",
  "WALMART":"shopping","TARGET":"shopping","AMAZON":"shopping","BEST BUY":"shopping",
  "HOME DEPOT":"shopping","LOWES":"shopping","IKEA":"shopping","TJ MAXX":"shopping",
  "MARSHALLS":"shopping","ROSS":"shopping","MACYS":"shopping","NIKE":"shopping",
  "SHELL":"gas","CHEVRON":"gas","EXXON":"gas","MOBIL":"gas","BP":"gas","SPEEDWAY":"gas",
  "UBER":"transport","LYFT":"transport","TAXI":"transport","METRO":"transport","TRANSIT":"transport","PARKING":"transport",
  "CVS":"health","WALGREENS":"health","RITE AID":"health","PHARMACY":"health","URGENT CARE":"health","DENTAL":"health",
  "NETFLIX":"subscriptions","SPOTIFY":"subscriptions","HULU":"subscriptions","DISNEY PLUS":"subscriptions",
  "APPLE COM":"subscriptions","YOUTUBE PREMIUM":"subscriptions","ICLOUD":"subscriptions",
  "AMC":"entertainment","REGAL CINEMAS":"entertainment","CINEMARK":"entertainment","STEAM":"entertainment",
  "DELTA":"travel","UNITED AIRLINES":"travel","SOUTHWEST":"travel","AIRBNB":"travel","MARRIOTT":"travel","HILTON":"travel","EXPEDIA":"travel",
  "PGE":"utilities","COMCAST":"utilities","XFINITY":"utilities","VERIZON":"utilities","AT&T":"utilities","T MOBILE":"utilities","WATER DEPT":"utilities","ELECTRIC":"utilities",
};
const KEYWORD_RULES = [
  { re: /\b(coffee|espresso|latte|roaster)\b/i, cat: "coffee" },
  { re: /\b(grocery|groceries|market|farm|produce)\b/i, cat: "groceries" },
  { re: /\b(restaurant|bistro|grill|kitchen|diner|cafe|eatery|pizzeria)\b/i, cat: "dining" },
  { re: /\b(pharmacy|rx|clinic|medical|dental|doctor)\b/i, cat: "health" },
  { re: /\b(fuel|gas station|petrol)\b/i, cat: "gas" },
  { re: /\b(taxi|rideshare|transit|parking|toll)\b/i, cat: "transport" },
  { re: /\b(hotel|inn|resort|airlines|airways|flight)\b/i, cat: "travel" },
  { re: /\b(cinema|theatre|theater|movie|concert|arcade)\b/i, cat: "entertainment" },
  { re: /\b(subscription|monthly plan|membership)\b/i, cat: "subscriptions" },
  { re: /\b(electric|water bill|internet|cable|utility)\b/i, cat: "utilities" },
];

/* ============================== CRYPTO ============================== */

const enc = new TextEncoder(), dec = new TextDecoder();
function b64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function unb64(str){ const bin=atob(str); const a=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return a.buffer; }
async function deriveKey(pass, saltB64){
  const salt = unb64(saltB64);
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:200000,hash:"SHA-256"}, base, {name:"AES-GCM",length:256}, false, ["encrypt","decrypt"]);
}
async function encryptJSON(key, obj){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(cipher) };
}
async function decryptJSON(key, blob){
  const iv = new Uint8Array(unb64(blob.iv));
  const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv}, key, unb64(blob.data));
  return JSON.parse(dec.decode(plain));
}

/* ============================== IDB ============================== */

function idbOpen(){
  return new Promise((res, rej) => {
    const req = indexedDB.open("ledger-store", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
let _db = null;
async function db(){ if(!_db) _db = await idbOpen(); return _db; }
async function kvGet(key){
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction("kv","readonly").objectStore("kv").get(key); t.onsuccess=()=>res(t.result); t.onerror=()=>rej(t.error); });
}
async function kvSet(key, val){
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction("kv","readwrite").objectStore("kv").put(val, key); t.onsuccess=()=>res(); t.onerror=()=>rej(t.error); });
}

/* ============================== STATE ============================== */

const S = { key:null, salt:null, transactions:[], rollups:{}, merchants:{}, apiKey:"", route:"home", viewMonth:null, tessWorker:null };

function normMerchant(name){ return (name||"").toUpperCase().replace(/[^A-Z0-9 &]/g," ").replace(/\s+/g," ").trim(); }
function monthKey(iso){ return iso.slice(0,7); }
function fmtMoney(n){ return "$" + Math.abs(n).toFixed(2); }
function fmtMonthLabel(mk){ const [y,m]=mk.split("-").map(Number); return new Date(y,m-1,1).toLocaleDateString(undefined,{month:"long",year:"numeric"}); }
function shiftMonth(mk, d){ const [y,m]=mk.split("-").map(Number); const dt=new Date(y,m-1+d,1); return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0"); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function monthsAgo(iso, n){ const d=new Date(iso), now=new Date(); return ((now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth())) >= n; }

function lookupCategory(mNorm, rawText){
  if (S.merchants[mNorm]) return { cat: S.merchants[mNorm], via: "dictionary" };
  if (SEED_MERCHANTS[mNorm]) return { cat: SEED_MERCHANTS[mNorm], via: "dictionary" };
  for (const k in SEED_MERCHANTS) if (mNorm.includes(k)) return { cat: SEED_MERCHANTS[k], via: "dictionary" };
  const hay = (mNorm + " " + (rawText||"")).toLowerCase();
  for (const rule of KEYWORD_RULES) if (rule.re.test(hay)) return { cat: rule.cat, via: "keyword" };
  return { cat: null, via: null };
}
function bumpRollup(mk, catId, delta, deltaCount){
  const k = mk+"|"+catId;
  const row = S.rollups[k] || { total:0, count:0 };
  row.total = Math.round((row.total+delta)*100)/100;
  row.count += deltaCount;
  if (row.count <= 0) delete S.rollups[k]; else S.rollups[k] = row;
}
async function persistAll(){
  const [txB, rollB, merB, keyB] = await Promise.all([
    encryptJSON(S.key, S.transactions), encryptJSON(S.key, S.rollups),
    encryptJSON(S.key, S.merchants), encryptJSON(S.key, { apiKey: S.apiKey }),
  ]);
  await Promise.all([kvSet("transactions",txB), kvSet("rollups",rollB), kvSet("merchants",merB), kvSet("secrets",keyB)]);
}
function addTransaction(t){
  t.id = "t"+Date.now()+Math.random().toString(36).slice(2,7);
  S.transactions.push(t);
  bumpRollup(monthKey(t.dateISO), t.category, t.amount, 1);
  if (t.merchantNorm && !S.merchants[t.merchantNorm]) S.merchants[t.merchantNorm] = t.category;
  return t;
}
function updateTransactionCategory(id, cat){
  const t = S.transactions.find(x=>x.id===id); if(!t) return;
  bumpRollup(monthKey(t.dateISO), t.category, -t.amount, -1);
  t.category = cat;
  bumpRollup(monthKey(t.dateISO), cat, t.amount, 1);
  if (t.merchantNorm) S.merchants[t.merchantNorm] = cat;
}
function deleteTransaction(id){
  const i = S.transactions.findIndex(x=>x.id===id); if(i<0) return;
  const t = S.transactions[i];
  bumpRollup(monthKey(t.dateISO), t.category, -t.amount, -1);
  S.transactions.splice(i,1);
}
function runRetention(){
  S.transactions = S.transactions.filter(t => !monthsAgo(t.dateISO, DETAIL_RETENTION_MONTHS));
  const nowMk = monthKey(todayISO()); const keep = {};
  for (const k in S.rollups) {
    const mk = k.split("|")[0];
    const [y,m]=mk.split("-").map(Number), [ny,nm]=nowMk.split("-").map(Number);
    if (((ny-y)*12+(nm-m)) < ROLLUP_RETENTION_MONTHS) keep[k] = S.rollups[k];
  }
  S.rollups = keep;
}

/* ============================== OCR: Tesseract first, Claude fallback ============================== */

let _tesseractLoadPromise = null;
function loadTesseractScript(){
  if (window.Tesseract) return Promise.resolve();
  if (_tesseractLoadPromise) return _tesseractLoadPromise;
  _tesseractLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    const timer = setTimeout(() => reject(new Error("Tesseract took too long to load")), 20000);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); _tesseractLoadPromise = null; reject(new Error("Couldn't load the on-device OCR library")); };
    document.head.appendChild(s);
  });
  return _tesseractLoadPromise;
}

async function getTessWorker(onProgress){
  if (S.tessWorker) return S.tessWorker;
  await loadTesseractScript();
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m) => { if (onProgress && m.status === "recognizing text") onProgress(m.progress); },
  });
  S.tessWorker = worker;
  return worker;
}

function parseReceiptText(text){
  const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);
  // merchant: first plausible line (letters, reasonable length, not a pure address/phone line)
  let merchant = "";
  for (const line of lines.slice(0, 6)) {
    if (/^[\d\s.,:\-\/#*]+$/.test(line)) continue; // pure numbers/punctuation
    if (/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(line)) continue; // phone
    if (line.length >= 3 && line.length <= 40) { merchant = line; break; }
  }
  // total: prefer a line containing "total" (not "subtotal"), else the largest $amount found
  const amountRe = /\$?\s?(\d{1,5}[.,]\d{2})\b/g;
  let total = null;
  const totalLine = lines.find(l => /\btotal\b/i.test(l) && !/subtotal/i.test(l));
  if (totalLine) {
    const m = totalLine.match(amountRe);
    if (m) total = parseFloat(m[m.length-1].replace(/[^0-9.]/g,""));
  }
  if (total === null) {
    let max = 0, found = false, m;
    amountRe.lastIndex = 0;
    while ((m = amountRe.exec(text)) !== null) {
      const v = parseFloat(m[1].replace(",", "."));
      if (v > max) { max = v; found = true; }
    }
    if (found) total = max;
  }
  // date
  let dateISO = null;
  const dm = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) || text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (dm) {
    if (dm[0].includes("-") && dm[1].length === 4) dateISO = `${dm[1]}-${dm[2]}-${dm[3]}`;
    else {
      let [, mo, da, yr] = dm;
      if (yr.length === 2) yr = "20" + yr;
      dateISO = `${yr}-${mo.padStart(2,"0")}-${da.padStart(2,"0")}`;
    }
  }
  return { merchant, total, dateISO };
}

async function runLocalOCR(file, onProgress){
  const worker = await getTessWorker(onProgress);
  const { data } = await worker.recognize(file);
  const parsed = parseReceiptText(data.text || "");
  return { confidence: data.confidence || 0, text: data.text || "", ...parsed };
}

async function fileToBase64(file){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function runClaudeOCR(file, knownMerchants){
  if (!S.apiKey) throw { code: "no_key", message: "No API key set." };
  const base64 = await fileToBase64(file);
  const catIds = CATEGORIES.map(c=>c.id).join(", ");
  const prompt = `You are reading a photo of a purchase receipt. Reply with ONLY a JSON object:
{"merchant": string, "date": "YYYY-MM-DD", "total": number, "category": one of [${catIds}], "items": [short strings, up to 6]}
If the merchant matches one of these already-known merchants, use that exact known category: ${JSON.stringify(knownMerchants)}. Otherwise pick your best-fit category. Today's date is ${todayISO()}.`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": S.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 500,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 } },
        { type: "text", text: prompt },
      ]}],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(()=>({}));
    throw { code: "api_error", message: errBody?.error?.message || `HTTP ${resp.status}` };
  }
  const data = await resp.json();
  const textBlock = (data.content||[]).find(b => b.type === "text");
  if (!textBlock) throw { code: "no_text", message: "Empty response." };
  let jsonStr = textBlock.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1];
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) jsonStr = braceMatch[0];
  return JSON.parse(jsonStr);
}

/* ============================== UI helpers ============================== */

const app = document.getElementById("app");
let toastTimer = null;
function toast(msg){
  clearTimeout(toastTimer);
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id="toast"; el.className="toast"; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = "block";
  toastTimer = setTimeout(()=>{ el.style.display="none"; }, 2800);
}
function h(strings, ...vals){ return strings.reduce((a,s,i)=>a+s+(vals[i]!==undefined?vals[i]:""),""); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

/* ============================== SCREENS ============================== */

function render(){
  if (!S.key) { renderLock(); return; }
  app.innerHTML = "";
  const wrap = document.createElement("div");
  if (S.route==="home") wrap.appendChild(renderHome());
  else if (S.route==="scan") wrap.appendChild(renderScan());
  else if (S.route==="quick") wrap.appendChild(renderQuickAdd());
  else if (S.route==="settings") wrap.appendChild(renderSettings());
  app.appendChild(wrap);
  app.appendChild(renderTabbar());
}

function renderLock(){
  app.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "lock-wrap";
  wrap.innerHTML = h`
    <div class="lock-mark">LEDGER · ON-DEVICE</div>
    <div class="lock-title">${S._needSetup ? "Set your passphrase" : "Welcome back"}</div>
    <div class="lock-sub">${S._needSetup
      ? "This creates an encryption key that never leaves your device. <b>There is no password reset</b> — if you forget it, your data can't be recovered."
      : "Enter your passphrase to unlock your ledger."}</div>
    <div class="field"><label>Passphrase</label><input type="password" id="pw" autocomplete="${S._needSetup?"new-password":"current-password"}" /></div>
    ${S._needSetup ? `<div class="field"><label>Confirm passphrase</label><input type="password" id="pw2" /></div>` : ""}
    <button class="btn-primary" id="unlockBtn">${S._needSetup ? "Create & unlock" : "Unlock"}</button>
    <div class="err-msg" id="lockErr"></div>
    <div class="lock-foot">Everything is encrypted (AES-256) and stored only in this browser. Receipt scanning tries on-device OCR first; only if that's not confident does a photo get sent to Claude, using your own API key.</div>
  `;
  app.appendChild(wrap);
  document.getElementById("unlockBtn").onclick = handleUnlockClick;
  document.getElementById("pw").addEventListener("keydown", e=>{ if(e.key==="Enter" && !S._needSetup) handleUnlockClick(); });
}
async function handleUnlockClick(){
  const pw = document.getElementById("pw").value;
  const errEl = document.getElementById("lockErr");
  errEl.textContent = "";
  if (!pw || pw.length < 4) { errEl.textContent = "Passphrase must be at least 4 characters."; return; }
  if (S._needSetup) {
    const pw2 = document.getElementById("pw2").value;
    if (pw !== pw2) { errEl.textContent = "Passphrases don't match."; return; }
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = b64(saltBytes);
    const key = await deriveKey(pw, saltB64);
    const verifier = await encryptJSON(key, { ok:true, created: todayISO() });
    await kvSet("salt", saltB64); await kvSet("verifier", verifier);
    S.salt = saltB64; S.key = key; S.transactions=[]; S.rollups={}; S.merchants={}; S.apiKey="";
    await persistAll();
    S.route = "home"; S.viewMonth = monthKey(todayISO());
    render(); toast("Ledger created — data stays on this device.");
    return;
  }
  try {
    const key = await deriveKey(pw, S.salt);
    const verifierBlob = await kvGet("verifier");
    await decryptJSON(key, verifierBlob);
    S.key = key;
    const [txB, rollB, merB, secB] = await Promise.all([kvGet("transactions"), kvGet("rollups"), kvGet("merchants"), kvGet("secrets")]);
    S.transactions = txB ? await decryptJSON(key, txB) : [];
    S.rollups = rollB ? await decryptJSON(key, rollB) : {};
    S.merchants = merB ? await decryptJSON(key, merB) : {};
    S.apiKey = secB ? (await decryptJSON(key, secB)).apiKey || "" : "";
    runRetention(); await persistAll();
    S.route = "home"; S.viewMonth = monthKey(todayISO());
    render();
  } catch(e) { errEl.textContent = "Wrong passphrase. Try again."; }
}

function renderTabbar(){
  const bar = document.createElement("div"); bar.className="tabbar";
  [{id:"home",ic:"🏠",label:"Home"},{id:"scan",ic:"📷",label:"Scan"},{id:"quick",ic:"✎",label:"Quick add"},{id:"settings",ic:"⚙",label:"Settings"}]
  .forEach(t=>{
    const b = document.createElement("button");
    b.className = "tab" + (S.route===t.id?" active":"");
    b.innerHTML = `<span class="ic">${t.ic}</span><span>${t.label}</span>`;
    b.onclick = ()=>{ S.route=t.id; render(); };
    bar.appendChild(b);
  });
  return bar;
}

function renderHome(){
  const el = document.createElement("div"); el.className="screen";
  const mk = S.viewMonth;
  const monthTx = S.transactions.filter(t=>monthKey(t.dateISO)===mk).sort((a,b)=>b.dateISO.localeCompare(a.dateISO));
  const catTotals = {}; let grand = 0;
  CATEGORIES.forEach(c=>{ const row=S.rollups[mk+"|"+c.id]; if(row && row.total>0){ catTotals[c.id]=row.total; grand+=row.total; } });
  const sortedCats = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  el.innerHTML = h`
    <div class="topbar"><div class="mark">LEDGER</div><button id="lockNowBtn" title="Lock">🔒</button></div>
    <div class="month-row"><div class="month-nav"><button id="prevMonth">‹</button><span class="month-label">${fmtMonthLabel(mk)}</span><button id="nextMonth">›</button></div></div>
    <div class="total-block"><div class="total-label">Total spent</div>
      <div class="total-amt"><span>$</span>${grand.toFixed(2).split(".")[0]}<span>.${grand.toFixed(2).split(".")[1]}</span></div></div>
    <div class="fab-row">
      <button class="fab fab-scan" id="goScan"><span class="ic">📷</span>Scan receipt</button>
      <button class="fab fab-quick" id="goQuick"><span class="ic">✎</span>Quick add</button>
    </div>
    <div class="section-label">By category</div><div id="catList"></div>
    <div class="section-label">Transactions this month</div><div id="txList"></div>
  `;
  const catListEl = el.querySelector("#catList");
  if (!sortedCats.length) catListEl.innerHTML = `<div class="empty-note">No spending logged for this month yet.</div>`;
  else sortedCats.forEach(([catId,total])=>{
    const c = CAT_MAP[catId]; const pct = grand>0?Math.round((total/grand)*100):0;
    const row = document.createElement("div"); row.className="cat-row";
    row.innerHTML = h`<span class="cat-dot" style="background:${c.color}"></span>
      <div class="cat-info"><div class="cat-name">${c.name}</div>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%;background:${c.color}"></div></div></div>
      <div class="cat-amt">${fmtMoney(total)}</div>`;
    catListEl.appendChild(row);
  });
  const txListEl = el.querySelector("#txList");
  if (!monthTx.length) txListEl.innerHTML = `<div class="empty-note">Nothing scanned or added this month. Tap "Scan receipt" or "Quick add" to log your first expense.</div>`;
  else monthTx.forEach(t=>{
    const c = CAT_MAP[t.category] || CAT_MAP.other;
    const row = document.createElement("div"); row.className="tx-row";
    row.innerHTML = h`<div class="tx-cat-chip" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
      <div class="tx-main"><div class="tx-merchant">${esc(t.merchant||"Unnamed")}</div>
      <div class="tx-meta">${c.name} · ${new Date(t.dateISO).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</div></div>
      <div class="tx-amt">${fmtMoney(t.amount)}</div>`;
    row.onclick = ()=> openTxEditor(t.id);
    txListEl.appendChild(row);
  });
  setTimeout(()=>{
    el.querySelector("#prevMonth").onclick = ()=>{ S.viewMonth = shiftMonth(S.viewMonth,-1); render(); };
    el.querySelector("#nextMonth").onclick = ()=>{ S.viewMonth = shiftMonth(S.viewMonth,1); render(); };
    el.querySelector("#goScan").onclick = ()=>{ S.route="scan"; render(); };
    el.querySelector("#goQuick").onclick = ()=>{ S.route="quick"; render(); };
    el.querySelector("#lockNowBtn").onclick = lockNow;
  },0);
  return el;
}

function lockNow(){ S.key=null; S.transactions=[]; S.rollups={}; S.merchants={}; S.apiKey=""; S.route="home"; boot(); }

function openTxEditor(id){
  const t = S.transactions.find(x=>x.id===id); if(!t) return;
  const overlay = document.createElement("div"); overlay.className="modal-overlay";
  overlay.innerHTML = h`<div class="modal-sheet"><h3>${esc(t.merchant||"Transaction")}</h3>
    <div class="field"><label>Amount</label><div class="mono" style="font-size:20px">${fmtMoney(t.amount)}</div></div>
    <div class="field"><label>Category</label><div class="chip-row" id="editCatChips"></div></div>
    <button class="btn-primary" id="closeEdit">Done</button>
    <button class="btn-ghost" id="deleteTx" style="color:var(--rust);border-color:var(--rust)">Delete transaction</button></div>`;
  document.body.appendChild(overlay);
  const chipRow = overlay.querySelector("#editCatChips");
  CATEGORIES.forEach(c=>{
    const b = document.createElement("button");
    b.className = "cat-chip-btn"+(t.category===c.id?" sel":"");
    b.innerHTML = `${c.icon} ${c.name}`;
    b.onclick = async ()=>{ updateTransactionCategory(t.id,c.id); await persistAll(); document.body.removeChild(overlay); render(); };
    chipRow.appendChild(b);
  });
  overlay.querySelector("#closeEdit").onclick = ()=> document.body.removeChild(overlay);
  overlay.querySelector("#deleteTx").onclick = async ()=>{ deleteTransaction(t.id); await persistAll(); document.body.removeChild(overlay); render(); toast("Transaction deleted."); };
  overlay.onclick = (e)=>{ if(e.target===overlay) document.body.removeChild(overlay); };
}

/* ---- Scan flow ---- */
function renderScan(){
  const el = document.createElement("div"); el.className="screen";
  el.innerHTML = h`<div class="flow-head"><button id="backBtn">←</button><h2>Scan receipt</h2></div><div id="scanBody"></div>`;
  setTimeout(()=>{
    el.querySelector("#backBtn").onclick = ()=>{ S.route="home"; render(); };
    renderScanBody(el.querySelector("#scanBody"));
  },0);
  return el;
}
function renderScanBody(body){
  body.innerHTML = h`
    <div class="drop-zone" id="dropZone"><span class="ic">📸</span>Take a photo or choose a receipt image
      <input type="file" accept="image/*" capture="environment" id="fileInput" /></div>
    <div class="ai-note"><b>How this works:</b> your device reads the receipt first, entirely offline. Only if that reading looks unreliable does a photo get sent to Claude using your own API key — set one in Settings if you haven't yet.</div>
  `;
  body.querySelector("#fileInput").onchange = (e)=>{ const f=e.target.files[0]; if(f) handleScanFile(f, body); };
}
async function handleScanFile(file, body){
  const url = URL.createObjectURL(file);
  body.innerHTML = h`<img class="preview-img" src="${url}" />
    <div class="status-line"><div class="spinner"></div><span id="statusText">Reading receipt on-device…</span></div>
    <div class="progress-track"><div class="progress-fill" id="progFill" style="width:0%"></div></div>`;
  const progFill = body.querySelector("#progFill");
  const statusText = body.querySelector("#statusText");
  let local;
  try {
    local = await runLocalOCR(file, (p)=>{ progFill.style.width = Math.round(p*100)+"%"; });
  } catch(e) {
    local = { confidence: 0, text: "", merchant: "", total: null, dateISO: null };
  }
  const mNorm = normMerchant(local.merchant);
  const dictHit = lookupCategory(mNorm, local.text);
  const needsFallback = local.confidence < OCR_CONFIDENCE_THRESHOLD || !local.merchant || local.total === null;

  if (!needsFallback) {
    finishScan(body, url, {
      merchant: local.merchant, merchantNorm: mNorm,
      dateISO: local.dateISO || todayISO(),
      amount: Math.round(Math.abs(local.total)*100)/100,
      category: dictHit.cat || "other",
      items: [], via: dictHit.cat ? dictHit.via : "unmatched",
      ocrSource: "on-device", confidence: Math.round(local.confidence),
    });
    return;
  }

  statusText.textContent = `On-device reading wasn't confident (${Math.round(local.confidence)}%)…`;
  if (!S.apiKey) {
    body.innerHTML += h`<div class="ai-note warn"><b>Low confidence, no fallback available.</b> Add an Anthropic API key in Settings to enable the AI fallback, or fix the fields below yourself.</div>`;
    finishScan(body, url, {
      merchant: local.merchant || "", merchantNorm: mNorm,
      dateISO: local.dateISO || todayISO(),
      amount: local.total ? Math.round(Math.abs(local.total)*100)/100 : 0,
      category: dictHit.cat || "other", items: [], via: "manual-fix-needed",
      ocrSource: "on-device (low confidence)", confidence: Math.round(local.confidence),
    });
    return;
  }
  statusText.textContent = "Asking Claude to read it instead…";
  progFill.style.width = "100%";
  try {
    const result = await runClaudeOCR(file, S.merchants);
    const merchant = String(result.merchant || "Unknown").trim();
    const mNorm2 = normMerchant(merchant);
    const dictHit2 = lookupCategory(mNorm2, "");
    finishScan(body, url, {
      merchant, merchantNorm: mNorm2,
      dateISO: /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : todayISO(),
      amount: Math.round(Math.abs(Number(result.total)||0)*100)/100,
      category: dictHit2.cat || CAT_MAP[result.category] ? (dictHit2.cat || result.category) : "other",
      items: Array.isArray(result.items) ? result.items.slice(0,6) : [],
      via: dictHit2.cat ? dictHit2.via : "ai", ocrSource: "claude", confidence: null,
    });
  } catch(e) {
    let msg = "Claude couldn't read that receipt either.";
    if (e.code === "api_error") msg = "API error: " + esc(e.message);
    body.innerHTML += `<div class="ai-note warn"><b>${msg}</b></div>`;
    finishScan(body, url, {
      merchant: local.merchant || "", merchantNorm: mNorm,
      dateISO: local.dateISO || todayISO(),
      amount: local.total ? Math.round(Math.abs(local.total)*100)/100 : 0,
      category: dictHit.cat || "other", items: [], via: "manual-fix-needed",
      ocrSource: "on-device (low confidence)", confidence: Math.round(local.confidence),
    });
  }
}
function finishScan(body, imgUrl, r){
  const sourceNote = r.ocrSource === "claude"
    ? `<span style="color:var(--moss-bright)">· read by Claude (on-device wasn't confident)</span>`
    : r.confidence !== null ? `<span style="color:var(--text-faint)">· read on-device, ${r.confidence}% confidence</span>` : "";
  body.innerHTML = h`
    <img class="preview-img" src="${imgUrl}" />
    <div class="field"><label>Merchant</label><input type="text" id="fMerchant" value="${esc(r.merchant)}" /></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="fAmount" value="${r.amount}" /></div>
    <div class="field"><label>Date</label><input type="date" id="fDate" value="${r.dateISO}" /></div>
    <div class="field"><label>Category ${sourceNote}</label><div class="chip-row" id="catChips"></div></div>
    <button class="btn-primary" id="saveTxBtn">Save expense</button>
  `;
  const chipRow = body.querySelector("#catChips");
  CATEGORIES.forEach(c=>{
    const b = document.createElement("button"); b.type="button";
    b.className = "cat-chip-btn"+(r.category===c.id?" sel":"");
    b.innerHTML = `${c.icon} ${c.name}`;
    b.onclick = ()=>{ r.category=c.id; chipRow.querySelectorAll(".cat-chip-btn").forEach(x=>x.classList.remove("sel")); b.classList.add("sel"); };
    chipRow.appendChild(b);
  });
  body.querySelector("#saveTxBtn").onclick = async ()=>{
    const merchant = body.querySelector("#fMerchant").value.trim() || "Unknown";
    const amount = Math.round(Math.abs(Number(body.querySelector("#fAmount").value)||0)*100)/100;
    const dateISO = body.querySelector("#fDate").value || todayISO();
    addTransaction({ merchant, merchantNorm: normMerchant(merchant), amount, dateISO, category: r.category, items: r.items, note:"", source:"scan" });
    await persistAll();
    S.route = "home"; S.viewMonth = monthKey(dateISO);
    render(); toast(`Saved ${fmtMoney(amount)} · ${CAT_MAP[r.category].name}`);
  };
}

/* ---- Quick add ---- */
function renderQuickAdd(){
  const el = document.createElement("div"); el.className="screen";
  el.innerHTML = h`<div class="flow-head"><button id="backBtn">←</button><h2>Quick add</h2></div>
    <div class="ai-note">Manual entries never call any AI — merchant and amount only, categorized from your on-device list.</div>
    <div class="field"><label>Merchant</label><input type="text" id="qMerchant" placeholder="e.g. Trader Joe's" /></div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="qAmount" placeholder="0.00" /></div>
    <div class="field"><label>Date</label><input type="date" id="qDate" value="${todayISO()}" /></div>
    <div class="field"><label>Category</label><div class="chip-row" id="qChips"></div></div>
    <button class="btn-primary" id="qSaveBtn">Save expense</button>`;
  setTimeout(()=>{
    el.querySelector("#backBtn").onclick = ()=>{ S.route="home"; render(); };
    let selectedCat = null;
    const chipRow = el.querySelector("#qChips");
    CATEGORIES.forEach(c=>{
      const b = document.createElement("button"); b.type="button"; b.className="cat-chip-btn";
      b.innerHTML = `${c.icon} ${c.name}`;
      b.onclick = ()=>{ selectedCat=c.id; chipRow.querySelectorAll(".cat-chip-btn").forEach(x=>x.classList.remove("sel")); b.classList.add("sel"); };
      chipRow.appendChild(b);
    });
    const merchantInput = el.querySelector("#qMerchant");
    merchantInput.addEventListener("blur", ()=>{
      if (selectedCat) return;
      const guess = lookupCategory(normMerchant(merchantInput.value), "");
      if (guess.cat) { selectedCat = guess.cat;
        chipRow.querySelectorAll(".cat-chip-btn").forEach(x=>{ if (x.textContent.includes(CAT_MAP[guess.cat].name)) x.classList.add("sel"); });
      }
    });
    el.querySelector("#qSaveBtn").onclick = async ()=>{
      const merchant = merchantInput.value.trim();
      const amount = Math.round(Math.abs(Number(el.querySelector("#qAmount").value)||0)*100)/100;
      const dateISO = el.querySelector("#qDate").value || todayISO();
      if (!merchant || amount<=0) { toast("Enter a merchant and an amount."); return; }
      const cat = selectedCat || lookupCategory(normMerchant(merchant),"").cat || "other";
      addTransaction({ merchant, merchantNorm: normMerchant(merchant), amount, dateISO, category: cat, items:[], note:"", source:"manual" });
      await persistAll();
      S.route = "home"; S.viewMonth = monthKey(dateISO);
      render(); toast(`Saved ${fmtMoney(amount)} · ${CAT_MAP[cat].name}`);
    };
  },0);
  return el;
}

/* ---- Settings ---- */
function renderSettings(){
  const el = document.createElement("div"); el.className="screen";
  el.innerHTML = h`
    <div class="flow-head"><h2>Settings</h2></div>
    <div class="settings-row"><div><div class="st-label">Storage</div><div class="st-sub">${S.transactions.length} detailed transactions on this device</div></div></div>
    <div class="settings-row"><div><div class="st-label">Retention</div><div class="st-sub">Detail kept ${DETAIL_RETENTION_MONTHS} months, category totals kept ${ROLLUP_RETENTION_MONTHS} months</div></div></div>
    <div class="settings-row"><div><div class="st-label">Known merchants</div><div class="st-sub">${Object.keys(S.merchants).length} learned + ${Object.keys(SEED_MERCHANTS).length} built-in</div></div></div>
    <div class="section-label">OCR fallback</div>
    <div class="field"><label>Anthropic API key (used only when on-device OCR isn't confident)</label>
      <input type="password" id="apiKeyInput" value="${esc(S.apiKey)}" placeholder="sk-ant-..." /></div>
    <button class="btn-primary" id="saveKeyBtn">Save key</button>
    <div class="ai-note">Stored encrypted on this device with the same passphrase as everything else. Sent only to api.anthropic.com, only when a scan's on-device confidence is below ${OCR_CONFIDENCE_THRESHOLD}%.</div>
    <div class="section-label">Backup</div>
    <div class="settings-row"><div><div class="st-label">Export encrypted backup</div><div class="st-sub">A .json file, still encrypted with your passphrase</div></div><button id="exportBtn">Export</button></div>
    <div class="settings-row"><div><div class="st-label">Import backup</div><div class="st-sub">Merges into this device's ledger</div></div>
      <button id="importBtn">Import</button><input type="file" accept=".json,application/json" id="importFile" style="display:none" /></div>
    <div class="section-label">Session</div>
    <div class="settings-row"><div><div class="st-label">Lock ledger</div><div class="st-sub">Requires your passphrase to reopen</div></div><button id="lockBtn">Lock</button></div>
    <div class="settings-row"><div><div class="st-label">Erase all data</div><div class="st-sub">Deletes everything on this device. Cannot be undone.</div></div><button class="danger" id="eraseBtn">Erase</button></div>
  `;
  setTimeout(()=>{
    el.querySelector("#saveKeyBtn").onclick = async ()=>{
      S.apiKey = el.querySelector("#apiKeyInput").value.trim();
      await persistAll(); toast("API key saved.");
    };
    el.querySelector("#lockBtn").onclick = lockNow;
    el.querySelector("#exportBtn").onclick = doExport;
    el.querySelector("#importBtn").onclick = ()=> el.querySelector("#importFile").click();
    el.querySelector("#importFile").onchange = (e)=>{ if(e.target.files[0]) doImport(e.target.files[0]); };
    el.querySelector("#eraseBtn").onclick = doErase;
  },0);
  return el;
}

async function doExport(){
  const payload = {
    version: 1, exportedAt: new Date().toISOString(), salt: S.salt,
    verifier: await kvGet("verifier"),
    transactions: await encryptJSON(S.key, S.transactions),
    rollups: await encryptJSON(S.key, S.rollups),
    merchants: await encryptJSON(S.key, S.merchants),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `ledger-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast("Backup downloaded.");
}
async function doImport(file){
  try {
    const payload = JSON.parse(await file.text());
    if (!payload.salt || !payload.verifier) throw new Error("bad file");
    let key = S.key;
    try { await decryptJSON(key, payload.verifier); }
    catch(e) {
      const pw = prompt("This backup used a different passphrase. Enter the passphrase it was created with:");
      if (!pw) return;
      key = await deriveKey(pw, payload.salt);
      await decryptJSON(key, payload.verifier);
    }
    const importedTx = await decryptJSON(key, payload.transactions);
    const importedRoll = await decryptJSON(key, payload.rollups);
    const importedMer = await decryptJSON(key, payload.merchants);
    const existingIds = new Set(S.transactions.map(t=>t.id));
    importedTx.forEach(t=>{ if(!existingIds.has(t.id)) S.transactions.push(t); });
    for (const k in importedRoll) {
      const cur = S.rollups[k] || { total:0, count:0 };
      S.rollups[k] = { total: Math.round((cur.total+importedRoll[k].total)*100)/100, count: cur.count+importedRoll[k].count };
    }
    for (const m in importedMer) if (!S.merchants[m]) S.merchants[m] = importedMer[m];
    runRetention(); await persistAll(); render(); toast("Backup imported.");
  } catch(e) { toast("Couldn't read that backup file."); }
}
async function doErase(){
  if (!confirm("Erase all ledger data on this device? This cannot be undone.")) return;
  await kvSet("transactions",null); await kvSet("rollups",null); await kvSet("merchants",null);
  await kvSet("secrets",null); await kvSet("verifier",null); await kvSet("salt",null);
  S.key=null; S.salt=null; S.transactions=[]; S.rollups={}; S.merchants={}; S.apiKey="";
  boot(); toast("All data erased.");
}

/* ============================== BOOT ============================== */
async function boot(){
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/ledger/sw.js").catch(()=>{});
  }
  let salt = null;
  try {
    salt = await kvGet("salt");
  } catch(e) {
    // IndexedDB unavailable (e.g. private browsing restriction) — treat as fresh setup
    salt = null;
  }
  S.salt = salt || null;
  S._needSetup = !salt;
  renderLock();
}
boot().catch(function(err) {
  var el = document.getElementById("app");
  if (el) {
    el.innerHTML = '<div style="padding:32px;color:#EFEDE6;font-family:sans-serif;line-height:1.6">'
      + '<b>Failed to start.</b><br><br>' + (err && err.message ? err.message : String(err))
      + '</div>';
  }
});
