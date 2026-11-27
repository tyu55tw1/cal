"use strict";
// 行事曆手機版（2026-11-27 第 1 步）：月曆、今天、班別時間表、從電腦版搬資料、備份。
// 程式放 GitHub Pages（公開），班表／回診／設定只存在手機的 localStorage，不送到任何地方。
// 班別規則照電腦版 E:\程式相關\行事曆\shifts.py（改了兩邊一起改）。
const VERSION = "手機版 1.4";
const KEY = "calphone.v1";   // 同一個網域（tyu55tw1.github.io）之後還會放公車、生活助手，名字別撞
const KINDS = ["早", "中", "晚", "夜", "例", "休", "國定", "特休"];
const DEFAULT_TIME = {"早": "06:00", "中": "09:00", "晚": "10:30", "夜": "23:00"};
const NAME = {"早": "早班", "中": "中班", "晚": "晚班", "夜": "夜班", "例": "例假", "休": "休假", "國定": "國定假日", "特休": "特休"};
// 班別時間表：上班 → 下班；"" ＝看情況下班（先算 shift_hours 小時）；下班比上班早＝跨到隔天
const DEFAULT_TABLE = {"05:00": "13:00", "06:00": "", "09:00": "17:00", "10:00": "18:00", "10:30": "18:30", "23:00": "08:00"};
const WEEK = "日一二三四五六";
const IS_BETA = location.pathname.includes("/beta/");

