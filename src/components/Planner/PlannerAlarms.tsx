/**
 * PlannerAlarms — an anchor per slot, one planner, and the alarms that fall out of them.
 * ====================================================================================
 *
 * WHAT THE PLAYER DOES HERE
 * -------------------------
 * They PICK how long is left on the thing they have running — "2h 10m", read off the game, out of
 * two dropdowns — and every later completion in this planner's plan is derived from that plus the
 * plan's own durations (`src/utils/plannerSchedule.ts`, which is where all the arithmetic lives and
 * where it is tested). The list re-derives as they pick, BEFORE anything is queued; the queue is
 * written later, once, after a debounce.
 *
 * ONE ANCHOR, OR ONE PER SLOT
 * ---------------------------
 * The tech tree passes `completions` and gets one anchor, because the game runs ONE upgrade at a
 * time and both its tabs describe that same physical slot. The egg planner passes `lanes` and gets
 * one anchor PER HATCH SLOT, because it hatches in several at once and each has its own countdown:
 * a player whose slots pop at 14:05, 15:40 and 22:10 cannot say that with a single reading, and two
 * of their three alarm sets used to be wrong. Slot n's alarms come from lane n and nothing else.
 *
 * A SLOT HAS THREE STATES AND "EMPTY" IS A REAL ONE
 * ------------------------------------------------
 * Hatching (a countdown, picked), Empty (nothing in it, ready now) and nothing-said-yet. Empty is a
 * button and not a duration of zero: zero is unrepresentable in the control by design (see
 * `DurationSelect`) and five minutes would be a lie in the other direction. Pressing Empty stamps
 * the instant the way Set does, so the slot's first planned egg is timed from THEN and never walks
 * forward with the clock, and that slot's first alarm is the one it would earn if the player loaded
 * it now — not silence.
 *
 * AND A SLOT THAT ARMED NOTHING SAYS SO
 * -------------------------------------
 * A countdown that has run out is refused by the gate and the row goes amber. An EMPTY stamp cannot
 * be refused the same way — "empty at 01:15" stays true for ever — so a slot marked empty last night
 * comes back this morning with a perfectly valid anchor and a lane whose every completion is behind
 * the clock. Every one of them is dropped, the queue holds nothing for that slot, and the row would
 * happily go on saying "so its 3 eggs are timed from then". So the row compares what its lane put in
 * against what came out, and when nothing survived it says that, in amber, where the reassuring
 * sentence used to sit alone. Same treatment for a slot whose egg pops inside the warning window.
 *
 * THE LAYOUT, AND WHY IT IS THIS ONE
 * ----------------------------------
 * Four slots times two selects is eight dropdowns, and at 360 px the panel's content column is
 * about 240 px wide: a naive column of eight is unusable, and a grid of them is worse. So AT MOST
 * ONE slot editor is open at a time. Every slot is a single line carrying its name, a two-button
 * Hatching/Empty choice and one sentence of state; the open one grows the two selects and a Set
 * button underneath, full width. That bounds the panel at "N lines plus one editor" no matter how
 * many slots the player has, and it matches how the reading is actually made: the game shows one
 * slot's countdown at a time, so the panel asks for one at a time. Committing a slot opens the next
 * one that still has nothing set, which turns four slots into a straight run of picks.
 *
 * THE INPUT IS A DURATION, NOT A CLOCK TIME, AND THAT IS THE WHOLE POINT
 * ---------------------------------------------------------------------
 * The game shows a countdown. It does not show "finishes at 16:46". Asking for a wall-clock time
 * would make the player do the arithmetic this file exists to do, and `misc.techPlanStartDate` —
 * a bare `datetime-local` the user picks, with no timezone — is already the thing 0009 D6 calls out
 * as the reason `fire_at` "is only ever as good as that anchor". A duration chosen at a known
 * instant is a strictly better anchor: it is stamped to `Date.now()` once, here, and then never
 * moves.
 *
 * AND IT IS NOT TYPED. `DurationSelect` (same folder) replaced a free-text field, on the owner's
 * instruction: the remaining time is to be PICKED — a calendar, or at most two selects — never
 * written by hand. Read that file's header for the range, the 5-minute step and what the step
 * costs. The one consequence that belongs HERE is that two whole failure states this panel used to
 * render are now unreachable from the control: there is no unparseable text, and there is no zero.
 * `parseDurationMs` survives for exactly one job — reading back an `anchorText` written by the old
 * build — and `deriveAlarms` still returns `anchor-not-positive`, because a stored anchor goes
 * stale on its own as the clock passes it.
 *
 * WHY THE ANCHOR IS NOT IN THE PROFILE
 * ------------------------------------
 * It lives in `localStorage`, keyed by profile id, and not in `profile.misc`. Not a shortcut — a
 * correctness decision. 0009's staleness gate stamps `profiles.version` at arming time and treats
 * ANY later bump as "the plan moved", and `profiles_touch` bumps that version on every profile
 * write. Storing the anchor in the profile would therefore mean that typing the anchor bumps the
 * version, so every alarm derived from it would be born stale and every notification would arrive
 * with its advice already stripped. The anchor is also a per-device observation ("what I have
 * running right now"), which is not part of the character's build and has no business travelling
 * through profile sync.
 *
 * The PLAN does live in the profile, though (`misc.techPlanQueue` / `techPlanStartDate`), so the
 * sync below still does what 0009 demands in so many words: "persist the profile FIRST, arm
 * SECOND". `sync.flushNow()` is awaited before every `arm_plan_alarms` call.
 *
 * NO ORPHANS, BY CONSTRUCTION
 * ---------------------------
 * This component never inserts, never patches and never deletes an individual row. It computes the
 * COMPLETE desired set and hands it to `arm_plan_alarms(profile, planner, hash, rows)`, whose first
 * statement deletes every pending unclaimed row for that (profile, planner) — so the server cannot
 * end up holding a row this client did not just ask for, and re-deriving the tech queue cannot touch
 * the egg queue because the DELETE is keyed on `planner`. An empty derivation is still sent (0009
 * deletes, then returns 0), which is how a plan that shrank takes its alarms with it. Turning the
 * switch off calls `cancel_plan_alarms(profile, planner)`, same guarantee, clearer intent.
 *
 * That matters more than tidiness: WebKit revokes a push subscription for a notification that
 * displays nothing useful, so a queued row that has become pointless has to be DELETED rather than
 * left to fire.
 *
 * IT RENDERS NOTHING when the build has no `VITE_SUPABASE_*` (no accounts, nothing to notify) or
 * when nobody is signed in — the owner's decision, and the same rule `PushPanel` follows.
 *
 * `data-planner-alarms` carries the planner and `data-alarm-state` the state, for
 * `reverseForge/scratch/alarms_shots.mjs`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, AlertTriangle, BellRing, Check, Loader2, X } from 'lucide-react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { getSupabaseClient } from '../../services/supabaseClient';
import { readPushEnvironment, readSubscriptionState } from '../../services/pushClient';
import {
    DEFAULT_DURATION_MS,
    DurationSelect,
    formatDurationExact,
    snapDurationMs,
} from './DurationSelect';
import {
    DEFAULT_LEAD_SECONDS,
    alarmPayload,
    anchorLanes,
    anchorRefusalMessage,
    deriveAlarmsAt,
    formatDurationShort,
    laneRefusalMessage,
    parseDurationMs,
    planHashOf,
    toArmRows,
    type Derivation,
    type DerivedAlarm,
    type LaneStatus,
    type PlanCompletion,
    type PlannerId,
    type SlotAnchor,
} from '../../utils/plannerSchedule';

/* ------------------------------------------------------------------------------------------ *
 * Local, per-profile, per-planner state
 * ------------------------------------------------------------------------------------------ */

