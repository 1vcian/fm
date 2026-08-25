/**
 * plannerSchedule — the per-planner alarm anchor, as arithmetic.
 * =============================================================
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * Two planners in this app produce an ORDERED plan with DURATIONS but no absolute clock:
 *
 *   - the tech planner (`useTreePlanner`, rendered by `src/pages/Calculators/TreeCalculator.tsx`)
 *     builds `schedule: ScheduleEntry[]`, one serial chain, each entry carrying `duration`
 *     (seconds), `cumulativeStartSeconds` / `cumulativeEndSeconds`, and a `startDate`/`endDate`
 *     derived from `misc.techPlanStartDate` — a bare `datetime-local` string the user PICKS;
 *   - the egg planner (`useEggsCalculator`) builds `optimization.timeline: TimelineEvent[][]`, one
 *     lane per hatch slot, each event carrying `startTime`/`endTime`/`duration` in MINUTES from an
 *     implicit zero, with no `Date` anywhere.
 *
 * Neither knows when anything actually started, so the player supplies the missing instant and every
 * later completion is derived from it plus the plan's own durations. This module is that
 * derivation, and nothing else: no React, no network, no `Date.now()`.
 *
 * ONE ANCHOR PER *SLOT*, NOT ONE PER PLANNER
 * -----------------------------------------
 * The tech tree has one anchor because the game runs ONE upgrade at a time: both its surfaces
 * describe the same physical slot. The egg planner does not. It hatches in `availableSlots` slots at
 * once and each one carries its own countdown, so a single anchor could only be right for one of
 * them: a player whose slots pop at 14:05, 15:40 and 22:10 had two of their three alarm sets wrong.
 *
 * So the unit is a LANE — one ordered chain of completions with one anchor of its own — and a
 * planner is a list of lanes. The tech tree is the one-lane case and keeps the exact arithmetic it
 * had; the egg planner has one lane per hatch slot, each measured from that slot's own reading.
 * `anchorLanes()` is where the two meet: it gates each lane's anchor separately and flattens the
 * lanes into absolute instants, after which `deriveAlarmsAt()` neither knows nor cares how many
 * anchors produced them.
 *
 * A LANE'S ANCHOR HAS THREE STATES, AND "EMPTY" IS ONE OF THEM
 * -----------------------------------------------------------
 * `unset` (nothing said yet), `busy` (something is running, the anchor is when it finishes) and
 * `idle` (the slot holds nothing, the anchor is the instant it was observed empty). `idle` is NOT
 * "a countdown of zero": zero is unrepresentable in the control by design and five minutes would be
 * a lie in the other direction. An idle lane simply starts at the instant it was declared empty, its
 * first planned egg finishes one duration later, and it emits no completion for a running item
 * because there is no running item.
 *
 * WHY `now` IS AN ARGUMENT AND THE ANCHOR IS AN INSTANT
 * ----------------------------------------------------
 * `deriveAlarms()` takes `nowMs` and `anchorAtMs` as numbers. Two separate reasons:
 *
 *  1. Reproducibility. A queue that depended on a hidden clock could not be tested and could not be
 *     compared against what the server already holds, so "did anything change?" would be
 *     unanswerable and the client would re-arm on every render.
 *  2. The anchor is stamped ONCE, when the player types a duration, and then never moves. Storing
 *     "2h 14m left" as a duration would make every subsequent render derive a LATER completion —
 *     the plan would walk forwards in time for as long as the page stayed open. So the caller does
 *     `anchorAtMs = Date.now() + parseDurationMs(text)` at the moment of the edit and keeps the
 *     instant. `nowMs` is then used for one job only: refusing an alarm whose warning window has
 *     already closed.
 *
 * A LANE'S ANCHOR MEANS "T0 FOR THAT LANE", AND T0 IS DEFINED THE SAME WAY EVERYWHERE
 * ----------------------------------------------------------------------------------
 * T0 = the instant that lane becomes free = `anchorAtMs`, and every offset in the lane is measured
 * from it.
 *
 *   TECH — one lane. The plan is one serial chain and its first playable step IS the running
 *   upgrade, so `treeCompletions()` gives that step `offsetMs = 0` and measures every later step
 *   from the END of that one (`cumulativeEndSeconds` differences). The planner's own prediction for
 *   the running step is DISCARDED in favour of what the player read off the game, which is the whole
 *   point of an anchor. Delays and `isInvalid` steps stay in the arithmetic (the offsets are
 *   cumulative and absolute) but produce no alarm: a delay is not a completion, and an invalid step
 *   is one the game will refuse.
 *
 *   EGGS — one lane per hatch slot. The optimizer starts every slot at zero
 *   (`slots = new Array(availableSlots).fill(0)`), so lane `n`'s `endTime`s are already measured
 *   from the moment slot `n` comes free, which is exactly what that slot's anchor supplies.
 *   `eggLanes()` puts one synthetic completion at `offsetMs = 0` per lane for the egg that slot has
 *   in it — the only egg whose finish time is actually known — and marks it `anchorItem`, so a lane
 *   the player declared EMPTY drops it and starts straight into the first planned egg.
 *
 * COALESCING IS NOT COSMETIC
 * -------------------------
 * Three Common eggs in three slots finish at the same minute. Three separate pushes at the same
 * instant is three queue rows, three notifications and one annoyed player, so completions inside
 * `coalesceMs` (default 60 s) become ONE alarm that names all of them. The surviving alarm keeps
 * the SMALLEST `stepIndex` of its group, which matters because `step_index` is half of 0009's
 * dedupe key (`planner:plan_hash:step_index`) — groups are disjoint and ordered, so the minimum is
 * unique and stable.
 *
 * WHAT NEVER LEAVES THIS FILE
 * ---------------------------
 * It never throws. Every refusal and every dropped completion is returned as data, because the
 * component has to be able to SHOW the user why an alarm they expected is not in the list. A
 * silent drop here would become an alarm the player believes is armed and is not.
 */

/* ------------------------------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------------------------------ */

/** 0009 `notification_queue.planner` accepts exactly these two. */
export type PlannerId = 'tree' | 'eggs';

/** 0009 `lead_seconds` default. "about 2 minutes" — see 0009 D2, the delivery instant is not a fact. */
export const DEFAULT_LEAD_SECONDS = 120;

