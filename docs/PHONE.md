# The phone app

The shop's software on an Android phone or an iPhone, with no store app. The
owner opens a link once, adds it to his home screen, and from then on it opens
from its own icon and works with no internet, like the PC version.

It is this app. The screens in `src/`, the database modules and migrations in
`electron/db`, the handlers in `electron/ipc.ts` and `ipc-trades.ts` and the
licence code in `electron/licence` all run on the phone unchanged. Only what
sits underneath differs, in `web/phone/`.

## How it is built

```bash
npm run build:phone [folder]   # defaults to ../Website OUQT/public/app
```

Then commit `public/app` in the website. The website serves it at `/app`.
Run it after any change to the screens, as `build:web` is run for the
builder's preview, or phones keep the previous version.

The build writes `sw.js`, the service worker that keeps every file on the
phone. Its cache is named after a hash of the files, so a new build is a new
cache. A phone moves to it the next time the app is fully closed and opened
again.

## What is different underneath

| On a PC | On a phone | Where |
| --- | --- | --- |
| SQLite in a file (better-sqlite3) | SQLite in WebAssembly, the whole file saved to the phone's storage a moment after each change and when the app is put away | `web/sqlite.ts`, `web/phone/main.ts` |
| The shop's folder on disk | The same files under `/shop`, kept in IndexedDB | `web/phone/disk.ts` |
| Motherboard, disk and system ids | One random id made the first time, hashed the same way | `web/phone/fingerprint.ts` |
| Save and open dialogs | A download, and the phone's file picker | `web/phone/disk.ts` |
| The receipt printer, and PDFs | The page opens over the screen with "Imprimer ou partager", which on a phone also saves a PDF or sends it on WhatsApp | `web/phone/paper.ts` |
| `platform: "windows" \| "mac"` at activation | `"phone"` | `web/phone/main.ts` |

A phone is one more device of the shop, activated with the shop's serial like
a second PC, and it counts against the licence's device limit. It keeps its
own data: sync between devices is D5 and will cover phones too.

Which licence key it trusts is decided by the address it is served from
(`web/phone/env.ts`): the live site's hosts trust the production key,
anything else the test project's.

## Opening on a shop

- **The website's link** `…/app/#serial=XXXXXXXX` activates by itself. The
  part after `#` never reaches a server and is taken off the address at once.
- **Typed**, on the serial screen, as on a PC.

## The layout on a phone

Below 768 pixels wide (`useNarrow` in `src/ui.tsx`, and `max-md:` in the
classes) the app lays itself out for a thumb. The desktop at 1366x768 never
reaches that width, so nothing changes there.

- The sections move to a bar along the bottom: five at most (rule 3), the
  first four and **Plus** when a shop has more. Their words are 13px, the one
  place under rule 4's 16px, because five share a phone's width; each still
  has its picture.
- Two panes side by side become one at a time. The till shows its products,
  with a bar at the bottom carrying the ticket's count and total; the ticket
  comes up over them when pressed. The restaurant's order does the same, and
  a transport departure opens over the day's list.
- Figures in rows of three to five become two columns. Wide tables keep
  their columns and scroll sideways. Rows of choices scroll sideways too.
- No field pulls the keyboard up by itself.

## Known limits

- A phone cannot reach the shop's receipt printer. Receipts open on screen and
  go through the phone's print sheet.
- The automatic daily copies the PC keeps are not made on a phone, because each
  would be a full copy in its storage. **Réglages → Copie** still saves one to
  the phone's downloads, and a copy can be restored from there.
- The database is saved whole after each change. That is quick for one shop's
  data; a shop with years of sales on one phone will want a page-level store
  later, and nothing above `web/sqlite.ts` would notice the change.
- Clearing the browser's data for the site removes the shop from that phone,
  as deleting the app's folder would on a PC. The app asks the phone to keep
  its storage (`navigator.storage.persist`); some phones decline.
