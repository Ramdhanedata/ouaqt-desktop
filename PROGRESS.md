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