/** 0009 `arm_plan_alarms` refuses more than this per call with 54000. */
export const MAX_ALARMS_PER_CALL = 200;

/**
 * How far ahead alarms are armed at all. A tech plan can span weeks; an alarm eleven days out is
 * near-certain to be wrong by the time it fires (the plan will have been edited, the tech tree will
 * have moved, the config version may have changed) and it occupies one of the 500 pending rows
 * 0009 allows per account. Re-arming happens on every mount, so a player who opens the app inside
 * the horizon never notices it exists.
 */
export const DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Longest accepted anchor. Beyond this the player has mistyped, not waited a month for an egg. */
export const MAX_ANCHOR_MS = 30 * 24 * 60 * 60 * 1000;

/** Completions closer together than this become one alarm. */
export const DEFAULT_COALESCE_MS = 60 * 1000;

/**
 * `assert_push_payload()` (0009 §3.0) PINS `notification.navigate` to this prefix and rejects
 * anything else with 22023. That is a security decision about clan broadcasts, and it applies to
 * planner alarms too — so even a dev build on localhost must queue the PRODUCTION url. The
 * notification is opened on a phone, not in the tab that armed it.
 */
export const PUSH_ORIGIN = 'https://1vcian.me/fm/';

/* ------------------------------------------------------------------------------------------ *
 * Input: what a planner reduces to
 * ------------------------------------------------------------------------------------------ */

/**
 * One thing the player should be warned about, positioned RELATIVE TO T0.
 *
 * The adapters below produce these; the core never looks at game data. `finishes` and `startNext`
 * are already-worded human strings for exactly that reason — the domain knowledge stays in the
 * planner, the arithmetic stays here.
 */
export interface PlanCompletion {
    /**
     * Stable and unique within one plan. Becomes `notification_queue.step_index`, which is half of
     * the dedupe key, so two completions must never share one: `deriveAlarms` drops a duplicate
     * rather than letting the database silently swallow the second row.
     */
    stepIndex: number;
    /** Eggs: the hatch slot. Tech: `null`. Becomes `notification_queue.slot_index`. */
    slotIndex: number | null;
    /** Milliseconds from T0 to this completion. `0` means "at T0". Must be finite and >= 0. */
    offsetMs: number;
    /** What finishes, in the player's words. Must be non-empty. */
    finishes: string;
    /** What to start when it does, or `null` when the plan ends here. */
    startNext: string | null;
    /**
     * True only for the completion whose instant the player actually TOLD us (the one at T0).
     * Everything else is anchor + prediction, and the body says so.
     */
    observed?: boolean;
    /**
     * This completion IS the thing the lane's anchor describes: the egg already in the slot, the
     * upgrade already on the clock. It exists only while that lane is BUSY — `anchorLanes()` drops
     * it from a lane the player declared empty, because an empty slot has nothing about to finish
     * and a push saying otherwise is the exact shape that gets a subscription revoked.
     */
    anchorItem?: boolean;
}

/**
 * A completion that has already been placed on the clock by its lane's anchor. This is what the
 * core derivation actually consumes; `PlanCompletion` is the lane-relative form the adapters emit.
 */
export interface AnchoredCompletion {
    stepIndex: number;
    slotIndex: number | null;
    /** Epoch ms. `laneAnchorAtMs + offsetMs`. */
    completesAtMs: number;
    finishes: string;
    startNext: string | null;
    observed?: boolean;
    /**
     * The lane anchor this instant was measured from. Carried per completion because a per-slot
     * planner has several, and `payload.fm.anchor_at` must name the one that produced THIS row
     * rather than some representative of the set.
     */
    anchorAtMs?: number;
}

export interface DeriveInput {
    /** Reference instant. Used ONLY to drop alarms whose window has closed. Never read from a clock. */
    nowMs: number;
    /** T0: the instant the currently-running item finishes. `Date.now() + parsed duration`. */
    anchorAtMs: number;
    completions: PlanCompletion[];
    leadSeconds?: number;
    maxAlarms?: number;
    horizonMs?: number;
    coalesceMs?: number;
}

export interface DeriveAtInput {
    /** Reference instant. Used ONLY to drop alarms whose window has closed. Never read from a clock. */
    nowMs: number;
    /** Already on the clock: see `anchorLanes`, which is what puts them there. */
    completions: readonly AnchoredCompletion[];
    /**
     * Reported back as `Derivation.anchorAtMs`, for a caller that has exactly one anchor. A per-slot
     * caller leaves it out: its anchors ride on the completions instead, where they are per row.
     */
    anchorAtMs?: number | null;
    leadSeconds?: number;
    maxAlarms?: number;
    horizonMs?: number;
    coalesceMs?: number;
}

/* ------------------------------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------------------------------ */

export type AnchorRefusal =
    /** No anchor yet, or one that is not a finite number. */
    | 'anchor-missing'
    /**
     * The anchor is now or in the past. REFUSED, not clamped: clamping would queue an alarm for a
     * completion that has already happened, and a push that arrives with nothing true to say is
     * exactly what gets a subscription revoked on WebKit (`userVisibleOnly`).
     */
    | 'anchor-not-positive'
    /** Further out than `MAX_ANCHOR_MS`. A typo, not a plan. */
    | 'anchor-too-large';

export type DropReason =
    /** `fire_at` is already behind `nowMs` — we cannot warn 2 minutes before something closer than that. */
    | 'window-closed'
    /** Past `horizonMs`. Will be armed on a later visit. */
    | 'beyond-horizon'
    /** Past `maxAlarms`. The earliest survive. */
    | 'over-cap'
    /** A non-finite or negative `offsetMs`, or an empty `finishes`. An adapter bug, made visible. */
    | 'unusable'
    /** Two completions claimed the same `stepIndex`; the second would collide on the dedupe key. */
    | 'duplicate-step';

export interface DerivedAlarm {
    stepIndex: number;
    slotIndex: number | null;
    /** Epoch ms. `completesAtMs - leadSeconds * 1000`. */
    fireAtMs: number;
    /** Epoch ms. `anchorAtMs + offsetMs`. */
    completesAtMs: number;
    /**
     * The lane anchor behind this alarm, or `null` when a coalesced group spans lanes that do not
     * share one. `alarmPayload` falls back to the caller's context in that case.
     */
    anchorAtMs: number | null;
    leadSeconds: number;
    /** What finishes. Every completion in a coalesced group, joined. */
    finishes: string;
    /** What to start next, or `null`. */
    startNext: string | null;
    /** The player told us this instant; it is not derived from a predicted duration. */
    observed: boolean;
    /** How many completions this one alarm speaks for. `> 1` after coalescing. */
    groupSize: number;
}

