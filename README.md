# gcBuild: gcsim config builder

A local web app for building and running [gcsim](https://gcsim.app) configs without writing script by hand:

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

## Run

```sh
npm install
npm run dev        # http://localhost:5173 (includes the local gcsim bridge)
npm run preview    # serves the production build, also with the gcsim bridge
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
