import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

/*
 * The machine, in three parts, each hashed on its own.
 *
 * The raw serials never leave this file. They are read, salted, hashed and
 * forgotten: not logged, not stored, not put in an error message. What goes
 * to activation is three hex strings that cannot be turned back into the
 * numbers they came from by anybody who sees them.
 *
 * Honest about the salt: it ships in the app, so it stops casual reversal and
 * is not a secret kept from a determined person. The point of the fingerprint
 * is to notice the same machine twice, not to hide which machine it is from
 * its own owner.
 *
 * Three parts because any one of them can change on a computer that is
 * honestly the same one: a dead disk replaced, a board swapped, a system
 * reinstalled. Two agreeing is the same machine; that rule lives on the
 * server, in settings.
 */

const SALT = "ouaqt-desktop-fingerprint-v1"; // not-a-rule: a label, not a limit

export type Fingerprint = {
  board: string | null;
  disk: string | null;
  machine: string | null;
};

function hash(value: string | null): string | null {
  const clean = value?.trim();
  /* Firmware that reports nothing, or a placeholder, is no part at all. */
  if (!clean || /^(0+|none|default string|to be filled by o\.e\.m\.|system serial number)$/i.test(clean)) {
    return null;
  }
  return createHash("sha256").update(`${SALT}:${clean}`).digest("hex");
}

async function output(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(command, args, { timeout: 8000, windowsHide: true });
    return stdout;
  } catch {
    return "";
  }
}

async function windows(): Promise<Fingerprint> {
  const ps = (query: string) =>
    output("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query]);

  const [board, disk, machine] = await Promise.all([
    ps("(Get-CimInstance Win32_BaseBoard).SerialNumber"),
    ps("(Get-CimInstance Win32_DiskDrive | Where-Object { $_.Index -eq 0 }).SerialNumber"),
    ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid"),
  ]);

  return { board: hash(board), disk: hash(disk), machine: hash(machine) };
}

async function mac(): Promise<Fingerprint> {
  const platform = await output("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const field = (name: string) =>
    platform.match(new RegExp(`"${name}"\\s*=\\s*"([^"]+)"`))?.[1] ?? null;

  const disk = await output("diskutil", ["info", "/"]);
  const volume = disk.match(/Volume UUID:\s*(\S+)/)?.[1] ?? null;

  return {
    board: hash(field("IOPlatformSerialNumber")),
    disk: hash(volume),
    machine: hash(field("IOPlatformUUID")),
  };
}

/** This machine's fingerprint. Any part it cannot read is null, never guessed. */
export async function fingerprint(): Promise<Fingerprint> {
  if (process.platform === "win32") return windows();
  if (process.platform === "darwin") return mac();
  return { board: null, disk: null, machine: null };
}