const STORE_KEY = 'forgeMaster_plannerAlarms';

/**
 * One slot's anchor as it is stored. `anchorAtMs` means the same thing in both kinds — the instant
 * that slot comes free — which is why nothing downstream has to branch on `kind`: for `busy` it is
 * a countdown's end (future), for `idle` it is the moment the player said the slot was empty (past).
 *
 * Both are STAMPED, and that is the same decision the single anchor made for the same reason: a
 * stored duration would make every render derive a later completion, so the plan would walk forward
 * in time for as long as the page stayed open.
 */
interface StoredSlotAnchor {
    kind: 'busy' | 'idle';
    anchorAtMs: number;
    /** `busy` only: the committed duration, so the two selects reopen on what the player picked. */
    anchorMs?: number | null;
    /** When they said it. `busy`: `anchorAtMs - anchorMs`. `idle`: `anchorAtMs` itself. */
    setAtMs: number;
}

interface AnchorRecord {
    enabled: boolean;
    /** T0 as an absolute instant. Stamped once, when the duration was committed. */
    anchorAtMs: number | null;
    /**
     * The committed duration, in ms. Added when the typed field became two selects: it is what the
     * dropdowns are restored from, and comparing it against the current pick is how the panel knows
     * whether there is an uncommitted change to show.
     */
    anchorMs?: number | null;
    /**
     * The same duration in words. No longer the source of truth — `anchorMs` is — but still written,
     * for two reasons: a record saved by this build stays readable by the old one, and a record
     * saved by the OLD build (which has no `anchorMs`) is recovered from it below via
     * `parseDurationMs`. Written by `formatDurationExact`, NOT `formatDurationShort`, which keeps
     * only two fields and would turn "1d 2h 10m" into "1d 2h".
     */
    anchorText: string;
    /** When they set it — the difference between this and now is how stale the reading is. */
    setAtMs: number | null;
    /** True once anything has ever been armed, so a never-used panel makes no requests at all. */
    everArmed?: boolean;
    /**
     * PER-SLOT anchors, index = slot. `null` at an index means "nothing said about that slot yet".
     *
     * Kept for EVERY slot the player has ever configured, not just the ones currently shown: the
     * slot count is a number they change (a fourth hatch bed is bought, or they mis-typed a 4 for a
     * 2), and dropping to two slots and back must not silently forget what slots 3 and 4 said. The
     * render slices this to the current count; nothing here is ever truncated.
     */
    slots?: (StoredSlotAnchor | null)[];
}

const BLANK: AnchorRecord = { enabled: false, anchorAtMs: null, anchorMs: null, anchorText: '', setAtMs: null, slots: [] };

type Store = Record<string, Partial<Record<PlannerId, AnchorRecord>>>;

function readStore(): Store {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
    } catch {
        return {};
    }
}

function readRecord(profileId: string, planner: PlannerId): AnchorRecord {
    const stored = readStore()[profileId]?.[planner];
    if (!stored || typeof stored !== 'object') return BLANK;
    const anchorText = typeof stored.anchorText === 'string' ? stored.anchorText : '';
    // A record from before the selects existed has no `anchorMs`. Recover it from the text the old
    // build wrote so the dropdowns open on what the player last entered rather than on the default.
    const fromText = anchorText ? parseDurationMs(anchorText) : null;
    const anchorMs = typeof stored.anchorMs === 'number' && Number.isFinite(stored.anchorMs)
        ? stored.anchorMs
        : (fromText !== null && fromText > 0 ? fromText : null);
    const anchorAtMs = typeof stored.anchorAtMs === 'number' && Number.isFinite(stored.anchorAtMs) ? stored.anchorAtMs : null;
    const setAtMs = typeof stored.setAtMs === 'number' && Number.isFinite(stored.setAtMs) ? stored.setAtMs : null;
    return {
        enabled: stored.enabled === true,
        anchorAtMs,
        anchorMs,
        anchorText,
        setAtMs,
        everArmed: stored.everArmed === true,
        slots: readSlotAnchors(stored, anchorAtMs, anchorMs, setAtMs),
    };
}

/**
 * The per-slot anchors, with the ONE-ANCHOR record from the previous build carried across.
 *
 * That old record said "the egg you have hatching has 2h 10m left" without saying which slot it was
 * in — the planner could not ask, because it only had room for one reading. Rather than discard a
 * reading the player made, it is attached to slot 1 and the other slots come up unset. That is a
 * guess about WHICH slot and it is visible as one: slot 1 shows the duration in its selects and its
 * own state line, so a player whose egg was really in slot 3 sees a wrong number rather than a
 * silently mis-timed queue, and fixes it with two taps.
 */
function readSlotAnchors(
    stored: Partial<AnchorRecord>,
    legacyAnchorAtMs: number | null,
    legacyAnchorMs: number | null,
    legacySetAtMs: number | null,
): (StoredSlotAnchor | null)[] {
    const raw = (stored as { slots?: unknown }).slots;
    if (Array.isArray(raw)) {
        return raw.map(entry => {
            if (!entry || typeof entry !== 'object') return null;
            const slot = entry as Partial<StoredSlotAnchor>;
            if (slot.kind !== 'busy' && slot.kind !== 'idle') return null;
            if (typeof slot.anchorAtMs !== 'number' || !Number.isFinite(slot.anchorAtMs)) return null;
            return {
                kind: slot.kind,
                anchorAtMs: slot.anchorAtMs,
                anchorMs: typeof slot.anchorMs === 'number' && Number.isFinite(slot.anchorMs) ? slot.anchorMs : null,
                setAtMs: typeof slot.setAtMs === 'number' && Number.isFinite(slot.setAtMs) ? slot.setAtMs : slot.anchorAtMs,
            };
        });
    }
    if (legacyAnchorAtMs === null) return [];
    return [{ kind: 'busy', anchorAtMs: legacyAnchorAtMs, anchorMs: legacyAnchorMs, setAtMs: legacySetAtMs ?? legacyAnchorAtMs }];
}

