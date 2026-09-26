# Where the build is

Read this first if the thread was interrupted. It is the running state of the
"ready-to-download software from the builder" build, which replaces the
milestone plan for how the apps get made. Everything else in the desktop
brief still holds: its non-negotiables, stack, licence rules, printing,
backups, UI rules and tests.

Last updated: 2026-09-23, the pharmacy slice downloadable from step 4.

## The order of work, as of 2026-09-22

Prove the chain first, then fill it in. Not everything built and packaged at
the end.

| Step | What | State |
| --- | --- | --- |
| **1. The vertical slice** | Pharmacy as it stands, with the till working and the other screens saying so, and everything around it: serial activation, one-click activation, the signed licence with trial, grace and read-only, Windows and macOS installers as a GitHub Release, the update system, and the download button at step 4. Marked as a test version in its own window. Pharmacy stays out of `enabled_packs`. | **in progress** |
| 2. The pharmacy screens | Stock, Clients, Caisse, Rapports, Réglages, receipts, backups, custom fields. Each reaches Adel as an update, not a reinstall. | not started |
| 3. A real pharmacist | Somebody uses it for real. Fix what that turns up. | not started |
| 4. The other three | Restaurant, then bakery, then warehouse. | not started |

### Step 1, the slice, where it stands

**Done and proven against the live test project.**

- **Serial activation.** A fresh install, a serial typed, and the owner's own
  shop: configuration, logo, the products from step 3 with their opening
  stock as a movement and their batches kept, his staff, and the shop's id
  written into the database. Walked in the real app, then sold.
- **One-click activation.** The `ouaqt://activate?token=...` link from step 4
  activates a fresh install with nothing typed. Walked in the real app in
  Arabic, then sold. The token is single use, lasts 24 hours from settings,
  is kept only as a hash, and is handed back if the activation fails.
- **The four cases asked for**, plus the edges, in the test client: a phone
  build then a serial, a PC build then one click, an expired token, a token
  used twice, a refused activation giving its link back, a serial and a token
  together, and another shop's serial on a PC that holds a shop already.
- **The licence in the app.** Our signature and this computer checked before
  anything is written; trial, grace, read-only, suspended and the clock rule
  from the shared rules the website uses; read-only enforced where sales are
  written, not only on screen.
- **A test build says so** in a bar on every screen, with the website it
  activates against.
- **Found by walking it, fixed:** a refused link left a blank serial screen;
  a server bug let refused trials take device slots, so an owner refused
  twice and then granted a trial by hand was told his licence was full.

**Also done, 2026-09-23.**

- **Published.** Every push to `main` builds and tests Windows and macOS, and
  publishes them to the public `Ramdhanedata/ouaqt-releases` with a SHA-256
  file per system. The installers have no version in their names, so
  `/releases/latest/download/OUAQT-windows-setup.exe` always means the newest.
- **Updates.** The installed app checks on start, downloads in the background
  and installs when it is next closed. It sends nothing about the shop. On
  macOS this waits for signing; until then a Mac updates from step 4.
- **Step 4.** On the shop PC: "Télécharger et installer" for the system it is
  on, the warning that system shows, then "Ouvrir mon logiciel" with a
  one-time link, and the serial kept smaller as his reference. On a phone:
  the serial and the address of his account page to open on the shop PC.
- **Downloads per trade** live in settings (`installer_url_windows_pharmacy`
  and so on). Pharmacy's point at the latest release. The other three are
  empty and say the software is coming.
