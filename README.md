# gcBuild: gcsim config builder

[Документация на русском](README.ru.md)

A local web app for building and running [gcsim](https://gcsim.app) configs without writing script by hand:

- **Language and modes.** *EN / RU* in the header switches the interface language (defaults to the system
  language). The app starts in a **simple mode** with only the essentials; *Advanced* shows every setting (KQMS
  details and substat rolls, level, logic blocks, gcsim optimizer, all sim options, the raw config). Rarely used
  actions (new / example team, import config, open / export, report a bug) are in the **⋯** menu.
- **Several teams at once (a group).** A strip above the team shows a card per team: members, last sim DPS and a
  ⚠ when a character is used by more than one team (allowed, but flagged; same for artifacts). Click a card to
  edit that team; + adds one, ⧉ copies, ✕ removes. Each team keeps its own rotation, undo history and sim results.
  *Teams → Save the group* stores all of them in one file (plus a gcsim config per team); *Load* replaces the
  open group, *+ as tab* adds the saved teams to it.
- **KQMS builds in one click.** Pick character, weapon and sets, then press *Generate KQMS*. Substats follow the
  KQM Standards used by gcsim's substat optimizer: 5★ main stats, 2 fixed rolls of every substat, and 20 liquid
  rolls capped at 10 per stat minus 2 per matching main stat. Liquid rolls go to ER until the ER target is met,
  then greedily to whatever raises a simple damage proxy most. With *auto*, the sands, goblet and circlet are
  chosen for you. Characters can also use *Custom stats* (exact numbers, e.g. from an imported config).
- **Click-to-build rotations.** Each character gets buttons (E, E hold, Q, N1…N6, CA/Aim, Plunge, Dash, Jump),
  plus Wait/Delay. Actions go into an *Opener* (runs once) or the *Rotation loop* (`while 1` or `for N`), at the
  blinking cursor. Chips and blocks can be dragged anywhere, including into and out of blocks.
- **Conditions and blocks.** Any action can be *only run if…* a condition (HP %, energy, burst ready, cooldown
  left, status / modifier time left, aura on the target, on-field, sim time, previous character, a custom
  expression, …), combined with and/or. *If…* blocks have then/else branches, *Repeat ×N* blocks become `for`
  loops, and *Script* blocks hold raw gcsim script.
- **Import.** Paste or open any gcsim config: builds keep their exact stats, and rotation lines, `if/else` and
  counted `for` loops become editable blocks. Anything else is kept as script, so the config round-trips.
- **Artifacts.** Import a GOOD export (Genshin Optimizer, Inventory Kamera, Irminsul, …) into an artifact
  inventory; only artifacts are read. Switch a team card to *Artifacts* and pick a piece per slot from a
  filterable list (set, main stat, sort by crit value / ER / EM / …; pieces worn by another team member are
  flagged). Stats are exact (main stats from rarity / level, substats as rolled) and set bonuses follow the
  equipped pieces.
- **My builds.** Save a team card (💾) to a personal library in the browser and load it back from the card or
  the *My builds* panel. Saved builds keep their own copy of the artifacts, so re-importing doesn't break them.
- **Target presets.** *gcsim / KQMS default* (a clear particle every 8-12s) or the Miliastra Wonderland
  *DPS Test Dummy++* presets: A12 (1 white orb per 1.5M damage, full energy start), SoF (2M, no energy
  start) and SoD (4M, no energy start). A white orb is modelled as 3 clear particles via
  `particle_threshold` / `particle_drop_count`; gcsim caps target level at 100, so SoF / SoD run at 100.
  Targets with `hp=` put gcsim in damage mode, which ignores `duration`, so the config gets a `time_limit`
  on-tick function that ends each run at the duration (otherwise a burst waiting for energy that never
  comes would hang the sim).
- **Teams folder.** *Teams* saves the current team to `teams/<name>.gcbuild.json` (the project, to load back)
  and `teams/<name>.txt` (the gcsim config), and lists / loads / deletes saved teams.
- **Rotation #.** Conditions can test the loop iteration (`rot`, 0 = first pass), e.g. "skip Hu Tao's burst
  on the first rotation". The generator then emits a `let rot = 0; while … { …; rot = rot + 1; }` loop.
- **Local gcsim.** The *Simulate* panel downloads the gcsim CLI into `tools/` and runs the config:
  - *Run sim*: DPS, per-character share, field time, time spent waiting (energy / cooldowns / swap), reactions,
    damage by source.
  - *Check ER*: runs the rotation 24× with bursts on cooldown (`ignore_burst_energy`) and measures how much ER
    each character needs, the same way gcsim's substat optimizer does. *Fix ER* raises or lowers KQMS ER targets
    and reallocates substats, or adds the missing ER to custom stats.
  - *gcsim substat optimizer*: gcsim's own sim-driven KQMS substats (`-substatOptim`), read back into the builds.
- **Two timelines.**
  - *Estimate* (live while you build): gcsim cancel frames, swap delay / swap cooldown, E/Q cooldowns, and
    hand-curated effect durations. No hitlag, energy or HP.
  - *gcsim sample* (after a sim): one real iteration. Actions with hitlag included, every status and modifier
    with its real duration (e.g. Hu Tao's Paramita extended by hitlag), team buffs, E/Q cooldowns, energy and HP
    curves, every hit coloured by element, element applications and reactions on the enemy, and red hatching
    where gcsim waited because an action wasn't ready.

## Install on a new PC (Windows)

1. Install [Node.js](https://nodejs.org) (LTS). Nothing else is needed (no Python, no Go).
2. Get the project: `git clone https://github.com/mirfeed/gcBuild.git`, or *Code → Download ZIP* on GitHub
   and unpack it.
3. Run `setup.bat` once. It installs the npm packages and downloads the gcsim CLI into `tools/`.
4. Run `start.bat`. It opens http://localhost:5179/ in the browser.

### Updating and where your data lives

Imported artifacts and *My builds* are stored in `userdata/`, saved teams in `teams/` (inside the project
folder). Updating doesn't touch them:

- cloned with git: update with `git pull`;
- downloaded the ZIP: unpack the new version, copy `userdata/` and `teams/` over from the old folder, then run
  `setup.bat`.

The same two folders are what to copy to move your data to another PC.

## Desktop app (Windows)

The builder also ships as a normal program: `gcBuild-Setup-<version>.exe` installs it (no admin rights needed),
adds a desktop shortcut and opens it in its own window. No Node.js, no `setup.bat`, no console window.

- **Data** lives in `%APPDATA%\gcBuild` (`userdata/`, `teams/`, `tools/gcsim.exe`), so reinstalling or updating
  keeps it. ⋯ menu → *Open data folder* shows it.
- **Coming from the start.bat version?** On first launch the app offers to copy artifacts, My builds, teams and
  the downloaded gcsim from the old folder (or later: ⋯ menu → *Import from old folder*). Existing files are
  never overwritten.
- **gcsim** is not bundled (it is AGPL): *Download gcsim* in the Simulate panel fetches it once, as before.
- The installer is not code-signed, so Windows SmartScreen warns on first run: *More info → Run anyway*.
- **Updates** come from GitHub Releases: the app checks on start and every 6 hours, downloads a new version in
  the background and shows *Restart to update* (if you pick *Later*, it installs when you close the app).
  ⋯ menu → *Check for updates* checks right away.

Building it (from the repo, after `npm install`):

```sh
npm run app        # build and start the desktop app from the repo
npm run dist:win   # build the installer into release/gcBuild-Setup-<version>.exe
```

Publishing a new version (the GitHub Actions workflow `.github/workflows/release.yml` builds it):

```sh
npm version 0.2.0          # bumps package.json, commits and tags v0.2.0
git push --follow-tags     # the workflow builds the installer and attaches it to a draft release
```

Then open *Releases* on GitHub, describe the changes and press *Publish release*: installed apps pick it up
within a few hours (or at the next start). Drafts are invisible to the apps, so nothing ships until you publish.
Publishing also posts the release to the Discord #releases channel (`.github/workflows/announce.yml`).

**Closed beta.** A version with a suffix (`npm version 0.2.0-beta.1`, then `git push --follow-tags`) is not
published on GitHub: the workflow uploads it to the closed beta feed (gcB-Bot on gcbuild.duckdns.org), and the bot
announces it in the Discord #beta channel. Beta testers get a personal key with `/beta-key` in Discord and turn on
*⋯ → Beta versions…* in the app; turning it off goes back to the latest stable. Stable releases are copied to the
feed too, so testers get them when they are newer than the last beta. Needs the repository secrets
`BETA_UPLOAD_TOKEN` and `DISCORD_RELEASES_WEBHOOK`.
`npm run release:win` does the same from your PC (needs `GH_TOKEN`, e.g. `GH_TOKEN=$(gh auth token)`).
`GCBUILD_UPDATE_URL=<url>` makes the app read updates from a plain HTTP folder (`latest.yml` + installer) to test
an update without publishing.

**Duels.** ⚔ *Duels* in the header: two players get the same squad and conditions and compete for DPS with
their own artifacts and rotation. *Create code* turns the open team (characters, levels, constellations, talents,
weapons) plus the mode and fight duration into a short code (`GD-…`); `/duel code:<code>` in the gcBuild Discord
posts the challenge. Once accepted, the bot gives each player a personal key (🔑 under the challenge); *Join a
duel* with it opens the duel as a locked team tab: only artifacts and the rotation can change, sim settings are
fixed (DPS dummy, 5000 iterations, the latest gcsim). Both have 15 minutes to submit. *Base* mode allows any
number of test sims, *Blind* none: the one final sim is the result. Everything is simulated locally: after both
submitted, each app re-runs the opponent's config (the rotation never reaches the page or any file, only the DPS
goes back) and the bot only compares the numbers. The allowed gap is 4 standard errors of the re-run, at least
0.3%; a larger one voids the duel. The final DPS is the average of both runs; the result card in Discord shows
both builds but not the rotations. `GCBUILD_DUEL_URL` points the app at another duel server.

How it works: `electron/main.ts` runs the same local API as the dev server (`server/*.ts`) on a random
127.0.0.1 port guarded by a per-launch token; the window loads `app://gcbuild/`, which is proxied to it, so the
origin (and the browser storage tied to it) never changes and no fixed port can be taken. Links open in the
system browser. `GCBUILD_DATA=<folder>` points the app at another data folder (handy for testing).

## Reporting a bug

*Report a bug* in the header opens a new GitHub issue with the app version, gcsim version, browser and the
current team's config filled in; add what you clicked and what you expected. If the app crashes, the
*Something broke* page has *Report on GitHub* (with the error included) and *Copy report* for sending it
another way. Without a GitHub account, send the *Export* file with a description.

## Run

```sh
npm install
npm run setup:gcsim  # download the gcsim CLI into tools/
npm run dev          # http://localhost:5179 (includes the local gcsim bridge)
npm run preview      # serves the production build, also with the gcsim bridge
```

The gcsim bridge (`server/gcsim.ts`) runs inside the Vite dev / preview server, so simulating needs one of
those two commands; a plain static host can build configs but not run them. The project autosaves to
`localStorage`; *Export* / *Open* save and load a project as JSON (*Open* also accepts a config `.txt`).

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`4` | pick character |
| `E` / `Shift+E` | skill / hold skill |
| `Q` | burst |
| `A` | normal attack (press again for N2, N3…) |
| `C` | charged attack (aim for bows) |
| `P` / `D` / `J` | plunge / dash / jump |
| `W` | wait (frames from the Timing box) |
| `←` `→` | move the insertion cursor |
| `Backspace` / `Delete` | remove the selected item (or the one before the cursor) |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `Ctrl+Enter` | run the sim |

## Data

`src/data/gcsim.json` is generated from a gcsim checkout. It contains characters, weapons, sets (with their
aliases), base stats, cooldowns, action params, frame tables and skill/burst status durations:

```sh
git clone --depth 1 https://github.com/genshinsim/gcsim ../gcsim
npm run extract                       # needs Python with PyYAML
npm run smoke                         # example config + estimate, to sanity-check the data
npm run import-check -- config.txt    # import a config and print it regenerated
```

Character, weapon and artifact icons are loaded at runtime from gcsim's public asset API
(`https://gcsim.app/api/assets`, see `src/data/icons.ts`), so they need an internet connection.

`src/data/curated.ts` holds hand-written timing data for the estimate: effect durations, team buffs,
weapon/set effects, cooldown overrides and KQMS presets per character. Characters without an entry fall back to
statuses extracted from gcsim.

## Limits

- The *Estimate* timeline is a planning aid: no hitlag, attack speed, energy or HP, and reaction-triggered set
  effects (VV, Instructor, Deepwood, …) are assumed to fire on the holder's E/Q. Conditions it can't evaluate
  (HP, statuses, auras) use the "estimate assumes" value. The *gcsim sample* timeline shows what really happened.
- The quick KQMS allocator is a heuristic. *Check ER* + *gcsim substat optimizer* give sim-driven results.
- The importer maps common script to blocks; functions, `switch`, `while` with conditions etc. stay as raw script.