export interface DroppedCompletion {
    stepIndex: number;
    finishes: string;
    reason: DropReason;
    /** `null` when the completion had no usable offset. */
    completesAtMs: number | null;
}

export interface Derivation {
    /** False only when the ANCHOR was refused. An empty plan is `ok: true` with no alarms. */
    ok: boolean;
    refusal: AnchorRefusal | null;
    /** A sentence for the user. `null` when there is nothing to explain. */
    message: string | null;
    /** T0, or `null` when the anchor was refused. */
    anchorAtMs: number | null;
    alarms: DerivedAlarm[];
    dropped: DroppedCompletion[];
    /**
     * A fingerprint of the DESIRED SET, absolute times included. Two derivations with the same
     * signature ask the server for exactly the same rows, which is what lets the sync layer skip a
     * round trip instead of re-arming on every render.
     */
    signature: string;
}

/* ------------------------------------------------------------------------------------------ *
 * The derivation
 * ------------------------------------------------------------------------------------------ */

const isFinitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The wording each anchor refusal gets on screen. Exported because a per-slot planner gates its
 * lanes itself (`anchorLanes`) and must say the same things about the same states as the one-anchor
 * path does, rather than inventing a second vocabulary for the same three failures.
 */
export function anchorRefusalMessage(refusal: AnchorRefusal): string {
    switch (refusal) {
        case 'anchor-not-positive':
            // NOT "there is nothing left to warn you about": the later steps of the plan may still
            // be days away. What is true is that their times were all measured from a moment that
            // has now gone, so none of them can be trusted, and the queue is cleared rather than
            // left to fire something derived from a dead reading. Say exactly that.
            return 'The time you set has run out, so every alarm measured from it has been cleared. Read the countdown off the game again, pick it above and press Set.';
        case 'anchor-too-large':
            // Unreachable from the two selects (their ceiling is 167 h 55 m); reachable from a
            // record saved by the old typed field, which is why the wording no longer says "typed".
            return 'That is more than a month away, so it is not a countdown you can be reading. Pick the time again and press Set.';
        default:
            return 'Pick how long is left on what you have running and these fill in.';
    }
}

/**
 * Gate ONE anchor and return the refusal it earns, or `null` when it is usable.
 *
 * `idle` is gated in the opposite direction from `busy` and that is the whole difference between
 * them: a busy anchor is a countdown, so it dies the moment it passes; an idle anchor is a note that
 * a slot was empty, so it is already behind `now` the instant it is stamped and only goes bad by
 * being ancient. Both are refused past `MAX_ANCHOR_MS`, in their own direction.
 */
export function gateAnchor(anchor: SlotAnchor, nowMs: number): AnchorRefusal | null {
    if (!isFinitePositive(nowMs)) return 'anchor-missing';
    if (!anchor || anchor.kind === 'unset' || !isFinitePositive(anchor.anchorAtMs)) return 'anchor-missing';
    if (anchor.kind === 'idle') {
        return nowMs - anchor.anchorAtMs > MAX_ANCHOR_MS ? 'anchor-too-large' : null;
    }
    const remaining = anchor.anchorAtMs - nowMs;
    if (remaining <= 0) return 'anchor-not-positive';
    if (remaining > MAX_ANCHOR_MS) return 'anchor-too-large';
    return null;
}

/**
 * Turn a plan and ONE anchor into the exact set of alarms that should be queued: gate the anchor,
 * put every offset on the clock, hand the result to `deriveAlarmsAt`.
 *
 * `PlannerAlarms` reaches this same behaviour through `anchorLanes` + `deriveAlarmsAt` with a single
 * lane, because it needs the per-lane gate for the eggs and one code path is better than two. This
 * function is the standalone form: the whole derivation for a caller that has one anchor and no
 * lanes, and the shape the tests drive.
 *
 * Total: never throws, and for a refused anchor returns an empty set rather than a partial one, so
 * "sync whatever this returns" is always the right thing for the caller to do — including when the
 * right answer is "delete everything this planner has queued".
 */
export function deriveAlarms(input: DeriveInput): Derivation {
    const refusal = gateAnchor({ kind: 'busy', anchorAtMs: input.anchorAtMs }, input.nowMs);
    if (refusal) {
        return {
            ok: false,
            refusal,
            message: anchorRefusalMessage(refusal),
            anchorAtMs: null,
            alarms: [],
            dropped: [],
            signature: 'refused:' + refusal,
        };
    }

    return deriveAlarmsAt({
        ...input,
        anchorAtMs: input.anchorAtMs,
        completions: (input.completions || []).map(c => ({
            stepIndex: c?.stepIndex ?? -1,
            slotIndex: c?.slotIndex ?? null,
            // A non-finite or negative offset becomes a non-finite instant, which `deriveAlarmsAt`
            // drops as `unusable` — the same verdict the offset itself would have earned.
            completesAtMs: c && isFinitePositive(c.offsetMs) && c.offsetMs >= 0
                ? input.anchorAtMs + c.offsetMs
                : Number.NaN,
            finishes: c?.finishes ?? '',
            startNext: c?.startNext ?? null,
            observed: c?.observed,
            anchorAtMs: input.anchorAtMs,
        })),
    });
}

/**
 * The core: completions ALREADY on the clock, in, alarms out. It gates nothing about anchors,
 * because by the time completions carry absolute instants their anchors have been gated one by one
 * — which is exactly what lets one dead slot lose its alarms while the other three keep theirs.
 */