- **Found by Adel after publishing, fixed.** 0.1.5 crashed on start on every
  system (the updater's import); 0.1.6 fixed that and gained a launch check.
  0.1.6 then stopped on Intel Macs with "incompatible architecture": both Mac
  installers had been packaged on one Apple-chip machine and the Intel one
  kept the Apple-chip database module, which a launch check on that same
  machine could not see. From 0.1.7 each installer is built on its own kind
  of machine (Windows, Intel Mac, Apple-chip Mac), `check:arch` refuses any
  native module that does not match the app, and the launch check opens the
  packaged app, not the development one. Both checks fail the 0.1.6 Intel
  installer and pass the 0.1.7 one.
- **Pharmacy is out of `enabled_packs`** and in `test_packs`. Owners see it as
  "Bientôt disponible". Adel reaches it through Réglages, "Tester le créateur",
  which opens test mode on that browser for thirty days and is audited.

**Pharmacy screens, 0.1.8, 2026-09-23.** Everything down the side of the
window now works, in French and in Arabic:

- **Vente**, by search as the old till did it: brand, generic (DCI) or Arabic
  name, or a scanned barcode. Cash with change, a mobile app by name, credit
  to a named customer (created on the spot if new), a discount where the
  shop gives them. The receipt prints after each sale if asked.
- **Stock**: out of stock, low, expiring soon and expired on the shelf,
  counted and clickable; the value at cost. Each product's sheet edits its
  fields, lists its batches with their expiry and what is left, receives
  goods (quantity, batch, expiry, cost, supplier), corrects after a count,
  writes off an expired batch, and shows every movement.
- **Clients**: who owes what, largest debt first; a payment in one field;
  every line of the debt with the balance after it; an optional limit.
- **Caisse**: opened with a float; the drawer's expected cash worked out from
  the float, cash sales net of voids and cash paid on debts; counted at
  closing and the difference said in words; past closings.
- **Rapports**: today, yesterday, 7 days, this month, last month; takings,
  count, average, voids, discounts, margin at known cost, by payment and per
  app, best sellers, till differences, owed today; every sale with its
  detail, reprint and void (with the old till's reasons); CSV for Excel.
- **Réglages**: the shop's details (edited on the website), printer, paper
  (58 mm, 80 mm, A4), print after each sale, test print; a daily automatic
  backup kept for two weeks, a backup to a USB key, and a restore that checks
  the copy is sound and this shop's, keeps the current state first, and
  restarts.
- The end-of-trial summary shows in the last days of the trial, from this
  computer's own records.

Proven by `npm run check:db` (every rule above, in the database) and by
`npm run walk:till`, which now sells by search, opens and closes the drawer,
takes a debt payment, receives goods and voids a sale, in both languages,
checking each one in the database.

**Every trade, 0.1.9, 2026-09-23.** Asked for by Adel after the pharmacy
worked: the same working app for restaurant or café, bakery, warehouse,
shop, hotel, transport, and any other business. All of them are in the
builder in test mode only (`test_packs`), none in `enabled_packs`.

- Website: shop, hotel, transport and "any other business" added as trades,
  each with its questions in French, Arabic and English (marked for review),
  sample products, a landing page (marked for review) and a download link.
- App: each trade opens on its own sections (see docs/INVENTORY.md), and
  shares Stock, Clients, Caisse, Rapports and Réglages with the others.
  Money in and out of the drawer that is not a sale (an expense, a
  withdrawal, a deposit, an advance) is in the cash book and in the count.
- Proven by `npm run check:db` (every trade's rules: a table's order paid
  once, a room never booked twice for a night, a seat never sold twice, a
  deposit counted once, a transfer that does not leave the warehouse) and by
  `npm run walk:trades`, which opens each trade's app in French and Arabic,
  photographs every section and does its main job through the screen.

**Questions for Adel from this step.**

- **Expired stock.** A sale never takes from an expired batch while a valid
  one is on the shelf. When the only stock recorded is expired, the sale goes
  through with a warning on the ticket. Should it refuse instead? That is a
  rule about selling medicines, so it is yours.
- **Insurance** is still not carried across from the old till, as before.

**Not done yet.**

- The step 4 account form was not clicked through by me, because it creates an
  account with a password. The new PC and phone screens after it are built and
  type-checked; Adel sees them on his first test.
- The Windows test below, on a real Windows machine.

### What to run on Windows, and what to see

Do this on the Windows PC itself, so step 4 knows it is on Windows.

1. Open `https://ouaqtcom-git-builder-b0-ouaqt.vercel.app/admin` (on the test
   site it opens without signing in), go to **Réglages** and press **Tester le
   créateur**. The
   builder opens with Pharmacie available. Test mode is per browser: do this
   in the browser you will build in.
2. Build a pharmacy. At step 3, import a few products from a spreadsheet if you
   want to see them in the app; otherwise the till says it has none yet.
3. At step 4, create the account. You should see **Votre logiciel est prêt**,
   one big **Télécharger et installer** button, the Windows warning sentence,
   **Ouvrir mon logiciel**, and your serial smaller underneath.
4. Press **Télécharger et installer** and run `OUAQT-windows-setup.exe`.
   Windows shows "Windows protected your PC": press **More info**, then **Run
   anyway**. Install. The app opens on the serial screen, with a black bar:
   "Version de test. À ne pas utiliser pour de vraies ventes."
5. Back in the browser, press **Ouvrir mon logiciel**. The browser asks
   whether to open OUAQT: say yes. **The app activates with nothing typed** and
   shows your pharmacy's name, your products, and "Essai gratuit : 30 jours
   restants".
6. Tap two products and press **Encaisser**. "Vente enregistrée" appears on
   the left, the ticket clears, and the stock on each card goes down.
7. Turn Wi-Fi off, close the app and open it again. It opens straight onto
   the till. Nothing it just did needed the internet.

The serial path: on the account page, or on another PC, install the same file
and type the serial instead of pressing the link. Same result.

If a second test on the same PC is refused ("Nous ne pouvons pas ouvrir
d'essai gratuit sur cet ordinateur"), that is the one-trial-per-machine rule
working. **Essais** in the admin area, "Donner un essai", lets it through.

Not in this version, and saying so rather than pretending: staff sign-in with
a PIN and the Gérant button, insurance payments, PDF export, and two tills
sharing one shop over the network.

### On a Mac

The same steps, with the Mac file step 4 offers for that Mac's processor
(`OUAQT-mac-x64.dmg` on Intel, `OUAQT-mac-arm64.dmg` on Apple chips). Drag
OUAQT into Applications, replacing any older copy. Until the app is notarised,
the first open is refused: right-click OUAQT, **Open**, then **Open** again.
After that it opens normally. A Mac does not update itself yet: a new version
is installed from step 4 the same way.

The nine phases below are still the checklist of what each pack owes. The
table above is the order they are done in.

## The nine phases

| Phase | State |
| --- | --- |
| 1. Inventory | **done** |
| 2. Remove the old clients | **done**, and guarded |
| 3. Everything from the configuration | **part done**: data layer, shell, selling |
| 4. The hybrid layer | not started |
| 5. Activation, licence, trial | website half mostly done, app half not started |
| 6. The daily essentials | not started |
| 7. Package and publish | Windows and macOS workflows build; macOS notarises once the Apple secrets exist; Windows signing ready to switch on |
| 8. Connect the website | not started |
| 9. Test the full chain | not started |

## Done

### Phase 1, inventory

`docs/INVENTORY.md` has the survey. Nothing in `~/Desktop/Projects` was
modified and no file from it was copied here.

The decision: **one app, four packs**, on the core already in this repo.
Pharmacy ports from the old pharmacy till, restaurant from the old
restaurant till, and bakery and warehouse are built on the core. The reasons,
and which project is which, are in the inventory.

### Phase 2, no past client anywhere

Nothing was ever copied in, so this was about making sure nothing can be.
`npm run check:clean` walks the repo and refuses any past client's name in a
file, a path or a line. It holds the names as hashes, because a denylist
spelling them out would be the thing it exists to prevent, and it reports the
file and line without printing the word, because a CI log is no place to put
a name in order to say it must not be there.

It caught the first draft of `docs/INVENTORY.md`, which named three of them.
That draft was rewritten and **its commits were removed from the history**,
which cost nothing because this repo has never been pushed. The inventory now
describes each project by its trade.

It runs as part of `npm test`, so CI runs it on every push.

### Phase 3, what is done and what is not

**Done.**

- The data layer: products with stock as the sum of its movements, sales,
  credit, and voiding. A sale is one transaction, so a power cut leaves the
  database as it was before the cashier pressed the key.
- 21 checks under Electron in `npm run check:db`, driving the real modules
  rather than a copy of their SQL. They cover a quarter kilo at 99,99 landing
  on a whole number of minor units, credit with nobody to owe it being
  refused, and a void restoring the stock and the debt without removing what
  happened.
- The shell reads the configuration and decides the language, the direction,
  the shop name and which sections exist. No Clients section for a shop that
  does not sell on credit.
- The till sells for real. `app-ui`'s sale screen gained an `onCharge`, in
  the website repo where it belongs, so the builder's preview and this app
  stay the same screen. The ticket stays on screen if the sale did not reach
  the disk.

- **The till has been walked in the real app**, in French and in Arabic, with
  invented products in a demo data folder that can never be a shop's. Two of
  one product and one of another, charged, 700,00 MRU recorded, stock down by
  exactly what left. `npm run walk:till` repeats it and leaves the pictures.
- The walk found two layout faults and they are fixed: the shop name
  appeared twice and was cut to "Pharmacie Es..." in the side bar, and the
  "sale recorded" banner covered the header and the Gérant button.
- It also found that a real click on a window opened on a working desktop
  becomes a ticket line. The window now ignores real mouse events during a
  walk, and the walk refuses to charge a ticket it did not build.

**Not done.**

- In Arabic the sale screen's header shows the Latin shop name even when the
  configuration has an Arabic one. That is in the shared screen, so it is
  fixed in the website repo's `app-ui`, next.
- Stock, Clients, Caisse, Rapports and Réglages are honest placeholders. They
  say they are not ready rather than pretending.
- Products only arrive at activation, so the till shows an empty state until
  phase 5 exists. Nothing invented is shown in their place.
- Custom fields, saved views and optional modules (phase 4) are untouched.
- Receipts, printing, backups and the owner PIN (phase 6) are untouched.

### Before this brief

- D0: the Electron shell, the SQLite core with its migrations, the
  configuration loader, and one screen from the shared `app-ui`.
- A GitHub workflow that builds a Windows installer on every push.
- Specs written for D2: the machine fingerprint, the database that must not
  be touched, and the end-of-trial summary. See `docs/MILESTONES.md`.
- On the website: activation returns configuration, products, staff and
  logo in one response; one trial per shop with the fingerprint rules;
  the trial is 30 days; money is integers in minor units everywhere.

## Added mid-build

**Activation without typing on a PC** (2026-09-22). An owner who built on the
shop computer gets a one-time token through `ouaqt://activate?token=...`
instead of typing his serial. The serial stays the licence for everybody:
second device, reinstall, support, offline renewal, and anyone who built on a
phone.

It lands in two places and neither has been built yet:

- **Phase 5**, in this repo: register the scheme on both systems, take the
  single-instance lock, spend the token, and fall back to the serial screen
  on any failure. Details in `docs/MILESTONES.md`.
- **Phase 8**, on the website: make the token at step 4 on a PC, show
  "Télécharger et installer" as the main button with the serial kept smaller
  as his reference, and show "Ouvrir mon logiciel" afterwards. On a phone,
  step 4 is unchanged.

The wire contract is written: `vendor/ouaqt-website/docs/LICENCE_API.md`,
under "Two ways in".

One thing to know before it is built: on **macOS** the URL scheme only
registers once the app has been opened, so step 4 on a Mac has to say "open
it once, then press this". A button that silently does nothing would be worse
than the sentence.

**Expired medicine: warn, never refuse** (2026-09-23, Adel's decision). When
a ticket can only be served from a batch past its date, the till names the
medicine, the batch and the date before charging, and the pharmacist may
sell anyway. The line is then marked `past_expiry`, the log records
`sold_past_expiry`, and Rapports lists those sales for the period. Refusing
outright would only teach him to sell around the software. Checked in
`check:db`; the dialog itself has not yet been seen on a screen by a walk.

**Paying with the serial alone** (2026-09-23). The trial banner now says to
pay on the OUAQT website with the numéro de série: an owner who built from
the phone never has an account, and the website takes the payment with the
number only.

**Insurance payments and staff PIN sign-in** are out of version one, by
Adel's decision. Nothing is stubbed for either.

**The failing builds** (2026-09-23). Run 10 failed three database checks on
Windows, run 13 the same three on the Apple-chip Mac, while the same code
passed elsewhere. A failed check is now also a build annotation, and run 13
named them: all three were the cash drawer. A sale recorded a moment before
the drawer opened, in the same millisecond, counted as inside the session,
because a session takes the sales from its opening time on. The database
now writes every moment on a clock that never repeats a millisecond
(`electron/db/clock.ts`), so before and after always mean what they say.
0.1.12 is the first release with every trade's screens.

**The app asks the website what changed** (2026-09-24). Until now it never
did after activation, so nothing new ever reached an installed shop: not a
trade changed on the website, and not a payment staff had confirmed. It now
asks at start and every three hours, through `/api/licence/refresh`, and
takes the new licence and, when there is one, the new configuration. A
change found at start shows at once; one found later waits for the next
start rather than reloading the screen under a cashier's ticket. Proven
against a local site with the app's own code: pharmacy became restaurant
on the first ask, and the second ask found nothing more.

**The apps and the builder steps, items 1 to 10** (2026-09-24, Adel's brief).

- **Language.** The builder no longer asks it; every app ships with all
  three. The first launch shows three buttons, each in its own language, and
  nothing else. Settings switches it at once and keeps it. Arabic mirrors the
  whole interface and keeps Western digits. The fonts are inside the app.
- **Logo and name** top left on every screen, the name alone and larger when
  there is no logo, the logo on a light chip in dark mode, a click going home.
- **Dark mode** in Settings, on the exact background scale given. Every
  colour is a named token in `src/tokens.css`, the one file the design pass
  changes. Text, accent and warnings were checked at 4.5:1 or better on the
  three backgrounds of both themes.
- **Trial.** The countdown left the top of the screen. Settings says where it
  stands in one line; the last five days bring a notice once a day that
  closes until tomorrow; the end is a screen with the serial to copy, and the
  data stays readable and exportable.
- **Payment methods.** Espèces and Application. The owner keeps his own list
  of apps in Settings (Bankily, Masrvi, SEDAD, BimBank and Click to start),
  in the `payment_apps` table of his database. Removing one keeps its past
  sales. A debt paid through an app says which one too.
- **His own columns** on the stock and customer lists: the app's columns
  renamed, moved or hidden, never deleted; his own typed as text, number,
  date, yes or no, or a list of choices; sorted, filtered, totalled,
  searched, exported and printed in his order, twenty per list at most.
  Definitions in `list_columns`, values in `column_values`, both in the
  database file, so a backup carries them. Deleting one asks him to type its
  name.
- **Structure.** Icons in the navigation, hierarchy in product rows, empty
  states that say what to do. The walk now measures every screen at 1366 by
  768 and fails on a target under 44 pixels or text under 15.

**Adel's three apps, brought into the packs** (2026-09-24, Adel's decision:
"bring their screens in", one app kept). His restaurant, pharmacy and hotel
apps become the look and the way of working of those three packs. Nothing of
the client they were made for comes across: the name and logo are always the
owner's own from the builder, and the old apps' own copy protection, which
held a password in plain text, is not used. Read from copies in a scratch
folder; nothing in `~/Desktop/Projects` is touched.

- **Restaurant and café**, after the restaurant app: one Commandes screen
  with the menu as cards by category, items added and edited on the spot,
  held orders along the bottom, and the order on the right (client or debt
  account with the employee's name, sur place, à emporter or livraison, a
  note per line, the table when there are tables). Paid in cash, by app, or
  both at once. The receipt comes up after each payment. A bar on top gives
  the day's total, the day's history (reopen, cancel, reprint) and the end
  of the day. Debt accounts get the app's profiles: contact, billing period,
  status, invoices for a period, payments. Monthly figures in Rapports.
- **Hotel**, after the hotel app: Today, Bookings, Rooms, Payments, Reports,
  with guests, maintenance and services.
- **Pharmacy**, after the pharmacy app, which the pack already follows: a
  dashboard, the Excel import in Stock, and the audit report.

Done the same day, each walked in French and Arabic:

- Restaurant: the counter replaces the room plan. A bill paid part in cash
  and part by app is kept in its parts (`sale_payments`), and the drawer,
  the reports and a void all read the parts. An order can be reopened from
  the day's history. Accounts take a contact, a billing period and a start,
  with each period's invoice and a status.
- Hotel: the board, filters, new booking from a free room, maintenance
  issues (`maintenance_issues`), a stay extended or moved, and bookings
  listed with whether they are paid.
- Pharmacy: Tableau de bord after Vente; Importer Excel in Stock, read by
  the website builder's own import code through the submodule, with
  SheetJS 0.20.3 from its own site; the journal of actions in Rapports.

### Everything from the website, then a pass for bugs (2026-09-24 and 25)

Everything the owner types on the website reaches the app: the name, both
logos, the team, the product columns (emplacement, vendu par) and the unit.
A change on the website after activation (name, logo, team) arrives at the
next refresh, and a logo removed there is removed here. The website takes
the white box off an uploaded logo before it is saved.

The pass for bugs, over both repositories:

- Website: types, 407 tests, lint over every folder (the builder was not
  linted before; three findings fixed), a full build, the activation and
  every-detail runs end to end, the pages in the browser and on a phone.
- App: types, unused code, `check:db`, `check:clean`, and every trade
  walked in French and Arabic, light and dark, with the size check now
  run on every trade instead of the till alone.
- Fixed: a removed logo stayed in the app; the counter kept payment parts
  larger than a reduced bill, and said "nothing was saved" when an account
  was over its limit; the old sale screen's leftovers still loaded every
  product at start; the bookings list grew without end (it now shows the
  current stays and the last 300).

### The end of the trial, and paying from the phone (2026-09-25)

Adel's brief: a 30-day counter out of sight from the installation, then the
software stops and says so kindly each time it opens, with the serial
number and OUAQT's contact, and a payment that checks out opens it at once.

- The trial (30 days, from the first activation, set on the website) no
  longer shows a notice in its last days. Réglages still says where it
  stands, for an owner who looks.
- At its end the window thanks him, shows his serial number, says how to
  pay from his phone (the website's address, the serial, the app he pays
  with, the screenshot) and has a WhatsApp button to OUAQT, whose number
  now comes with every licence check. It asks the website every 30 seconds,
  and "J'ai payé : vérifier" asks at once; a confirmed payment opens the
  software by itself. His records stay readable, as before.
- On the website, a payment whose screenshot was read and matched on every
  point is confirmed at once, and appears in the admin area to be kept or
  undone. On the free AI tier nothing is read, so a person confirms and the
  software opens as soon as they do.
- A paid licence is reminded of once a day in its last five days and
  through its grace days, which the site's FAQ already promised.
- `OUAQT_DEMO_LICENCE` with `OUAQT_WALK` photographs these screens:
  `expired_trial`, `expired`, `active:3`, `renewal_due`.

### A receipt for every sale, in every trade (2026-09-25)

Every sale's receipt can be seen, downloaded as a PDF and printed: from
Rapports in all eight trades (a "Reçu" button on each line, and "Voir le
reçu" in the sale itself), from the pharmacy's Tableau de bord, from the
till right after a sale, and from the restaurant's counter and history.
What the screen shows is the printed page itself, drawn by the same code as
the printer and the PDF, so the three always agree. The PDF is offered in
Downloads. The till walk opens a receipt from the dashboard and from
Rapports and saves its PDF.

### Each trade's own words and fields (2026-09-25)

Adel's review: every app should hold what its business needs and nothing
else, simply enough for anyone. Pharmacy words had leaked into the others.
Now `src/i18n/products.ts` says, per trade, what a product is called, how
it is searched for, which fields its form has and why a sale is cancelled:

- Restaurant and hotel: a dish or a service has a name, an Arabic name, a
  category and a price. No purchase price, no margin card in Rapports.
- Bakery: no low-stock alert and no stock value for bread made each day;
  its cost is "Coût de fabrication"; Production's quantity column says
  "Fabriqué" instead of a second "Produit".
- Warehouse: articles, with a reference, "Nouvel article", "Quantité en
  stock"; its movements ask for an "Article".
- Shop and general trade: name or barcode, as their answers say.
- Pharmacy only: DCI, lots, expiry counters, "Ordonnance annulée".
- The hotel board shows its type and floor filters only above 12 rooms.
- The trade walks now also photograph each trade's add form.

### Paying from the phone at the end of the trial (2026-09-25)

The end-of-trial window shows the serial number with Copier, then two ways
to pay side by side. On the phone first, since Bankily and the others and
the screenshot are all there: a QR code that opens the payment page with
the serial already in it, three short steps, and the address to type
instead. On this computer second: "Payer sur le site". The window checks
every 15 seconds and opens the software once the payment is confirmed.
The QR code is drawn by `src/qr.ts` (no new dependency), and the licence
walk reads it back with the system's own barcode reader to prove it opens
the right page.

### All eight trades open, and every answer counts (2026-09-25)

On Adel's word that the apps are ready, the website offers all eight
trades to everybody. Each question an owner answers now changes something
in his app, or is no longer asked: a pharmacy's lot numbers show or hide
the lot field; a shop that sells by the piece only has no unit field; a
warehouse's entries ask for the supplier only when it said so, and its unit
hint lists the units it chose. Selling by the strip, a pharmacy's purchases
by supplier and a restaurant's "pay before or after" are no longer asked,
since the apps do the same either way.

### The builder's preview is this app (2026-09-26)

What an owner sees beside the questions is this app itself, not a copy of
it. `npm run build:web` builds the same screens, database modules,
migrations and handlers for a web page (see `web/main.ts`): SQLite runs in
WebAssembly and in memory, Electron is swapped for `web/electron.ts`, and a
printed page shows on screen. The output goes into the website's
`public/app-preview`, and the builder frames it and sends it the
configuration each time an answer changes; a new trade starts a new demo
shop, with a week of invented sales behind it.

**After any change to the screens, run `npm run build:web` and commit the
website's `public/app-preview`,** or the website shows the previous app.

On Adel's word that the preview's designs were better in places, the app
took them, keeping every feature it had: departures beside a seat plan of
the bus; the sale screen's tiles and day figures as on the restaurant's
till; the last seven days as a chart in Reports and on the dashboard; the
day's warehouse movements beside the form.

### A receipt for each trade (2026-09-26)

Each trade prints the receipt its customers need to keep, built from what
the sale settled (`electron/db/receipts.ts`): a table's bill with the
service, the table and the kitchen's notes; a hotel stay with the room, the
dates and the advance taken off; a bus ticket laid out as the boarding pass;
a parcel with its sender and receiver; a bakery's order less its deposit;
a pharmacy's lines with their batch and date; a warehouse's with its units.
Same layout underneath, columns aligned, in all three languages.

### The website as a startup with one product (2026-09-26, website repo)

The home page leads with the Builder as OUAQT's product for small and
medium businesses: a real screen of the app in the hero, the three steps,
and a live demo of this app by trade (the same `public/app-preview` build).
Then features, trades, why OUAQT, the annual price, and custom work as the
second offer. Pricing left the top menu for "Le Builder". Step 4 of the
builder asks Windows or Mac and shows the install, warnings included, in the
space the preview used. "Mon activité n'est pas dans la liste" now reaches
ouaqt.mrt@gmail.com with the phone number.

### It opens by itself, stops at the payment, and wears its trade (2026-09-26)

**Opens by itself.** On its first start the app asks the website whether it
was downloaded from the connection it stands on (`{ nearby: true }`, see the
website's docs/LICENCE_API.md). Pressing the download at step 4 made a
one-time token that keeps a scrambled mark of that connection; when exactly
one shop was downloaded from there for this system in the last six hours,
the app opens straight on it, in the language it was built in, and the trial
starts. Otherwise it asks for the serial as before, and only a real refusal
(the one-trial rule, a full shop, another shop's computer) is explained.
Tested against the local site: the same connection opens the shop, another
connection is refused, a spent token does not work twice, and on this Mac,
which has had trials before, the one-trial rule refused it as it should.

**Stops at the payment.** When the free trial ends the app stays on the
payment window. The owner can save a copy of his data from it. A paid
licence that lapsed still opens the data to read, as the terms say.

**Its trade's icon.** The installer and the app carry the OUAQT tile; once
the app knows its shop it wears its trade's (a croissant for a bakery):
window and taskbar at every opening, and once per trade the Windows desktop
and Start menu shortcuts, or the app in Applications on a Mac. Tested on
this Mac with a local build: Finder shows the croissant and the app still
opens. Drawn by `scripts/make-icons.cjs` into `build/icon.*` and
`build/trade-icons/`.

The preview's demo shop now speaks the preview's language (categories,
units, towns, rooms).

### The launch audit (2026-09-26)

**Website.** Owners could write their own business, product, staff, logo
and payment rows straight from a browser, the launch price included; they
now only read them (0025). Any signed-in session could read the private
settings; not any more. The AI has a daily budget and the builder's AI
route a per-address limit (0026); activation slows down serial guessing.
Next.js 14 carried critical advisories (remote code execution in the image
optimizer with AVIF): now 15.5.26 with React 19, npm audit clean. Security
headers and a content policy on every page, checked with every page loading
clean. The share previews carried the old pitch; redrawn.

**This app.** A production build ignores every OUAQT_ switch (a demo shop
was a till that never asks to be paid) except the pipeline's launch check;
any installed build refuses debugger flags; the window cannot be taken to
another page; the fuses are set (no running as Node, archive integrity
checked). The licence now names the machine each device runs on (0027 on
the website), so a data folder copied onto another computer asks to be
activated there, which counts against the year's device releases.

The website's docs/LAUNCH_CHECKLIST.md lists what only Adel can do before
launch; the first item is production installers with a production key.

## What Adel needs to do

1. **Run the Windows test** above, on the Windows PC, and say what you saw.
2. **Change the Supabase database password** for the builder project, and
   anywhere else you have used the same string. The restaurant till's
   activation code is that string plus the client's name, stored reversible
   in one line of Node and shipped inside the `.exe` and `.dmg` that client
   has. Anyone with either installer can read it.
3. **Insurance at the pharmacy counter.** The old till records insurance
   sales: a policy number, the insurer's share as a percentage, and what the
   patient paid apart. How medicines are sold and recorded is your call, not
   mine. Do owners need it in the first version, and if so, what must be
   recorded?
4. **The GitHub token you pasted in the chat**, if you have not already:
   regenerate it. A token that has been in a conversation is a token somebody
   else could have read.
5. **Before merging the website branch:** apply migrations
   `0024` to `0027` to the production database (I only ever apply
   migrations to the test project). Until the website is merged, installed
   apps simply ask for the serial as before.
6. **Optional, for the leads mail:** if `RESEND_API_KEY` is not set in
   Vercel yet, create a Resend account with ouaqt.mrt@gmail.com and add its
   key there. Without it the visitor's browser sends the mail through
   FormSubmit, as the contact form already does, so nothing is lost.

**Done, 2026-09-23:** the push (it had not landed the first time; it went
through from the Terminal panel), the public `ouaqt-releases` repository, the
`RELEASES_TOKEN` secret, and Vercel Authentication off for previews. The
releases repository was created empty on my instruction, which a release
cannot be made in; the pipeline now gives it a first commit itself.

## Disagreements and open questions

**1. This is not a one-pass job, and the plan should not pretend otherwise.**

"Done means" is four packs, downloadable and installable on two systems, each
activating and showing the owner's own business, with the full chain tested.
That is weeks of work, not a sitting. I am not raising this to renegotiate
the scope, which is the right scope: I am saying the schedule in your head
should have weeks in it, and PROGRESS.md is how you will see where it
actually is rather than where it was promised to be.

The order I am working in, and why: the data layer and the shell first,
because all four packs sit on them and a mistake there is four mistakes;
then activation, because nothing is testable end to end until a serial turns
into a real shop; then pharmacy in full, because it is the pack with a real
project behind it; then the other three, which are mostly question banks and
one screen each.

**2. Unsigned installers will cost you more than a certificate does.**

Phase 7 says unsigned for now and links the warning instructions. That works
for you and me. It will not work well for an owner who, in your own words,
rarely touches a PC.

On Windows, SmartScreen shows a blue full-screen warning with the safe button
hidden behind "More info". On macOS, Gatekeeper refuses the first open
outright and the way through is a right-click and a menu item most people do
not know exists. Every one of those is a WhatsApp message to you, on the day
someone is trying to pay you.

An Apple Developer account is 99 dollars a year and notarisation removes the
macOS problem completely. Windows OV signing is a few hundred a year and
takes the SmartScreen warning away once the certificate builds reputation.
I would rather you spent that than spent the first month of the launch
talking people through security warnings. Your call, and the build works
either way: signing is a configuration change, not a rewrite.

**3. Two-device sync is deferred, as your brief allows.**

It comes after the first release. The schema already carries `device_id` and
a per-device `counter` on every row, which is what sync will need, so
deferring it costs nothing later.
