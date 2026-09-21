# What each milestone owes

D0 is done: the shell, the database, the configuration loader and one screen.
What follows is the agreed scope, written down so that a milestone cannot
quietly lose a decision that was made between them.

D1 the core · D2 activation and the licence · D3 pharmacy end to end ·
D4 backups and installers · D5 two device sync · D6 the other three packs

---

## D2, activation and the licence

The owner types his serial once. The app calls activation, gets back the
licence, the configuration, his products, his staff and two links to his
logo, writes all of it to disk, and is then on its own. Everything after that
works with no network at all.

See `vendor/ouaqt-website/docs/LICENCE_API.md` for the wire contract. It is
the agreement, not a suggestion; if something there is wrong, change it there
first.

### The machine fingerprint

Activation sends a fingerprint so that one computer cannot take one free
trial after another. The website's half of this is built; see
`vendor/ouaqt-website/docs/LICENCE_API.md`.

**What it is made of**, three parts, each hashed on its own:

- the motherboard or BIOS serial
- the system disk serial
- the operating system's own machine id (`MachineGuid` on Windows,
  `IOPlatformUUID` on macOS)

**What is sent.** `sha256(salt + value)` for each part, and nothing else. The
raw serials never leave the machine, are never written to a log, and are
never stored in the local database. The salt ships in the app, so be honest
about what this is: it stops the hashes being reversed by anyone who happens
to see them, and it is not a secret we are keeping from a determined person.

**Why three.** The server calls it the same machine when two of the three
agree. A disk dies and is replaced, a motherboard is swapped under warranty,
a reinstall changes the machine id: any one of those can change on a computer
that is honestly the same one. All three changing is a different computer.
How many must agree is a setting, so it can be loosened without a new build.

**When a part cannot be read.** Send null for that part rather than a made-up
value or an empty hash. An old PC that only yields two parts still works; one
that yields none is refused a trial with `no_fingerprint`, and the app must
say "update the software", never "you were refused".

**When the trial is refused.** `403 trial_not_available` arrives with a
`because` and a WhatsApp number. Show his own words for the reason, show the
button, and stop. A second-hand PC and a repaired PC both land here and both
owners are honest: the screen must read as a door, not as a verdict. Never
the word fraud, never a warning colour, never a countdown.

### A database that is already here

At activation, before starting any trial, look for an existing database on
this PC.

If one is there and it belongs to a different licence, **stop**. Do not start
a trial on top of it, do not migrate it, do not rename it, and do not open it
for writing. Offer two ways out:

- pay for the licence the data belongs to, and keep the data
- talk to us

**Never delete or overwrite it.** Not on activation, not on a failed
activation, not when the owner clicks the wrong thing twice. A shop's year of
sales is the most valuable object on that machine and this is the one code
path that is ever tempted to remove it. If the app cannot proceed, it stops
and says so with the file's location, and somebody helps him.

The check is on the licence the database was created under, which is recorded
in it at first run, not on the file's presence: the same shop reinstalling
its own software must not be stopped by this.

### The end-of-trial summary

Five days before the trial ends, the app shows the owner what his own shop
did with it.

**The figures**, all counted from his own tables:

- how many sales he rang up
- how much credit he is carrying, and for how many customers
- how many evenings the till did not match, and by how much in total

**Where they come from.** SQL over the local database, counting rows rather
than reading them: this runs on a ten year old PC with five thousand products
on it, and the owner is opening the till, not waiting for a report.

**Where they go: nowhere.** They are computed on his machine and stay on it.
No request carries them, no log line carries them, and no field exists in the
licence API that could. This is not a privacy paragraph, it is the whole
premise of the product, and a future version of us adding "just a count" to a
telemetry call would break it.

**When it appears.** When the licence status is `trial` and the end date is
`trialSummaryDays` or fewer away. That number arrives in the licence file, so
it can be changed from the admin settings without a new build. Never derive
it from a constant in this repo.

Once a day, on the first open of the day, and dismissible. After a dismissal
it stays reachable from the licence screen, so an owner who closed it by
accident on a busy morning can find it again.

**What it says.** The figures, plainly, next to the amount to pay and the
Bankily number, the same way the renewal reminder does. No superlatives, no
"vous avez économisé", no invented comparison with what he did before: we do
not know what he did before.

**When there is little to show.** A shop that rang up four sales gets the
four, not a celebration. If a figure is zero, the line says zero or is left
out, and the screen offers help over WhatsApp instead of a boast. An owner
who barely used the trial is better served by someone asking why.

**When it stops.** The moment the licence is no longer a trial, whether he
paid or the trial ran out. It is not shown again on a licence that is active.

**The clock.** The same `clockGraceDays` tolerance as the rest of the licence
logic. A machine whose battery has died must not be told its trial is ending.

**Both languages.** French and Arabic, full right to left, Western digits,
and every amount through the shared money helpers so it reads the way the
receipt does.
