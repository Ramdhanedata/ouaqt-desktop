# Where the build is

Read this first if the thread was interrupted. It is the running state of the
"ready-to-download software from the builder" build, which replaces the
milestone plan for how the apps get made. Everything else in the desktop
brief still holds: its non-negotiables, stack, licence rules, printing,
backups, UI rules and tests.

Last updated: 2026-09-22, during phase 3.

## The nine phases

| Phase | State |
| --- | --- |
| 1. Inventory | **done** |
| 2. Remove the old clients | **done**, and guarded |
| 3. Everything from the configuration | **part done**: data layer, shell, selling |
| 4. The hybrid layer | not started |
| 5. Activation, licence, trial | website half mostly done, app half not started |
| 6. The daily essentials | not started |
| 7. Package and publish | workflow builds Windows already; unsigned |
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

**Not done.**

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

1. **The push is still blocked.** This repo has commits that cannot reach
   `Ramdhanedata/ouaqt-desktop`: the remote answers "Repository not found",
   which is what GitHub says when the stored token cannot see a private repo.
   Either give that keychain token `repo` scope, or add an SSH key, or run
   `git push -u origin main` here yourself.
2. **Change the Supabase database password** for the builder project, and
   anywhere else you have used the same string. The restaurant till's
   activation code is that string plus the client's name, stored reversible
   in one line of Node and shipped inside the `.exe` and `.dmg` that client
   has. Anyone with either installer can read it. (The shop app's `.env`,
   which an earlier note said to rotate, holds placeholders only.)

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
