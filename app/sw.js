// 行事曆手機版的離線快取：每次打開先抓網路上的新版（改完不用重裝），抓不到就用手機裡存的那一份。
// 只快取程式本身（同一個網址底下的檔案），班表和回診存在 localStorage，不經過這裡。
const CACHE = "calphone-v4";
const SHELL = ["./", "index.html", "app.js", "roster.js", "app.css", "manifest.json", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("calphone-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);   // 網路很慢時 4 秒就改用手機裡的
      const r = await fetch(e.request, {cache: "no-cache", signal: ctl.signal});
      clearTimeout(t);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      const hit = await c.match(e.request, {ignoreSearch: true});
      if (hit) return hit;
      throw err;
    }
  })());
});
