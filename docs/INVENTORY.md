# What is in ~/Desktop/Projects, and what we take from it

Read-only survey, 2026-09-21. Nothing in `~/Desktop/Projects` was modified,
and no file from it has been copied into this repository. Where a project is
reused, the logic is re-implemented here against this repo's core; the old
files stay where they are.

**Past clients are not named in this file.** Each project is referred to by
its trade. Adel knows which is which, and a document here that spelled the
names out would be the very thing `npm run check:clean` exists to prevent.

## The projects

| Project | Stack | Storage | Offline | What it is |
| --- | --- | --- | --- | --- |
| The pharmacy till | Electron + Vite + TypeScript + React | better-sqlite3 | yes | A pharmacy counter |
| The restaurant till | Electron + Vite + React (JSX) | **localStorage** | yes | A restaurant and café counter |
| The shop app | Flutter (Dart) | **Supabase, online** | no | An online shop for small businesses |
| The school system | Electron + Vite + TS + React + antd | better-sqlite3 | yes | Roles, terms, grade levels, students |
| The hotel front desk | Electron Forge + Vite, plain JS | better-sqlite3 | yes | Rooms and stays |
| The parcels system | Electron + Vite, plain JS | better-sqlite3 | yes | Parcels and manifests |
| The weighbridge slips | Electron + React + Radix | `data.json` on disk | yes | Slips for a mine |
| A packaged hotel build | built artefacts only | its own `.db` | — | No source present |

### Pharmacy: the pharmacy till

The closest thing to this repo that exists. Same stack, same database
library, same shape.

Screens: checkout, stock, reports, settings, dashboard. Components: a
spreadsheet import wizard, a product form, a receipt modal, a refund modal, a
sidebar and a top bar. Database modules for the schema, products, sales,
staff and an audit log.

Worth taking: the checkout flow, the refund path with its reason codes, the
audit log (every action with an actor, an amount and a reason), the import
wizard, and the receipt layout.

Against our rules: money is stored as a float, stock is a column on the
product rather than a sum of movements, and the shop's name is compiled in.

### Restaurant: the restaurant till

Screens: a menu grid, an order panel, order lines, a checkout bar, a payment
modal, a receipt modal, a held-orders list, order history, an end-of-day
summary, company accounts and a monthly statistics view.

Worth taking: orders held open while a table eats, which is exactly the
behaviour the restaurant pack needs; the end-of-day summary; and company
accounts, which is customer credit under another name.

Against our rules: **everything is in `localStorage`.** A browser store that
a cleanup tool can empty is not where a day's takings belong, so the screens
come across and the storage does not.

### Bakery

No project to start from. The shop app is the nearest by trade and is the
wrong premise twice over: Flutter rather than Electron, and a cloud database
rather than the owner's own machine. It is not converted.

### Warehouse stock

No project, as expected.

### Inventory only, not converted

The school system, the hotel front desk, the parcels system, the weighbridge
slips and the shop app. The school system is the best built of them and is
worth revisiting if an education pack is ever wanted: it already has roles,
permissions, terms and grade levels.

## Client-specific things, per project

Everything below stays in `~/Desktop/Projects`. None of it is reproduced
here, in the code, the assets, the sample data, the tests or the history.

| Project | What is client-specific |
| --- | --- |
| The pharmacy till | A product name in the sidebar, the top bar, the reports, the receipt generator and the database filename. A phone number on the checkout screen. |
| The restaurant till | The business name in the window title, the translations and the main process. A data file holding that restaurant's real menu and prices. |
| The weighbridge slips | A named business throughout. |
| The others | Not examined line by line: none of them is being converted. |

## Real data and credentials found

**None of this has been copied, and none of it may be.**

| Where | What it holds |
| --- | --- |
| The weighbridge project | A working `data.json` and a dated backup of it, both holding a real business's records, plus a small SQLite file |
| The pharmacy till's build folder | A database with 2 products, 21 sales and 2 staff. Small, but they are somebody's sales |
| The packaged hotel build | Its own database |
| The school system | A test database, schema only, every table empty |
| The shop app | A `.env` with **placeholder** values only (`your-project.supabase.co`). Nothing to rotate |
| The restaurant till | An activation code, reversible in one line, shipped inside the client's installers. It is built from a string Adel also used as a database password. See PROGRESS.md |

