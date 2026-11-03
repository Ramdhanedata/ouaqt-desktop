/*
 * Builds the phone app and puts it where the website serves it, at /app.
 *
 *   npm run build:phone [folder]
 *
 * The folder defaults to the website checkout beside this one, at
 * public/app. Run it after any change to the screens, as build:web is run
 * for the preview, or phones keep the previous app.
 *
 * After Vite, it writes sw.js: the service worker that keeps every file of
 * the app on the phone, so it opens with no network. Its cache is named
 * after a hash of those files, so a new build is a new cache, and the phone
 * moves to it the next time the app is fully closed and opened again.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "../Website OUQT/public/app");
if (!existsSync(resolve(out, ".."))) {
  console.error(`No folder to build into: ${resolve(out, "..")}`);
  process.exit(1);
}
const vite = process.platform === "win32" ? "npx.cmd" : "npx";
const built = spawnSync(vite, ["vite", "build", "--config", process.env.OUAQT_PHONE_CONFIG ?? "vite.phone.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, OUAQT_PHONE_OUT: out },
});
if (built.status !== 0) process.exit(built.status ?? 1);

/* Every file the build produced, as the page asks for it: relative to /app/. */
function walk(folder) {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(out)
  .map((path) => relative(out, path).split("\\").join("/"))
  .filter((path) => path !== "sw.js")
  .sort();

const hash = createHash("sha256");
for (const file of files) hash.update(file).update(readFileSync(join(out, file)));
const version = hash.digest("hex").slice(0, 12);

const worker = `/*
 * The phone app's service worker, written by scripts/build-phone.mjs in the
 * ouaqt-desktop repository. Do not edit it here: build again.
 *
 * It keeps every file of the app on the phone, so the app opens with no
 * network. It never touches the licence calls (/api/), which must reach the
 * website or fail, and it never stores anything of the shop: the shop's data
 * is in the page's own storage, not in this cache.
 */
const CACHE = "ouaqt-phone-${version}";
const FILES = ${JSON.stringify(["./", ...files.map((file) => `./${file}`)], null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
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

  /* Opening the app: the page kept on the phone, whatever follows the address. */
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("./", { ignoreSearch: true }).then((kept) => kept || fetch(request))
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
`;
writeFileSync(join(out, "sw.js"), worker);
console.log(`\nThe phone app is in ${out} (${files.length} files, cache ${version})\n`);
