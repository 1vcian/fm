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

## Where it lives in the app

- Helpers: `src/utils/constants.ts` (`SIM_DT_RAW`, `attackIncRaw`, `attackIntervalSeconds`, `doubleDelaySeconds`).
- Combat stats: `src/utils/statEngine.ts` sets `realCycleTime`, `realDoubleHitCycle`, `doubleHitDelay`, `realAps` from the helpers; these feed real DPS/HPS.
- Breakpoint UI: `src/components/Profile/BreakpointTables.tsx` (+ `BreakpointExplanation`), shown via `DpsBreakdownModal` and `BreakpointWikiModal`.

## Open item

`ClanWarDamage` / `ClanWarHealth` (war-only combat boosts) carry `ValuePerLevel = 1.0` at `MaxLevel 100`, anomalous vs every other clan multiplier. The Clan page assumes **+1%/level → +100% at max** and flags it for in-game verification.
