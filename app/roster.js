"use strict";
// 拍班表 → 手機直接送 Gemini 讀（2026-11-27 第 2 步）。做法、提示詞照電腦版 E:\程式相關\行事曆\gem.py（改了兩邊一起改）：
//   1. 照片轉正（試 −6～6 度，橫格線最對齊的角度）
//   2. Gemini 找表頭「日期」列和你那一列的框
//   3. 程式在那一列找 31 條等距直格線（允許透視），每天切一格、上面接表頭日期、標 #1…#30 拼一張圖 → Gemini 逐格讀
//      （整張直接讀碰到「夜夜夜」連續一樣的格子會漏一格、後面全錯一欄）
//   4. 找不到整齊的格線才退回整條讀
// 金鑰只存在手機（設定頁輸入），照片只送 Gemini，不存。
const Roster = (() => {
  const API = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
  // 免費額度每個模型每天分開算（台灣約 16:00 重置）；用完（429）或忙線換下一個
  const VISION = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.7-flash"];

  const MARKS = `班別字的上面或下面有時候會打一個勾:要寫出來,例如「夜✓」「中✓」(勾很小、很淡也要看)。
也可能是「例」(手寫很像「倒」,一律寫「例」)、「休」、「時休」或「特休」(兩個字上下疊著寫,常常斜斜的),
這三種下面常順手畫一個勾,不用寫勾,只寫「例」「休」「特休」;整格只有一個勾、沒有字的寫「✓」;「代」(小字)、或空白。`;
  const MARK_DESC = "下方手寫大字或符號:早、中、晚、夜(班別旁邊有勾就寫「夜✓」這樣)、例、休、特休、✓(整格只有勾)、代;空白格寫空白";
  const BOX = {type: "ARRAY", items: {type: "INTEGER"}, description: "[ymin, xmin, ymax, xmax],0~1000"};
  const LOCATE_SCHEMA = {type: "OBJECT", properties: {title: {type: "STRING", description: "表格標題整行"},
    date_row: BOX, week_row: BOX, person_row: BOX}, required: ["title", "date_row", "week_row", "person_row"]};
  const LOCATE_PROMPT = `這是一張手寫排班表(輪休表)照片。請找出下面三個橫列的位置,各回一個框 [ymin, xmin, ymax, xmax](0~1000 的相對座標),
框要包住整列、從最左邊的標題格到最右邊最後一個日期欄:
1. date_row:表頭「日期」那一列(一排數字 26 27 … 1 2 … 25)
2. week_row:表頭「星期」那一列
3. person_row:{who}那一列(整列手寫格子)
title 填表格最上面的標題(例如「…輪休表 2026年12月」)。`;
  const TILE_SCHEMA = {type: "OBJECT", properties: {cells: {type: "ARRAY", items: {type: "OBJECT", properties: {
    n: {type: "INTEGER", description: "格子左上角紅字的編號"},
    day: {type: "INTEGER", description: "上半部印刷的日期數字;看不到填 0"},
    time: {type: "STRING", description: "下半部手寫小字時間 HH:MM;沒有就空白"},
    mark: {type: "STRING", description: MARK_DESC},
    sure: {type: "NUMBER", description: "0~1"}}, required: ["n", "day", "time", "mark", "sure"]}}}, required: ["cells"]};
  const TILE_PROMPT = `這張圖是從手寫排班表切下來的 {n} 個小格子,每個小格子左上角有紅字編號 #1~#{n}。
每個小格子:上半部是表頭印刷的「日期」數字,下半部是某個人那天的手寫格子。
手寫格子的寫法:上方小字是上班時間(05:00、06:00、09:00、10:00、10:30…),下方大字是班別:早、中、晚、夜;
${MARKS}
格子邊邊可能露出隔壁格或上下列的一點點筆畫,只看格子中間那一格的字。
請每個編號都回一筆(#1 到 #{n},共 {n} 筆)。看不清楚的還是猜一個最可能的,sure 給低一點。時間寫成 HH:MM。`;
  const ROSTER_SCHEMA = {type: "OBJECT", properties: {
    year: {type: "INTEGER", description: "表頭寫的年(西元)"}, month: {type: "INTEGER", description: "表頭寫的月"},
    row_label: {type: "STRING", description: "你讀的那一列最左邊的格子(姓名)寫什麼,看不清楚就空白"},
    cells: {type: "ARRAY", items: {type: "OBJECT", properties: {
      day: {type: "INTEGER", description: "這一欄表頭「日期」列的數字"},
      weekday: {type: "STRING", description: "這一欄表頭「星期」列的字(一~日)"},
      time: {type: "STRING", description: "格子上方的小字時間,寫成 HH:MM;沒有就空白"},
      mark: {type: "STRING", description: MARK_DESC}, sure: {type: "NUMBER", description: "你多確定這格讀對(0~1)"}},
      required: ["day", "weekday", "time", "mark", "sure"]}}}, required: ["year", "month", "row_label", "cells"]};
  const STRIP_PROMPT = `這是從一張手寫「輪休表」(排班表)裁下來的長條:最上面是表頭兩列(「日期」數字、「星期」一~日),下面隔一條白線是同一張表裡某一個人的那一列。
表格標題是:{title}
這張表的日期從上個月 26 日開始,經過月底後從 1 開始,到 25 日結束,約 30 欄。
每一格是手寫:上方小字是上班時間(05:00、06:00、09:00、10:00、10:30…),下方大字是班別:早、中、晚、夜;
${MARKS}

請把下面那一列從左到右每一個日期欄都讀出來(每欄一筆,不要跳過、不要合併)。
重要:表頭的每一個日期數字正下方就是那天的格子,用直的格線對齊,確定是同一欄再寫;寫完檢查筆數要等於表頭的日期欄數。
最左邊的姓名格不要算進日期。看不清楚的格子還是猜一個最可能的,sure 給低一點。時間寫成 HH:MM。`;

  // ── Gemini ──
  async function call(key, models, parts, schema) {
    if (!key) throw new Error("先到「⚙️ 設定」填 Gemini 金鑰");
    const body = JSON.stringify({contents: [{role: "user", parts}],
      generationConfig: {temperature: 0.1, responseMimeType: "application/json", responseSchema: schema}});
    let last = "";
    for (const m of models) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 90000);
      try {
        const r = await fetch(API(m), {method: "POST", body, signal: ctl.signal,
          headers: {"x-goog-api-key": key, "Content-Type": "application/json"}});
        if (!r.ok) {
          last = "HTTP " + r.status;
          if ([404, 429, 500, 503].includes(r.status)) continue;
          if (r.status === 400 || r.status === 403) throw new Error("Gemini 金鑰不對或不能用（HTTP " + r.status + "）");
          break;
        }
        const j = await r.json();
        const c = ((j.candidates || [])[0] || {}).content || {};
        const txt = (c.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
        try { return [JSON.parse(txt), m]; } catch (e) { last = "回了看不懂的內容"; }
      } catch (e) {
        if (e.message && e.message.startsWith("Gemini 金鑰")) throw e;
        last = e.name === "AbortError" ? "等太久" : "連不上 Gemini";
      } finally { clearTimeout(t); }
    }
    if (last.includes("429")) throw new Error("Gemini 免費額度暫時用完了（每天下午 4 點左右重置），等一下再試");
    throw new Error(`Gemini 讀不到（${last || "不明原因"}），等一下再試`);
  }
  const part = canvas => ({inlineData: {mimeType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.92).split(",")[1]}});

  // ── 圖片 ──
  function canvasOf(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  /** 照片 → canvas（照 EXIF 轉正、最長邊 2400） */
  async function prep(file, maxSide = 2400) {
    const bmp = await createImageBitmap(file, {imageOrientation: "from-image"});
    const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = canvasOf(bmp.width * r, bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }
  /** 轉 a 度（跟 PIL rotate 同方向：正＝逆時針），expand＝畫布放大包住整張；空白補白色 */
  function rotate(src, a, expand) {
    const rad = -a * Math.PI / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const w = expand ? src.width * cos + src.height * sin : src.width, h = expand ? src.width * sin + src.height * cos : src.height;
    const c = canvasOf(w, h), g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2); g.rotate(rad); g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }
  /** 灰階陣列 [W*H]（0～255） */
  function gray(c) {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, out = new Float32Array(c.width * c.height);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return out;
  }
  /** 拍歪了就轉正：橫格線最對齊（每一橫行的暗度差最大）的角度 */
  function deskew(c) {
    const r = Math.min(1, 900 / Math.max(c.width, c.height));
    const small = canvasOf(c.width * r, c.height * r);
    small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
    const score = a => {
      const rc = rotate(small, a, false), g = gray(rc), W = rc.width, H = rc.height;
      let prev = null, s = 0;
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) row += 255 - g[y * W + x];
        if (prev !== null) s += (row - prev) ** 2;
        prev = row;
      }
      return s;
    };
    const best = list => list.reduce((b, a) => { const s = score(a); return s > b[1] ? [a, s] : b; }, [0, -1])[0];
    const range = (a, b, st) => { const o = []; for (let x = a; x <= b + 1e-9; x += st) o.push(Math.round(x * 10) / 10); return o; };
    let a = best(range(-6, 6, 0.5));
    a = best(range(a - 0.4, a + 0.4, 0.1));
    if (Math.abs(a) < 0.15) return [c, 0];
    return [rotate(c, a, true), Math.round(a * 10) / 10];
  }
  /** 在 [x0,x1] 內找 n 條近似等距的直格線（允許透視讓間距慢慢變）→ [平均分數 0～1, 各線 x] */
  function comb(profile, n, x0, x1) {
    const L = profile.length, pr = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      let m = 0;
      for (let s = -2; s <= 2; s++) m = Math.max(m, profile[(i + s + L) % L]);
      pr[i] = i < x0 || i >= x1 ? 0 : m;
    }
    let best = -1, bestPos = null;
    const span = x1 - x0, pos = new Float64Array(n);
    for (let p = span / (n + 6); p <= span / (n - 1) + 0.01; p += 0.25) {
      for (const q of [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03]) {
        for (let k = 0; k < n; k++) pos[k] = k * p + q * k * k;
        if (pos[n - 1] >= span) continue;
        for (let o = x0; o < Math.floor(x1 - pos[n - 1]); o++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += pr[Math.floor(o + pos[k])];
          if (s > best) { best = s; bestPos = Array.from(pos, v => Math.floor(o + v)); }
        }
      }
    }
    return [best / n, bestPos];
  }
  /** 某一橫列（Gemini 給的框）裡的 n 條直格線；near＝另一列的格線，只在它左右半格內找 */
  function lines(g, W, H, box, n, near) {
    const y0 = Math.floor(box[0] * H / 1000), y1 = Math.floor(box[2] * H / 1000), h = Math.max(4, y1 - y0);
    const ya = y0 + Math.floor(h / 5), yb = y1 - Math.floor(h / 5);
    let x0 = Math.max(0, Math.floor(box[1] * W / 1000) - Math.floor(W / 100)), x1 = Math.min(W, Math.floor(box[3] * W / 1000) + Math.floor(W / 100));
    if (near) {
      const half = Math.floor((near[near.length - 1] - near[0]) / (near.length - 1) * 0.45);
      x0 = Math.max(0, near[0] - half); x1 = Math.min(W, near[near.length - 1] + half);
    }
    const vals = [];
    for (let y = ya; y < yb; y += 2) for (let x = x0; x < x1; x += 3) vals.push(g[y * W + x]);
    vals.sort((a, b) => a - b);
    const paper = vals[Math.floor(vals.length / 2)] || 255, rows = Math.max(1, yb - ya);
    const dark = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = ya; y < yb; y++) if (g[y * W + x] < paper - 50) c++;
      dark[x] = c / rows;
    }
    return comb(dark, n, x0, x1);
  }
  /** 那一列切成一格一格、每格上面接表頭日期格，標 #1、#2…拼一張圖；格線不整齊回 [null, 分數] */
  function mosaic(img, loc, ndays) {
    const pb = loc.person_row, db = loc.date_row, W = img.width, H = img.height;
    if (!(Array.isArray(pb) && pb.length === 4 && Array.isArray(db) && db.length === 4)) return [null, 0];
    const g = gray(img);
    const [sp, xp] = lines(g, W, H, pb, ndays + 1);
    if (sp < 0.6) return [null, sp];
    const [sd, xd] = lines(g, W, H, db, ndays + 1, xp);
    const score = Math.min(sp, sd);
    if (score < 0.6) return [null, score];
    const ph = Math.floor((pb[2] - pb[0]) * H / 1000), py0 = Math.max(0, Math.floor(pb[0] * H / 1000) - Math.floor(ph / 8)),
      py1 = Math.min(H, Math.floor(pb[2] * H / 1000) + Math.floor(ph / 8));
    const dh = Math.floor((db[2] - db[0]) * H / 1000), dy0 = Math.max(0, Math.floor(db[0] * H / 1000) - Math.floor(dh / 8)),
      dy1 = Math.min(H, Math.floor(db[2] * H / 1000) + Math.floor(dh / 8));
    const TW = 170, PER = 10, tiles = [];
    for (let i = 0; i < ndays; i++) {
      const hx0 = xd[i] - 3, hw = xd[i + 1] + 3 - hx0, cx0 = xp[i] - 3, cw = xp[i + 1] + 3 - cx0;
      const hh = Math.max(1, Math.floor((dy1 - dy0) * TW / hw)), ch = Math.max(1, Math.floor((py1 - py0) * TW / cw));
      const t = canvasOf(TW, 40 + hh + 6 + ch), tg = t.getContext("2d");
      tg.fillStyle = "#fff"; tg.fillRect(0, 0, t.width, t.height);
      tg.fillStyle = "rgb(210,0,0)"; tg.font = "30px Arial, sans-serif"; tg.textBaseline = "top"; tg.fillText(`#${i + 1}`, 8, 4);
      tg.drawImage(img, hx0, dy0, hw, dy1 - dy0, 0, 40, TW, hh);
      tg.drawImage(img, cx0, py0, cw, py1 - py0, 0, 40 + hh + 6, TW, ch);
      tiles.push(t);
    }
    const th = Math.max(...tiles.map(t => t.height)), rows = Math.ceil(ndays / PER);
    const out = canvasOf(PER * (TW + 14), rows * (th + 20)), og = out.getContext("2d");
    og.fillStyle = "rgb(235,235,235)"; og.fillRect(0, 0, out.width, out.height);
    tiles.forEach((t, i) => og.drawImage(t, (i % PER) * (TW + 14) + 7, Math.floor(i / PER) * (th + 20) + 10));
    return [out, score];
  }
  /** 找不到格線時：表頭和那一列裁下來上下接起來放大 */
  function strip(img, loc) {
    const W = img.width, H = img.height, boxes = ["date_row", "week_row", "person_row"].map(k => loc[k]);
    if (!boxes.every(b => Array.isArray(b) && b.length === 4)) throw new Error("找不到表頭或你那一列，請拍清楚一點");
    const x0 = Math.max(0, Math.floor(Math.min(...boxes.map(b => b[1])) * W / 1000) - Math.floor(W / 60));
    const x1 = Math.min(W, Math.floor(Math.max(...boxes.map(b => b[3])) * W / 1000) + Math.floor(W / 60));
    const band = (b, pad) => { const h = (b[2] - b[0]) * H / 1000; return [Math.max(0, b[0] * H / 1000 - h * pad), Math.min(H, b[2] * H / 1000 + h * pad)]; };
    const a = band(boxes[0], .25), b = band(boxes[1], .25), head = [Math.min(a[0], b[0]), Math.max(a[1], b[1])], row = band(boxes[2], .2);
    const r = Math.max(1, 2400 / (x1 - x0)), gap = 12;
    const out = canvasOf((x1 - x0) * r, ((head[1] - head[0]) + (row[1] - row[0]) + gap) * r), og = out.getContext("2d");
    og.fillStyle = "#fff"; og.fillRect(0, 0, out.width, out.height);
    og.drawImage(img, x0, head[0], x1 - x0, head[1] - head[0], 0, 0, out.width, (head[1] - head[0]) * r);
    og.drawImage(img, x0, row[0], x1 - x0, row[1] - row[0], 0, ((head[1] - head[0]) + gap) * r, out.width, (row[1] - row[0]) * r);
    return out;
  }
  /** 讀班表裡使用者那一列 → {year, month, cells:[{day, weekday, time, mark, sure}], _how, _sec, photo} */
  async function read(file, {key, row, name, hint, onStep}) {
    const t0 = Date.now(), step = onStep || (() => {});
    const who = `表頭下面從上往下數第 ${row} 個人` + (name ? `(姓名格寫「${name}」)` : "");
    step("整理照片…");
    let img = await prep(file), angle;
    [img, angle] = deskew(img);
    step("Gemini 找你那一列…");
    const [loc] = await call(key, VISION, [part(img), {text: LOCATE_PROMPT.replace("{who}", who)}], LOCATE_SCHEMA);
    const title = loc.title || "", m = title.match(/(20\d\d)\s*年\s*(\d{1,2})\s*月/);
    const ym = m && +m[2] >= 1 && +m[2] <= 12 ? [+m[1], +m[2]] : hint;
    let pic = null, score = 0, data = null, how = "strip", model = "";
    if (ym) {
      const [y, mo] = ym, start = new Date(mo === 1 ? y - 1 : y, mo === 1 ? 11 : mo - 2, 26), end = new Date(y, mo - 1, 25);
      const ndays = Math.round((end - start) / 86400000) + 1;
      step("切格子…");
      [pic, score] = mosaic(img, loc, ndays);
      if (pic) {
        step("Gemini 一格一格讀…");
        let got;
        [got, model] = await call(key, VISION, [part(pic), {text: TILE_PROMPT.replaceAll("{n}", String(ndays))}], TILE_SCHEMA);
        const cells = [];
        for (const c of got.cells || []) {
          const i = parseInt(c.n, 10) - 1;
          if (!(i >= 0 && i < ndays)) continue;
          const dt = new Date(start); dt.setDate(dt.getDate() + i);
          let sure = +c.sure || 0;
          if (c.day && +c.day !== dt.getDate()) sure = Math.min(sure, 0.3);   // 表頭數字對不上 → 可能切錯格，標黃
          cells.push({day: dt.getDate(), weekday: "日一二三四五六"[dt.getDay()], time: c.time || "", mark: c.mark || "", sure});
        }
        data = {year: y, month: mo, row_label: "", cells};
        how = "tiles";
      }
    }
    if (!data) {
      pic = strip(img, loc);
      step("Gemini 讀整條…");
      [data, model] = await call(key, VISION, [part(pic), {text: STRIP_PROMPT.replace("{title}", title)}], ROSTER_SCHEMA);
      if (ym && !(data.year && data.month)) [data.year, data.month] = ym;
    }
    // 對照照片（確認畫面用，只在這一次，不存）
    const r = Math.min(1, 1400 / pic.width), th = canvasOf(pic.width * r, pic.height * r);
    th.getContext("2d").drawImage(pic, 0, 0, th.width, th.height);
    return Object.assign(data, {_how: how, _grid: Math.round(score * 100) / 100, _angle: angle, _model: model,
      _sec: Math.round((Date.now() - t0) / 100) / 10, photo: th.toDataURL("image/jpeg", 0.75)});
  }
  return {read, _test: {prep, deskew, lines, gray, mosaic, comb}};
})();
