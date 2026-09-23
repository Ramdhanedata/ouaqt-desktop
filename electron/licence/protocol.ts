import { app } from "electron";

/*
 * ouaqt://activate?token=...
 *
 * The link the step 4 page opens once the owner has installed, so that he
 * never types his serial on the PC he built on.
 *
 * The URL carries a one-time token, so it is never logged, never shown and
 * never kept. It is read here, handed to activation, and dropped.
 *
 * Windows: the installer registers the scheme, and the link arrives in argv,
 * on a cold start or as a second instance. macOS: the bundle declares it, the
 * link arrives through open-url, and open-url can fire before the app is
 * ready, so a token that comes early is held until something asks for it.
 */

const SCHEME = "ouaqt";

let waiting: string | null = null;
let deliver: ((token: string) => void) | null = null;

export function tokenFromLink(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== `${SCHEME}:`) return null;
    /* ouaqt://activate?token=... parses with "activate" as the host. */
    if (url.hostname !== "activate" && url.pathname.replace(/^\/+/, "") !== "activate") return null;
    const token = url.searchParams.get("token");
    return token && token.length >= 20 && token.length <= 200 ? token : null;
  } catch {
    return null;
  }
}

function fromArgs(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith(`${SCHEME}://`)) return tokenFromLink(arg);
  }
  return null;
}

function hand(token: string | null) {
  if (!token) return;
  if (deliver) deliver(token);
  else waiting = token;
}

/**
 * Call before app.whenReady. Returns false when another copy of the app is
 * already running, in which case this one hands its link over and quits.
 */
export function claimLinks(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  /*
   * Only an installed app claims the scheme. A development run would
   * otherwise register itself as the handler for every ouaqt:// link on the
   * developer's machine, which is a lasting change to somebody else's system
   * made by running a test. A development run still reads a link passed on
   * its command line, which is enough to test everything after the click.
   */
  if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);

  app.on("open-url", (event, link) => {
    event.preventDefault();
    hand(tokenFromLink(link));
  });

  app.on("second-instance", (_event, argv) => {
    hand(fromArgs(argv));
  });

  hand(fromArgs(process.argv));
  return true;
}

/** Where tokens go once the app is ready for them. One arriving early is delivered now. */
export function onToken(handler: (token: string) => void): void {
  deliver = handler;
  if (waiting) {
    const token = waiting;
    waiting = null;
    handler(token);
  }
}
