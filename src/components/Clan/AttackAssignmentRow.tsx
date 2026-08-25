/**
 * AttackAssignmentRow — one player of your squad, their ticket budget, and their attack orders.
 * =============================================================================================
 *
 * Split out of `AttacksPlanner` because the board is a list of fifty of these and the row carries
 * the one thing the screen exists to show: **how many of this player's war tickets are spoken
 * for**. Everything else on the tab is scaffolding around that number.
 *
 *
 * THE BUDGET IS THE ROW, NOT A DETAIL ON IT
 * -----------------------------------------
 * The game gives every member `GuildWarConfig.MaxWarTicketsPerMember` attacks (read from the
 * config, never written here as a literal), and `clan_war_plans.attacks_per_player` is the leader's
 * editable version of that with an optional per-player override. A leader's real question is never
 * "who has orders" — it is "who is sitting on unused tickets, and who has been told to do more than
 * they can". So the row states it three ways at once, because a number alone does not survive being
 * scanned fifty times:
 *
 *   * PIPS. One box per attack: filled means assigned, hollow means spare, red means an order this
 *     player cannot carry out. Countable at a glance and readable at 360px, where a bar is 40px
 *     wide and says nothing.
 *   * A FRACTION, `3 / 5`, coloured by verdict.
 *   * A WORD. "2 spare" or "1 over budget", spelled out, because amber and red are the same colour
 *     to roughly one man in twelve and this project has shipped worse.
 *
 * The verdict itself comes from `summarizeBudget()` in `utils/warPlanExport.ts`, so the badge on
 * screen and the line in the exported text cannot disagree about who is short.
 *
 *
 * WHY ORDERS ARE CHIPS AND A DROPDOWN AND NOT DRAG-AND-DROP
 * --------------------------------------------------------
 * `set_war_assignments()` replaces one attacker's whole list and the ARRAY POSITION becomes `slot`,
 * which is the order the export prints. So the row needs "append", "remove" and "move earlier" and
 * nothing more — those three generate every ordering. A drag surface would need a pointer sensor,
 * a keyboard fallback and a touch fallback to be usable on the phone this is read on, to express
 * the same three moves.
 *
 * EVERY EDIT IS A WRITE. There is no local draft and no save button: the parent calls
 * `setOrders(attackerId, ids)` and the board reloads. That is one round trip per click, which is
 * the honest cost of a schema with no compare-and-swap — a draft would let two leaders build two
 * private versions of the same row and discover the collision at save time, which is exactly the
 * failure `warPlanApi`'s concurrency note says the feature cannot resolve.
 *
 *
 * WHO MAY DO WHAT
 * ---------------
 * `canEdit` hides controls; it does not authorise anything. The database refuses a plain member's
 * write with 42501 and holds no INSERT/UPDATE/DELETE grant for any client role on any war table.
 * The point of the flag is that a member is never shown a button that will fail — their row is the
 * same row, rendered as text.
 *
 * `isMine` is the member's own line, and it is highlighted on both sides of the fence: a leader
 * needs to find themselves in the list too.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft,
    Check,
    Crosshair,
    Pencil,
    Plus,
    Trash2,
    UserX,
    X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WarAssignmentRow, WarParticipantRow } from '../../services/warPlanApi';
import { WAR_MAX_SLOTS_PER_ATTACKER, WAR_NAME_MAX_LENGTH } from '../../services/warPlanApi';

/* ------------------------------------------------------------------------------------------ *
 * The budget meter, exported because the enemy column and the totals bar reuse the verdict
 * ------------------------------------------------------------------------------------------ */

export type BudgetVerdict = 'idle' | 'under' | 'exact' | 'over';

/** The one mapping of (assigned, budget) to a verdict. Used for pips, text and colour alike. */
export function budgetVerdict(assigned: number, budget: number): BudgetVerdict {
    if (assigned > budget) return 'over';
    if (assigned === 0 && budget > 0) return 'idle';
    if (assigned < budget) return 'under';
    return 'exact';
}