export function deriveAlarmsAt(input: DeriveAtInput): Derivation {
    const lead = clampLead(input.leadSeconds);
    const maxAlarms = Math.max(0, Math.min(input.maxAlarms ?? MAX_ALARMS_PER_CALL, MAX_ALARMS_PER_CALL));
    const horizon = input.horizonMs ?? DEFAULT_HORIZON_MS;
    const coalesce = Math.max(0, input.coalesceMs ?? DEFAULT_COALESCE_MS);

    if (!isFinitePositive(input.nowMs)) {
        return {
            ok: false,
            refusal: 'anchor-missing',
            message: anchorRefusalMessage('anchor-missing'),
            anchorAtMs: null,
            alarms: [],
            dropped: [],
            signature: 'refused:anchor-missing',
        };
    }

    // --- shape the completions -------------------------------------------------------------
    const dropped: DroppedCompletion[] = [];
    const seen = new Set<number>();
    const usable: AnchoredCompletion[] = [];

    for (const c of input.completions) {
        const label = (c && typeof c.finishes === 'string' ? c.finishes : '').trim();
        if (!c || !Number.isInteger(c.stepIndex) || c.stepIndex < 0 || !isFinitePositive(c.completesAtMs) || !label) {
            dropped.push({ stepIndex: c?.stepIndex ?? -1, finishes: label || '(unnamed)', reason: 'unusable', completesAtMs: null });
            continue;
        }
        if (seen.has(c.stepIndex)) {
            dropped.push({ stepIndex: c.stepIndex, finishes: label, reason: 'duplicate-step', completesAtMs: c.completesAtMs });
            continue;
        }
        seen.add(c.stepIndex);
        usable.push({ ...c, finishes: label });
    }

    // Earliest first, then by stepIndex so a tie is not decided by input order (the egg timeline
    // arrives slot-major, so two slots finishing together would otherwise coalesce differently
    // depending on how many slots there are).
    usable.sort((a, b) => (a.completesAtMs - b.completesAtMs) || (a.stepIndex - b.stepIndex));

    // --- coalesce --------------------------------------------------------------------------
    const groups: AnchoredCompletion[][] = [];
    for (const c of usable) {
        const last = groups[groups.length - 1];
        if (last && c.completesAtMs - last[0].completesAtMs <= coalesce) last.push(c);
        else groups.push([c]);
    }

    // --- filter and build ------------------------------------------------------------------
    // Each survivor is carried WITH the completions it speaks for, because `over-cap` below has to
    // report the members and not the group: `dropped` is per COMPLETION for every other reason, and
    // a caller counting "what did lane 3 lose?" by step index cannot see a member it never named.
    const kept: { alarm: DerivedAlarm; group: AnchoredCompletion[] }[] = [];
    for (const group of groups) {
        const completesAtMs = group[0].completesAtMs;
        const fireAtMs = completesAtMs - lead * 1000;
        const stepIndex = Math.min(...group.map(g => g.stepIndex));
        const finishes = joinPhrases(group.map(g => g.finishes));

        if (fireAtMs <= input.nowMs) {
            for (const g of group) dropped.push({ stepIndex: g.stepIndex, finishes: g.finishes, reason: 'window-closed', completesAtMs: g.completesAtMs });
            continue;
        }
        if (completesAtMs - input.nowMs > horizon) {
            for (const g of group) dropped.push({ stepIndex: g.stepIndex, finishes: g.finishes, reason: 'beyond-horizon', completesAtMs: g.completesAtMs });
            continue;
        }

        // `startNext` of a coalesced group is every distinct next-thing in it. A group whose members
        // all end the plan yields null, which the body renders as "nothing after this".
        const nexts = dedupe(group.map(g => (typeof g.startNext === 'string' ? g.startNext.trim() : '')).filter(Boolean));
        const slots = dedupe(group.map(g => (g.slotIndex === null || g.slotIndex === undefined ? '' : String(g.slotIndex))).filter(Boolean));
        // Same rule as the slot: a group whose members came from different anchors has no single
        // anchor to name, so it names none and the payload falls back to the caller's context.
        const anchors = dedupe(group.map(g => (isFinitePositive(g.anchorAtMs) ? String(g.anchorAtMs) : '')).filter(Boolean));

        kept.push({
            alarm: {
                stepIndex,
                // Only meaningful when the whole group is one slot; a mixed group is not "a slot".
                slotIndex: slots.length === 1 ? Number(slots[0]) : null,
                fireAtMs,
                completesAtMs,
                anchorAtMs: anchors.length === 1 ? Number(anchors[0]) : null,
                leadSeconds: lead,
                finishes,
                startNext: nexts.length ? joinPhrases(nexts) : null,
                observed: group.every(g => g.observed === true),
                groupSize: group.length,
            },
            group,
        });
    }

    // Over the cap: keep the EARLIEST, because those are the ones the player reaches first and the
    // rest are re-armed on the next visit anyway.
    kept.sort((a, b) => (a.alarm.fireAtMs - b.alarm.fireAtMs) || (a.alarm.stepIndex - b.alarm.stepIndex));
    const alarms = kept.slice(0, maxAlarms).map(k => k.alarm);
    for (const over of kept.slice(maxAlarms)) {
        for (const g of over.group) {
            dropped.push({ stepIndex: g.stepIndex, finishes: g.finishes, reason: 'over-cap', completesAtMs: g.completesAtMs });
        }
    }

    return {
        ok: true,
        refusal: null,
        message: null,
        anchorAtMs: isFinitePositive(input.anchorAtMs) ? input.anchorAtMs : null,
        alarms,
        dropped,
        signature: signatureOf(alarms),
    };
}

/* ------------------------------------------------------------------------------------------ *
 * Lanes: one anchor each
 * ------------------------------------------------------------------------------------------ */

/**
 * What one lane's player has said about it. `anchorAtMs` means the same thing in both live states —
 * the instant that lane comes free — which is why the arithmetic downstream needs no branch: for
 * `busy` it is in the future (a countdown ending), for `idle` it is in the past (the moment the
 * player said the slot was empty).
 */
export type SlotAnchor =
    | { kind: 'unset' }
    | { kind: 'busy'; anchorAtMs: number }
    | { kind: 'idle'; anchorAtMs: number };

export interface LaneStatus {
    laneIndex: number;
    kind: SlotAnchor['kind'];
    /** The gated anchor, or `null` when this lane was refused. */
    anchorAtMs: number | null;
    /** `null` when the lane is usable. */
    refusal: AnchorRefusal | null;
    /** How many completions this lane contributed. `0` for a refused lane, and for an empty one. */
    count: number;
}

