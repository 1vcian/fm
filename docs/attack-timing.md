# Attack timing & breakpoints (reverse-engineered from the game binary)

> Source of truth: disassembly of `libil2cpp.so`, build **2026_10_08_09_03** (RVAs from
> `reverseForge/Il2CppDumper-net8-macos-x64-v6.7.46/dump.cs`), first derived on **2.8.2** (history
> below), cross-checked against in-game frame measurements and the tick-accurate engine in
> `src/engine`. This supersedes every earlier "windup + recovery, floored separately, +0.2s"
> approximation: that model is **refuted**.

## The engine

- Combat is a **deterministic 10 Hz simulation**: `PlayerModel.TicksPerSecond = 10`, i.e. **one tick = 0.1s**. (This is the real "frame" for combat; it is *not* the 60fps render rate.)
- The per-tick time delta is `dt = F64.Ratio(1, 10)`, and `F64.Ratio(a,b) = (a<<32) / b` with **integer, truncate-toward-zero** division:
  - `dt_raw = floor(2^32/10) = 429_496_729`, so `dt = 429496729 / 2^32 = 0.09999999976s` (just under 0.1s; this matters).
- Each unit has **one continuous `AttackTimer`** (FD6 fixed-point, raw = value x 10^6). Per tick it advances by
  `inc = dt x attackSpeedMultiplier`, computed as:

  ```
  inc_raw = floor( dt_raw x round(attackSpeedMultiplier x 1e6) / 2^32 )     // FD6 raw, truncated
  ```

- The state machine (`AttacksSystem.HandleUnits`): `Idle -> WindingUp -> OnCooldown`.
  - **Idle**: if a target is in range, go to `WindingUp` (this costs **1 tick**, no timer advance: the "re-acquire" tick).
  - **WindingUp**: `AttackTimer += inc`; when `AttackTimer >= WindUpDuration`, **fire** and go to `OnCooldown`. **The timer is NOT reset at the fire.**
  - **OnCooldown**: `AttackTimer += inc`; when `AttackTimer >= AttackDuration`, reset to 0 and go back to `Idle`.
  - **Double proc** (rolled after every main strike, consumed even when it cannot proc): the timer is
    **overwritten** with `FD6(WindUpDuration) x (1 - 1/DoubleAttackSpeedUp) = floor(0.75 x W)` (an absolute
    store, not an add: the overshoot past the windup at the first fire is **lost**) and the unit winds up
    again. The second strike fires when the timer is back at `W`, then the timer runs on to `AttackDuration`
    as usual. A second strike cannot proc again.

Config facts: **`AttackDuration = 1.5s` for every weapon**; `WindUpTime` varies per weapon in `[0.2, 1.1]s`.

## The formulas (as implemented in `src/utils/constants.ts`)

```ts
SIM_DT_RAW = 429_496_729                                   // floor(2^32 / 10)
inc  = attackIncRaw(mult) = floor(SIM_DT_RAW x round(mult x 1e6) / 2^32)
W    = round(windup x 1e6),  D = round(AttackDuration x 1e6)
attackCycleTicks(m)        = ceil(D / inc) + 1                                  // single
doubleCycleTicks(m, w)     = ceil(W / inc) + ceil((D - floor(0.75 W)) / inc) + 1 // both strikes
doubleSecondStrikeSeconds  = ceil((W - floor(0.75 W)) / inc) x 0.1              // gap between the strikes
weaponHitsPerSecond(m,w,d) = (1 + d) / ((1 - d) x single + d x double)          // seconds = ticks x 0.1
```

(every `ceil` is at least 1: a phase always costs a tick.)

- **Single-attack interval is WINDUP-INDEPENDENT.** Because windup and recovery share one continuous timer,
  the interval is `ceil(AttackDuration / inc) + 1` ticks regardless of the weapon's windup. Every weapon/skin
  at the same attack speed has the same single interval.
- **Only the double cycle depends on windup.** That is the one place windup changes timing.
- **The double cycle is NOT `single + gap`.** The rule used until 2026-10-13 (`doubleCycle = single +
  ceil(0.25 W / inc)`) kept the windup overshoot; the game throws it away at the re-seed. Measured against the
  engine over every `WindupTime` in `WeaponLibrary.json` x attack speed 1.00..4.00 (step 0.01) x double chance
  {0, 1}: the old rule was off in 3324 of 22876 points (up to **+16.7%** hit rate, e.g. windup 0.833 at x3.76);
  the formula above matches all of them exactly. The same bug made a projectile weapon (windup 0.833 at x2.14)
  read +8.6% real DPS: projectiles themselves do not change the steady state (one impact per shot, the travel is
  a constant lag).

## Verified against build 2026_10_08_09_03 (2026-10-13)

`AttacksSystem.HandleUnits` at RVA `0x77F3D34` (length `0xBB8`). `UnitEntity` fields: `AttackDuration`
`0x60`, `WindUpDuration` `0x70`, `AttackTimer` `0x80`, `State` `0x90`, double flag `0x2C8`.