**Correction, 2026-09-22.** An earlier version of this file said the shop
app's `.env` held live credentials. It does not: both values are
placeholders. The real finding is in the restaurant till, and PROGRESS.md
says what to do about it.

## The hybrid record, per pack

Decided 2026-09-22: the old projects are the foundation, not a quarry. What
works in them is kept. The brief wins on the non-negotiables (offline, money
as integers, stock as movements, right-to-left Arabic, the UI rules), and the
old code wins on how the daily work feels to the owner. Every replacement is
explained here or in PROGRESS.md.

### Pharmacy

**Comes from the old pharmacy till, and is kept.**

| What | How it works there | State here |
| --- | --- | --- |
| Selling by search | Type part of the brand name or the generic name, pick from the results, and the search box clears for the next one. No grid of tiles | **Not yet.** The till uses the shared tile screen. Brought across in the pharmacy screens step, because a shop with three thousand products searches, it does not scroll |
| Two names per product | A commercial name and a generic name, both searchable | **Not yet.** Goes into the product's pack fields |
| Paying by mobile app | Cash, or an app, with the app's name recorded | Kept as `mobile`; the app's name comes with it |
| Discounts | A percentage on the ticket | Kept, where the configuration allows discounts |
| Refunds | A refund modal with reason codes | Kept, as the void path already built: a reversing sale with its reason |
| Audit log | Every action with a person, an amount and a reason | Kept, as `audit_local` |
| Product fields | Unit, category, supplier, barcode, batch, expiry, receipt date, alert threshold | Kept, all of them |
| Import wizard | A spreadsheet import | Superseded by the website's import at step 3, which was built for the messy files owners actually have |
| Receipt layout | The shop's receipt | Kept as the layout reference for printing |

**Changed, because it broke a rule.**

- Money was stored as a float. It is integers in minor units here.
- Stock was a number on the product. It is the sum of movements here, so
  every figure can be explained.
- The shop's name was compiled in. It comes from the configuration.
- Batch and expiry were one pair per product. A pharmacy receives the same
  medicine in several batches with several dates, so they become one row per
  batch received.

**Waiting on Adel.** The old till takes **insurance** payments: a policy
number, the insurer's share as a percentage, and what the patient paid
recorded separately. That is how medicines are sold and recorded, which is a
question for you rather than a design decision. Not carried across until you
say how it should work.

**Added here.** Activation, the licence, the configuration, customer credit
as a ledger, right-to-left Arabic, the shared screens, and everything in the
shared core.

### Restaurant

**Built fresh on the shared core.** The old restaurant till is a reference
for which screens and workflows owners actually used, not a source of code:
it keeps the day's takings in browser storage and carries a disguised
password, and neither habit belongs here.

What it is used for, when the restaurant pack is built: orders held open
while a table eats, the held-orders list, the end-of-day summary, company
accounts (customer credit), and the payment and receipt flow. Recorded here,
item by item, when that work starts.

### Bakery and warehouse

No old project behind either. Both are built on the shared core.

## The decision: one app, four packs

One shared app, as the brief prefers, built on the core already in this repo.

The reasons are practical rather than tidy. All four old Electron projects
already use better-sqlite3 and React, so their screens port without a
rewrite. And converting four projects separately would mean writing
activation, licence checking, configuration, custom fields, backups and
printing four times, then fixing every bug in them four times. One owner's
update would reach one owner.

| Pack | Route |
| --- | --- |
| Pharmacy | Port the pharmacy till's screens and flows onto this core |
| Restaurant | Built fresh on the core, with the old restaurant till as a reference for its workflows only |
| Bakery | Built on the core, reusing the pharmacy sale screen and `app-ui`'s production screen |
| Warehouse | Built on the core, reusing `app-ui`'s stock movements screen |

Porting means reading the old code and writing new code here that does the
same job under this repo's rules: integer money, stock as movements, the
configuration deciding everything, French and Arabic throughout.