export interface AnchoredPlan {
    /** Every usable lane's completions, on the clock. Ready for `deriveAlarmsAt`. */
    completions: AnchoredCompletion[];
    lanes: LaneStatus[];
    /**
     * The refusal to SHOW, or `null` while at least one lane is alive. When every lane is refused
     * for the same reason that reason is named; when they disagree there is no single sentence to
     * write, so it falls back to `anchor-missing` and the per-lane lines carry the detail.
     */
    refusal: AnchorRefusal | null;
}

/**
 * Put each lane on its own clock and flatten. THE point of the whole file: lane 2 being dead cannot
 * take lanes 1, 3 and 4 with it, because each anchor is gated on its own and a refused lane simply
 * contributes nothing.
 *
 * A lane with no anchor yet contributes nothing either, and it does so LOUDLY: `lanes[i].refusal` is
 * how the panel tells the player which slot it is still waiting to hear about. Silence there would
 * be the old bug in a new place, with two slots quietly unarmed.
 */
export function anchorLanes(input: {
    nowMs: number;
    lanes: readonly (readonly PlanCompletion[])[];
    anchors: readonly SlotAnchor[];
}): AnchoredPlan {
    const completions: AnchoredCompletion[] = [];
    const lanes: LaneStatus[] = [];

    input.lanes.forEach((lane, laneIndex) => {
        const anchor = input.anchors[laneIndex] || { kind: 'unset' as const };
        const refusal = gateAnchor(anchor, input.nowMs);
        if (refusal || anchor.kind === 'unset') {
            lanes.push({ laneIndex, kind: anchor.kind, anchorAtMs: null, refusal: refusal ?? 'anchor-missing', count: 0 });
            return;
        }

        const anchorAtMs = anchor.anchorAtMs;
        let count = 0;
        for (const c of lane || []) {
            if (!c) continue;
            // An empty slot has nothing in it to finish, so the completion that describes the thing
            // the anchor was read off does not exist. Dropped here rather than in the adapter: the
            // adapter does not know what the player said about the slot.
            if (c.anchorItem && anchor.kind === 'idle') continue;
            completions.push({
                stepIndex: c.stepIndex,
                slotIndex: c.slotIndex,
                completesAtMs: isFinitePositive(c.offsetMs) && c.offsetMs >= 0 ? anchorAtMs + c.offsetMs : Number.NaN,
                finishes: c.finishes,
                startNext: c.startNext,
                observed: c.observed,
                anchorAtMs,
            });
            count += 1;
        }
        lanes.push({ laneIndex, kind: anchor.kind, anchorAtMs, refusal: null, count });
    });

    const alive = lanes.some(l => l.refusal === null);
    const reasons = dedupe(lanes.map(l => l.refusal || '').filter(Boolean));
    return {
        completions,
        lanes,
        refusal: alive ? null : (reasons.length === 1 ? (reasons[0] as AnchorRefusal) : 'anchor-missing'),
    };
}

/**
 * One sentence for a per-slot planner with nothing left alive, naming the slots rather than "what
 * you have running": with four anchors, "pick the time again" does not tell the reader WHICH time.
 */
export function laneRefusalMessage(lanes: readonly LaneStatus[], noun: (index: number) => string): string {
    const expired = lanes.filter(l => l.refusal === 'anchor-not-positive');
    const unset = lanes.filter(l => l.refusal === 'anchor-missing' || l.refusal === 'anchor-too-large');
    if (expired.length > 0 && unset.length === 0) {
        return `${sentenceCase(joinPhrases(expired.map(l => noun(l.laneIndex))))} ran out, so every alarm measured from ${expired.length === 1 ? 'it' : 'them'} has been cleared. Read the countdowns off the game again and set them.`;
    }
    if (expired.length > 0) {
        return `${sentenceCase(joinPhrases(expired.map(l => noun(l.laneIndex))))} ran out and the rest have nothing set, so nothing is queued. Say what each slot is doing.`;
    }
    return 'No slot has anything set yet, so nothing is queued. Say whether each slot is hatching or empty.';
}

