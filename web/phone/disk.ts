/*
 * The phone's disk: the few Node file functions the app's main-process code
 * uses, kept in the browser's own database (IndexedDB) so they are still
 * there when the phone is switched off and on again.
 *
 * The desktop app keeps a shop in a folder: its database, its configuration,
 * its licence and its device token. The phone app keeps the same files under
 * /shop, written through this module, so electron/licence/*, the database
 * modules and the backup code run on the phone exactly as written.
 *
 * Everything is read into memory once, at start (loadDisk), because the code
 * above it is synchronous, as Node's file functions are. A write changes the
 * memory at once and reaches IndexedDB a moment later; flushDisk waits for
 * every write to land and runs when the page is hidden.
 *
 * Three places are not kept: /downloads, where a file written is handed to
 * the phone as a download (a backup, a list as a spreadsheet); /uploads,
 * where a file the owner picks arrives; and /tmp. They live as long as the
 * page does.
 */

const DATABASE = "ouaqt-phone";
const STORE = "files";
export const SHOP_FOLDER = "/shop";
export const DOWNLOADS = "/downloads";
export const UPLOADS = "/uploads";

const files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>();
const folders = new Set<string>(["/", SHOP_FOLDER, DOWNLOADS, UPLOADS, "/tmp"]);
const pending = new Set<Promise<unknown>>();
let idb: IDBDatabase | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function kept(path: string): boolean {
  return path === SHOP_FOLDER || path.startsWith(`${SHOP_FOLDER}/`);
}

