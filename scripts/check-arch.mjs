/*
 * Is every native part of a packaged app built for the same processor as the
 * app itself?
 *
 *   node scripts/check-arch.mjs [release/mac/OUAQT.app ...]
 *
 * With no argument it checks every app electron-builder left in release/.
 *
 * The Intel Mac installer of 0.1.6 ran on Intel but carried a database module
 * built for Apple's own chips, so it stopped at the first screen with
 * "incompatible architecture". Both Mac versions had been packaged on one
 * Apple machine, and the launch check ran on that machine only, where the
 * wrong module happened to be the right one. This reads the headers of the
 * files themselves, so it needs neither the matching machine nor any tool
 * the system may lack.
 */
import { existsSync, openSync, readdirSync, readSync, closeSync, statSync } from "node:fs";
import { join } from "node:path";

/* Mach-O (macOS) and PE (Windows) headers, reduced to a processor name. */
const MACH_CPU = { 0x01000007: "x64", 0x0100000c: "arm64", 7: "ia32" };
const PE_MACHINE = { 0x8664: "x64", 0xaa64: "arm64", 0x014c: "ia32" };

function head(file, length) {
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    const read = readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** The processors a binary runs on, or null when it is not a binary. */
export function archsOf(file) {
  const bytes = head(file, 4096);
  if (bytes.length < 8) return null;
  const magicBE = bytes.readUInt32BE(0);
  const magicLE = bytes.readUInt32LE(0);

  /* A universal Mac binary lists each slice it holds. */
  if (magicBE === 0xcafebabe || magicBE === 0xcafebabf) {
    const count = bytes.readUInt32BE(4);
    const entry = magicBE === 0xcafebabf ? 32 : 20;
    const archs = [];
    for (let i = 0; i < count && 8 + i * entry + 4 <= bytes.length; i++) {
      archs.push(MACH_CPU[bytes.readUInt32BE(8 + i * entry)] ?? "unknown");
    }
    return archs;
  }
  if (magicLE === 0xfeedfacf || magicLE === 0xfeedface) {
    return [MACH_CPU[bytes.readUInt32LE(4)] ?? "unknown"];
  }
  if (bytes[0] === 0x4d && bytes[1] === 0x5a && bytes.length >= 0x40) {
    const pe = bytes.readUInt32LE(0x3c);
    if (pe + 6 <= bytes.length && bytes.readUInt32LE(pe) === 0x00004550) {
      return [PE_MACHINE[bytes.readUInt16LE(pe + 4)] ?? "unknown"];
    }
  }
  return null;
}

function nativeParts(folder) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name.endsWith(".node")) found.push(path);
    }
  };
  if (existsSync(folder)) walk(folder);
  return found;
}

/** Where the app's own executable and its unpacked modules are. */
function layoutOf(app) {
  if (app.endsWith(".app")) {
    return {
      executable: join(app, "Contents", "MacOS", "OUAQT"),
      unpacked: join(app, "Contents", "Resources", "app.asar.unpacked"),
    };
  }
  return { executable: join(app, "OUAQT.exe"), unpacked: join(app, "resources", "app.asar.unpacked") };
}

export function checkApp(app) {
  const { executable, unpacked } = layoutOf(app);
  const want = archsOf(executable);
  if (!want) return [`${executable}: not found or not a program`];
  const parts = nativeParts(unpacked);
  if (parts.length === 0) return [`${app}: no native module found, the database cannot open`];
  const wrong = [];
  for (const part of parts) {
    const has = archsOf(part) ?? [];
    const missing = want.filter((arch) => !has.includes(arch));
    if (missing.length > 0) {
      wrong.push(`${part}: built for ${has.join("+") || "nothing"}, the app runs on ${want.join("+")}`);
    }
  }
  return wrong;
}

function packagedApps() {
  const release = "release";
  if (!existsSync(release)) return [];
  const apps = [];
  for (const name of readdirSync(release)) {
    const dir = join(release, name);
    if (!statSync(dir).isDirectory()) continue;
    if (name.endsWith("-unpacked")) apps.push(dir);
    else if (existsSync(join(dir, "OUAQT.app"))) apps.push(join(dir, "OUAQT.app"));
  }
  return apps;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-arch.mjs")) {
  const apps = process.argv.slice(2).length > 0 ? process.argv.slice(2) : packagedApps();
  if (apps.length === 0) {
    console.error("No packaged app to check in release/.");
    process.exit(1);
  }
  let failed = false;
  for (const app of apps) {
    const problems = checkApp(app);
    const { executable } = layoutOf(app);
    if (problems.length > 0) {
      failed = true;
      console.error(`${app}: WRONG`);
      for (const problem of problems) console.error(`  ${problem}`);
    } else {
      console.log(`${app}: ${archsOf(executable).join("+")}, every native module matches`);
    }
  }
  process.exit(failed ? 1 : 0);
}
