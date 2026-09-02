# Attack timing & breakpoints (reverse-engineered from the game binary)

> Source of truth: disassembly of `libil2cpp.so` (Forge Master **2.8.2**), cross-checked against
> in-game frame measurements and the community BattleSim. This supersedes every earlier
> "windup + recovery, floored separately, +0.2s" approximation — that model is **refuted**.

## The engine

- Combat is a **deterministic 10 Hz simulation** — `PlayerModel.TicksPerSecond = 10`, i.e. **one tick = 0.1s**. (This is the real "frame" for combat; it is *not* the 60fps render rate.)
- The per-tick time delta is `dt = F64.Ratio(1, 10)`, and `F64.Ratio(a,b) = (a<<32) / b` with **integer, truncate-toward-zero** division:
  - `dt_raw = ⌊2³²/10⌋ = 429_496_729` → `dt = 429496729 / 2³² ≈ 0.09999999976s` (just under 0.1s — this matters).
- Each unit has **one continuous `AttackTimer`** (FD6 fixed-point, raw = value × 10⁶). Per tick it advances by
  `inc = dt × attackSpeedMultiplier`, computed as:

  ```
  inc_raw = floor( dt_raw × round(attackSpeedMultiplier × 1e6) / 2³² )     // FD6 raw, truncated
  ```

- The state machine (`AttacksSystem.HandleUnits`): `Idle → WindingUp → OnCooldown`.
  - **Idle**: if a target is in range → go to `WindingUp` (this costs **1 tick**, no timer advance — the "re-acquire" tick).
  - **WindingUp**: `AttackTimer += inc`; when `AttackTimer ≥ WindUpDuration` → **fire**, go to `OnCooldown`. **The timer is NOT reset at the fire.**
  - **OnCooldown**: `AttackTimer += inc`; when `AttackTimer ≥ AttackDuration` → reset to 0, back to `Idle`.
  - On a Double proc: after firing, the timer is re-seeded to `WindUpDuration × 0.75` and it winds up again → the second strike lands after climbing the remaining `0.25 × WindUpDuration`. (`0.75 = 1 − 1/4`; the `1/4` comes from `UnitConstants.DoubleAttackSpeedUp = 4.0`.)

Config facts: **`AttackDuration = 1.5s` for every weapon**; `WindUpTime` varies per weapon in `[0.2, 1.1]s`.

## The formulas (as implemented in `src/utils/constants.ts`)

```ts
SIM_DT_RAW = 429_496_729                       // floor(2^32 / 10)
attackIncRaw(mult)         = floor(SIM_DT_RAW × round(mult × 1e6) / 2^32)
attackIntervalSeconds(m)   = (ceil(1_500_000 / attackIncRaw(m)) + 1) × 0.1     // single attack
doubleDelaySeconds(m, w)   = max(1, ceil(round(w × 1e6) × 0.25 / attackIncRaw(m))) × 0.1
```

- **Single-attack interval is WINDUP-INDEPENDENT.** Because windup and recovery share one continuous timer,
  the interval is `ceil(AttackDuration / inc) + 1` ticks regardless of the weapon's windup. Every weapon/skin
  at the same attack speed has the same single interval. (This is why the old per-windup breakpoint table was
  an *average*, not a real per-weapon effect.)
- **Only the double 2nd-hit delay depends on windup.** That is the one place windup changes timing.
- `doubleCycle = single + doubleDelay`.

## Validation

Reproduces the measured single-interval table exactly (attack-speed **bonus %** → seconds):

| Bonus % | 0 | 50 | 100 | 150 | 200 | 238 | 276 | 401 |
|---|---|---|---|---|---|---|---|---|
| Single (s) | 1.7 | 1.2 | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 | 0.4 |

- The famous "0% → 1.7s" (not 1.5s) is emergent: `dt < 0.1` bumps `ceil(1.5/inc)` to 16, plus the idle re-acquire tick → 17 ticks = 1.7s. There is **no** literal "+0.2s" constant.
- The "1.4s vs 1.5s at 15.4% on two weapons" is **not** a windup effect — it is an attack-speed quantisation boundary (`ceil(1.5/inc)` flips at `inc ≈ 0.11538`, i.e. ~15.39%).
- Double breakpoints match the windup table: a **1.0s-windup** weapon hits a 0.1s double at ~**150%**, a **1.1s** weapon at ~**175%** (`speed ≈ windup × 2.5`).
- Matches the BattleSim (doraemon): "132% → 0.8s single, any weapon", and "Quantum Gun / Infernal Trident double = 1.0s from 100–149.9%, drops at 150%".

## Verified against the 2.8.2 binary (2026-08-29)