| RVA | what it does |
|---|---|
| `0x77F45D4` | **OnCooldown**: timer `+= inc` |
| `0x77F4628` | store of the advanced timer (`stp x0, x1, [x27, #0x80]`) |
| `0x77F4630` | `FD6.op_GreaterThanOrEqual(timer, AttackDuration)` |
| `0x77F4640` | `State = Idle` (`strb wzr, [x27, #0x90]`); the timer is zeroed on the way back |
| `0x77F46B8` | **WindingUp**: timer `+= inc` |
| `0x77F470C` | store of the advanced timer |
| `0x77F4738` | `AttacksSystem.ExecuteAttack` (the strike) |
| `0x77F4758` | `RandomPCG.NextF64`: the double roll |
| `0x77F482C`..`0x77F4874` | **re-seed**: `F64.op_Division(1, DoubleAttackSpeedUp)`, `F64.op_Subtraction(1, that)`, `FD6.op_Multiply(WindUpDuration, 0.75)`, then the absolute store `stp x0, x1, [x27, #0x80]` at `0x77F4874` and the double flag at `0x77F4878` |

Skill timing (the `SkillSystem`, not this state machine) is documented in `src/engine/skills.ts`: skill
timers lose `FD6(dt) = 0.099999` per tick, so every phase costs `max(1, ceil(seconds / 0.099999))` ticks, the
first cast lands at tick 41 (4.0s hardcoded charge) and the cast period is active + cooldown phases.

## Validation

Reproduces the measured single-interval table exactly (attack-speed **bonus %** → seconds):

| Bonus % | 0 | 50 | 100 | 150 | 200 | 238 | 276 | 401 |
|---|---|---|---|---|---|---|---|---|
| Single (s) | 1.7 | 1.2 | 0.9 | 0.8 | 0.7 | 0.6 | 0.5 | 0.4 |

- The famous "0% → 1.7s" (not 1.5s) is emergent: `dt < 0.1` bumps `ceil(1.5/inc)` to 16, plus the idle re-acquire tick → 17 ticks = 1.7s. There is **no** literal "+0.2s" constant.
- The "1.4s vs 1.5s at 15.4% on two weapons" is **not** a windup effect — it is an attack-speed quantisation boundary (`ceil(1.5/inc)` flips at `inc ≈ 0.11538`, i.e. ~15.39%).
- Second-strike gaps match the windup table: a **1.0s-windup** weapon reaches a 0.1s gap at ~**150%**, a **1.1s** weapon at ~**175%** (`speed ≈ windup × 2.5`).
- Matches the BattleSim (doraemon): "132% → 0.8s single, any weapon", and "Quantum Gun / Infernal Trident double = 1.0s from 100–149.9%, drops at 150%".

## History: verified against the 2.8.2 binary (2026-08-29)

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
| `0x76940fc` | **Double proc**: re-seeds the timer from `WindUpDuration` scaled by `UnitConstants.DoubleAttackSpeedUp` (absolute store at `0x76941c8`), then `State = WindingUp`. |

`stp x0, x1, [x27, #0x80]` appears exactly four times in the whole function, at `0x7693f7c`,
`0x7694060`, `0x76941c8` and `0x7694268`. The last one is the **only** zeroing of the timer, and it
happens at the end of a full cycle, never at the fire. That single fact is what makes the single
interval windup-independent: where `WindUpDuration` sits between 0 and `AttackDuration` cannot change
how many ticks it takes to reach `AttackDuration` from zero.

## Field check, 2026-09-30 (Underworld weapon, windup 0.82s)

A player timed single hits at five attack-speed bonuses. All five match the model above:

| Bonus % | 152 | 183 | 197 | 235 | 268 |
|---|---|---|---|---|---|
| Measured (s) | 0.7 | 0.7 | 0.7 | 0.6 | 0.6 |
| Model (s) | 0.7 | 0.7 | 0.7 | 0.6 | 0.6 |

The same player had read 0.6s / 0.5s for these speeds off the Items wiki breakpoint table. That table
was wrong, not the game: `Items.tsx` passed a hard-coded `AttackDuration` of 1.1s (and `Skins.tsx`
fell back to 1.1s) instead of the weapon's 1.5s, which shifted every row by roughly a third. Fixed
2026-10-12; the profile's DPS breakdown always used the real 1.5s.

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

- Helpers: `src/utils/constants.ts` (`SIM_DT_RAW`, `attackIncRaw`, `attackCycleTicks`, `attackIntervalSeconds`, `doubleCycleTicks`, `doubleCycleSeconds`, `doubleSecondStrikeSeconds`, `weaponHitsPerSecond`).
- Combat stats: `src/utils/statEngine.ts` sets `realCycleTime`, `realDoubleHitCycle`, `realAps` from the helpers; these feed real DPS/HPS. Buff skills ride on the same real hit rate (x crit, lifesteal included); damage skills use `skillYieldPerCast` (`src/engine/skillYield.ts`) and the skill tick helpers in `src/engine/skills.ts`.
- Breakpoint UI: `src/components/Profile/BreakpointTables.tsx` (+ `BreakpointExplanation`), shown via `DpsBreakdownModal` and `BreakpointWikiModal`. Skill cooldown breakpoints: `src/components/Profile/CooldownBreakpoints.tsx` inside the Skills Cycle panel.
- Regression: `reverseForge/engine_selftest.ts` checks the single interval, the second-strike gap, the full double cycle and the skill tick helpers against the engine.

## Resolved: ClanWarDamage / ClanWarHealth

`ValuePerLevel = 1.0` at `MaxLevel 100` is real: +100% per level, +10000% at max, verified in game on
2026-08-24 (`src/pages/Clan.tsx`). The stat engine feeds the full value into the clan-war context bonus.