function sentenceCase(text: string): string {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clampLead(seconds: number | undefined): number {
    if (!isFinitePositive(seconds)) return DEFAULT_LEAD_SECONDS;
    // 0009 checks `lead_seconds between 0 and 86400`.
    return Math.max(0, Math.min(86400, Math.round(seconds)));
}

function dedupe(values: string[]): string[] {
    const out: string[] = [];
    for (const v of values) if (!out.includes(v)) out.push(v);
    return out;
}

/** `a`, `a and b`, `a, b and c`. */
function joinPhrases(parts: string[]): string {
    const list = dedupe(parts);
    if (list.length <= 1) return list[0] || '';
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function signatureOf(alarms: DerivedAlarm[]): string {
    return alarms.map(a => `${a.stepIndex}@${a.fireAtMs}/${a.completesAtMs}:${a.finishes}>${a.startNext ?? ''}`).join('|');
}

/* ------------------------------------------------------------------------------------------ *
 * The plan hash
 * ------------------------------------------------------------------------------------------ */

/**
 * `plan_hash` for 0009: at least 8 chars, and the migration insists it MUST include the game-data
 * version "because switching version changes every Duration and therefore every completion time".
 *
 * WHAT IT DELIBERATELY DOES NOT INCLUDE: `now`, or any absolute time. The hash is half of the
 * dedupe key, and 0009's `on conflict do nothing` is what makes "the client may call arm on every
 * render without consequence" true. Fold a clock into the hash and every call mints new keys, so a
 * row the sender has already CLAIMED (those are not deleted — 0009 leaves the lease alone) would be
 * duplicated by the next re-arm. The anchor IS included, rounded to the minute, because an anchor
 * edit genuinely changes every fire time and those rows must not be confused with the old ones.
 */
export function planHashOf(parts: {
    planner: PlannerId;
    /** `selectedVersion` from `GameDataContext`. Required by 0009, in words. */
    configVersion: string;
    /**
     * T0 for a one-lane planner, or EVERY lane's anchor for a per-slot one. An array, because
     * moving slot 3's reading moves slot 3's alarms and must therefore move the hash: folding in
     * one representative anchor would let two genuinely different desired sets share a dedupe key.
     */
    anchorAtMs: number | readonly number[];
    leadSeconds: number;
    /**
     * Lane-relative (`offsetMs`) or already on the clock (`completesAtMs`). Both are stable across
     * re-derivations of the same plan, which is the property the dedupe key needs, and neither is a
     * reading of the current time, which is the property it must not have.
     */
    completions: readonly {
        stepIndex: number;
        slotIndex: number | null;
        offsetMs?: number;
        completesAtMs?: number;
        finishes: string;
        startNext: string | null;
    }[];
}): string {
    const minute = (ms: number) => String(Math.floor(ms / 60000));
    const body = [
        parts.planner,
        parts.configVersion || 'no-version',
        Array.isArray(parts.anchorAtMs) ? parts.anchorAtMs.map(minute).join(',') : minute(parts.anchorAtMs as number),
        String(parts.leadSeconds),
        ...parts.completions.map(c => {
            const at = c.offsetMs !== undefined ? c.offsetMs : (c.completesAtMs ?? 0);
            return `${c.stepIndex}:${c.slotIndex ?? ''}:${Math.round(at / 1000)}:${c.finishes}>${c.startNext ?? ''}`;
        }),
    ].join('');
    // Two FNV-1a passes with different offset bases -> 16 hex chars. Not cryptographic and does not
    // need to be: it separates plans, it does not defend against anybody.
    return `${fnv1a(body, 0x811c9dc5)}${fnv1a(body, 0x01000193)}`;
}

function fnv1a(text: string, seed: number): string {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------------------------------ *
 * The payload
 * ------------------------------------------------------------------------------------------ */

export interface PushNotificationPayload {
    web_push: number;
    /**
     * `hint` is the DROPPABLE half and it is not decoration: `send-push`'s `composeWirePayload()`
     * appends it to `body` only when the plan is fresh, and omits it entirely when
     * `claim_due_notifications()` reports `plan_is_stale`. `body` is the half that is always sent.
     * Anything plan-dependent must therefore live in `hint`, never in `body`.
     */
    notification: { title: string; body?: string; hint?: string; navigate: string; tag: string };
    /** Provenance. `assert_push_payload` ignores unknown top-level keys; the worker and the page read it. */
    fm: {
        planner: PlannerId;
        plan_hash: string;
        step_index: number;
        slot_index: number | null;
        anchor_at: string;
        lead_seconds: number;
        /** `'observed'` when the completion instant came from the player; `'derived'` when predicted. */
        basis: 'observed' | 'derived';
    };
}

/** One element of `arm_plan_alarms`'s `p_alarms` array. Field names are 0009's, exactly. */
export interface ArmAlarmRow {
    fire_at: string;
    completes_at: string;
    step_index: number;
    slot_index: number | null;
    lead_seconds: number;
    anchor_kind: 'predicted' | 'observed';
    payload: PushNotificationPayload;
}

/**
 * THE SPLIT THAT MAKES 0009's STALENESS GATE WORK, and the reason it is here rather than in the UI.
 *
 * 0009 D5: `claim_due_notifications()` reports `plan_is_stale` when `profiles.version` has moved
 * since the alarm was armed, and the sender then "keeps the completion and strips the advice". That
 * only degrades gracefully if the two live in different fields — so:
 *
 *   title = the COMPLETION and nothing else. It must still be a true, useful sentence with the rest
 *           deleted, because that is precisely what a stale alarm delivers.
 *   hint  = the ADVICE ("start Y next") and THE ASSUMPTION, in words. Both are droppable.
 *
 * Putting "start Y next" in the title would make a stale alarm send the player to spend potions on
 * the wrong node, which is the one outcome worth more than the feature.
 *
 * IT MUST BE `hint`, NOT `body`, AND THAT IS NOT A NAMING PREFERENCE. `send-push`'s
 * `composeWirePayload()` implements the gate as:
 *
 *     if (hint && !planIsStale) body = body ? `${body}\n${hint}` : hint;
 *
 * — it strips `hint` and passes `body` through untouched. Advice written into `body` is therefore
 * delivered verbatim to a player whose plan has changed, and the staleness gate silently becomes a
 * no-op: the alarm still says "Next: Pet Bonus Damage 2->3" for a plan they no longer have. `body`
 * is left unset here so that a stale alarm arrives as the title alone, which is the whole design.
 */
export function alarmPayload(
    alarm: DerivedAlarm,
    context: { planner: PlannerId; planHash: string; route: string; anchorAtMs: number; armedAtMs: number },
): PushNotificationPayload {
    const minutes = Math.max(1, Math.round(alarm.leadSeconds / 60));
    const lead = alarm.leadSeconds >= 60 ? `about ${minutes} min` : `under a minute`;

    // 120 chars is 0009's hard cap on the title. A comma and not a dash: the owner asked for the
    // em dashes out of everything a player reads, and a notification title is the most read string
    // this app produces.
    const title = clip(`${alarm.finishes}, ${lead} left`, 120);

    const advice = alarm.startNext ? `Next: ${alarm.startNext}.` : 'Nothing after this in your plan.';
    // "set", not "entered": nothing is typed any more — the player picks it out of two dropdowns.
    const assumption = alarm.observed
        ? `Based on the time you set at ${hhmm(context.armedAtMs)}.`
        : `Assumes the plan you had at ${hhmm(context.armedAtMs)} and that each step is started as the one before it finishes.`;
    // 400 is `assert_push_payload`'s cap on `body` and the sender's own BODY_LIMIT, and the sender
    // applies it to the COMPOSED `body + hint`. With `body` unset the two are the same string, so
    // clipping here keeps the client's preview and the delivered text identical.
    const hint = clip(`${advice} ${assumption}`, 400);

    return {
        web_push: 8030,
        notification: {
            title,
            hint,
            // Pinned by `assert_push_payload`. The route lives in the fragment because the app is a
            // HashRouter, and `sw.js`'s navigation bridge applies the hash for a client it does not
            // control.
            navigate: `${PUSH_ORIGIN}${context.route.startsWith('#') ? context.route : `#${context.route}`}`,
            // One tag per (planner, step): a re-armed alarm replaces its predecessor on the device
            // instead of stacking next to it.
            tag: `fm-${context.planner}-${alarm.stepIndex}`,
        },
        fm: {
            planner: context.planner,
            plan_hash: context.planHash,
            step_index: alarm.stepIndex,
            slot_index: alarm.slotIndex,
            // The alarm's OWN lane anchor wins. A per-slot planner has one per slot, and stamping
            // every row with a representative would misreport which reading produced it.
            anchor_at: new Date(alarm.anchorAtMs ?? context.anchorAtMs).toISOString(),
            lead_seconds: alarm.leadSeconds,
            basis: alarm.observed ? 'observed' : 'derived',
        },
    };
}

/**
 * `anchor_kind` for 0009. `'observed'` for every row derived from this anchor, because the column
 * asks how the ANCHOR was obtained, and this one is a clock reading the player made and typed in —
 * not the timezone-less `datetime-local` guess that 0009 D6 calls `'predicted'`. The individual
 * completion's basis (observed vs derived) rides in `payload.fm.basis`, where it is per-row.
 */
export function toArmRows(
    alarms: DerivedAlarm[],
    context: { planner: PlannerId; planHash: string; route: string; anchorAtMs: number; armedAtMs: number },
): ArmAlarmRow[] {
    return alarms.map(alarm => ({
        fire_at: new Date(alarm.fireAtMs).toISOString(),
        completes_at: new Date(alarm.completesAtMs).toISOString(),
        step_index: alarm.stepIndex,
        slot_index: alarm.slotIndex,
        lead_seconds: alarm.leadSeconds,
        anchor_kind: 'observed' as const,
        payload: alarmPayload(alarm, context),
    }));
}

function clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}`;
}

function hhmm(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------------------------------ *
 * Durations, in the form a player reads them off the game
 * ------------------------------------------------------------------------------------------ */

/**
 * Parse what somebody types when they look at a countdown: `2h 14m`, `2:14`, `1d 3h 20m`, `45m`,
 * `90` (bare numbers are MINUTES, because that is what the game shows most of the time), `1:02:30`.
 *
 * Returns `null` for anything it cannot read, and `0` is a legitimate parse — the CALLER refuses
 * zero, not the parser, so the UI can say "that has already finished" instead of "I do not
 * understand that", which are different problems for the reader.
 */
export function parseDurationMs(text: string): number | null {
    if (typeof text !== 'string') return null;
    const raw = text.trim().toLowerCase();
    if (!raw) return null;

    // Clock form: h:mm, h:mm:ss, or mm:ss when the first field is small — ambiguous, so h:mm wins
    // (a player reading "2:14" off a hatch timer means two hours fourteen).
    const clock = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(raw);
    if (clock) {
        const a = Number(clock[1]);
        const b = Number(clock[2]);
        const c = clock[3] === undefined ? null : Number(clock[3]);
        return c === null ? (a * 3600 + b * 60) * 1000 : (a * 3600 + b * 60 + c) * 1000;
    }

    // A bare number is MINUTES. Tested BEFORE whitespace is stripped, on purpose: "2 14" would
    // otherwise compact to "214" and be read as three and a half hours — a plausible-looking wrong
    // answer, which is worse than refusing to guess.
    if (/^\d+(?:[.,]\d+)?$/.test(raw)) return Math.round(Number(raw.replace(',', '.')) * 60_000);

    // From here on whitespace carries no meaning ("2h 14m" and "2h14m" are the same reading), so it
    // goes and the rest of the parse demands FULL consumption — a partial parse is how "2h banana"
    // would silently become two hours.
    const compact = raw.replace(/\s+/g, '');

    const factors: Record<string, number> = { d: 86400_000, h: 3600_000, m: 60_000, s: 1000 };
    // Longest alternative first, or "minutes" matches "min" and leaves "utes" behind.
    const re = /(\d+(?:[.,]\d+)?)(days|day|hours|hour|hrs|hr|minutes|minute|mins|min|seconds|second|secs|sec|d|h|m|s)/g;
    let total = 0;
    let matched = 0;
    let consumed = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(compact)) !== null) {
        if (m.index !== consumed) return null; // a gap means something unreadable sits in it
        consumed = m.index + m[0].length;
        const value = Number(m[1].replace(',', '.'));
        if (!Number.isFinite(value)) return null;
        total += value * factors[m[2][0]];
        matched += 1;
    }
    if (matched === 0 || consumed !== compact.length) return null;
    return Math.round(total);
}

/** `2h 14m`, `3d 4h`, `45m`, `30s`. Compact on purpose: it sits inside a control. */
export function formatDurationShort(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    const negative = ms < 0;
    let s = Math.round(Math.abs(ms) / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m && !d) parts.push(`${m}m`);
    if (!d && !h && (s || !m)) parts.push(`${s}s`);
    return `${negative ? '-' : ''}${parts.slice(0, 2).join(' ') || '0s'}`;
}

/* ------------------------------------------------------------------------------------------ *
 * Adapter: the tech planner
 * ------------------------------------------------------------------------------------------ */

/**
 * The shape `useTreePlanner().schedule` already has. Structural on purpose — importing
 * `ScheduleEntry` would drag React into this file through the hook.
 */
export interface TreeScheduleLike {
    step: { type: 'node' | 'delay' };
    index: number;
    nodeName: string;
    fromLevel: number;
    toLevel: number;
    cumulativeEndSeconds: number;
    isInvalid: boolean;
}

export interface TreeCompletionOptions {
    /**
     * IS THE FIRST ROW OF THIS LIST THE UPGRADE THAT IS ALREADY RUNNING?
     *
     * The two tech surfaces answer this differently and the answer moves every alarm, so it is a
     * required decision rather than a default that happens to suit one of them.
     *
     *   `true`  — the tech PLANNER. `markDone()` applies finished steps to the profile and then
     *             does `setPlanQueue(prev => prev.slice(upToIndex + 1))`, so a step that is over is
     *             GONE from the queue and `schedule[0]` is the one on the clock right now. The
     *             anchor describes it, so it lands on `offsetMs = 0`, its predicted duration is
     *             discarded in favour of what the player read off the game, and it is the one
     *             completion marked `observed`.
     *
     *   `false` — the OPTIMIZER. Its list is recomputed from `profile.techTree` and the potion
     *             count on every render; NOTHING in it has been started. Absorbing row 0 into the
     *             anchor would (a) push a notification naming an upgrade the player never began, as
     *             finishing in two minutes, stamped `basis: 'observed'`, and (b) delete that row's
     *             duration from the chain, so every later alarm fires `d0 - anchor` early — and
     *             `orderedActions` is sorted LONGEST FIRST, so `d0` is the biggest duration in the
     *             plan. Measured against the shipped config that is up to 98 h of error on every
     *             row. So nothing is absorbed, nothing is `observed` except the anchor itself, and
     *             row 0 starts AT T0 instead of ending there.
     *
     * Delays and `isInvalid` steps produce no alarm either way — a delay is not a completion, and
     * an invalid step is one the game will refuse (maxed node, unmet prerequisite, not enough
     * potions), so warning about it would be a lie. They still shape the arithmetic, because the
     * offsets they contribute are already inside `cumulativeEndSeconds`.
     */
    firstStepIsRunning: boolean;
    /**
     * Only read when `firstStepIsRunning` is false: what to call the completion at T0. It is the
     * one instant the player actually told us and the only thing we can say about it truthfully —
     * we do not know WHICH upgrade they have running, only when it ends.
     */
    anchorFinishes?: string;
}

/**
 * `schedule` -> completions measured from T0. See `TreeCompletionOptions.firstStepIsRunning`, which
 * is the whole of the difference between the two tech surfaces.
 */
export function treeCompletions(
    schedule: readonly TreeScheduleLike[],
    options: TreeCompletionOptions = { firstStepIsRunning: true },
): PlanCompletion[] {
    const playable = schedule.filter(e => e && e.step && e.step.type === 'node' && !e.isInvalid);
    if (playable.length === 0) return [];

    if (options.firstStepIsRunning) {
        const baseSeconds = playable[0].cumulativeEndSeconds;
        return playable.map((entry, i) => {
            const next = playable[i + 1];
            return {
                stepIndex: entry.index,
                slotIndex: null,
                offsetMs: Math.max(0, Math.round((entry.cumulativeEndSeconds - baseSeconds) * 1000)),
                finishes: describeNode(entry),
                startNext: next ? describeNode(next) : null,
                observed: i === 0,
            };
        });
    }

    // Nothing in this list has been started. T0 is when the thing the player IS running finishes,
    // which is the moment row 0 of the list begins — so the chain keeps its full length and one
    // synthetic completion carries the anchor, exactly as `eggLanes` does per slot for the same
    // reason (it marks its own `anchorItem`; this one cannot be dropped, because the tech tree has
    // no "empty" state — there is always something on the clock or nothing to time at all).
    // `stepIndex` 0 is reserved for it; the rows shift to `index + 1`.
    const out: PlanCompletion[] = [{
        stepIndex: 0,
        slotIndex: null,
        offsetMs: 0,
        finishes: options.anchorFinishes || 'The upgrade you have running',
        startNext: describeNode(playable[0]),
        observed: true,
    }];

    for (let i = 0; i < playable.length; i++) {
        const entry = playable[i];
        const next = playable[i + 1];
        out.push({
            stepIndex: entry.index + 1,
            slotIndex: null,
            offsetMs: Math.max(0, Math.round(entry.cumulativeEndSeconds * 1000)),
            finishes: describeNode(entry),
            startNext: next ? describeNode(next) : null,
            observed: false,
        });
    }

    return out;
}

function describeNode(entry: TreeScheduleLike): string {
    const name = (entry.nodeName || 'Tech upgrade').trim();
    return entry.toLevel > 0 ? `${name} ${entry.fromLevel}→${entry.toLevel}` : name;
}

/* ------------------------------------------------------------------------------------------ *
 * Adapter: the egg planner
 * ------------------------------------------------------------------------------------------ */

/** The shape of one `useEggsCalculator().optimization.timeline` entry. */
export interface EggEventLike {
    rarity: string;
    /** Minutes from the plan's implicit zero. */
    startTime: number;
    endTime: number;
}

/** How many eggs one lane may hold before its step indices would collide with the next lane's. */
export const EGG_LANE_STRIDE = 1000;

/**
 * `optimization.timeline` -> ONE LANE PER HATCH SLOT, each lane's offsets measured from that slot's
 * own anchor.
 *
 * The optimizer starts every slot at zero (`slots = new Array(availableSlots).fill(0)`), so lane
 * `n`'s `endTime`s are already "minutes after slot n comes free" — which is precisely the quantity
 * slot n's anchor turns into a clock time. No lane is measured through another one, so three slots
 * finishing at 14:05, 15:40 and 22:10 produce three independent sets of alarms.
 *
 * Each lane opens with a synthetic completion at `offsetMs = 0` marked `anchorItem`: the egg that
 * slot has in it right now, the only egg in the plan whose finish time the player actually knows.
 * `anchorLanes()` keeps it for a BUSY slot and drops it for an IDLE one, because an empty slot has
 * nothing about to pop. A busy slot with no planned eggs still keeps it, and that is the point: "slot
 * 3 is done" is the single most useful thing this feature can say, plan or no plan.
 *
 * `stepIndex` is `slot * EGG_LANE_STRIDE + position + 1`, with `slot * EGG_LANE_STRIDE` reserved for
 * the anchor item. Stable under a re-derivation of the same plan, unique across lanes, and unique
 * for up to 999 eggs in a slot (`EggHatchSlotMaxCount` is 4 and a slot holds tens).
 */
export function eggLanes(timeline: readonly (readonly EggEventLike[])[]): PlanCompletion[][] {
    return (timeline || []).map((rawLane, slot) => {
        const lane = (rawLane || []).filter(e => e && Number.isFinite(e.endTime));
        const nameOf = (event: EggEventLike) => `${event.rarity} egg (slot ${slot + 1})`;

        const out: PlanCompletion[] = [{
            stepIndex: slot * EGG_LANE_STRIDE,
            slotIndex: slot,
            offsetMs: 0,
            // Not a rarity: the plan does not know what is in the slot, only the player does, and
            // inventing a rarity here would be a fabrication in the title of a push notification.
            finishes: `The egg in slot ${slot + 1}`,
            startNext: lane[0] ? nameOf(lane[0]) : null,
            observed: true,
            anchorItem: true,
        }];

        lane.forEach((event, position) => {
            const next = lane[position + 1];
            out.push({
                stepIndex: slot * EGG_LANE_STRIDE + position + 1,
                slotIndex: slot,
                offsetMs: Math.max(0, Math.round(event.endTime * 60_000)),
                finishes: nameOf(event),
                startNext: next ? nameOf(next) : null,
                observed: false,
            });
        });

        return out;
    });
}
