# Assumptions

Dated, with the reason. Kept current.

## 2026-09-21, D0

- **app-ui arrives as a git submodule**, not a published package. The website
  repo is public, so a submodule costs nothing and needs no registry or token
  on any machine or in CI. Publishing to GitHub Packages adds authentication
  to every clone for no benefit until somebody outside works on this. The
  submodule is pinned to `builder-b0` because that is where the pack screens
  live today; it moves to `main` when that branch merges.
- **Money is converted in one place.** This app stores integers in minor units
  as the brief requires. The shared formatter in app-ui still takes whole
  ouguiyas, the way the website stores prices, so `electron/money.ts` converts
  at the boundary. When the website moves to minor units the conversion
  disappears rather than being duplicated.
- **better-sqlite3 is built against Electron's ABI**, by
  `electron-builder install-app-deps` on install. Plain Node cannot then load
  it, so anything touching the database runs under Electron:
  `ELECTRON_RUN_AS_NODE=1 electron script.mjs`. That is also the honest way to
  test it, since it is the build the shop will run.
- **The vendored website's own tests do not run here.** `vitest.config.ts`
  limits the suite to `src` and `electron`. Those tests belong to the website
  repo and run in its CI. app-ui's own tests are worth adding here later,
  because they cover the code this app leans on most.
- **The database file lives in the application data folder**, never on a
  network drive or in a synced folder. Two processes writing one SQLite file
  over SMB is the classic way to lose a database, and a sync client copying a
  file mid-transaction is the other.
- **`synchronous = FULL`**, not the usual `NORMAL`. It costs a few
  milliseconds a sale and it is the difference between "the till was slow for
  a moment" and "yesterday is gone".

## 2026-09-27, health cover for pharmacies

- **A fund's part is kept on the sale, not as a payment part.** `covered`,
  with the fund, the member number and the share, sits on `sales` like
  `prepaid` does: what the customer pays is the total less both, and
  `sale_takings` gains an "insurance" line so the drawer never counts it and
  the reports show it apart. A payment part would have let a split bill mix
  cash, an app and a fund in any order, which no till here does.
- **The fund's part is worked out by the database from the share**, never
  taken from the screen, with the same rounding as app-ui, so the receipt, the
  drawer and the claim cannot disagree by an ouguiya.
- **Each fund's usual share is a setting on this computer**, like the printer,
  set by the manager in Réglages. It changes with the fund's rules, not with
  the owner's answers, so it is not in the configuration. Two computers can
  therefore start from different shares until both are set.
- **A voided sale is left out of the claims**, with its reversal, whatever
  month the void falls in. A claim already sent for it has to be corrected by
  hand with the fund.
- **The till's fund buttons use short names** ("Autre" rather than "Autre
  assurance") so the four sit on one row and the ticket keeps its room on a
  1366x768 screen. Everywhere else the full name is used.
- **The web build here was made with the SheetJS code already in the
  website's committed preview**, because the CDN was out of reach from the
  machine that built it. Same version, same functions; the installers build
  from the real package as always.