// ════════════ 資料（只在手機） ════════════
function fix(d) {
  d = d && typeof d === "object" ? d : {};
  d.settings = Object.assign({table: {...DEFAULT_TABLE}, shift_hours: 8, before_hours: 2, eve_hour: 20, row: 0, name: ""},
                             d.settings || {});
  d.shifts = d.shifts && typeof d.shifts === "object" && !Array.isArray(d.shifts) ? d.shifts : {};
  d.events = Array.isArray(d.events) ? d.events : [];
  return d;
}
function load() {
  try { return fix(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { return fix({}); }
}
let DB = load();
function save() {
  localStorage.setItem(KEY, JSON.stringify(DB));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ════════════ 日期、時間 ════════════
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const stamp = () => { const d = new Date(); return `${iso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const md = s => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

function normTime(t) {
  t = String(t || "").trim().replace("：", ":").replace(".", ":");
  let m = t.match(/(\d{1,2})\s*:?\s*(\d{2})/);
  if (!m) {
    const m2 = t.match(/^(\d{1,2})$/);
    return m2 && +m2[1] < 24 ? `${pad(+m2[1])}:00` : "";
  }
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : "";
}
function tableOf(t) {
  const out = {};
  for (const [k0, v0] of Object.entries(t || {})) {
    const k = normTime(k0), v = v0 ? normTime(v0) : "";
    if (k) out[k] = v;
  }
  return Object.keys(out).length ? out : {...DEFAULT_TABLE};
}
function addHours(t, h) {
  const [a, b] = t.split(":").map(Number);
  const m = ((a * 60 + b + Math.round(h * 60)) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
/** [下班 HH:MM, 狀態]：ok＝對照表有／vague＝看情況下班（先算 hours）／guess＝對照表沒有（上班＋8 小時） */
function shiftEnd(kind, t) {
  const table = tableOf(DB.settings.table);
  t = t || DEFAULT_TIME[kind] || "";
  if (!t) return ["", "guess"];
  if (table[t]) return [table[t], "ok"];
  if (t in table) return [addHours(t, +DB.settings.shift_hours || 8), "vague"];
  return [addHours(t, 8), "guess"];
}
/** 05:00 早班～13:00、06:00 早班（下班看情況）、23:00 夜班～隔天 08:00 */
function title(s) {
  if (!s || !s.kind) return "";
  if (!(s.kind in DEFAULT_TIME)) return NAME[s.kind] || s.kind;
  const t = s.time || DEFAULT_TIME[s.kind];
  const [end, how] = shiftEnd(s.kind, t);
  const tail = how === "vague" ? "（下班看情況）" : (end < t ? "～隔天 " : "～") + end;
  return `${t} ${NAME[s.kind]}${tail}` + (s.ot ? "（國定加班）" : "");
}
/** 月曆格子裡的短字 */
function short(s) {
  if (!s || !s.kind) return "";
  if (!(s.kind in DEFAULT_TIME)) return s.kind === "國定" ? "國定" : s.kind;
  const t = s.kind === "夜" ? "" : (s.time || DEFAULT_TIME[s.kind]).replace(/^0/, "").replace(":00", "");
  return s.kind + (t ? " " + t : "") + (s.ot ? "✓" : "");
}
function guessFlag(s) {   // 班別時間表沒有這個上班時間 → 標黃
  return s && s.kind in DEFAULT_TIME && shiftEnd(s.kind, s.time)[1] === "guess";
}
const eventsOn = d => DB.events.filter(e => e.date === d).sort((a, b) => (a.time || "").localeCompare(b.time || ""));

// ════════════ 讀班表的規則（照 shifts.py 的 parse_mark／convert） ════════════
const CHECKS = "✓✔√VvＶ", LOW = 0.7;   // 把握度低於 LOW 就標黃
/** 格子的大字 → [班別, 國定加班]；班別 null＝不管（代、空白），認不得回 "?" */
function parseMark(mark) {
  const s = String(mark || "").replace(/\s/g, "");
  if (!s) return [null, false];
  const check = [...CHECKS].some(c => s.includes(c));
  if (s.includes("時休") || s.includes("特休") || s.includes("特")) return ["特休", false];
  if (s.includes("代") && ![..."早中晚夜"].some(k => s.includes(k))) return [null, false];
  for (const k of "早中晚夜") if (s.includes(k)) return [k, check || s.includes("國定") || s.includes("加班")];
  if (s.includes("例") || s.includes("倒")) return ["例", false];   // 手寫「例」很像「倒」
  if (s.includes("國定")) return ["國定", false];
  if (s.includes("休")) return ["休", false];
  if (check && ![...s].some(c => !CHECKS.includes(c))) return ["國定", false];   // 整格只有勾
  if (s === "時") return ["特休", false];   // 「時休」只讀到上半
  return ["?", false];
}
/** Gemini 讀到的 {year, month, cells} → {year, month, start, end, days:[{date, wd, kind, time, ot, raw, flag, why}]} */
function convert(data) {
  const table = tableOf(DB.settings.table), y = +data.year, m = +data.month;
  if (!(y > 2000 && y < 2100 && m >= 1 && m <= 12)) throw new Error("讀不到表頭的年月，請拍清楚一點（要拍到「YYYY年M月 輪休表」那行）");
  const start = iso(new Date(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 26)), end = iso(new Date(y, m - 1, 25));
  const got = {};
  for (const c of data.cells || []) {
    const d = parseInt(c.day, 10);
    if (!d) continue;
    const dt = d >= 26 ? new Date(+start.slice(0, 4), +start.slice(5, 7) - 1, d) : new Date(y, m - 1, d);   // 26 以後是上個月
    if (dt.getDate() !== d) continue;   // 例如 2 月沒有 30 日
    const k = iso(dt);
    if (!(k in got)) got[k] = c;
  }
  const days = [];
  for (let ds = start; ds <= end; ds = addDays(ds, 1)) {
    const c = got[ds], wd = WEEK[parse(ds).getDay()];
    const rec = {date: ds, wd, kind: null, time: "", ot: false, raw: "", flag: false, why: ""};
    if (!c) { rec.flag = true; rec.why = "這天讀不到"; days.push(rec); continue; }
    const t = normTime(c.time), mk = String(c.mark || "").trim(), why = [];
    rec.raw = (t + " " + mk).trim();
    let [k, ot] = parseMark(mk);
    if (k === "?") { k = null; why.push(`看不懂「${mk}」`); }
    else if (k in DEFAULT_TIME) {
      rec.ot = ot;
      if (k === "夜") { rec.time = "23:00"; if (t && t !== "23:00") why.push(`夜班卻寫 ${t}`); }
      else if (t) { rec.time = t; if (!(t in table)) why.push(`${NAME[k]}寫 ${t}，班別時間表沒有，下班先算 ${addHours(t, 8)}`); }
      else { rec.time = DEFAULT_TIME[k]; why.push(`沒讀到時間，先填 ${DEFAULT_TIME[k]}`); }
    }
    rec.kind = k;
    const w = String(c.weekday || "").trim();
    if (w && WEEK.includes(w.slice(-1)) && w.slice(-1) !== wd) why.push(`表上星期${w.slice(-1)}，日期算出來是星期${wd}`);
    if ((+c.sure || 0) < LOW) why.push("字看不太清楚");
    if (why.length) { rec.flag = true; rec.why = why.join("；"); }
    days.push(rec);
  }
  return {year: y, month: m, start, end, days};
}

// ════════════ 畫面共用 ════════════
const $ = s => document.querySelector(s);
let tab = "today", month = (() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1]; })();
const wide = matchMedia("(min-width: 720px)");

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function setTab(t) {
  tab = t;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  document.body.dataset.tab = t;
  render();
  scrollTo(0, 0);
}
function openSheet(html) {
  $("#sheet-box").innerHTML = html;
  $("#sheet").hidden = false;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-box").innerHTML = "";
}
// 安卓外殼按返回鍵時先問這裡：關掉抽屜、回到今天；回 false 才離開 App
window.UI = {back() {
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  if (tab !== "today" && !(wide.matches && tab === "month")) { setTab("today"); return true; }
  return false;
}};

function eventHtml(e, withDate) {
  const bits = [e.dept, e.place && "📍 " + e.place, e.bring && "帶：" + e.bring, e.note].filter(Boolean);
  return `<button class="ev" data-ev="${esc(e.id)}"><div class="ev-h">${e.kind === "行程" ? "📌" : "🏥"} ${withDate ? esc(md(e.date)) + " " : ""}` +
    `${esc(e.time || "")} ${esc(e.title || e.kind || "回診")}</div>` +
    (bits.length ? `<div class="ev-d">${bits.map(esc).join("<br>")}</div>` : "") + "</button>";
}
function chip(s) {
  if (!s || !s.kind) return `<span class="chip k-none">未排</span>`;
  return `<span class="chip k-${esc(s.kind)}${guessFlag(s) ? " flag" : ""}">${esc(title(s))}</span>`;
}

// ════════════ 今天 ════════════
function renderToday() {
  const d0 = today(), s = DB.shifts[d0], y = DB.shifts[addDays(d0, -1)];
  const has = Object.keys(DB.shifts).length || DB.events.length;
  let h = "";
  if (!has) {
    h += `<div class="card hint"><b>手機裡還沒有班表</b><br>到「⚙️ 設定」按「📥 從電腦版搬過來」，或在月曆點一天自己填。</div>`;
  }
  h += `<div class="btns top-btns"><button class="primary shoot" data-act="shoot">📷 拍班表</button>` +
    `<button class="shoot" data-act="evnew">＋ 回診／行程</button></div>`;
  h += `<div class="card today"><div class="day">${esc(md(d0))} 今天</div><div class="big">${chip(s)}</div>`;
  if (y && y.kind === "夜") h += `<div class="sub">昨晚夜班，今天 ${esc(shiftEnd("夜", y.time)[0])} 下班</div>`;
  for (const e of eventsOn(d0)) h += eventHtml(e);
  h += `</div>`;
  const t1 = addDays(d0, 1);
  h += `<div class="card"><div class="day">${esc(md(t1))} 明天</div><div class="big">${chip(DB.shifts[t1])}</div>`;
  for (const e of eventsOn(t1)) h += eventHtml(e);
  h += `</div><div class="card"><h3>接下來</h3><div class="list">`;
  for (let i = 2; i <= 8; i++) {
    const d = addDays(d0, i);
    h += `<button class="row" data-day="${d}"><span class="d">${esc(md(d))}</span>${chip(DB.shifts[d])}` +
      (eventsOn(d).length ? `<span class="dot">🏥</span>` : "") + `</button>`;
  }
  h += `</div></div>`;
  const next = DB.events.filter(e => e.date >= addDays(d0, 2)).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))).slice(0, 4);
  if (next.length) h += `<div class="card"><h3>之後的回診</h3>${next.map(e => eventHtml(e, true)).join("")}</div>`;
  $("#pane-today").innerHTML = h;
}

// ════════════ 月曆 ════════════
function renderMonth() {
  const [y, m] = month, first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), d0 = today();
  let h = `<div class="card"><div class="mhead"><button class="nav" data-mv="-1" aria-label="上個月">‹</button>` +
    `<b>${y} 年 ${m} 月</b><button class="nav" data-mv="1" aria-label="下個月">›</button>` +
    `<button class="small" data-mv="0">今天</button></div><div class="grid">`;
  for (const w of WEEK) h += `<div class="wd">${w}</div>`;
  for (let i = 0; i < first.getDay(); i++) h += `<div class="cell empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m)}-${pad(d)}`, s = DB.shifts[ds], wd = new Date(y, m - 1, d).getDay();
    const cls = ["cell", ds === d0 ? "is-today" : "", wd === 0 || wd === 6 ? "we" : "", s && s.kind ? "k-" + s.kind : "", guessFlag(s) ? "flag" : ""];
    h += `<button class="${cls.filter(Boolean).join(" ")}" data-day="${ds}"><span class="n">${d}</span>` +
      `<span class="s">${esc(short(s))}</span>${eventsOn(ds).length ? `<span class="e">🏥</span>` : ""}</button>`;
  }
  h += `</div><div class="legend">點一天可以看詳細、改班。黃底＝班別時間表沒有這個上班時間（下班先算 8 小時）。</div></div>`;
  $("#pane-month").innerHTML = h;
}

function openDay(ds) {
  const s = DB.shifts[ds] || {}, isShift = s.kind in DEFAULT_TIME;
  let h = `<div class="sh-head"><b>${esc(md(ds))}</b><button class="x" data-close>✕</button></div>` +
    `<div class="big">${chip(DB.shifts[ds])}</div><div class="kinds">`;
  for (const k of KINDS) h += `<button class="kb k-${k}${s.kind === k ? " on" : ""}" data-kind="${k}">${NAME[k]}</button>`;
  h += `<button class="kb${s.kind ? "" : " on"}" data-kind="">不排</button></div>` +
    `<div class="edit" ${isShift ? "" : "hidden"} id="ed-shift"><label>上班時間 <input type="time" id="ed-time" value="${esc(s.time || DEFAULT_TIME[s.kind] || "")}"></label>` +
    `<label class="ck"><input type="checkbox" id="ed-ot" ${s.ot ? "checked" : ""}> 國定加班</label></div>` +
    `<button class="primary" data-saveday="${ds}">存起來</button>`;
  const evs = eventsOn(ds);
  if (evs.length) h += `<h3>這天的回診</h3>${evs.map(e => eventHtml(e)).join("")}`;
  h += `<div class="btns"><button data-act="evnew" data-date="${ds}">＋ 這天加回診／行程</button></div>`;
  openSheet(h);
  openDay.kind = s.kind || "";
}

function saveDay(ds) {
  const k = openDay.kind;
  if (!k) delete DB.shifts[ds];
  else {
    const rec = {kind: k, time: "", ot: false, at: stamp()};
    if (k in DEFAULT_TIME) {
      rec.time = k === "夜" ? "23:00" : (normTime($("#ed-time").value) || DEFAULT_TIME[k]);
      rec.ot = $("#ed-ot").checked;
    }
    DB.shifts[ds] = rec;
  }
  save();
  closeSheet();
  render();
  toast(`${md(ds)} 存好了`);
}

// ════════════ 設定 ════════════
function renderSet() {
  const st = DB.settings, tb = tableOf(st.table);
  const nShift = Object.keys(DB.shifts).length, nEv = DB.events.length;
  let h = `<div class="card"><h3>📥 從電腦版搬過來</h3>`;
  if (window.CalBridge) {
    h += `<p class="muted">手機要開 Tailscale、電腦要開著。會把電腦版的班表、回診、班別時間表複製到手機（電腦版不會動）。</p>` +
      `<button class="primary" data-act="import">📥 從電腦版搬過來</button>`;
  } else {
    h += `<p class="muted">在 Fold8 的「行事曆手機版」App 裡才能直接搬。用瀏覽器打開時，可以用下面的「匯入備份」。</p>`;
  }
  h += `<p class="muted">手機裡現在有 <b>${nShift}</b> 天班、<b>${nEv}</b> 筆回診` +
    (DB.imported ? `（${esc(DB.imported)} 從電腦版搬過）` : "") + `。</p></div>`;

  h += `<div class="card"><h3>📷 讀班表</h3><p class="muted">拍班表要用 Google Gemini 的免費金鑰（到 aistudio.google.com 申請）。` +
    `金鑰只存在這支手機，不會放進備份。照片只送 Gemini 讀，不存。</p>` +
    `<label class="line">Gemini 金鑰 <input type="password" id="gkey" autocomplete="off" value="${esc(st.gkey || "")}" placeholder="AIza…"></label>` +
    `<label class="line">你是表上第 <input type="number" id="grow" min="1" max="40" value="${+st.row || ""}"> 個人（表頭下面從上往下數）</label>` +
    `<label class="line">名字（選填，幫 Gemini 找那一列）<input id="gname" value="${esc(st.name || "")}" maxlength="20"></label>` +
    `<div class="btns"><button class="primary" data-act="savegem">存起來</button><button data-act="testgem">測試金鑰</button></div>` +
    `<p class="muted" id="gtest">測試金鑰不會用掉每天的讀班表次數。</p></div>`;
  h += remindCard();

  h += `<div class="card"><h3>🕐 班別時間表</h3><p class="muted">上班時間 → 下班時間。下班空白＝看情況（先算下面的小時數）；下班比上班早＝隔天下班。夜班固定 23:00。</p><div id="tbl">`;
  for (const [a, b] of Object.entries(tb).sort()) h += tRow(a, b);
  h += `</div><button class="small" data-act="addrow">＋ 加一列</button>` +
    `<label class="line">看情況下班的，先算 <input type="number" id="hours" min="1" max="16" step="0.5" value="${esc(st.shift_hours)}"> 小時</label>` +
    `<div class="btns"><button class="primary" data-act="savetbl">存起來</button><button data-act="deftbl">回到預設</button></div></div>`;

  h += `<div class="card"><h3>💾 備份</h3><p class="muted">資料只存在這支手機。換手機或清除 App 資料前，先複製備份（存到記事本或傳給自己）。</p>` +
    `<div class="btns"><button data-act="export">📤 複製備份</button><button data-act="impshow">📥 匯入備份</button></div>` +
    `<div id="impbox" hidden><textarea id="imptext" rows="4" placeholder="把備份貼在這裡"></textarea>` +
    `<input type="file" id="impfile" accept=".json,application/json,text/plain"><button class="primary" data-act="impgo">匯入</button></div></div>`;

  h += `<div class="card"><h3>ℹ️ 關於</h3><p class="muted">行事曆 ${VERSION}${IS_BETA ? "（測試版）" : ""}・程式放在網路上、打開時自動更新；` +
    `班表、回診只存在手機，不會上傳。</p>` +
    `<div class="btns"><a class="btn" href="${IS_BETA ? "../app/" : "../beta/"}">${IS_BETA ? "回正式版" : "打開測試版"}</a>` +
    `<button class="danger" data-act="wipe">清除手機裡的資料</button></div></div>`;
  $("#pane-set").innerHTML = h;
}
function tRow(a, b) {
  return `<div class="trow"><input type="time" class="ta" value="${esc(a)}"> → <input type="time" class="tb" value="${esc(b)}">` +
    `<button class="x" data-act="delrow" aria-label="刪掉這列">✕</button></div>`;
}

function readTable() {
  const t = {};
  for (const r of document.querySelectorAll("#tbl .trow")) {
    const a = normTime(r.querySelector(".ta").value), b = normTime(r.querySelector(".tb").value);
    if (a) t[a] = b;
  }
  return t;
}

// 從電腦版搬：安卓外殼（CalBridge）在背景拿 電腦版 /api/all，拿到後呼叫 window.onImport(文字, 錯誤)
window.onImport = function (text, err) {
  if (err) { toast("搬不過來：" + err, 5000); return; }
  try {
    const n = mergeIn(JSON.parse(text), true);
    toast(`搬好了：${n[0]} 天班、${n[1]} 筆回診`, 4000);
  } catch (e) {
    toast("搬不過來：" + e.message, 5000);
  }
};
/** 合進手機的資料：電腦版 /api/all 的 {ok,data:{settings,shifts,events}} 或備份檔 {settings,shifts,events} */
function mergeIn(o, fromPc) {
  if (o && o.ok === false) throw new Error(o.error || "電腦版回錯誤");
  const d = o && o.data && o.data.shifts ? o.data : o;
  if (!d || typeof d.shifts !== "object" || !Array.isArray(d.events)) throw new Error("看不懂這份資料");
  const s = d.settings || {};
  for (const k of ["shift_hours", "before_hours", "eve_hour", "row", "name"]) if (k in s) DB.settings[k] = s[k];
  if (s.table) DB.settings.table = tableOf(s.table);
  let ns = 0, ne = 0;
  for (const [k, v] of Object.entries(d.shifts)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && (v.kind === null || KINDS.includes(v.kind))) {
      if (v.kind) DB.shifts[k] = {kind: v.kind, time: v.time || "", ot: !!v.ot, at: v.at || ""};
      ns++;
    }
  }
  const byId = new Map(DB.events.map(e => [e.id, e]));
  for (const e of d.events) {
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || "")) continue;
    const id = e.id || Math.random().toString(16).slice(2, 12);
    byId.set(id, Object.assign({}, e, {id}));
    ne++;
  }
  DB.events = [...byId.values()];
  if (fromPc) DB.imported = new Date().toLocaleDateString("zh-TW");
  save();
  render();
  return [ns, ne];
}