function writeRecord(profileId: string, planner: PlannerId, record: AnchorRecord): void {
    try {
        const store = readStore();
        store[profileId] = { ...store[profileId], [planner]: record };
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
        /* private mode, or storage full. The panel keeps working for this session. */
    }
}

/* ------------------------------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------------------------------ */

export interface PlannerAlarmsProps {
    planner: PlannerId;
    /** Hash route the notification deep-links to, e.g. `#/calculators/tree`. */
    route: string;
    /**
     * ONE-LANE planners: the whole plan, already reduced by `treeCompletions()`, measured from a
     * single anchor. Mutually exclusive with `lanes`.
     */
    completions?: PlanCompletion[];
    /**
     * PER-SLOT planners: one lane per slot, from `eggLanes()`, each lane's offsets measured from
     * THAT slot's own anchor. Passing this is what turns the panel into the per-slot layout.
     */
    lanes?: PlanCompletion[][];
    /**
     * How many slots to ask about. Comes from the player's own "slots available", NOT from
     * `lanes.length`, so the anchors keep their shape while the plan is empty and the optimizer has
     * produced no timeline at all. Missing lanes read as empty ones.
     */
    slotCount?: number;
    /** Names one slot in running text, lower case: `i => \`slot ${i + 1}\``. Required with `lanes`. */
    laneLabel?: (index: number) => string;
    /** ONE-LANE only. What the anchor asks about: "the upgrade you have running". */
    anchorNoun?: string;
    /**
     * One sentence saying what the derived times assume, in this planner's terms. Shown under the
     * list, always, because the player has to be able to tell whether the advice applies to them.
     */
    assumption: string;
    /**
     * Which of a planner's surfaces this plan came from, e.g. "Optimizer plan" / "Planner plan".
     * Only the tech tree passes it, and only because it has two surfaces sharing one `planner` key:
     * `arm_plan_alarms` replaces every pending row for a `(profile, planner)` pair, so the account
     * holds ONE tech queue and the badge is what stops that being a silent surprise. Omit it and
     * nothing is rendered — the egg planner has a single surface and needs no disambiguation.
     */
    planLabel?: string;
    className?: string;
}

type SyncState = 'off' | 'idle' | 'syncing' | 'armed' | 'error';

/* ------------------------------------------------------------------------------------------ *
 * The component
 * ------------------------------------------------------------------------------------------ */

