# The desktop app, for whoever joins next

## What it is

One binary for every client. Every feature of every pack is in it. A
configuration file, produced by the builder on the website, decides which
appear, in which language, with which name and products. Two pharmacies run
the same build with different configurations.

## Where things are

| Path | What |
| --- | --- |
| `electron/main.ts` | The main process: database, configuration, the window |
| `electron/preload.ts` | Everything the screens can reach, in one short file |
| `electron/db/` | Opening the database, migrations, the schema |
| `electron/money.ts` | Integers in minor units, and the boundary with app-ui |
| `src/` | The renderer: screens that are this app's own |
| `vendor/ouaqt-website/app-ui/` | Screens shared with the builder's preview |

## The rules that shape the schema

**Stock is movements, never a stored total.** Sold 2, received 50, adjusted
minus 1: each is a row, and the quantity on hand is their sum. That is what
makes merging two tills safe, and what lets any figure be traced back.

**A row recording an event is never updated in place.** A voided sale is a new
row that reverses it, with a reason and the person who did it. The original
stays, because it happened.

**Money is integers in minor units.** 1 MRU is 100. `electron/money.ts` is the
only place that converts, because app-ui still formats whole ouguiyas.

## Running the database outside Electron

You cannot, directly. `better-sqlite3` is built against Electron's ABI, so:

```bash
ELECTRON_RUN_AS_NODE=1 electron scripts/check-db.mjs
```

## Changing a shared screen

Change it in the website repo, in `app-ui`, then move the submodule forward
here. Never edit `vendor/` in place: the next submodule update throws it away
and the builder's preview shows something the shop never sees.

## Still to come

D1 the core, D2 activation and the licence, D3 pharmacy, D4 backups and
installers, D5 two-device sync, D6 the other three packs.