async function exportCopy() {
  const settings = Object.fromEntries(Object.entries(DB.settings).filter(([k]) => k !== "gkey"));   // 金鑰不放進備份
  const text = JSON.stringify({app: "calphone", version: VERSION, at: new Date().toISOString(),
                               settings, shifts: DB.shifts, events: DB.events});
  try {
    await navigator.clipboard.writeText(text);
    toast("備份已複製，貼到記事本或 LINE 傳給自己存著", 4000);
  } catch (e) {   // 剪貼簿不能用：顯示出來讓人自己全選複製
    openSheet(`<div class="sh-head"><b>備份（全選複製）</b><button class="x" data-close>✕</button></div><textarea rows="10" readonly>${esc(text)}</textarea>`);
  }
}

// ════════════ 拍班表 → 確認畫面 ════════════
let RD = null;   // 這次讀到的班表（還沒存）
async function shoot(file) {
  const st = DB.settings;
  if (!st.gkey) { setTab("set"); return toast("先在「📷 讀班表」填 Gemini 金鑰", 4000); }
  if (!(+st.row >= 1)) { setTab("set"); return toast("先填你是表上第幾個人", 4000); }
  const d = new Date(), hint = d.getDate() >= 26 ? [d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(), d.getMonth() === 11 ? 1 : d.getMonth() + 2]
    : [d.getFullYear(), d.getMonth() + 1];   // 照片裁掉標題時用：26 號以後拍的多半是下個月的表
  openSheet(`<div class="sh-head"><b>📷 讀班表</b></div><p id="rstep" class="step">整理照片…</p><p class="muted">大約 30～90 秒，先別關掉 App。</p>`);
  try {
    const raw = await Roster.read(file, {key: st.gkey, row: +st.row, name: st.name || "", hint,
      onStep: s => { const e = $("#rstep"); if (e) e.textContent = s; }});
    const r = convert(raw);
    for (const x of r.days) {
      const o = DB.shifts[x.date];
      if (o && (o.kind !== x.kind || (o.time || "") !== (x.time || "") || !!o.ot !== x.ot)) x.old = title(o);
    }
    Object.assign(r, {photo: raw.photo, how: raw._how, sec: raw._sec, seen: false});
    RD = r;
    showRoster();
  } catch (e) {
    openSheet(`<div class="sh-head"><b>讀不到</b><button class="x" data-close>✕</button></div><p>${esc(e.message)}</p>` +
      `<button class="primary" data-act="shoot">再拍一次</button>`);
  }
}
function showRoster() {
  const r = RD, ots = r.days.filter(d => d.ot), nflag = r.days.filter(d => d.flag).length;
  let h = `<div class="sh-head"><b>${r.year} 年 ${r.month} 月班表</b><button class="x" data-close>✕</button></div>` +
    `<p class="muted">${esc(md(r.start))}～${esc(md(r.end))}・${r.how === "tiles" ? "逐格讀" : "整條讀"}・${r.sec} 秒` +
    (nflag ? `・<b>${nflag} 天標黃，請看一下</b>` : "") + `</p>` +
    `<div class="otbox" id="otbox"><b>📌 有國定加班嗎？</b><br>讀到 ${ots.length} 天：${ots.map(d => esc(md(d.date))).join("、") || "沒有"}。` +
    `班別下面的小勾最容易漏，請對照下面的照片。<label class="ck"><input type="checkbox" id="rseen" ${r.seen ? "checked" : ""}> 我看過了</label></div>`;
  if (r.photo) h += `<div class="rphoto" data-act="zoom"><img src="${r.photo}" alt="對照照片"></div><div class="muted small-t">↑ 對照照片（點一下放大，可以左右滑）</div>`;
  h += `<div class="rlist">`;
  r.days.forEach((d, i) => {
    const work = d.kind in DEFAULT_TIME;
    h += `<div class="rrow${d.flag ? " flag" : ""}"><span class="d">${esc(md(d.date))}</span>` +
      `<select class="rk" data-ri="${i}">${["", ...KINDS].map(k => `<option value="${k}"${(d.kind || "") === k ? " selected" : ""}>${k ? NAME[k] : "不排"}</option>`).join("")}</select>` +
      `<input type="time" class="rt" data-ri="${i}" value="${esc(d.time)}"${work && d.kind !== "夜" ? "" : " hidden"}>` +
      `<label class="ck ro-l"${work ? "" : " hidden"}><input type="checkbox" class="ro" data-ri="${i}"${d.ot ? " checked" : ""}>國定加班</label>` +
      (d.why ? `<div class="why">⚠ ${esc(d.why)}${d.raw ? `（讀到「${esc(d.raw)}」）` : ""}</div>` : "") +
      (d.old ? `<div class="why old">原本：${esc(d.old || "未排")}</div>` : "") + `</div>`;
  });
  h += `</div><div class="btns"><button class="primary" id="rsave" data-act="rsave"${r.seen ? "" : " disabled"}>確認存入</button>` +
    `<button data-close>取消</button></div>`;
  openSheet(h);
}
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "rfile") { const f = t.files[0]; t.value = ""; if (f) shoot(f); return; }
  if (!RD) return;
  if (t.id === "rseen") { RD.seen = t.checked; $("#rsave").disabled = !t.checked; return; }
  const i = +t.dataset.ri, d = RD.days[i];
  if (!d) return;
  if (t.classList.contains("rk")) {
    d.kind = t.value || null;
    const row = t.closest(".rrow"), work = d.kind in DEFAULT_TIME;
    if (work) d.time = d.kind === "夜" ? "23:00" : (d.time || DEFAULT_TIME[d.kind]);
    else { d.time = ""; d.ot = false; row.querySelector(".ro").checked = false; }
    row.querySelector(".rt").value = d.time;
    row.querySelector(".rt").hidden = !work || d.kind === "夜";
    row.querySelector(".ro-l").hidden = !work;
  } else if (t.classList.contains("rt")) d.time = normTime(t.value);
  else if (t.classList.contains("ro")) d.ot = t.checked;
});
function saveRoster() {
  if (!RD.seen) { $("#otbox").scrollIntoView({behavior: "smooth"}); return toast("先看一下國定加班，勾「我看過了」"); }
  let n = 0;
  for (const d of RD.days) {   // 這段日期整段覆蓋（不排＝刪掉那天），照電腦版 roster_save
    if (KINDS.includes(d.kind)) {
      const work = d.kind in DEFAULT_TIME;
      DB.shifts[d.date] = {kind: d.kind, time: work ? (d.kind === "夜" ? "23:00" : normTime(d.time) || DEFAULT_TIME[d.kind]) : "",
                           ot: work && !!d.ot, at: stamp()};
      n++;
    } else delete DB.shifts[d.date];
  }
  save();
  month = [+RD.end.slice(0, 4), +RD.end.slice(5, 7)];
  RD = null;
  closeSheet();
  setTab("month");
  toast(`存好了：${n} 天`);
}

