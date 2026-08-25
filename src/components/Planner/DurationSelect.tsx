/**
 * DurationSelect — "how long is left", as two dropdowns and no keyboard.
 * =====================================================================
 *
 * WHY THIS IS NOT A TEXT FIELD AND NOT A DATE PICKER
 * --------------------------------------------------
 * The player is reading a COUNTDOWN off the game — "2h 14m left" — and the alarm anchor is that
 * number. Two other shapes were possible and both are wrong here:
 *
 * (The owner's instruction, in English: let me PICK the remaining time — a calendar, or at most two
 * selects — never write it by hand.)
 *
 *   - a typed field (what this replaces) accepts "2h14", "2.14", "214" and "2:14", and three of
 *     those four mean different things. `parseDurationMs` guesses well, but the player only finds
 *     out what it guessed by reading the echo, and an anchor that is silently four times too long
 *     produces alarms that never fire;
 *   - a `datetime-local` picker asks the player to convert a countdown into a wall-clock instant in
 *     their head. That conversion is the single step this whole feature exists to do for them, and
 *     it is exactly where a mistake becomes invisible: "16:46" looks equally plausible whether or
 *     not it is right.
 *
 * So: two selects. Nothing to type, nothing to parse, and every value in the list is a duration the
 * player can match against what is on the game screen.
 *
 * ZERO IS NOT VALIDATED, IT IS UNREPRESENTABLE
 * -------------------------------------------
 * `deriveAlarms` refuses an anchor at or before "now" (`anchor-not-positive`), because queueing a
 * push for something that has already happened is what gets a subscription revoked on WebKit. A
 * refusal after the fact is still a state the player can reach and be confused by, so the control
 * never offers it: when the hours select is on 0, the minutes list simply does not contain 0, and
 * choosing 0 hours while minutes is 0 moves minutes to the first step in the same change. The
 * smallest expressible duration is `MIN_DURATION_MS` (5 minutes) and there are no negative options,
 * so `joinDurationMs` cannot return anything a planner would have to refuse.
 *
 * THE RANGE IS NOT 0..23 HOURS, AND THAT IS A MEASUREMENT, NOT A PREFERENCE
 * -----------------------------------------------------------------------
 * Both planners routinely run items longer than a day, so an hours list stopping at 23 could not
 * express the truth for most of them:
 *
 *     max Duration in TechTreeUpgradeLibrary.json, across all 36 shipped config versions
 *         470814 s = 130.78 h  (2026_01_10);  15 of 25 durations in the current version are >= 24 h
 *     max HatchTime in EggLibrary.json (Mythic)
 *         115200 s =  32.00 h
 *
 * `MAX_HOURS` is therefore 167 — 6 d 23 h — and that bound is not arbitrary either: `deriveAlarms`
 * drops every completion further out than `DEFAULT_HORIZON_MS` (7 days), so an anchor of 7 days or
 * more arms literally nothing. 167 h is the largest anchor that can still produce an alarm, which
 * makes the top of the list the last useful value rather than a number somebody picked.
 *
 * Past 24 h the option reads `5d 10h` rather than `130h`, and the list is grouped by day. That is
 * the same arithmetic-avoidance as above: the game shows days, so the list shows days.
 *
 * THE MINUTE STEP IS 5, AND IT COSTS SOMETHING
 * -------------------------------------------
 * 12 minute options fit one thumb-reachable list; 60 do not. But tech durations are not round — the
 * current config has minute-remainders of 0.8, 1.57, 6.88, 14.05, 18.17, 21.45, 34.35, 43.8, 51.98
 * — so most real readings fall between two steps, and the player has to land on one of them. The
 * two directions are NOT symmetric, against a warning lead of `DEFAULT_LEAD_SECONDS` = 120 s:
 *
 *     picking the step BELOW the reading  ->  anchor up to 5 min short  ->  alarm up to 5 min EARLY
 *     picking the step ABOVE the reading  ->  anchor up to 5 min long   ->  alarm up to 3 min LATE
 *
 * An early alarm is still an alarm. A late one is a notification about something that has already
 * finished, which is both useless and the exact shape of push that gets a subscription revoked on
 * WebKit. So everything here rounds DOWN — `splitDurationMs` floors, and `snapDurationMs` with it —
 * and `PlannerAlarms` prints the rule beside the control: pick the step at or below the countdown.
 * A 1-minute step would erase the loss and cost a 60-item list on every single use; 5 with a stated
 * downward bias puts the whole error on the harmless side. Measured in
 * `reverseForge/scratch/alarms2_duration.mts` section E, against the real `Duration` values.
 */

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------------------------------ *
 * The grid
 * ------------------------------------------------------------------------------------------ */