export function PlannerAlarms({
    planner, route, completions, lanes, slotCount, laneLabel, anchorNoun, assumption, planLabel, className,
}: PlannerAlarmsProps) {
    const { status } = useAuth();
    const { profile, sync } = useProfile();
    const { selectedVersion } = useGameDataContext();

    const signedIn = status === 'signed-in';
    const profileId = profile?.id || '';

    const perSlot = Array.isArray(lanes);
    const nameOf = laneLabel || ((i: number) => `slot ${i + 1}`);

    const [record, setRecord] = useState<AnchorRecord>(BLANK);
    /**
     * What the two selects currently hold, in ms. Always a duration the control can express and
     * always `>= MIN_DURATION_MS`, so there is no "empty" and no "unreadable" — but it is NOT the
     * anchor until Set is pressed, which is what `record.anchorMs` records.
     */
    const [draftMs, setDraftMs] = useState<number>(DEFAULT_DURATION_MS);
    /**
     * The same, per slot, for the one editor that is open. Keyed by slot rather than held as a
     * single value so that moving between slots does not carry one slot's half-made pick into the
     * next: each slot's dropdowns come back to what that slot last held.
     */
    const [slotDrafts, setSlotDrafts] = useState<Record<number, number>>({});
    /** Which slot's editor is open, and never more than one. See the header for why. */
    const [openSlot, setOpenSlot] = useState<number | null>(0);
    const [syncState, setSyncState] = useState<SyncState>('off');
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [armedCount, setArmedCount] = useState<number | null>(null);
    const [deviceReady, setDeviceReady] = useState<boolean | null>(null);

    /**
     * The clock, and the only reason there is one. Nothing is derived FROM it — `anchorAtMs` is
     * absolute — but an alarm whose warning window has already closed must stop being listed and
     * stop being armed, and that is a function of the current time.
     */
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNowMs(Date.now()), 20_000);
        return () => window.clearInterval(id);
    }, []);

    // Load (and reload when the active profile changes — the anchor is per profile).
    useEffect(() => {
        if (!profileId) return;
        const loaded = readRecord(profileId, planner);
        setRecord(loaded);
        // `snapDurationMs` floors, so a stored "2h 14m" from the old typed field opens the selects
        // on 2h 10m rather than being silently rounded up past the real completion.
        setDraftMs(loaded.anchorMs ? snapDurationMs(loaded.anchorMs) : DEFAULT_DURATION_MS);
        setSlotDrafts({});
        // Open whatever this profile has not answered yet. A profile with every slot already set
        // opens nothing, so switching profiles does not present an editor nobody asked for.
        setOpenSlot(firstUnset(loaded.slots, slotCount ?? (lanes?.length ?? 0)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profileId, planner]);

    // Is THIS device actually subscribed? The alarms are queued for the ACCOUNT, so they are not
    // wasted if it is not — but the player should know why nothing buzzes here.
    useEffect(() => {
        if (!signedIn) return;
        let alive = true;
        const environment = readPushEnvironment();
        if (environment.blocker || environment.permission !== 'granted') {
            setDeviceReady(false);
            return;
        }
        void readSubscriptionState().then(state => { if (alive) setDeviceReady(state.subscribed); });
        return () => { alive = false; };
    }, [signedIn]);

    const commit = useCallback((next: AnchorRecord) => {
        setRecord(next);
        if (profileId) writeRecord(profileId, planner, next);
    }, [profileId, planner]);

    /* ---- the derivation, recomputed on every render that matters ------------------------- */

    /**
     * The plan as LANES. One lane for a single-anchor planner, `slotCount` of them for a per-slot
     * one — padded with empty lanes rather than shortened to what the optimizer happened to produce,
     * because the panel must go on asking about slot 4 while the plan for it is still empty.
     *
     * Not memoised, and deliberately: `deriveAlarmsAt` is a sort over tens of items and `planHashOf`
     * an FNV pass over a couple of kilobytes, while the things a memo would have to depend on are
     * two arrays and an object that a parent re-render replaces anyway. The sync effect below hangs
     * off `desired`, which is a STRING, so a recomputed-but-identical derivation costs nothing and
     * cannot retrigger anything.
     */
    const laneCount = perSlot ? Math.max(0, slotCount ?? (lanes?.length ?? 0)) : 1;
    const laneList: PlanCompletion[][] = perSlot
        ? Array.from({ length: laneCount }, (_, i) => (lanes as PlanCompletion[][])[i] || [])
        : [completions || []];

    const anchors: SlotAnchor[] = perSlot
        ? laneList.map((_, i) => {
            const slot = record.slots?.[i];
            return slot ? { kind: slot.kind, anchorAtMs: slot.anchorAtMs } : { kind: 'unset' };
        })
        : [record.anchorAtMs === null ? { kind: 'unset' } : { kind: 'busy', anchorAtMs: record.anchorAtMs }];

    const anchored = anchorLanes({ nowMs, lanes: laneList, anchors });

    /**
     * The slot count is the player's and it moves: a hatch bed is unlocked, or a 4 was typed where a
     * 2 was meant. Two things follow, and neither is cosmetic.
     *
     *   - an editor left open on slot 4 when the count drops to 2 is an editor for a slot that no
     *     longer exists, and pressing Set in it would stamp an anchor nothing reads;
     *   - a slot that has just appeared has nothing set, and the panel exists to ask. Leaving it
     *     silent is how a slot ends up unarmed without the player being told.
     */
    const lastLaneCount = useRef<number>(0);
    useEffect(() => {
        if (!perSlot) return;
        if (lastLaneCount.current === laneCount) return;
        lastLaneCount.current = laneCount;
        // An editor that is still in range is left exactly where it is: the count moving is not a
        // reason to close something the player is in the middle of.
        setOpenSlot(prev => (prev !== null && prev < laneCount ? prev : firstUnset(record.slots, laneCount)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [perSlot, laneCount]);


    /**
     * The anchor a row falls back to when its own lane cannot name one (a coalesced group spanning
     * two slots). The EARLIEST live lane, so the fallback is at least a real reading the player
     * made rather than the moment the sync happened to run.
     */
    const liveAnchors = anchored.lanes.map(l => l.anchorAtMs).filter((ms): ms is number => ms !== null);
    const contextAnchorMs = liveAnchors.length ? Math.min(...liveAnchors) : null;

    const derived = deriveAlarmsAt({
        nowMs,
        completions: anchored.completions,
        anchorAtMs: contextAnchorMs,
        leadSeconds: DEFAULT_LEAD_SECONDS,
    });

    /**
     * A refusal is only a refusal when EVERY lane is refused: one dead slot must not take the other
     * three down with it, which is the whole point of the change. With one lane this is exactly the
     * gate `deriveAlarms` applies, word for word — `anchorRefusalMessage` is the shared source of
     * both sentences.
     */
    const derivation: Derivation = anchored.refusal
        ? {
            ok: false,
            refusal: anchored.refusal,
            message: perSlot ? laneRefusalMessage(anchored.lanes, nameOf) : anchorRefusalMessage(anchored.refusal),
            anchorAtMs: null,
            alarms: [],
            dropped: [],
            signature: 'refused:' + anchored.refusal,
        }
        : derived;

    const planHash = planHashOf({
        planner,
        configVersion: selectedVersion || '',
        // One number for one anchor keeps the tech tree's hash byte-identical to what it was; the
        // array form is what makes moving slot 3's reading move the key, as it must.
        anchorAtMs: perSlot ? anchored.lanes.map(l => l.anchorAtMs ?? 0) : (record.anchorAtMs ?? 0),
        leadSeconds: DEFAULT_LEAD_SECONDS,
        completions: perSlot ? anchored.completions : (completions || []),
    });

    /* ---- the queue ----------------------------------------------------------------------- */

    /**
     * What the server was last told, so an unchanged desired set costs nothing. `null` means "we
     * have not spoken to the server in this session", which is deliberately NOT the same as "off":
     * the account may still hold rows from a previous session, and the first sync of the session is
     * what reconciles them.
     */
    const lastPushed = useRef<string | null>(null);
    const desired = record.enabled ? `on:${planHash}:${derivation.signature}` : 'off';

    /**
     * The values the sync reads, mirrored so the effect can depend on `desired` ALONE.
     *
     * `derivation` is a fresh object on every 20-second tick and `record` is an object too, so
     * listing them as dependencies would tear down and rebuild the debounce timer on every tick —
     * which is exactly how a debounce becomes a timer that never fires while the clock is running.
     * `desired` is a string, and it changes if and only if the request would change.
     */
    const live = useRef({ record, derivation, planHash, contextAnchorMs, flushNow: sync.flushNow, commit });
    live.current = { record, derivation, planHash, contextAnchorMs, flushNow: sync.flushNow, commit };

    useEffect(() => {
        if (!signedIn || !profileId) return;
        // A panel nobody has ever switched on makes no requests. Without this, every visit to
        // either planner page would fire a cancel for a queue that was always empty.
        if (!live.current.record.enabled && !live.current.record.everArmed) return;
        if (lastPushed.current === desired) return;

        let cancelled = false;
        const timer = window.setTimeout(() => { void run(); }, 1200);

        return () => { cancelled = true; window.clearTimeout(timer); };

        async function run() {
            const { record, derivation, planHash, contextAnchorMs, flushNow, commit } = live.current;
            setSyncState('syncing');
            setSyncMessage(null);
            try {
                const client = await getSupabaseClient();
                if (!client) return;

                if (!record.enabled) {
                    const { error } = await client.rpc('cancel_plan_alarms', {
                        p_profile_id: profileId,
                        p_planner: planner,
                    });
                    if (cancelled) return;
                    if (error) { fail(error); return; }
                    lastPushed.current = desired;
                    setArmedCount(0);
                    setSyncState('off');
                    return;
                }

                // 0009's client ordering requirement, in its own words: "persist the profile FIRST,
                // arm SECOND. Arming first would stamp the pre-save version and every alarm would
                // be born stale." The plan lives in `profile.misc`, so this is not optional.
                await flushNow().catch(() => undefined);
                if (cancelled) return;

                const armedAtMs = Date.now();
                const rows = toArmRows(derivation.alarms, {
                    planner,
                    planHash,
                    route,
                    // Only a fallback: every alarm derived from a lane carries that lane's own
                    // anchor and `alarmPayload` prefers it, so this is read for a row whose
                    // coalesced group spanned two slots and therefore has no single reading.
                    anchorAtMs: contextAnchorMs ?? record.anchorAtMs ?? armedAtMs,
                    armedAtMs,
                });

                const { data, error } = await client.rpc('arm_plan_alarms', {
                    p_profile_id: profileId,
                    p_planner: planner,
                    p_plan_hash: planHash,
                    p_alarms: rows,
                    // 0009 records this because `techPlanStartDate` carries no timezone while
                    // `getWarDayIndex` is pure UTC: a plan anchored here and read elsewhere would
                    // otherwise land hours away with nothing to show it had.
                    p_tz_offset_min: new Date().getTimezoneOffset(),
                });
                if (cancelled) return;
                if (error) { fail(error); return; }

                lastPushed.current = desired;
                setArmedCount(typeof data === 'number' ? data : rows.length);
                setSyncState(rows.length > 0 ? 'armed' : 'idle');
                if (!record.everArmed) commit({ ...record, everArmed: true });
            } catch {
                if (!cancelled) {
                    setSyncState('error');
                    setSyncMessage('Could not reach the server. Nothing changed; it is retried when you come back.');
                }
            }
        }

        function fail(error: { code?: string; message?: string }) {
            lastPushed.current = null;
            setSyncState('error');
            setSyncMessage(describeRpcError(error));
        }
    }, [signedIn, profileId, planner, route, desired]);

    /* ---- render -------------------------------------------------------------------------- */

    // No accounts in this build, or nobody signed in: nothing to render at all.
    if (status === 'unconfigured' || !signedIn) return null;

    /**
     * Stamp the anchor ONCE, here. `anchorAtMs` is what everything downstream reads, so the moment
     * of the reading is captured at the moment of the pick and never re-derived from a later clock.
     *
     * This is a BUTTON and not an `onChange`, and that is worth a sentence. Committing on every
     * select change would stamp an anchor from a half-made choice — pick 3 hours while the minutes
     * are still on last week's 40, pause longer than the sync debounce, and the account is armed
     * for 3h40m. One deliberate press is one anchor.
     */
    const onSet = () => {
        const at = Date.now();
        // Refresh the reference clock in the same breath, so the window-closed filter downstream
        // measures against the instant the player actually pressed the button and not against a
        // tick up to 20 s old.
        setNowMs(at);
        commit({
            ...record,
            anchorAtMs: at + draftMs,
            anchorMs: draftMs,
            anchorText: formatDurationExact(draftMs),
            setAtMs: at,
        });
    };

    /**
     * The same stamp, for one slot. `Set` for a countdown, `Empty` for a slot with nothing in it —
     * and Empty needs no second press because there is nothing further to choose: the tap IS the
     * whole statement, where a duration is a compound one and must be confirmed.
     *
     * Committing opens the next slot that still has nothing set, so reading four countdowns off the
     * game is one pass down the panel rather than four rounds of tap-open, pick, tap-shut.
     */
    const setSlotAnchor = (index: number, next: StoredSlotAnchor | null) => {
        const at = Date.now();
        setNowMs(at);
        const slots = [...(record.slots || [])];
        while (slots.length <= index) slots.push(null);
        slots[index] = next;
        commit({ ...record, slots });
        setOpenSlot(firstUnset(slots, laneCount));
    };

    const setSlotBusy = (index: number, ms: number) => {
        const at = Date.now();
        setSlotAnchor(index, { kind: 'busy', anchorAtMs: at + ms, anchorMs: ms, setAtMs: at });
    };

    const setSlotIdle = (index: number) => {
        const at = Date.now();
        setSlotAnchor(index, { kind: 'idle', anchorAtMs: at, anchorMs: null, setAtMs: at });
    };

    const toggle = () => {
        const next = !record.enabled;
        commit({ ...record, enabled: next });
        if (!next) { setArmedCount(0); setSyncMessage(null); }
    };

    const anchorRemaining = record.anchorAtMs === null ? null : record.anchorAtMs - nowMs;
    /**
     * The dropdowns hold something other than the anchor that is actually committed. Compared
     * against `snapDurationMs` of the stored value so a record written by the old typed field
     * ("2h 14m", which the selects can only show as 2h 10m) does not read as a pending edit forever.
     */
    const pendingChange = record.anchorMs == null || snapDurationMs(record.anchorMs) !== draftMs;
    const visible = derivation.alarms.slice(0, 8);
    const hidden = derivation.alarms.length - visible.length;
    const preview = derivation.alarms[0]
        ? alarmPayload(derivation.alarms[0], { planner, planHash, route, anchorAtMs: contextAnchorMs ?? record.anchorAtMs ?? nowMs, armedAtMs: nowMs })
        : null;

    /**
     * "Nothing to time" is a different problem from "nothing to time it FROM", and the panel must
     * name the right one. A lane's `anchorItem` is not a step of the plan, it is the thing already
     * running, so a per-slot planner whose lanes hold nothing else is an empty plan even though its
     * lanes are not empty arrays.
     *
     * Checked alongside `alarms.length === 0` rather than on its own: a slot with an egg in it and
     * an empty plan still earns exactly one alarm, "slot 3 is done", and that is the most useful
     * thing this panel says. Announcing an empty plan over the top of it would hide it.
     */
    const planIsEmpty = laneList.every(lane => lane.every(c => c.anchorItem === true));

    /**
     * How many alarms one lane actually put in the queue.
     *
     * Counted through the STEP INDEX of the completions the lane contributed, and not as
     * `alarms.filter(a => a.slotIndex === i)`, for two reasons that both make the naive count read
     * zero for a slot that is perfectly well armed:
     *
     *   - a coalesced group spanning two slots names NEITHER of them (`slotIndex` is null for a
     *     mixed group, by design), and two slots popping inside the same minute is the normal case,
     *     not the corner one;
     *   - the number this row needs is "did anything of mine survive?", and survival is decided by
     *     the drop filters, which report per completion.
     *
     * It has to be exact because a row that says "nothing is queued for this slot" when something is
     * would send the player to re-read a countdown they already gave, and one that stays silent when
     * nothing is queued is the failure this whole panel exists to prevent.
     */
    const droppedSteps = new Set(derivation.dropped.map(d => d.stepIndex));
    const laneArmed = (index: number) => {
        let n = 0;
        for (const c of anchored.completions) {
            if (c.slotIndex === index && !droppedSteps.has(c.stepIndex)) n += 1;
        }
        return n;
    };

    const state: string = !record.enabled
        ? 'off'
        : derivation.refusal
            ? derivation.refusal
            : derivation.alarms.length === 0
                ? 'empty'
                : syncState;

    return (
        <Card
            className={cn('p-4 bg-bg-secondary/40 border-border/50', className)}
            data-planner-alarms={planner}
            data-alarm-state={state}
            data-alarm-count={derivation.alarms.length}
        >
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-bg-input flex items-center justify-center shrink-0">
                    {record.enabled
                        ? <BellRing className="w-5 h-5 text-accent-primary" />
                        : <AlarmClock className="w-5 h-5 text-text-secondary" />}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold">Alarms</span>
                                {planLabel && (
                                    <span
                                        data-alarm-plan-label
                                        className="rounded border border-accent-primary/30 bg-accent-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-primary"
                                    >
                                        {planLabel}
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-text-secondary">
                                A push about two minutes before each step finishes, saying what to start next
                            </div>
                        </div>
                        {syncState === 'syncing' && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-text-muted" />}
                        <Button
                            variant={record.enabled ? 'secondary' : 'primary'}
                            size="sm"
                            className="shrink-0"
                            onClick={toggle}
                            aria-pressed={record.enabled}
                        >
                            {record.enabled ? 'On' : 'Off'}
                        </Button>
                    </div>

                    {/* ---- the anchors, one per slot ------------------------------------- */}
                    {perSlot ? (
                        <div className="mt-3 space-y-1.5" data-alarm-slots={laneCount}>
                            {laneList.map((lane, i) => (
                                <SlotAnchorRow
                                    key={i}
                                    index={i}
                                    name={nameOf(i)}
                                    stored={record.slots?.[i] || null}
                                    status={anchored.lanes[i]}
                                    nowMs={nowMs}
                                    open={openSlot === i}
                                    plannedEggs={lane.filter(c => !c.anchorItem).length}
                                    alarmCount={laneArmed(i)}
                                    draftMs={draftFor(record.slots?.[i] || null, slotDrafts[i])}
                                    onDraft={ms => setSlotDrafts(prev => ({ ...prev, [i]: ms }))}
                                    onOpen={() => setOpenSlot(openSlot === i ? null : i)}
                                    onSet={ms => setSlotBusy(i, ms)}
                                    onIdle={() => setSlotIdle(i)}
                                />
                            ))}
                        </div>
                    ) : (
                    /* ---- the anchor ---------------------------------------------------- */
                    <div className="mt-3">
                        <div className="flex flex-wrap items-end gap-2">
                            <DurationSelect
                                className="min-w-[13rem] flex-1"
                                legend={`Time left on ${anchorNoun}`}
                                valueMs={draftMs}
                                onChange={setDraftMs}
                            />
                            <Button variant={pendingChange ? 'primary' : 'secondary'} size="sm" onClick={onSet} data-alarm-apply>
                                Set
                            </Button>
                        </div>

                        {/* What the pick means, before anything is sent: the player checks the
                            reading, not the queue. The clock time is the check that matters — a
                            wrong pick is obvious the moment it names an hour that cannot be right.

                            Every line below is `text-text-secondary` and never `text-text-muted`:
                            muted measures 3.94:1 on this card — the same note PushPanel carries, and
                            it is asserted by reverseForge/scratch/alarms2_shots.mjs. */}
                        <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary" data-alarm-echo>
                            <span className="font-bold text-text-primary">{formatDurationExact(draftMs)}</span>
                            {' '}from now, finishing at{' '}
                            <span className="font-bold text-text-primary">{clockOf(nowMs + draftMs)}</span>.
                            {/* "in steps of 5", not "in 5s": on a panel whose other numbers are
                                seconds and minutes, "5s" reads as five seconds to at least some
                                people, and the one thing this sentence exists to do is tell them
                                which way to round. */}
                            {' '}Minutes go in steps of 5, so pick the step at or below the game's countdown and the
                            warning lands early rather than late.
                        </p>

                        {/* The committed anchor, and whether the dropdowns still agree with it. Without
                            this the two selects look applied the moment they are touched, and a player
                            who picked but never pressed Set would believe an anchor they do not have. */}
                        {record.anchorAtMs !== null && record.setAtMs !== null ? (
                            <p className="mt-1 text-[11px] text-text-secondary" data-alarm-anchor-state={pendingChange ? 'pending' : 'set'}>
                                Anchored at {clockOf(record.setAtMs)}
                                {anchorRemaining !== null && anchorRemaining > 0
                                    ? `, ${formatDurationShort(anchorRemaining)} still to go.`
                                    : ', and that moment has passed. Set it again.'}
                                {pendingChange && (
                                    <span className="text-amber-400"> Press Set to move it to what the dropdowns now say.</span>
                                )}
                            </p>
                        ) : (
                            <p className="mt-1 text-[11px] text-text-secondary" data-alarm-anchor-state="unset">
                                Not set yet. Read the countdown off the game, pick it above, then press{' '}
                                <span className="font-bold text-text-primary">Set</span>. Nothing is queued until you do.
                            </p>
                        )}
                    </div>
                    )}

                    {/* ---- the derived list --------------------------------------------- */}
                    <div className="mt-3 rounded-lg border border-border bg-bg-input/40 p-2" data-alarm-list>
                        {/* ORDER MATTERS. "no plan" is checked before "no anchor", because with
                            neither the anchor is not the thing to fix: asking for a duration on a
                            page with nothing to time would be advice the reader cannot act on. */}
                        {planIsEmpty && derivation.alarms.length === 0 ? (
                            <p className="p-1 text-xs text-text-secondary leading-relaxed">
                                <span className="font-bold text-amber-400">This plan is empty.</span> Add steps to the plan
                                and they show up here with the time each one finishes.
                            </p>
                        ) : derivation.refusal ? (
                            <p className="p-1 text-xs text-text-secondary leading-relaxed">
                                <span className="font-bold text-amber-400">Nothing to arm.</span> {derivation.message}
                            </p>
                        ) : derivation.alarms.length === 0 ? (
                            <p className="p-1 text-xs text-text-secondary leading-relaxed">
                                <span className="font-bold text-amber-400">Nothing left to warn about.</span> Every
                                completion in this plan is either already inside the two-minute window or further out than
                                a week. Nothing is queued.
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {visible.map(alarm => (
                                    <li
                                        key={alarm.stepIndex}
                                        data-alarm-row={alarm.stepIndex}
                                        className="flex flex-wrap items-baseline gap-x-2 rounded px-1 py-1 text-xs"
                                    >
                                        {/* Kept a DIRECT child of the li: `alarms_shots.mjs` reads the
                                            listed times through `[data-alarm-row] > span:first-child`. */}
                                        <span className="font-mono font-bold text-accent-primary shrink-0 tabular-nums">
                                            {clockOf(alarm.fireAtMs)}
                                        </span>
                                        <span className="min-w-0 flex-1 basis-40 text-text-primary">
                                            {alarm.finishes}
                                            {alarm.startNext && (
                                                <span className="text-text-secondary"> → start {alarm.startNext}</span>
                                            )}
                                        </span>
                                        {/* `basis-full` drops it to its own line instead of fighting the
                                            label for the right-hand edge of a narrow column. */}
                                        {alarm.observed && (
                                            <span className="basis-full text-[10px] font-bold uppercase text-accent-primary/80">
                                                from the time you set
                                            </span>
                                        )}
                                    </li>
                                ))}
                                {hidden > 0 && (
                                    <li className="px-1 pt-1 text-[11px] text-text-secondary">
                                        and {hidden} more, through {dayAndClockOf(derivation.alarms[derivation.alarms.length - 1].fireAtMs)}
                                    </li>
                                )}
                            </ul>
                        )}
                    </div>

                    {/* ---- what a notification will actually say ------------------------- */}
                    {preview && (
                        <div className="mt-2 rounded-lg border border-accent-primary/25 bg-accent-primary/5 p-2" data-alarm-preview>
                            <div className="text-[10px] font-bold uppercase text-accent-primary/80">The first one reads</div>
                            <div className="mt-1 text-xs font-bold text-text-primary">{preview.notification.title}</div>
                            {/* What the device receives is the composed `body + hint`, because the
                                sender appends `hint` whenever the plan is still fresh. Rendering
                                `body` alone here would preview an empty second line. The bold title
                                above is the half that survives when the plan HAS changed. */}
                            <div className="text-[11px] text-text-secondary leading-relaxed">
                                {[preview.notification.body, preview.notification.hint].filter(Boolean).join(' ')}
                            </div>
                        </div>
                    )}

                    {/* ---- everything that is NOT armed, and why ------------------------- */}
                    {derivation.dropped.length > 0 && (
                        <p className="mt-2 text-[11px] text-text-secondary leading-relaxed" data-alarm-dropped>
                            {describeDropped(derivation.dropped)}
                        </p>
                    )}

                    {/* ---- the assumption, always ---------------------------------------- */}
                    <p className="mt-2 flex items-start gap-2 text-[11px] text-text-secondary leading-relaxed">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-text-muted" />
                        <span>
                            {assumption} Every notification says what it assumed. If a plan changes after an alarm was
                            queued the advice is dropped and only the completion is sent, because a plain timer is
                            better than wrong advice.
                        </span>
                    </p>

                    {/* ---- state --------------------------------------------------------- */}
                    {record.enabled && syncState === 'armed' && armedCount !== null && (
                        <p role="status" className="mt-2 flex items-start gap-2 text-[11px] text-text-secondary leading-relaxed">
                            <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-primary" />
                            <span>
                                {derivation.alarms.length === 1 ? '1 alarm' : `${derivation.alarms.length} alarms`} queued for
                                your account
                                {armedCount === 0 && ' (unchanged since the last time)'}
                                . They arrive on every device where you have notifications on.
                            </span>
                        </p>
                    )}
                    {record.enabled && deviceReady === false && (
                        <p className="mt-1 flex items-start gap-2 text-[11px] text-amber-400 leading-relaxed">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                                This device is not subscribed, so nothing will buzz here. Turn notifications on in
                                Profile → Misc; the alarms are queued for your account either way.
                            </span>
                        </p>
                    )}
                    {syncMessage && (
                        <p role="status" className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200 leading-relaxed">
                            <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{syncMessage}</span>
                        </p>
                    )}
                </div>
            </div>
        </Card>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * One slot
 * ------------------------------------------------------------------------------------------ */

/** The first slot inside `count` with nothing committed, or `null` when they are all answered. */
function firstUnset(slots: (StoredSlotAnchor | null)[] | undefined, count: number): number | null {
    for (let i = 0; i < count; i++) if (!slots?.[i]) return i;
    return null;
}

/** What this slot's dropdowns should hold: the live edit, else what it last committed, else 1 h. */
function draftFor(stored: StoredSlotAnchor | null, draft: number | undefined): number {
    if (typeof draft === 'number') return draft;
    if (stored && stored.kind === 'busy' && stored.anchorMs) return snapDurationMs(stored.anchorMs);
    return DEFAULT_DURATION_MS;
}

interface SlotAnchorRowProps {
    index: number;
    /** Lower case and in running text: "slot 2". Capitalised by CSS where it heads the row. */
    name: string;
    stored: StoredSlotAnchor | null;
    status: LaneStatus | undefined;
    nowMs: number;
    open: boolean;
    /** Real eggs planned for this slot, the `anchorItem` excluded. */
    plannedEggs: number;
    /**
     * Alarms this slot alone earned, coalesced groups included. Exact, because the row states it in
     * words when it is zero. `data-alarm-slot-alarms` is how the tests read the split.
     */
    alarmCount: number;
    draftMs: number;
    onDraft: (ms: number) => void;
    onOpen: () => void;
    onSet: (ms: number) => void;
    onIdle: () => void;
}

/**
 * One line per slot, and the two selects only for the slot being read.
 *
 * The Hatching/Empty pair is a two-button group and not a checkbox, because the third state matters:
 * a slot nobody has spoken about yet has NEITHER pressed, and it says so. A checkbox would have to
 * lie in one direction or the other, and the direction it would lie in is "this slot is empty", which
 * is precisely the state that arms alarms.
 */
function SlotAnchorRow({
    index, name, stored, status, nowMs, open, plannedEggs, alarmCount, draftMs, onDraft, onOpen, onSet, onIdle,
}: SlotAnchorRowProps) {
    const expired = status?.refusal === 'anchor-not-positive';
    const state = !stored ? 'unset' : expired ? 'expired' : stored.kind;
    const remaining = stored && stored.kind === 'busy' ? stored.anchorAtMs - nowMs : null;
    const pending = !stored || stored.kind !== 'busy' || stored.anchorMs == null || snapDurationMs(stored.anchorMs) !== draftMs;

    /**
     * THE READING IS ACCEPTED AND THE SLOT STILL ARMS NOTHING.
     *
     * An expired countdown is refused by the gate and says so in amber. An EMPTY slot cannot expire
     * that way: "empty at 01:15" stays a true statement of the past for ever, so the gate keeps it,
     * and the whole lane goes on being measured from 01:15. Come back the next morning and every one
     * of those completions is behind the clock, all of them are dropped as too soon to warn about,
     * and the row would otherwise go on saying "so its 3 eggs are timed from then" while the queue
     * holds nothing at all for it. Same shape, less obvious, for a slot whose egg pops inside the
     * two-minute warning window.
     *
     * `count` is what the lane put IN and `alarmCount` is what came out, so the two disagreeing is
     * exactly "this slot is silent", and it is stated rather than left to be discovered when the
     * phone does not buzz.
     */
    const silent = !!stored && !expired && (status?.count ?? 0) > 0 && alarmCount === 0;

    return (
        <div
            className={cn(
                'rounded-lg border p-2 transition-colors',
                state === 'expired' || silent ? 'border-amber-500/40 bg-amber-500/5' : 'border-border/70 bg-bg-input/30',
            )}
            data-alarm-slot={index}
            data-alarm-slot-state={state}
            data-alarm-slot-alarms={alarmCount}
            data-alarm-slot-silent={silent ? 'yes' : 'no'}
        >
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 whitespace-nowrap overflow-hidden text-clip text-xs font-bold capitalize text-text-primary">{name}</span>
                <div className="flex shrink-0 overflow-hidden rounded-md border border-border" role="group" aria-label={`What is in ${name}`}>
                    <button
                        type="button"
                        data-alarm-slot-busy
                        aria-pressed={state === 'busy' || state === 'expired'}
                        onClick={onOpen}
                        className={cn(
                            'px-2 py-1 text-[11px] font-bold transition-colors',
                            state === 'busy' || state === 'expired'
                                ? 'bg-accent-primary text-bg-primary'
                                : 'bg-bg-input text-text-secondary hover:text-text-primary',
                        )}
                    >
                        Hatching
                    </button>
                    <button
                        type="button"
                        data-alarm-slot-idle
                        aria-pressed={state === 'idle'}
                        onClick={onIdle}
                        className={cn(
                            'border-l border-border px-2 py-1 text-[11px] font-bold transition-colors',
                            state === 'idle'
                                ? 'bg-accent-primary text-bg-primary'
                                : 'bg-bg-input text-text-secondary hover:text-text-primary',
                        )}
                    >
                        Empty
                    </button>
                </div>
            </div>

            {/* The editor, for the one slot being read. `flex-wrap` and not a fixed pair of columns:
                at 360 px the Set button drops to its own line and the two selects keep the full
                width of the row, which is the difference between "5d 10h" and "5d". */}
            {open && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                    <DurationSelect
                        className="min-w-[11rem] flex-1"
                        legend={`Time left in ${name}`}
                        valueMs={draftMs}
                        onChange={onDraft}
                    />
                    <Button
                        variant={pending ? 'primary' : 'secondary'}
                        size="sm"
                        className="shrink-0"
                        onClick={() => onSet(draftMs)}
                        data-alarm-apply
                        data-alarm-slot-apply={index}
                    >
                        Set
                    </Button>
                </div>
            )}

            <p className="mt-1 text-[11px] leading-relaxed text-text-secondary" data-alarm-slot-line>
                {state === 'unset' && (
                    open
                        ? <>Read the countdown off the game, pick it above and press <span className="font-bold text-text-primary">Set</span>. If nothing is in it, press Empty.</>
                        : <>Nothing set. Say whether it is hatching or empty, or it arms nothing.</>
                )}
                {state === 'expired' && (
                    <span className="text-amber-400">That countdown has run out, so this slot arms nothing. Read it again and press Set.</span>
                )}
                {state === 'busy' && remaining !== null && (
                    <>
                        Pops at <span className="font-bold text-text-primary">{clockOf(stored!.anchorAtMs)}</span>
                        , {formatDurationShort(remaining)} to go.
                        {plannedEggs > 0 && ` Then ${plannedEggs === 1 ? '1 more egg' : `${plannedEggs} more eggs`} here.`}
                    </>
                )}
                {state === 'idle' && (
                    <>
                        Empty since <span className="font-bold text-text-primary">{clockOf(stored!.anchorAtMs)}</span>
                        {plannedEggs > 0
                            ? <>, so its {plannedEggs === 1 ? 'egg is' : `${plannedEggs} eggs are`} timed from then.</>
                            : <>, and the plan puts nothing in it.</>}
                    </>
                )}
                {/* Said last, so it corrects the sentence above rather than being buried under it. */}
                {silent && (
                    <span className="text-amber-400">
                        {' '}
                        {state === 'idle'
                            ? 'That was long enough ago that all of those times have gone by, so nothing is queued for this slot. Press Empty again to time them from now.'
                            : 'It pops too soon to warn you about, so nothing is queued for this slot.'}
                    </span>
                )}
                {open && pending && stored && (
                    <span className="text-amber-400"> Press Set to move it to what the dropdowns now say.</span>
                )}
            </p>
        </div>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------------------------------ */

function clockOf(ms: number): string {
    const d = new Date(ms);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

function dayAndClockOf(ms: number): string {
    const d = new Date(ms);
    return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function describeDropped(dropped: { reason: string }[]): string {
    const counts = new Map<string, number>();
    for (const d of dropped) counts.set(d.reason, (counts.get(d.reason) || 0) + 1);
    const phrases: string[] = [];
    const say = (reason: string, one: string, many: (n: number) => string) => {
        const n = counts.get(reason);
        if (!n) return;
        phrases.push(n === 1 ? one : many(n));
    };
    say('window-closed', 'one finishes too soon to warn you about', n => `${n} finish too soon to warn you about`);
    say('beyond-horizon', 'one is more than a week out and will be armed later', n => `${n} are more than a week out and will be armed later`);
    say('over-cap', 'one is past the 200-alarm limit', n => `${n} are past the 200-alarm limit`);
    say('duplicate-step', 'one repeated a step number and was skipped', n => `${n} repeated step numbers and were skipped`);
    say('unusable', 'one had no usable time', n => `${n} had no usable time`);
    if (phrases.length === 0) return '';
    return `Not queued: ${phrases.join('; ')}.`;
}

function describeRpcError(error: { code?: string; message?: string }): string {
    const code = error.code || '';
    const message = (error.message || '').toLowerCase();

    if (code === '42501' && message.includes('not yours')) {
        return 'This profile is not in your account yet, so the server has nowhere to attach the alarms. Upload it from the account panel and they will arm on their own.';
    }
    if (code === '42501') {
        return 'Sign in again, because the server did not recognise your session.';
    }
    if (code === '54000' && message.includes('quota')) {
        return 'Your account already has 500 notifications waiting. Turn alarms off on another plan first.';
    }
    if (code === '54000') {
        return 'This plan is too long to arm in one go. Shorten it, or the first 200 steps will be armed on their own.';
    }
    if (code === '22023') {
        return `The server refused an alarm: ${error.message || 'it did not say why'}.`;
    }
    if (!code && (message.includes('failed to fetch') || message.includes('network'))) {
        return 'Could not reach the server. Nothing changed; it is retried when you come back.';
    }
    return error.message || 'The server refused the alarms.';
}

export type { DerivedAlarm };