// ════════════ 事件 ════════════
document.addEventListener("click", async ev => {
  const b = ev.target.closest("button, a, [data-act], .sheet");
  if (!b) return;
  if (b.id === "sheet" && ev.target === b) return closeSheet();   // 點抽屜外面＝關掉
  if (b.dataset.tab) return setTab(b.dataset.tab);
  if (b.dataset.close !== undefined) return closeSheet();
  if (b.dataset.day) return openDay(b.dataset.day);
  if (b.dataset.mv !== undefined) {
    const n = +b.dataset.mv;
    if (n === 0) { const d = new Date(); month = [d.getFullYear(), d.getMonth() + 1]; }
    else { const d = new Date(month[0], month[1] - 1 + n, 1); month = [d.getFullYear(), d.getMonth() + 1]; }
    return renderMonth();
  }
  if (b.dataset.kind !== undefined) {
    openDay.kind = b.dataset.kind;
    document.querySelectorAll(".kinds .kb").forEach(x => x.classList.toggle("on", x === b));
    const isShift = openDay.kind in DEFAULT_TIME;
    $("#ed-shift").hidden = !isShift;
    if (isShift) {
      $("#ed-time").value = openDay.kind === "夜" ? "23:00" : ($("#ed-time").value || DEFAULT_TIME[openDay.kind]);
      $("#ed-time").disabled = openDay.kind === "夜";
    }
    return;
  }
  if (b.dataset.saveday) return saveDay(b.dataset.saveday);
  const act = b.dataset.act;
  if (act === "shoot") return $("#rfile").click();
  if (act === "zoom") return b.classList.toggle("zoom");
  if (act === "rsave") return saveRoster();
  if (act === "savegem") {
    DB.settings.gkey = $("#gkey").value.trim();
    DB.settings.row = Math.max(0, Math.min(40, parseInt($("#grow").value, 10) || 0));
    DB.settings.name = $("#gname").value.trim().slice(0, 20);
    save();
    return toast("存好了");
  }
  if (act === "import") {
    toast("搬資料中…（要開 Tailscale）", 15000);
    return window.CalBridge.importOld();
  }
  if (act === "addrow") return $("#tbl").insertAdjacentHTML("beforeend", tRow("", ""));
  if (act === "delrow") return b.closest(".trow").remove();
  if (act === "savetbl") {
    const t = readTable(), hrs = Math.max(1, Math.min(16, +$("#hours").value || 8));
    if (!Object.keys(t).length) return toast("至少要有一列");
    DB.settings.table = t;
    DB.settings.shift_hours = hrs;
    save(); render();
    return toast("班別時間表存好了");
  }
  if (act === "deftbl") { DB.settings.table = {...DEFAULT_TABLE}; save(); render(); return toast("回到預設了"); }
  if (act === "export") return exportCopy();
  if (act === "impshow") { $("#impbox").hidden = !$("#impbox").hidden; return; }
  if (act === "impgo") {
    let text = $("#imptext").value.trim();
    const f = $("#impfile").files[0];
    if (!text && f) text = await f.text();
    if (!text) return toast("先貼上備份或選檔案");
    try { const n = mergeIn(JSON.parse(text), false); toast(`匯入好了：${n[0]} 天班、${n[1]} 筆回診`, 4000); }
    catch (e) { toast("匯入失敗：" + e.message, 5000); }
    return;
  }
  if (act === "wipe") {   // 按兩次才清（不用 confirm 對話框）
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "再按一次就清除（先複製備份！）"; return; }
    localStorage.removeItem(KEY); DB = load(); render(); return toast("清除了");
  }
  if (b.dataset.ev) return openEvent(DB.events.find(e => e.id === b.dataset.ev));
  if (act === "evnew") return openEvent({date: b.dataset.date || today(), kind: "回診"});
  if (act === "evsave") return saveEvent();
  if (act === "evdel") {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "再按一次就刪掉"; return; }
    DB.events = DB.events.filter(e => e.id !== EV.id); save(); closeSheet(); render(); return toast("刪掉了");
  }
  if (act === "evparse" || act === "evphoto") {
    if (!DB.settings.gkey) return toast("先到「⚙️ 設定」填 Gemini 金鑰", 4000);
    if (act === "evphoto") return $("#efile").click();
    const t = $("#ev-say").value.trim();
    if (!t) return toast("先打一句話");
    return gemEvent(() => Roster.parseEvent(DB.settings.gkey, t));
  }
  if (b.dataset.pick !== undefined) return openEvent(Object.assign({}, EV, PICKS[+b.dataset.pick], {id: EV.id}));
  if (act === "savermd") {
    DB.settings.push_shift = $("#r-shift").checked;
    DB.settings.push_event = $("#r-event").checked;
    DB.settings.eve_hour = Math.max(0, Math.min(23, parseInt($("#r-eve").value, 10) || 20));
    DB.settings.before_hours = Math.max(0.5, Math.min(12, +$("#r-before").value || 2));
    save(); render(); return toast("提醒設定存好了");
  }
  if (act === "testgem") return testGem();
  if (act === "rmdtest") { window.CalBridge.testAlarm(); return toast("10 秒後會跳一則測試提醒"); }
  if (act === "rmdperm") { window.CalBridge.askNotify(); return; }
});