/** Minutes advance in steps of this many. See the header for what it costs. */
export const MINUTE_STEP = 5;

/**
 * Largest hour on the list. 6 d 23 h: one step below `DEFAULT_HORIZON_MS`, which is the point past
 * which `deriveAlarms` arms nothing at all.
 */
export const MAX_HOURS = 167;

/** 5 minutes. Nothing smaller is expressible, so nothing smaller has to be refused. */
export const MIN_DURATION_MS = MINUTE_STEP * 60_000;

/** 167 h 55 m. */
export const MAX_DURATION_MS = (MAX_HOURS * 60 + (60 - MINUTE_STEP)) * 60_000;

/**
 * What the selects show before the player has ever set an anchor. One hour is a value nobody can
 * mistake for a reading they made — it is round, and the caller renders "not set yet" beside it
 * until Set is pressed, so nothing is ever armed from this number by accident.
 */
export const DEFAULT_DURATION_MS = 60 * 60_000;

const MINUTES: readonly number[] = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/* ------------------------------------------------------------------------------------------ *
 * Arithmetic — exported because the tests and the caller both need it, and it is the whole
 * contract: whatever these functions return is a duration the two selects can express.
 * ------------------------------------------------------------------------------------------ */

export interface DurationParts {
    hours: number;
    minutes: number;
}

/** `{hours, minutes}` -> ms. Never returns 0: a zero pair is lifted to one step. */
export function joinDurationMs(hours: number, minutes: number): number {
    const h = clampInt(hours, 0, MAX_HOURS);
    const m = clampInt(minutes, 0, 60 - MINUTE_STEP);
    const ms = (h * 60 + m) * 60_000;
    return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, ms));
}

/**
 * ms -> the pair of options that represents it.
 *
 * FLOORS to the grid. See the header: an anchor rounded down warns early, an anchor rounded up
 * warns late, and only one of those is still an alarm.
 */
export function splitDurationMs(ms: number): DurationParts {
    const safe = Number.isFinite(ms) ? ms : DEFAULT_DURATION_MS;
    const clamped = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, safe));
    const totalMinutes = Math.floor(clamped / 60_000);
    const hours = Math.min(MAX_HOURS, Math.floor(totalMinutes / 60));
    const minutes = Math.floor((totalMinutes - hours * 60) / MINUTE_STEP) * MINUTE_STEP;
    // A duration under one step floors to 0h 0m, which the pair may not hold.
    if (hours === 0 && minutes === 0) return { hours: 0, minutes: MINUTE_STEP };
    return { hours, minutes };
}

/** The nearest duration at or below `ms` that these two selects can actually show. */
export function snapDurationMs(ms: number): number {
    const { hours, minutes } = splitDurationMs(ms);
    return joinDurationMs(hours, minutes);
}

/**
 * `1d 2h 10m`, `2h 10m`, `45m`. Lossless, unlike `formatDurationShort` in `plannerSchedule.ts`,
 * which keeps at most two parts and therefore silently drops the minutes of anything over a day —
 * this string is round-tripped through `parseDurationMs` when an older record is read back, so it
 * has to carry every field.
 */
export function formatDurationExact(ms: number): string {
    const totalMinutes = Math.max(0, Math.round(ms / 60_000));
    const d = Math.floor(totalMinutes / 1440);
    const h = Math.floor((totalMinutes - d * 1440) / 60);
    const m = totalMinutes - d * 1440 - h * 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m || parts.length === 0) parts.push(`${m}m`);
    return parts.join(' ');
}

/** `3h`, `1d 2h`. What one hours option says. */
export function formatHourOption(hours: number): string {
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
}

/** `[{label, hours: [...]}, ]`, one entry per whole day, so a 168-long list stays scannable. */
function hourGroups(): { label: string; hours: number[] }[] {
    const groups: { label: string; hours: number[] }[] = [];
    for (let day = 0; day * 24 <= MAX_HOURS; day++) {
        const hours: number[] = [];
        for (let h = day * 24; h < (day + 1) * 24 && h <= MAX_HOURS; h++) hours.push(h);
        if (hours.length === 0) continue;
        groups.push({ label: day === 0 ? 'Under a day' : day === 1 ? '1 day' : `${day} days`, hours });
    }
    return groups;
}

const HOUR_GROUPS = hourGroups();

/* ------------------------------------------------------------------------------------------ *
 * The control
 * ------------------------------------------------------------------------------------------ */