Re-derived from `libil2cpp.so` directly, not from the earlier notes. Anyone can repeat these checks:
the offsets below are file offsets into `libil2cpp.so` as extracted from `Forge Master_2.8.2.xapk`
(`split_0.apk` -> `lib/arm64-v8a/libil2cpp.so`, BuildID `a5e45731...`).

**The tick rate is 10, proven twice.**

- Metadata: `public const int TicksPerSecond = 10;` inside the concrete `PlayerModel`
  (`dump.cs:826934`, class `PlayerModel : PlayerModelBase<PlayerModel, PlayerStatistics>`).
- Code: `GetTicksPerSecond()` at RVA `0x76E3304` / offset `0x76DF304` is two instructions,
  `MOV W0, #10` then `RET`.

There is **no literal `0.1` anywhere**. The step is `1/TicksPerSecond` in F64 fixed point, so
`floor(2^32 / 10) = 429496729` and `dt = 429496729 / 2^32 = 0.09999999976s`, just under a tenth.
That truncation is what makes 0% attack speed measure **1.7s** rather than 1.6s, which is the
cheapest field check that separates this model from one using a clean `0.1`.

**The state machine, read from `AttacksSystem.HandleUnits`** (RVA `0x7693690`, offset `0x768F690`).
Field offsets on `UnitEntity`: `AttackDuration` `0x60`, `WindUpDuration` `0x70`, `AttackTimer` `0x80`,
`State` `0x90`. The dispatch on `State` is at `0x7693f0c`.

| address | what it does |
|---|---|
| `0x76941d4` | **Idle**: target in range -> `State = WindingUp`. Timer untouched: this is the re-acquire tick. |
| `0x769400c` | **WindingUp**: timer `+= inc`, store at `0x7694060`, compare against `WindUpDuration` (`0x769405c`). On fire -> `State = OnCooldown` at `0x7694098`. **No timer reset here.** |
| `0x7693f28` | **OnCooldown**: timer `+= inc`, store at `0x7693f7c`, compare against `AttackDuration` (`0x7693f78`). When it passes -> `State = Idle` at `0x7693f94`, then zero is loaded (`0x7693ffc`) and written to the timer at `0x7694268`. |
| `0x76940fc` | **Double proc**: re-seeds the timer from `WindUpDuration` scaled by `UnitConstants.DoubleAttackSpeedUp` (store at `0x76941c8`), then `State = WindingUp`. |

`stp x0, x1, [x27, #0x80]` appears exactly four times in the whole function, at `0x7693f7c`,
`0x7694060`, `0x76941c8` and `0x7694268`. The last one is the **only** zeroing of the timer, and it
happens at the end of a full cycle, never at the fire. That single fact is what makes the single
interval windup-independent: where `WindUpDuration` sits between 0 and `AttackDuration` cannot change
how many ticks it takes to reach `AttackDuration` from zero.

## A refuted alternative: quantising windup and recovery separately

Worth recording so it does not get re-proposed. A user reported a 0.6s band starting just above
**+216.7%**, which our model cannot produce (its 0.6s band starts at +200.1% and runs to +275.1%).
The model `ceil(windup/inc) + ceil((duration-windup)/inc) + 1` **does** put a boundary at exactly
+216.67% for a 0.95s windup, matching that report to the decimal, so it looked convincing.

It is wrong anyway:

- The binary has **one** `ceil`, not two. There is a single continuous timer, and the disassembly
  above shows no reset at the fire, so windup and recovery are never quantised independently.
- It also fails the measured table: 6 of 8 points, missing +276% (predicts 0.6s, measured 0.5s) and
  +401% (predicts 0.5s, measured 0.4s). No windup value among the 36 in `WeaponLibrary.json` reaches
  8 of 8; the best is 6.

The +216.7% report therefore remains **unexplained**. Before changing anything, establish what that
number actually is: attack-speed bonus or total multiplier, read in game or in a third party tool,
and whether the 0.6s is the single interval or the double second-strike delay. The two models differ by a
whole tick at +276% and +401%, so a single in-game measurement at either point settles it.

## Where it lives in the app

- Helpers: `src/utils/constants.ts` (`SIM_DT_RAW`, `attackIncRaw`, `attackIntervalSeconds`, `doubleDelaySeconds`).
- Combat stats: `src/utils/statEngine.ts` sets `realCycleTime`, `realDoubleHitCycle`, `doubleHitDelay`, `realAps` from the helpers; these feed real DPS/HPS.
- Breakpoint UI: `src/components/Profile/BreakpointTables.tsx` (+ `BreakpointExplanation`), shown via `DpsBreakdownModal` and `BreakpointWikiModal`.

## Open item

`ClanWarDamage` / `ClanWarHealth` (war-only combat boosts) carry `ValuePerLevel = 1.0` at `MaxLevel 100`, anomalous vs every other clan multiplier. The Clan page assumes **+1%/level → +100% at max** and flags it for in-game verification.