// ════════════ 回診／行程 ════════════
let EV = null, PICKS = [];
function openEvent(e) {
  if (!e) return;
  EV = Object.assign({id: "", date: today(), time: "", kind: "回診", place: "", dept: "", bring: "", title: "", note: ""}, e);
  const f = (k, label, ph = "") => `<label class="fl">${label}<input id="ev-${k}" value="${esc(EV[k])}" placeholder="${esc(ph)}"></label>`;
  let h = `<div class="sh-head"><b>${EV.id ? "改" : "加"}回診／行程</b><button class="x" data-close>✕</button></div>`;
  if (!EV.id) h += `<div class="quick"><textarea id="ev-say" rows="2" placeholder="打一句話，例如：12/3 下午兩點 台大眼科回診，帶健保卡"></textarea>` +
    `<div class="btns"><button data-act="evparse">✨ 幫我拆</button><button data-act="evphoto">📷 拍預約單</button></div><div id="ev-res"></div></div>`;
  h += `<div class="fgrid"><label class="fl">日期<input type="date" id="ev-date" value="${esc(EV.date)}"></label>` +
    `<label class="fl">時間<input type="time" id="ev-time" value="${esc(EV.time)}"></label>` +
    `<label class="fl">種類<select id="ev-kind"><option${EV.kind === "回診" ? " selected" : ""}>回診</option><option${EV.kind === "行程" ? " selected" : ""}>行程</option></select></label></div>` +
    f("title", "標題", "例如：台大眼科回診") + f("place", "地點", "醫院／診所") + f("dept", "科別／醫師") + f("bring", "要帶", "健保卡、預約單…") + f("note", "備註") +
    `<div class="btns"><button class="primary" data-act="evsave">存起來</button>${EV.id ? `<button class="danger" data-act="evdel">刪掉</button>` : ""}<button data-close>取消</button></div>`;
  openSheet(h);
}
/** 1.4（2026-11-27 使用者要）：設定頁「測試金鑰」——只列模型清單，不叫 Gemini 讀東西，不用掉每天的免費次數 */
async function testGem() {
  const key = $("#gkey").value.trim(), out = $("#gtest");
  if (!key) { out.textContent = "先把金鑰貼進上面的格子。"; return; }
  out.textContent = "測試中…";
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {headers: {"x-goog-api-key": key}});
    out.textContent = r.ok ? "✅ 金鑰可以用！記得按「存起來」。"
      : r.status === 400 ? "❌ 金鑰不對：重新複製一次，前後不要多空白。"
      : r.status === 403 ? "❌ 這把金鑰沒有開 Gemini 權限，或已經被停用：到 aistudio.google.com/apikey 換一把。"
      : r.status === 429 ? "⏳ 金鑰是對的，但現在查太頻繁，等一下再試。"
      : `❓ Gemini 回了 ${r.status}，等一下再試。`;
  } catch (err) {
    out.textContent = "📶 連不到 Gemini：看看有沒有網路。";
  }
}