function request<T>(make: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error("the phone's storage is not open"));
    const transaction = idb.transaction(STORE, mode);
    const asked = make(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(asked.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function track(promise: Promise<unknown>) {
  const done = promise.catch((error) => console.error("the phone could not save a file", error));
  pending.add(done);
  void done.finally(() => pending.delete(done));
}

/** Opens the phone's storage and reads every kept file into memory. Run once, before anything else. */
export async function loadDisk(): Promise<void> {
  idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const [keys, values] = await Promise.all([
    request((store) => store.getAllKeys(), "readonly"),
    request((store) => store.getAll(), "readonly"),
  ]);
  keys.forEach((key, index) => {
    const value = values[index] as { bytes: Uint8Array; mtimeMs: number } | Uint8Array;
    const entry = value instanceof Uint8Array ? { bytes: value, mtimeMs: Date.now() } : value;
    files.set(String(key), entry);
    rememberFolders(String(key));
  });
  /* Ask the phone not to clear this site's storage when it runs short of space. Some phones say no; nothing else changes. */
  void navigator.storage?.persist?.().catch(() => false);
}

/** Waits for every write to reach the phone's storage. */
export async function flushDisk(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

/** Whether the phone agreed to keep this site's storage even when space runs short. */
export async function storageIsKept(): Promise<boolean> {
  return (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
}

/* ── node:path ─────────────────────────────────────────────────────── */

function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of String(path).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function join(...parts: string[]): string {
  return normalise(parts.filter(Boolean).join("/"));
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function dirname(path: string): string {
  const clean = normalise(path);
  return clean.split("/").slice(0, -1).join("/") || "/";
}

export function basename(path: string, extension?: string): string {
  const name = normalise(path).split("/").pop() ?? "";
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export const sep = "/";

/* ── node:fs ───────────────────────────────────────────────────────── */

function rememberFolders(path: string) {
  let folder = dirname(path);
  while (!folders.has(folder)) {
    folders.add(folder);
    folder = dirname(folder);
  }
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: "ENOENT" });
}

type Encoding = BufferEncoding | { encoding?: BufferEncoding | null; mode?: number } | null | undefined;
type BufferEncoding = "utf8" | "utf-8" | "base64";

function encodingOf(options: Encoding): BufferEncoding | null {
  if (!options) return null;
  if (typeof options === "string") return options;
  return options.encoding ?? null;
}

export function readFileSync(path: string, options?: Encoding): string | Uint8Array {
  const file = files.get(normalise(path));
  if (!file) throw missing(path);
  const encoding = encodingOf(options);
  if (encoding === "utf8" || encoding === "utf-8") return decoder.decode(file.bytes);
  return asBuffer(file.bytes);
}

export function writeFileSync(path: string, data: string | Uint8Array | ArrayBuffer, _options?: Encoding): void {
  const clean = normalise(path);
  const bytes = typeof data === "string" ? encoder.encode(data) : data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);
  const entry = { bytes, mtimeMs: Date.now() };
  files.set(clean, entry);
  rememberFolders(clean);
  if (kept(clean) && idb) track(request((store) => store.put(entry, clean), "readwrite"));
  if (clean.startsWith(`${DOWNLOADS}/`)) hand(clean, bytes);
}

export function existsSync(path: string): boolean {
  const clean = normalise(path);
  return files.has(clean) || folders.has(clean);
}

export function mkdirSync(path: string, _options?: unknown): void {
  const clean = normalise(path);
  folders.add(clean);
  rememberFolders(`${clean}/x`);
}

export function readdirSync(path: string): string[] {
  const prefix = `${normalise(path)}/`.replace(/^\/\/$/, "/");
  const names = new Set<string>();
  for (const name of [...files.keys(), ...folders]) {
    if (name.startsWith(prefix) && name !== prefix) names.add(name.slice(prefix.length).split("/")[0]);
  }
  return [...names].filter(Boolean).sort();
}

export function unlinkSync(path: string): void {
  const clean = normalise(path);
  if (!files.delete(clean)) throw missing(path);
  if (kept(clean) && idb) track(request((store) => store.delete(clean), "readwrite"));
}

export function rmSync(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
  const clean = normalise(path);
  if (files.has(clean)) return unlinkSync(clean);
  if (!folders.has(clean)) {
    if (options.force) return;
    throw missing(path);
  }
  for (const name of [...files.keys()]) if (name.startsWith(`${clean}/`)) unlinkSync(name);
  for (const folder of [...folders]) if (folder === clean || folder.startsWith(`${clean}/`)) folders.delete(folder);
}

export function copyFileSync(from: string, to: string): void {
  const file = files.get(normalise(from));
  if (!file) throw missing(from);
  writeFileSync(to, file.bytes);
}

export function renameSync(from: string, to: string): void {
  copyFileSync(from, to);
  unlinkSync(from);
}

export function statSync(path: string) {
  const clean = normalise(path);
  const file = files.get(clean);
  if (!file && !folders.has(clean)) throw missing(path);
  const mtimeMs = file?.mtimeMs ?? Date.now();
  return {
    size: file?.bytes.byteLength ?? 0,
    mtimeMs,
    mtime: new Date(mtimeMs),
    isFile: () => Boolean(file),
    isDirectory: () => !file,
  };
}

export function chmodSync(): void {
  /* A phone has one user. */
}

/* ── Files leaving and arriving ────────────────────────────────────── */

const MIME: Record<string, string> = {
  ".csv": "text/csv;charset=utf-8",
  ".pdf": "application/pdf",
  ".db": "application/octet-stream",
  ".html": "text/html;charset=utf-8",
};

/* A file written to /downloads is given to the phone, which saves it or offers to share it. */
function hand(path: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: MIME[extname(path)] ?? "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = basename(path);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000); // not-a-rule: long enough for the phone to take the file
}

/** Where a file the owner chose to save goes: straight to the phone's downloads. */
export function downloadPath(defaultPath: string | undefined, fallback: string): string {
  return join(DOWNLOADS, basename(defaultPath || fallback));
}

/** The phone's own file picker. The file chosen lands in /uploads and its path is returned. */
export function pickFile(extensions: string[]): Promise<string | null> {
  return new Promise((done) => {
    const input = document.createElement("input");
    input.type = "file";
    if (extensions.length) input.accept = extensions.map((one) => `.${one}`).join(",");
    input.style.display = "none";
    let settled = false;
    const finish = (path: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      done(path);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      void file.arrayBuffer().then((buffer) => {
        const path = join(UPLOADS, file.name || "copie.db");
        writeFileSync(path, new Uint8Array(buffer));
        finish(path);
      });
    });
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/* ── node:crypto ───────────────────────────────────────────────────── */

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function createHash(): never {
  throw new Error("createHash is not used on the phone");
}

/* ── Buffer, as far as the licence code uses it ────────────────────── */

function asBuffer(bytes: Uint8Array): Uint8Array {
  const Shim = (globalThis as { Buffer?: { from(value: Uint8Array): Uint8Array } }).Buffer;
  return Shim ? Shim.from(bytes) : bytes;
}

export default {
  join,
  resolve,
  dirname,
  basename,
  extname,
  sep,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  rmSync,
  copyFileSync,
  renameSync,
  statSync,
  chmodSync,
  randomUUID,
  createHash,
};