const VERDICT_TEXT: Record<BudgetVerdict, string> = {
    idle: 'text-red-300',
    under: 'text-amber-300',
    exact: 'text-emerald-300',
    over: 'text-red-300',
};

/**
 * One box per attack. Capped at 12 drawn boxes so a leader who typed `attacks_per_player: 40` gets
 * a fraction instead of a row of confetti; the fraction beside it is always exact.
 */
export const BudgetPips: React.FC<{ assigned: number; budget: number; className?: string }> = ({
    assigned,
    budget,
    className,
}) => {
    const drawn = Math.min(Math.max(budget, assigned), 12);
    if (drawn <= 0) return null;
    return (
        <span className={cn('inline-flex items-center gap-[3px]', className)} aria-hidden="true">
            {Array.from({ length: drawn }, (_, i) => {
                const filled = i < assigned;
                const beyond = i >= budget;
                return (
                    <span
                        key={i}
                        className={cn(
                            'h-3 w-[7px] rounded-[2px] border',
                            beyond && filled && 'border-red-400 bg-red-500',
                            beyond && !filled && 'border-white/10 bg-transparent',
                            !beyond && filled && 'border-emerald-400/70 bg-emerald-500/80',
                            !beyond && !filled && 'border-amber-400/50 bg-transparent',
                        )}
                    />
                );
            })}
        </span>
    );
};

/** `3 / 5` plus the verdict in words. Never colour alone. */
export const BudgetBadge: React.FC<{ assigned: number; budget: number; compact?: boolean }> = ({
    assigned,
    budget,
    compact,
}) => {
    const verdict = budgetVerdict(assigned, budget);
    const spare = budget - assigned;
    const words =
        verdict === 'over'
            ? `${assigned - budget} over budget`
            : verdict === 'idle'
                ? 'no target yet'
                : verdict === 'under'
                    ? `${spare} spare`
                    : 'full';
    return (
        <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
            <span className={cn('font-mono text-sm font-bold tabular-nums', VERDICT_TEXT[verdict])}>
                {assigned}/{budget}
            </span>
            {!compact && <span className={cn('text-[11px]', VERDICT_TEXT[verdict])}>{words}</span>}
        </span>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * Inline rename
 * ------------------------------------------------------------------------------------------ */

/**
 * Click the name, type, Enter. Escape cancels, blur commits.
 *
 * Only ever mounted for a DUMMY. A real clan member's row shows their live profile name as text:
 * renaming them would write the snapshot column, and `clan_war_assignment_sheet` prefers the live
 * name while they are still in the clan — so the rename would appear to do nothing until the day
 * they leave. An edit that silently does nothing is worse than no edit, so it is not offered.
 */
const InlineName: React.FC<{
    value: string;
    disabled?: boolean;
    label: string;
    onCommit: (next: string) => void;
}> = ({ value, disabled, label, onCommit }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const commit = () => {
        setEditing(false);
        const next = draft.replace(/\s+/g, ' ').trim();
        if (next && next !== value) onCommit(next);
        else setDraft(value);
    };

    if (!editing) {
        return (
            <button
                type="button"
                disabled={disabled}
                onClick={() => setEditing(true)}
                title={disabled ? undefined : label}
                aria-label={disabled ? undefined : label}
                className={cn(
                    'group/name inline-flex min-w-0 items-center gap-1 rounded text-left',
                    disabled ? 'cursor-default' : 'hover:text-white',
                )}
            >
                <span className="min-w-[7rem] max-w-full whitespace-nowrap overflow-hidden text-clip font-bold text-white">{value}</span>
                {!disabled && (
                    <Pencil className="h-3 w-3 shrink-0 text-text-secondary opacity-0 transition-opacity group-hover/name:opacity-100" />
                )}
            </button>
        );
    }

    return (
        <span className="inline-flex min-w-0 items-center gap-1">
            <input
                ref={inputRef}
                value={draft}
                maxLength={WAR_NAME_MAX_LENGTH}
                spellCheck={false}
                autoComplete="off"
                aria-label={label}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        commit();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setDraft(value);
                        setEditing(false);
                    }
                }}
                className="h-7 w-full min-w-0 max-w-[180px] rounded border border-accent-primary/60 bg-bg-input px-2 text-sm font-bold text-white outline-none focus:ring-2 focus:ring-accent-primary/40"
            />
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
        </span>
    );
};