async function gemEvent(fn) {
  const box = $("#ev-res");
  box.innerHTML = `<p class="muted">Gemini 讀取中…</p>`;
  try {
    PICKS = (await fn()).filter(i => i && i.date);
    if (!PICKS.length) { box.innerHTML = `<p class="muted">找不到日期，請自己填下面的欄位。</p>`; return; }
    if (PICKS.length === 1) { openEvent(Object.assign({}, EV, cleanEv(PICKS[0]), {id: ""})); return toast("拆好了，看一下對不對再存"); }
    PICKS = PICKS.map(cleanEv);
    box.innerHTML = `<p class="muted">讀到 ${PICKS.length} 筆，點一筆填進下面（存完再點「＋」加下一筆）：</p>` +
      PICKS.map((p, i) => `<button class="row" data-pick="${i}">${esc(md(p.date))} ${esc(p.time)} ${esc(p.title || p.place || p.kind)}</button>`).join("");
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}
function cleanEv(i) {
  return {date: /^\d{4}-\d{2}-\d{2}$/.test(i.date || "") ? i.date : "", time: normTime(i.time), kind: i.kind === "行程" ? "行程" : "回診",
    place: String(i.place || "").slice(0, 40), dept: String(i.dept || "").slice(0, 30), bring: String(i.bring || "").slice(0, 80),
    title: String(i.title || "").slice(0, 40), note: String(i.note || "").slice(0, 200)};
}
function saveEvent() {
  const v = k => $("#ev-" + k).value.trim();
  const e = cleanEv({date: v("date"), time: v("time"), kind: v("kind"), place: v("place"), dept: v("dept"), bring: v("bring"), title: v("title"), note: v("note")});
  if (!e.date) return toast("要填日期");
  if (!e.title) e.title = (e.place + e.dept + (e.kind === "回診" ? "回診" : "")) || e.kind;
  e.id = EV.id || Math.random().toString(16).slice(2, 12);
  DB.events = DB.events.filter(x => x.id !== e.id).concat(e).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  save(); closeSheet(); render();
  toast(`${md(e.date)} ${e.title} 存好了`);
}
document.addEventListener("change", ev => {
  if (ev.target.id !== "efile") return;
  const f = ev.target.files[0];
  ev.target.value = "";
  if (f) gemEvent(() => Roster.readAppt(DB.settings.gkey, f));
});

// ════════════ 提醒（手機鬧鐘式：交給安卓 App 用 AlarmManager 排，不靠網路推播） ════════════
// 規則照電腦版 calapi.due_pushes：早／中／晚班前一天 eve_hour 點、夜班當天 eve_hour 點；回診前一天 eve_hour 點＋當天 before_hours 小時前
function reminders() {
  const s = DB.settings, out = [], now = Date.now(), until = now + 35 * 86400000;
  const at = (ds, hm) => { const [h, m] = hm.split(":").map(Number); const d = parse(ds); d.setHours(h, m, 0, 0); return d.getTime(); };
  const eve = `${pad(+s.eve_hour || 20)}:00`;
  const off = (t, nxt) => {
    const [end, how] = shiftEnd(t.kind, t.time);
    if (how === "vague") return "下班看情況";
    return `${end < (t.time || "00:00") ? nxt : ""}${end} 下班` + (how === "guess" ? "（約）" : "");
  };
  const add = (key, when, title, body) => { if (when > now && when < until) out.push({key, at: when, title, body}); };
  if (s.push_shift !== false) {
    for (const [ds, t] of Object.entries(DB.shifts)) {
      const ot = t.ot ? "（國定加班）" : "";
      if (["早", "中", "晚"].includes(t.kind)) add(`shift:${ds}`, at(addDays(ds, -1), eve), "📅 明天上班", `明天 ${t.time} ${NAME[t.kind]}${ot}，${off(t, "隔天 ")}`);
      if (t.kind === "夜") { const tt = Object.assign({}, t, {time: t.time || "23:00"}); add(`shift:${ds}`, at(ds, eve), "📅 今晚上班", `今晚 ${tt.time} 夜班${ot}，${off(tt, "明早 ")}`); }
    }
  }
  if (s.push_event !== false) {
    for (const e of DB.events) {
      const what = e.title + (e.place && !e.title.includes(e.place) ? `（${e.place}）` : ""), bring = e.bring ? `，帶 ${e.bring}` : "";
      const word = e.kind === "回診" ? "回診" : "的行程";
      add(`ev1:${e.id}:${e.date}`, at(addDays(e.date, -1), eve), "🏥 明天" + word, `明天 ${e.time ? e.time + " " : ""}${what}${bring}`);
      if (e.time) {
        const hb = +s.before_hours || 2, lt = hb >= 1 ? `${Math.floor(hb)} 小時${hb % 1 ? ` ${Math.round(hb % 1 * 60)} 分` : ""}後` : `${Math.round(hb * 60)} 分後`;
        add(`ev0:${e.id}:${e.date}:${e.time}`, at(e.date, e.time) - hb * 3600000, "🏥 準備出門", `今天 ${e.time} ${what}（${lt}）${bring}`);
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 60);
}
function syncAlarms() {   // 每次資料改了或打開 App：把接下來 35 天的提醒整批交給 App 重排
  if (window.CalBridge && CalBridge.setAlarms) {
    try { CalBridge.setAlarms(JSON.stringify(reminders())); } catch (e) { /* 舊版 App 沒有這個功能 */ }
  }
  if (window.CalBridge && CalBridge.setWidget) {   // 桌面小工具：接下來 3 週的班＋之後的回診（小工具自己照日期挑今天）
    const days = {}, d0 = today();
    for (let i = -1; i <= 21; i++) {
      const ds = addDays(d0, i), s = DB.shifts[ds];
      if (s && s.kind) days[ds] = {t: title(s), k: s.kind};
    }
    const events = DB.events.filter(e => e.date >= d0).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6)
      .map(e => ({d: e.date, t: `${e.time ? e.time + " " : ""}${e.title}`}));
    try { CalBridge.setWidget(JSON.stringify({days, events})); } catch (e) { /* 舊版 App 沒有這個功能 */ }
  }
}
function remindCard() {
  const s = DB.settings, list = reminders(), app = !!(window.CalBridge && CalBridge.setAlarms);
  const st = app && CalBridge.alarmStatus ? JSON.parse(CalBridge.alarmStatus()) : null;
  let h = `<div class="card"><h3>🔔 提醒</h3>`;
  if (!app) h += `<p class="muted">提醒要在 Fold8 的「行事曆手機版」App 裡才會跳（瀏覽器打開不會）。</p>`;
  else if (st && !st.notify) h += `<p class="warn">通知被關掉了，提醒不會跳。<button class="small" data-act="rmdperm">打開通知</button></p>`;
  h += `<label class="ck"><input type="checkbox" id="r-shift"${s.push_shift !== false ? " checked" : ""}> 上班提醒（早中晚班前一天晚上、夜班當天晚上）</label>` +
    `<label class="ck"><input type="checkbox" id="r-event"${s.push_event !== false ? " checked" : ""}> 回診／行程提醒（前一天晚上＋當天出門前）</label>` +
    `<label class="line">晚上幾點提醒 <input type="number" id="r-eve" min="0" max="23" value="${+s.eve_hour || 20}"> 點</label>` +
    `<label class="line">回診當天提早 <input type="number" id="r-before" min="0.5" max="12" step="0.5" value="${+s.before_hours || 2}"> 小時提醒</label>` +
    `<div class="btns"><button class="primary" data-act="savermd">存起來</button>${app ? `<button data-act="rmdtest">測試（10 秒後跳）</button>` : ""}</div>` +
    `<p class="muted">接下來 35 天會跳 ${list.length} 則` + (list[0] ? `，下一則：${esc(md(iso(new Date(list[0].at))))} ${new Date(list[0].at).toTimeString().slice(0, 5)}「${esc(list[0].body)}」` : "") + `。</p>`;
  if (st && !st.exact) h += `<p class="muted">（手機沒給「精確鬧鐘」權限，提醒可能晚幾分鐘）</p>`;
  return h + `</div>`;
}

function render() {
  document.body.classList.toggle("wide", wide.matches);
  const both = wide.matches && (tab === "today" || tab === "month");
  if (tab === "today" || both) renderToday();
  if (tab === "month" || both) renderMonth();
  if (tab === "set") renderSet();
  clearTimeout(render._t);
  render._t = setTimeout(syncAlarms, 300);
}
wide.addEventListener("change", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { DB = load(); render(); } });   // 過了午夜切回來，今天要換
$("#beta").hidden = !IS_BETA;
document.body.dataset.tab = tab;
render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