export interface DurationSelectProps {
    /** Milliseconds. Anything off the grid is shown floored; the caller is not corrected silently. */
    valueMs: number;
    /** Called with a duration these selects can express — always `>= MIN_DURATION_MS`. */
    onChange: (ms: number) => void;
    /**
     * Names the PAIR, e.g. "Time left on the upgrade you have running". Rendered as a `<legend>`,
     * so a screen reader repeats it before each of the two selects — which is the difference
     * between "Hours, combo box" and "Time left on the upgrade you have running, Hours, combo box"
     * on a page that is otherwise a 61-node grid.
     */
    legend: string;
    disabled?: boolean;
    className?: string;
}

/**
 * Two native `<select>`s. Native on purpose: a phone renders them as the OS picker, they are
 * keyboard-operable and type-ahead searchable for free (typing "45" jumps to 45 minutes), and no
 * custom listbox in this app would be as good at either.
 */
export function DurationSelect({ valueMs, onChange, legend, disabled, className }: DurationSelectProps) {
    const uid = useId();
    const hoursId = `${uid}-hours`;
    const minutesId = `${uid}-minutes`;

    const { hours, minutes } = splitDurationMs(valueMs);

    // THE INVARIANT, in one line: at zero hours the minutes list has no zero in it.
    const minuteOptions = hours === 0 ? MINUTES.filter(m => m > 0) : MINUTES;

    const onHours = (next: number) => {
        // Moving to 0 h while minutes is 0 would be a zero duration, so it takes the minutes with
        // it. Done HERE rather than in an effect: the pair is never briefly zero, not even for one
        // render, so nothing downstream ever sees a value it would have to refuse.
        const nextMinutes = next === 0 && minutes === 0 ? MINUTE_STEP : minutes;
        onChange(joinDurationMs(next, nextMinutes));
    };

    return (
        <fieldset className={cn('min-w-0 border-0 p-0 m-0', className)} data-duration-select>
            <legend className="text-[10px] font-bold text-text-secondary uppercase p-0">{legend}</legend>

            <div className="mt-1 grid grid-cols-2 gap-2">
                <Field id={hoursId} label="Hours">
                    <select
                        id={hoursId}
                        data-duration-hours
                        value={hours}
                        disabled={disabled}
                        onChange={e => onHours(Number(e.target.value))}
                        className={SELECT_CLASS}
                        // The dropdown POPUP is drawn by the platform, not by this page. Without
                        // `color-scheme` Chrome paints it with the light system palette while the
                        // options keep the page's near-white `color` — white on white, which is the
                        // exact class of bug this project has shipped before. The per-option classes
                        // below are the belt to this pair of braces on engines that ignore it.
                        style={{ colorScheme: 'dark' }}
                    >
                        {HOUR_GROUPS.map(group => (
                            <optgroup key={group.label} label={group.label} className={OPTGROUP_CLASS}>
                                {group.hours.map(h => (
                                    <option key={h} value={h} className={OPTION_CLASS}>
                                        {formatHourOption(h)}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </Field>

                <Field id={minutesId} label="Minutes">
                    <select
                        id={minutesId}
                        data-duration-minutes
                        value={minutes}
                        disabled={disabled}
                        onChange={e => onChange(joinDurationMs(hours, Number(e.target.value)))}
                        className={SELECT_CLASS}
                        style={{ colorScheme: 'dark' }}
                    >
                        {minuteOptions.map(m => (
                            <option key={m} value={m} className={OPTION_CLASS}>
                                {m}m
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
        </fieldset>
    );
}

const SELECT_CLASS = cn(
    'w-full appearance-none rounded-lg border border-border bg-bg-input px-3 py-2 pr-8',
    'text-[15px] font-bold text-text-primary tabular-nums',
    'focus:outline-none focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/40',
    'disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
);

/** Opaque, because `bg-input` is 80% alpha and an option popup has nothing behind it to blend with. */
const OPTION_CLASS = 'bg-bg-secondary text-text-primary';
const OPTGROUP_CLASS = 'bg-bg-secondary text-text-secondary';

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0">
            {/* `htmlFor`, not a wrapping label with no association: the pair is read by a screen
                reader as legend + label, and `UI/Select.tsx`'s own label has no `htmlFor` at all,
                which is why this control does not use it. */}
            <label htmlFor={id} className="block text-[10px] font-bold uppercase text-text-secondary">
                {label}
            </label>
            <div className="relative mt-0.5">
                {children}
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
            </div>
        </div>
    );
}