/* ------------------------------------------------------------------------------------------ *
 * The row
 * ------------------------------------------------------------------------------------------ */

export interface AttackAssignmentRowProps {
    attacker: WarParticipantRow;
    /** This attacker's orders, ascending by slot. */
    orders: WarAssignmentRow[];
    /** Every enemy on the plan, in board order, for the "add target" picker. */
    enemies: WarParticipantRow[];
    /** `id -> enemy`, so a chip can name its target without a scan per chip. */
    enemyById: Map<string, WarParticipantRow>;
    /** The effective budget: this row's override, or the plan's `attacks_per_player`. */
    budget: number;
    /** The plan default, so an override can be labelled as one. */
    planBudget: number;
    canEdit: boolean;
    /** This ally is the profile on screen. Highlighted for members AND leaders. */
    isMine: boolean;
    /** Clicking an enemy card appends to the armed row. Purely an accelerator. */
    armed: boolean;
    busy: boolean;
    onArm: () => void;
    /** The whole new list, in slot order. An empty array clears this player. */
    onSetOrders: (targetIds: string[]) => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    onSetBudget: (attacks: number) => void;
}

export const AttackAssignmentRow: React.FC<AttackAssignmentRowProps> = ({
    attacker,
    orders,
    enemies,
    enemyById,
    budget,
    planBudget,
    canEdit,
    isMine,
    armed,
    busy,
    onArm,
    onSetOrders,
    onRename,
    onRemove,
    onSetBudget,
}) => {
    const [editingBudget, setEditingBudget] = useState(false);
    const [budgetDraft, setBudgetDraft] = useState(String(budget));
    useEffect(() => {
        if (!editingBudget) setBudgetDraft(String(budget));
    }, [budget, editingBudget]);

    const assigned = orders.length;
    const verdict = budgetVerdict(assigned, budget);
    const isDummy = attacker.member_kind === 'dummy';
    /** A real ally whose profile row was deleted. The FK is `on delete set null`, so this happens. */
    const orphaned = attacker.member_kind === 'profile' && !attacker.profile_id;
    const full = assigned >= WAR_MAX_SLOTS_PER_ATTACKER;

    const ids = orders.map(o => o.target_id);

    const removeAt = (index: number) => onSetOrders(ids.filter((_, i) => i !== index));
    const moveEarlier = (index: number) => {
        if (index <= 0) return;
        const next = [...ids];
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        onSetOrders(next);
    };

    return (
        <li
            className={cn(
                'rounded-xl border p-2.5 transition-colors sm:p-3',
                // The armed state has to be visible from the enemy column, which is a screen-width
                // away at 1440: a border alone is not enough, so it also gets a ring.
                armed
                    ? 'border-accent-primary bg-accent-primary/10 ring-1 ring-accent-primary/50'
                    : isMine
                        ? 'border-sky-400/50 bg-sky-500/5'
                        : 'border-border bg-bg-input/40',
            )}
        >
            {/* AT 360px THE NAME GETS ITS OWN LINE. Measured on the first build of this row: with the
                name block and the budget cluster on one flex line, a 360px viewport crushed
                "Anvil Ann" to "A" and dropped "Bolt Bella" and "Rick alt" to nothing at all -
                the row showed a PROFILE GONE badge, a fraction, and no clue who it was about. So
                the name takes the whole row below `sm` (`basis-full`) and shares the line above it,
                and the budget cluster does the same in reverse. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* --- who --- */}
                <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
                    {canEdit && (
                        <button
                            type="button"
                            onClick={onArm}
                            disabled={busy}
                            aria-pressed={armed}
                            title={armed ? 'Armed: click an enemy to add them here' : 'Aim at this player, then click enemies'}
                            className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
                                armed
                                    ? 'border-accent-primary bg-accent-primary text-black'
                                    : 'border-border bg-bg-input text-text-secondary hover:border-accent-primary/50 hover:text-white',
                            )}
                        >
                            <Crosshair className="h-3.5 w-3.5" />
                        </button>
                    )}

                    <div className="flex min-w-0 flex-col">
                        {/* `flex-wrap` plus a floor on the name: the badges drop to a second line
                            rather than squeezing the name to zero, which is what a bare `whitespace-nowrap overflow-hidden text-clip`
                            in a flex row does when the siblings refuse to shrink. */}
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                            {isDummy && canEdit ? (
                                <InlineName
                                    value={attacker.display_name}
                                    label={`Rename ${attacker.display_name}`}
                                    disabled={busy}
                                    onCommit={onRename}
                                />
                            ) : (
                                <span
                                    className="min-w-[7rem] max-w-full whitespace-nowrap overflow-hidden text-clip font-bold text-white"
                                    title={
                                        attacker.member_kind === 'profile'
                                            ? 'A real clan member. Their name follows their profile.'
                                            : undefined
                                    }
                                >
                                    {attacker.display_name}
                                </span>
                            )}
                            {isMine && (
                                <span className="shrink-0 rounded bg-sky-500/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wider text-sky-300">
                                    You
                                </span>
                            )}
                            {isDummy && (
                                <span
                                    className="shrink-0 rounded bg-white/5 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-text-secondary"
                                    title="A stand-in: a name on the plan, not a clan account. It gets no notification."
                                >
                                    Stand-in
                                </span>
                            )}
                            {orphaned && (
                                <span
                                    className="inline-flex shrink-0 items-center gap-1 rounded bg-red-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-red-300"
                                    title="This player's profile was deleted. The name is the snapshot taken when they were added."
                                >
                                    <UserX className="h-3 w-3" /> Profile gone
                                </span>
                            )}
                        </div>
                        {attacker.note && (
                            <span className="whitespace-nowrap overflow-hidden text-clip text-[11px] text-text-secondary">{attacker.note}</span>
                        )}
                    </div>
                </div>

                {/* --- the budget, said three ways --- */}
                <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
                    <BudgetPips assigned={assigned} budget={budget} />
                    {editingBudget && canEdit ? (
                        <span className="inline-flex items-center gap-1">
                            <input
                                type="number"
                                min={0}
                                max={WAR_MAX_SLOTS_PER_ATTACKER}
                                value={budgetDraft}
                                autoFocus
                                aria-label={`Attacks for ${attacker.display_name}`}
                                onChange={e => setBudgetDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') {
                                        setBudgetDraft(String(budget));
                                        setEditingBudget(false);
                                    }
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                }}
                                onBlur={() => {
                                    setEditingBudget(false);
                                    const next = Math.round(Number(budgetDraft));
                                    if (Number.isFinite(next) && next >= 0 && next !== budget) onSetBudget(next);
                                }}
                                className="h-7 w-14 rounded border border-accent-primary/60 bg-bg-input px-1.5 text-center font-mono text-sm text-white outline-none"
                            />
                        </span>
                    ) : (
                        <BudgetBadge assigned={assigned} budget={budget} />
                    )}
                    {canEdit && !editingBudget && (
                        <button
                            type="button"
                            onClick={() => setEditingBudget(true)}
                            disabled={busy}
                            title={
                                attacker.attacks_budget === null
                                    ? `Give this player a different number of attacks (the plan says ${planBudget}). An override cannot be removed once set, only changed.`
                                    : `Overridden: ${budget} instead of the plan's ${planBudget}. An override cannot be removed, only changed.`
                            }
                            className={cn(
                                'flex h-6 w-6 items-center justify-center rounded border transition-colors',
                                attacker.attacks_budget === null
                                    ? 'border-border text-text-secondary hover:border-accent-primary/50 hover:text-white'
                                    : 'border-accent-primary/50 text-accent-primary',
                            )}
                        >
                            <Pencil className="h-3 w-3" />
                        </button>
                    )}
                    {canEdit && (
                        <button
                            type="button"
                            onClick={onRemove}
                            disabled={busy}
                            title={`Remove ${attacker.display_name} from the war plan`}
                            aria-label={`Remove ${attacker.display_name} from the war plan`}
                            className="flex h-6 w-6 items-center justify-center rounded border border-border text-text-secondary transition-colors hover:border-red-500/60 hover:text-red-300"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* --- the orders --- */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {orders.map((order, index) => {
                    const target = enemyById.get(order.target_id);
                    const beyond = index >= budget;
                    return (
                        <span
                            key={order.id}
                            className={cn(
                                'inline-flex max-w-full items-center gap-1 rounded-lg border py-1 pl-1.5 pr-1 text-xs',
                                beyond
                                    ? 'border-red-500/50 bg-red-500/10 text-red-200'
                                    : 'border-border bg-bg-secondary text-text-primary',
                            )}
                            title={beyond ? 'Beyond this player\'s attacks: they cannot carry this one out.' : undefined}
                        >
                            <span
                                className={cn(
                                    'font-mono text-[10px] font-bold',
                                    beyond ? 'text-red-300' : 'text-text-secondary',
                                )}
                            >
                                {index + 1}
                            </span>
                            <span className="whitespace-nowrap overflow-hidden text-clip">{target?.display_name ?? 'Removed enemy'}</span>
                            {canEdit && (
                                <>
                                    {index > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => moveEarlier(index)}
                                            disabled={busy}
                                            title="Move earlier"
                                            aria-label={`Move ${target?.display_name ?? 'this target'} earlier`}
                                            className="rounded p-0.5 text-text-secondary transition-colors hover:bg-white/10 hover:text-white"
                                        >
                                            <ArrowLeft className="h-3 w-3" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => removeAt(index)}
                                        disabled={busy}
                                        title="Remove this attack"
                                        aria-label={`Remove the attack on ${target?.display_name ?? 'this target'}`}
                                        className="rounded p-0.5 text-text-secondary transition-colors hover:bg-red-500/20 hover:text-red-300"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </>
                            )}
                        </span>
                    );
                })}

                {canEdit && (
                    <label className="inline-flex items-center">
                        <span className="sr-only">Add a target for {attacker.display_name}</span>
                        <select
                            value=""
                            disabled={busy || enemies.length === 0 || full}
                            onChange={e => {
                                const id = e.target.value;
                                e.currentTarget.value = '';
                                if (id) onSetOrders([...ids, id]);
                            }}
                            title={
                                enemies.length === 0
                                    ? 'Add enemies to the plan first.'
                                    : full
                                        ? `A player can be given at most ${WAR_MAX_SLOTS_PER_ATTACKER} attacks.`
                                        : 'Add a target'
                            }
                            className={cn(
                                'h-7 rounded-lg border border-dashed border-border bg-transparent px-1.5 text-xs text-text-secondary outline-none transition-colors',
                                'hover:border-accent-primary/50 hover:text-white focus:border-accent-primary disabled:opacity-40',
                            )}
                        >
                            <option value="" style={{ backgroundColor: '#13131a', color: '#f5f5f5' }}>+ target</option>
                            {enemies.map(enemy => (
                                <option key={enemy.id} value={enemy.id} style={{ backgroundColor: '#13131a', color: '#f5f5f5' }}>
                                    {enemy.display_name}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {orders.length === 0 && !canEdit && (
                    <span className="text-xs text-red-300">No target yet.</span>
                )}
                {orders.length === 0 && canEdit && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-300">
                        <Plus className="h-3 w-3" /> nothing assigned
                    </span>
                )}
                {verdict === 'under' && orders.length > 0 && (
                    <span className="text-[11px] text-amber-300">
                        {budget - assigned} ticket{budget - assigned === 1 ? '' : 's'} unused
                    </span>
                )}
            </div>
        </li>
    );
};

export default AttackAssignmentRow;
