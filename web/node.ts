/*
 * The few Node modules the app's main-process code imports, for the web page
 * the builder's preview runs it in.
 *
 * The preview keeps everything in memory and never touches a disk, so the
 * file functions are here only so the modules that import them load: none of
 * them is reached from what the preview does. Were one reached, it says so
 * rather than pretending to have written a file.
 */

const nowhere = (name: string) => () => {
  throw new Error(`${name} has no disk in the preview`);
};

export const readFileSync = nowhere("readFileSync");
export const writeFileSync = nowhere("writeFileSync");
export const copyFileSync = nowhere("copyFileSync");
export const readdirSync = () => [] as string[];
export const mkdirSync = () => undefined;
export const existsSync = () => false;
export const rmSync = () => undefined;
export const statSync = nowhere("statSync");

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function dirname(path: string): string {
  return path.split("/").slice(0, -1).join("/") || "/";
}

export function basename(path: string): string {
  return path.split("/").pop() ?? "";
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export const createHash = nowhere("createHash");

export default { readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync, existsSync, rmSync, statSync, join, dirname, basename, randomUUID, createHash };
