# Where the build is

Read this first if the thread was interrupted. It is the running state of the
"ready-to-download software from the builder" build, which replaces the
milestone plan for how the apps get made. Everything else in the desktop
brief still holds: its non-negotiables, stack, licence rules, printing,
backups, UI rules and tests.

Last updated: 2026-09-21, end of phase 1.

## The nine phases

| Phase | State |
| --- | --- |
| 1. Inventory | **done** |
| 2. Remove the old clients | not started |
| 3. Everything from the configuration | not started |
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
2. **Rotate the shop app's cloud keys** if that project is still live. They
   are in a plain `.env` in that project's folder under `~/Desktop/Projects`.
   `docs/INVENTORY.md` says which project without naming anybody.

## Disagreements and open questions

Nothing yet.
