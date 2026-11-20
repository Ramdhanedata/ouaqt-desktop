/*
 * The phone app's service worker, written by scripts/build-phone.mjs in the
 * ouaqt-desktop repository. Do not edit it here: build again.
 *
 * It keeps every file of the app on the phone, so the app opens with no
 * network. It never touches the licence calls (/api/), which must reach the
 * website or fail, and it never stores anything of the shop: the shop's data
 * is in the page's own storage, not in this cache.
 */
const CACHE = "ouaqt-phone-d13574fa947b";
const FILES = [
  "./assets/cairo-arabic-BW4_w4rE.woff2",
  "./assets/cairo-latin-Br-HIwGC.woff2",
  "./assets/cairo-latin-ext-BzTkPeNP.woff2",
  "./assets/ibm-plex-sans-arabic-arabic-400-CyU-ddYS.woff2",
  "./assets/ibm-plex-sans-arabic-arabic-500-C4MQITzh.woff2",
  "./assets/ibm-plex-sans-arabic-arabic-600-0pRdybE_.woff2",
  "./assets/ibm-plex-sans-arabic-arabic-700-DrtBj6UE.woff2",
  "./assets/ibm-plex-sans-arabic-latin-400-Bo5KPYvw.woff2",
  "./assets/ibm-plex-sans-arabic-latin-500-Cd6jVIg7.woff2",
  "./assets/ibm-plex-sans-arabic-latin-600-KrqB56Mw.woff2",
  "./assets/ibm-plex-sans-arabic-latin-700-BzSf6GNr.woff2",
  "./assets/ibm-plex-sans-arabic-latin-ext-400-BpLfq-63.woff2",
  "./assets/ibm-plex-sans-arabic-latin-ext-500-Ck_W4G78.woff2",
  "./assets/ibm-plex-sans-arabic-latin-ext-600-DjDAeNQD.woff2",
  "./assets/ibm-plex-sans-arabic-latin-ext-700-BSbyEp0V.woff2",
  "./assets/index-ChCyhUAF.js",
  "./assets/jetbrains-mono-latin-400-V6pRDFza.woff2",
  "./assets/jetbrains-mono-latin-600-C8RAYTDA.woff2",
  "./assets/jetbrains-mono-latin-700-BYuf6tUa.woff2",
  "./assets/jetbrains-mono-latin-ext-400-Bc8Ftmh3.woff2",
  "./assets/jetbrains-mono-latin-ext-600-BfB_LPfz.woff2",
  "./assets/jetbrains-mono-latin-ext-700-CZipNAKV.woff2",
  "./assets/main-BsHoNU3s.css",
  "./assets/main-DUVW5grq.js",
  "./assets/plus-jakarta-sans-latin-400-Dhut76fR.woff2",
  "./assets/plus-jakarta-sans-latin-500-Bf-nb4oT.woff2",
  "./assets/plus-jakarta-sans-latin-600-DLTa1BUW.woff2",
  "./assets/plus-jakarta-sans-latin-700-CfpNZvy6.woff2",
  "./assets/plus-jakarta-sans-latin-ext-400-D127hM_v.woff2",
  "./assets/plus-jakarta-sans-latin-ext-500-9VZagAe1.woff2",
  "./assets/plus-jakarta-sans-latin-ext-600-DQgPU_Cg.woff2",
  "./assets/plus-jakarta-sans-latin-ext-700-BajbvANd.woff2",
  "./assets/preload-nUBFWpaf.js",
  "./assets/sqlite3-Con_VOcu.wasm",
  "./assets/sqlite3-opfs-async-proxy-Ck-yCayi.js",
  "./assets/sqlite3-worker1-BXnajhSw.js",
  "./assets/unbounded-latin-700-CaoNriVp.woff2",
  "./assets/unbounded-latin-ext-700-BLzWLLjG.woff2",
  "./assets/xlsx-DZ8bO3Pv.js",
  "./icons/bakery-180.png",
  "./icons/bakery-192.png",
  "./icons/bakery-512.png",
  "./icons/general-180.png",
  "./icons/general-192.png",
  "./icons/general-512.png",
  "./icons/hotel-180.png",
  "./icons/hotel-192.png",
  "./icons/hotel-512.png",
  "./icons/ouaqt-180.png",
  "./icons/ouaqt-192.png",
  "./icons/ouaqt-512.png",
  "./icons/pharmacy-180.png",
  "./icons/pharmacy-192.png",
  "./icons/pharmacy-512.png",
  "./icons/restaurant-180.png",
  "./icons/restaurant-192.png",
  "./icons/restaurant-512.png",
  "./icons/shop-180.png",
  "./icons/shop-192.png",
  "./icons/shop-512.png",
  "./icons/transport-180.png",
  "./icons/transport-192.png",
  "./icons/transport-512.png",
  "./icons/warehouse-180.png",
  "./icons/warehouse-192.png",
  "./icons/warehouse-512.png",
  "./icons/wash-180.png",
  "./icons/wash-192.png",
  "./icons/wash-512.png",
  "./index.html",
  "./manifest-bakery.webmanifest",
  "./manifest-general.webmanifest",
  "./manifest-hotel.webmanifest",
  "./manifest-pharmacy.webmanifest",
  "./manifest-restaurant.webmanifest",
  "./manifest-shop.webmanifest",
  "./manifest-transport.webmanifest",
  "./manifest-warehouse.webmanifest",
  "./manifest-wash.webmanifest",
  "./manifest.webmanifest"
];

/*
 * A new version takes over as soon as its files are here, rather than waiting
 * for every window of the app to close, which on a phone may never happen.
 * The page already open keeps running as it is; keepFilesOnPhone in
 * web/phone/main.ts decides when it is reloaded onto the new one.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name.startsWith("ouaqt-phone-") && name !== CACHE).map((name) => caches.delete(name)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  /*
   * Opening the app: the page kept on the phone, whatever follows the
   * address. It is /app/index.html, named in full, because the website sends
   * /app and /app/ there with a redirect, and a redirect is not something a
   * page opened with no network can follow.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((kept) => kept || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (kept) =>
        kept ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
