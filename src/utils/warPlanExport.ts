/**
 * warPlanExport — the attack plan as plain text somebody can paste into Discord.
 * =============================================================================
 *
 * PURE. No React, no network, no `Date.now()`, no `import` of anything at runtime. Give it rows,
 * get a string. That is what makes it testable without a browser and what makes the text a leader
 * pastes into a public channel reproducible: the same rows always produce the same bytes.
 *
 *
 * WHAT IT IS FED, AND WHY THAT SOURCE AND NOT THE BOARD
 * ----------------------------------------------------
 * `WarExportRow` is a structural subset of `clan_war_assignment_sheet` (`WarSheetRow` in
 * `services/warPlanApi.ts`), so a `WarSheetRow[]` is assignable to `WarExportRow[]` with no cast
 * and no adapter — and this module still imports nothing, which is the whole point of declaring the
 * shape locally rather than importing the interface.
 *
 * The SHEET and not the board, for a reason that matters the moment a message is posted in public:
 * the view is the one place a LIVE profile name is resolved, and it resolves only through
 * `clan_members`. A member who was kicked keeps the snapshot taken when they were added, so their
 * current profile name cannot leak into a Discord channel because somebody exported an old week.
 *
 * The sheet also carries **one row per ally who has no orders at all**, with every `slot` and
 * `target_*` column null. Those rows are the reason this file exists in the shape it does: see
 * "THE MOST USEFUL LINE IN THE EXPORT" below.
 *
 *
 * ONE BLOCK PER ATTACKER, NOT A TABLE
 * -----------------------------------
 * The reader is one player scrolling a phone, looking for their own name in a message about fifty
 * people. A table makes them track a row across columns in a proportional font that Discord will
 * not align; a block makes them stop at their own heading and read three short lines. So every
 * attacker gets a heading with their name and their budget, and their orders are numbered
 * underneath in the order the leader put them in — `slot` is the array position
 * `set_war_assignments()` was given, so the leader's ordering IS the export's ordering.
 *
 *
 * THE MOST USEFUL LINE IN THE EXPORT
 * ---------------------------------
 * "These four have no target yet." A plan that is 90% assigned looks finished in every screenshot
 * and is not, and the four people it forgot are exactly the ones who will not attack. So allies
 * with no orders get their own section, by name, with how many attacks they are sitting on — and
 * an attacker who is UNDER or OVER their budget is marked in their own heading, because "5 of 5"
 * and "3 of 5" are two characters apart and nobody scanning fifty blocks will spot the difference
 * unaided.
 *
 *
 * PLAIN TEXT, NOT MARKDOWN, AND ASCII ONLY
 * ----------------------------------------
 * Discord treats `*`, `_`, `~` and `#` as formatting, and a player called `*_Bob_*` would come out
 * as a bold-italic "Bob" — the sheet would stop saying who to hit, which is its only job. So this
 * writes no markdown of its own: headings are bare lines, orders are `1)` and never `-` or `*`
 * (Discord renders a leading `- ` as a bullet list and re-indents it), and separators are `===`.
 * `codeBlock: true` wraps the result in a fence, which is the only reliable way to make Discord
 * leave a roster of player names completely alone; the splitter accounts for the fence's own
 * characters so a wrapped part still fits.
 *
 * Everything emitted here is ASCII. No em dashes, no box-drawing, no arrows: this text is retyped,
 * quoted and pasted into game chat by people on four platforms, and a character that survives
 * Discord may not survive the next hop.
 *
 *
 * THE 2000-CHARACTER WALL
 * -----------------------
 * Discord refuses a message over 2000 characters. A 50-player plan at five attacks each is roughly
 * 3.5 KB, so an export that is not split is an export that cannot be sent — the failure arrives
 * after the paste, in a channel, in front of the clan. `splitWarPlanExport()` therefore guarantees
 * every part it returns is <= `limit`, INCLUDING the `[part 2 of 3]` marker it appends and the code
 * fence it may add. It breaks between attacker blocks first (a blank line), between lines second,
 * and cuts mid-line only when a single line is longer than a whole message. A player's orders are
 * never split from their heading unless that one block alone exceeds the limit.
 */

/* ------------------------------------------------------------------------------------------ *
 * Input shapes — structural subsets, so nothing is imported
 * ------------------------------------------------------------------------------------------ */

/**
 * One row of `clan_war_assignment_sheet`, narrowed to what the text needs.
 *
 * A `WarSheetRow` from `warPlanApi` satisfies this structurally, so callers pass the sheet
 * straight through. Extra properties are ignored.
 */
export interface WarExportRow {
    attacker_id: string;
    /** The live profile name while they are still in the clan, else the snapshot. */
    attacker_name: string;
    /** A real ally whose profile row was deleted. Said out loud rather than shown as a normal name. */
    attacker_orphaned?: boolean;
    /** The per-player override already resolved against the plan default, by the database. */
    attacker_attacks: number;
    attacker_note?: string | null;

    /** `null` on the "this ally has no orders" row. */
    slot: number | null;
    /** Already the RENAMED name: renaming an enemy dummy is what makes this line worth reading. */
    target_name: string | null;
    order_note?: string | null;

    week_start?: string;
    battle_day?: number;
    status?: string;
    opponent_name?: string | null;
    opponent_tag?: string | null;
}

/** The plan header, for the case where there are no sheet rows to read it from. */
export interface WarExportPlan {
    week_start?: string;
    battle_day?: number;
    status?: string;
    opponent_name?: string | null;
    opponent_tag?: string | null;
}

/** One enemy as the leader renamed them. Passed in from the board, not from the sheet. */
export interface WarExportEnemy {
    name: string;
    power_estimate?: number | null;
}

export interface WarExportOptions {
    /**
     * Wrap the whole thing in a Discord code fence. The reliable way to stop a name like `_Bob_`
     * being rendered as formatting instead of as a person to attack.
     */
    codeBlock?: boolean;
    /** Falls back to the rows' own header columns, then to `WarExportPlan`, then to nothing. */
    plan?: WarExportPlan;
    /** Your own clan's name, for the "X vs Y" line. Omitted rather than guessed. */
    clanName?: string;
    /**
     * THE ENEMY ROSTER AS RENAMED, including enemies nobody has been pointed at yet.
     *
     * The sheet cannot supply this: it only carries an enemy through a target that was actually
     * assigned, so an enemy with no attackers is invisible to it. Passing the board's enemy list is
     * what lets the export end with "and nobody is on these three".
     */
    enemies?: WarExportEnemy[];
    /** Default true. */
    includeEnemyRoster?: boolean;
    /** Default true. The unassigned section. Turning it off is a choice to hide the gaps. */
    includeUnassigned?: boolean;
    /** Replaces the first line only. The week/opponent lines are still written. */
    heading?: string;
}

/* ------------------------------------------------------------------------------------------ *
 * Budget arithmetic — ONE definition of over and under, shared with the screen
 * ------------------------------------------------------------------------------------------ */

/** One attacker's load. The board builds these from participants; the export from sheet rows. */
export interface AttackerLoad {
    id: string;
    name: string;
    /** The effective budget: the per-player override, or the plan's `attacks_per_player`. */
    budget: number;
    assigned: number;
}

/**
 * The clan-wide picture, and the two counts a leader is actually looking for.
 *
 * `idle` is a subset of `under`: somebody with nothing at all is also somebody with spare
 * attacks. They are counted separately because they are two different conversations — "you have
 * one ticket left" and "you have not been given a target".
 */
export interface WarBudgetSummary {
    attackers: number;
    /** Sum of every attacker's effective budget. Not `attackers * planDefault` when overrides exist. */
    capacity: number;
    assigned: number;
    /** Attacks that exist and are not pointed at anybody. Never negative. */
    spare: number;
    /** Attackers with `assigned < budget`. */
    under: number;
    /** Attackers with nothing assigned at all. */
    idle: number;
    /** Attackers with `assigned > budget` — they cannot carry out the whole order. */
    over: number;
    /** Attacks ordered beyond what the attackers hold. Never negative. */
    overflow: number;
}

/**
 * THE ONE PLACE "over-committed" AND "unused" ARE DEFINED.
 *
 * The screen and the exported text must not disagree about who is short of a target, so both call
 * this. A second implementation in the component is how a leader ends up looking at a green badge
 * and pasting a sheet that says the same player is two attacks short.
 */
export function summarizeBudget(loads: AttackerLoad[]): WarBudgetSummary {
    let capacity = 0;
    let assigned = 0;
    let spare = 0;
    let overflow = 0;
    let under = 0;
    let idle = 0;
    let over = 0;

    for (const load of loads) {
        const budget = Math.max(0, Math.floor(load.budget) || 0);
        const used = Math.max(0, Math.floor(load.assigned) || 0);
        capacity += budget;
        assigned += used;
        if (used < budget) {
            under += 1;
            spare += budget - used;
            if (used === 0) idle += 1;
        } else if (used > budget) {
            over += 1;
            overflow += used - budget;
        }
    }

    return { attackers: loads.length, capacity, assigned, spare, under, idle, over, overflow };
}

/* ------------------------------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------------------------------ */

/** One attacker and their orders, in the order the leader gave them. */
export interface WarExportGroup {
    attackerId: string;
    name: string;
    orphaned: boolean;
    budget: number;
    note: string | null;
    orders: { slot: number; targetName: string; note: string | null }[];
}

/**
 * Groups sheet rows by attacker, preserving the order the rows arrived in.
 *
 * The caller is expected to have ordered them `attacker_sort, attacker_name, slot`, which is what
 * `loadAssignmentSheet()` asks the server for. An ally with no orders arrives as ONE row with
 * `slot` null and comes out here with an empty `orders` array — never dropped, because dropping it
 * is exactly how a forgotten player disappears from the message that was supposed to catch them.
 */
export function groupWarExportRows(rows: WarExportRow[]): WarExportGroup[] {
    const groups: WarExportGroup[] = [];
    const index = new Map<string, WarExportGroup>();

    for (const row of rows) {
        let group = index.get(row.attacker_id);
        if (!group) {
            group = {
                attackerId: row.attacker_id,
                // Sanitised HERE and not at the point of printing, so every consumer of a group -
                // the text, `loadsFromWarExportRows()` and the screen's own budget tiles - sees the
                // same name and cannot disagree with the pasted message about who a line is about.
                name: exportName(row.attacker_name),
                orphaned: row.attacker_orphaned === true,
                budget: Math.max(0, Math.floor(row.attacker_attacks) || 0),
                note: row.attacker_note ?? null,
                orders: [],
            };
            index.set(row.attacker_id, group);
            groups.push(group);
        }
        if (row.slot !== null && row.target_name !== null) {
            group.orders.push({
                slot: row.slot,
                targetName: exportName(row.target_name),
                note: row.order_note ?? null,
            });
        }
    }

    // The view has no ORDER BY of its own, so a caller that forgot the `slot` ordering would print
    // a player's attacks shuffled. Sorting here costs nothing and makes the text independent of it.
    for (const group of groups) group.orders.sort((a, b) => a.slot - b.slot);
    return groups;
}

/** The same loads `summarizeBudget()` wants, taken from the sheet. */
export function loadsFromWarExportRows(rows: WarExportRow[]): AttackerLoad[] {
    return groupWarExportRows(rows).map(group => ({
        id: group.attackerId,
        name: group.name,
        budget: group.budget,
        assigned: group.orders.length,
    }));
}

/* ------------------------------------------------------------------------------------------ *
 * The text
 * ------------------------------------------------------------------------------------------ */

/** Discord's hard limit on one message. Not a style choice; the API refuses 2001. */
export const DISCORD_MESSAGE_LIMIT = 2000;

/** ` ``` \n` + `\n``` ` — what wrapping a part in a code fence costs it. */
const FENCE_OVERHEAD = 8;

/** Worst case for `\n\n[part 99 of 99]`. Reserved before packing so the marker always fits. */
const MARKER_RESERVE = 20;

/** Collapses whitespace so a pasted note cannot inject blank lines and break the block structure. */
function oneLine(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * EVERY participant name that reaches the message, on BOTH sides of every comparison.
 *
 * A name is the one string in here the leader types freely, and the database lets more through
 * than this format survives. Measured on a real cluster with 0001..0011 applied:
 * `clan_war_participants_display_name_check` is only
 * `char_length(btrim(display_name)) between 1 and 32`, so `set_war_participant()` accepts and
 * stores an embedded newline and a run of backticks verbatim. Three things went wrong without
 * this function, all reproduced end to end:
 *
 *   1. A newline in a name SPLIT THE BLOCK. `line1\nline2 - 1 of 5 attacks` reads as a heading for
 *      a player who does not exist, and the real player's heading loses its budget. `oneLine()` was
 *      already applied to notes for exactly this reason and the name is the more dangerous string.
 *   2. A backtick run CLOSED THE CODE FENCE. `codeBlock: true` is documented above as the only
 *      reliable way to stop Discord formatting a roster of names; an enemy renamed with ``` made
 *      the message carry four fence markers, so everything after that name left the literal block.
 *      Renaming an enemy dummy is the gesture this feature exists for, which makes it the last
 *      place a hostile or accidental name may be trusted.
 *   3. TWO SPACES BROKE `NOBODY ASSIGNED`. The enemy roster ran `oneLine()` over the name while the
 *      order lines used the raw one, so `countTargeted()` compared `Grim Ash` with `Grim  Ash` and
 *      answered 0 — the export's own "who is being ignored" line said nobody was attacking a target
 *      that two attacks were pointed at, in the same message.
 *
 * So: one function, applied at every point a name enters the text, and applied to both operands of
 * the only comparison this file makes. Collapsing whitespace loses nothing a reader could see;
 * dropping backticks loses a character the game cannot put in a name and Discord cannot render
 * literally. A name that survives to nothing at all is still given a placeholder rather than an
 * empty heading, because a nameless order line is worse than an honest one.
 */
function exportName(value: string | null | undefined): string {
    return oneLine(value).replace(/`/g, '') || '(unnamed)';
}

/** `Iron Vultures [IV]`, `Iron Vultures`, or nothing at all — never a guess. */
function opponentLabel(plan: WarExportPlan): string {
    const name = oneLine(plan.opponent_name);
    const tag = oneLine(plan.opponent_tag);
    if (!name) return '';
    return tag ? `${name} [${tag}]` : name;
}

/** The header columns off the first sheet row, with the caller's `plan` as the fallback. */
function planOf(rows: WarExportRow[], fallback?: WarExportPlan): WarExportPlan {
    const first = rows[0];
    if (!first) return fallback ?? {};
    return {
        week_start: first.week_start ?? fallback?.week_start,
        battle_day: first.battle_day ?? fallback?.battle_day,
        status: first.status ?? fallback?.status,
        opponent_name: first.opponent_name ?? fallback?.opponent_name,
        opponent_tag: first.opponent_tag ?? fallback?.opponent_tag,
    };
}

/**
 * The plan as one plain-text message, one block per attacker.
 *
 * It is never empty and never throws: a plan with nothing in it still produces a header and says
 * so, because "the export button did nothing" is indistinguishable from "the export button is
 * broken" and a leader will conclude the second.
 */
export function buildWarPlanExport(rows: WarExportRow[], options: WarExportOptions = {}): string {
    const plan = planOf(rows, options.plan);
    const groups = groupWarExportRows(rows);
    const loads = groups.map(g => ({ id: g.attackerId, name: g.name, budget: g.budget, assigned: g.orders.length }));
    const totals = summarizeBudget(loads);

    const assigned = groups.filter(g => g.orders.length > 0);
    const idle = groups.filter(g => g.orders.length === 0);

    const lines: string[] = [];

    /* ---- header ---- */

    lines.push(options.heading ?? 'GUILD WAR - ATTACK PLAN');

    const week = oneLine(plan.week_start);
    // The config day index is 0-based and humans count from one: `GuildWar.tsx` renders index 5 as
    // "Day 6", so anything else on screen would be a second numbering of the same day.
    const day = typeof plan.battle_day === 'number' ? `Day ${plan.battle_day + 1}` : '';
    const draft = plan.status === 'draft' ? 'DRAFT - NOT PUBLISHED YET' : '';
    const headerBits = [week ? `Week of ${week}` : '', day ? `Battle day: ${day}` : '', draft].filter(Boolean);
    if (headerBits.length) lines.push(headerBits.join(' | '));

    const foe = opponentLabel(plan);
    const us = oneLine(options.clanName);
    if (us && foe) lines.push(`${us} vs ${foe}`);
    else if (foe) lines.push(`Opponent: ${foe}`);
    else if (us) lines.push(us);

    if (totals.attackers > 0) {
        const counts = [
            `${totals.attackers} ${totals.attackers === 1 ? 'player' : 'players'}`,
            `${totals.assigned} of ${totals.capacity} attacks assigned`,
        ];
        if (totals.spare > 0) counts.push(`${totals.spare} spare`);
        if (totals.overflow > 0) counts.push(`${totals.overflow} OVER BUDGET`);
        lines.push(counts.join(' | '));
    }
    lines.push('');

    /* ---- one block per attacker ---- */

    if (totals.attackers === 0) {
        lines.push('Nobody is on the war roster yet, so there is nothing to hand out.');
        lines.push('');
    }

    if (assigned.length > 0) {
        lines.push('=== ATTACK ORDERS ===');
        lines.push('');
        for (const group of assigned) {
            lines.push(...attackerBlock(group));
            lines.push('');
        }
    }

    /* ---- the section that earns the export ---- */

    if ((options.includeUnassigned ?? true) && idle.length > 0) {
        lines.push(`=== NO TARGET YET (${idle.length}) ===`);
        lines.push('');
        for (const group of idle) {
            const orphan = group.orphaned ? ' (profile deleted)' : '';
            const free = group.budget === 1 ? '1 attack free' : `${group.budget} attacks free`;
            lines.push(`${group.name}${orphan} - ${free}`);
        }
        lines.push('');
    }

    /* ---- the enemy, as renamed ---- */

    const enemies = options.enemies ?? [];
    if ((options.includeEnemyRoster ?? true) && enemies.length > 0) {
        const targeted = new Set<string>();
        for (const group of groups) for (const order of group.orders) targeted.add(order.targetName);

        lines.push(`=== ENEMY ROSTER (${enemies.length}) ===`);
        lines.push('');
        for (const enemy of enemies) {
            // The SAME function the order lines went through, which is the whole point: this name
            // is about to be compared with theirs by `countTargeted()`.
            const name = exportName(enemy.name);
            const power = typeof enemy.power_estimate === 'number' && enemy.power_estimate > 0
                ? ` - power ${enemy.power_estimate.toLocaleString('en-US')}`
                : '';
            const hits = countTargeted(groups, name);
            const load = hits === 0 ? ' - NOBODY ASSIGNED' : hits === 1 ? ' - 1 attack' : ` - ${hits} attacks`;
            lines.push(`${name}${power}${load}`);
        }
        lines.push('');
    }

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    return options.codeBlock ? `\`\`\`\n${text}\n\`\`\`` : text;
}

/** How many attacks across the whole plan are pointed at this exact name. */
function countTargeted(groups: WarExportGroup[], name: string): number {
    let n = 0;
    for (const group of groups) {
        for (const order of group.orders) if (order.targetName === name) n += 1;
    }
    return n;
}

/**
 * One attacker's heading and their numbered orders.
 *
 * The heading carries the verdict, not just the numbers: `3 of 5` is two characters away from
 * `5 of 5` and nobody scanning fifty blocks on a phone will see the difference, so being short or
 * over is spelled out in words on the same line.
 */
function attackerBlock(group: WarExportGroup): string[] {
    const out: string[] = [];
    const orphan = group.orphaned ? ' (profile deleted)' : '';
    const used = group.orders.length;

    let verdict = '';
    if (used < group.budget) {
        const spare = group.budget - used;
        verdict = spare === 1 ? '  << 1 attack spare' : `  << ${spare} attacks spare`;
    } else if (used > group.budget) {
        const extra = used - group.budget;
        verdict = extra === 1 ? '  << 1 ATTACK OVER BUDGET' : `  << ${extra} ATTACKS OVER BUDGET`;
    }

    out.push(`${group.name}${orphan} - ${used} of ${group.budget} attacks${verdict}`);
    const note = oneLine(group.note);
    if (note) out.push(`  note: ${note}`);
    for (const order of group.orders) {
        const why = oneLine(order.note);
        out.push(`  ${order.slot}) ${order.targetName}${why ? ` (${why})` : ''}`);
    }
    return out;
}

/* ------------------------------------------------------------------------------------------ *
 * Splitting
 * ------------------------------------------------------------------------------------------ */

export interface WarSplitOptions {
    /** Discord's own ceiling by default. Every returned part is <= this, markers and fences included. */
    limit?: number;
    /** Append `[part 2 of 3]`. Default true, and skipped entirely when there is only one part. */
    label?: boolean;
    /** Wrap each part in its own code fence. Accounted for in the packing, not added afterwards. */
    codeBlock?: boolean;
}

/**
 * Splits an export into messages that Discord will actually accept.
 *
 * THE GUARANTEE: every returned string is at most `limit` characters, INCLUDING the part marker and
 * the code fence. That is why the fence is applied here and not by the caller — a caller who wraps
 * the parts afterwards adds eight characters to a string that was already exactly at the limit.
 *
 * WHERE IT BREAKS, in order of preference:
 *   1. between attacker blocks (a blank line), so nobody's orders are separated from their name;
 *   2. between lines, when one block is bigger than a whole message;
 *   3. mid-line, only when a single line is longer than a whole message.
 *
 * Pass text that was built WITHOUT `codeBlock` and set it here instead: splitting an
 * already-fenced string would leave the fence markers stranded in the first and last parts.
 */
export function splitWarPlanExport(text: string, options: WarSplitOptions = {}): string[] {
    const limit = Math.max(1, Math.floor(options.limit ?? DISCORD_MESSAGE_LIMIT));
    const label = options.label ?? true;
    const fence = options.codeBlock === true;

    // THE WHOLE THING FITS: return it as one message with no marker on it. Reserving room for a
    // `[part 1 of 1]` that is never written is how a 2000-character export gets split in two for no
    // reason, which is the exact boundary this function exists to get right.
    const whole = fence ? `\`\`\`\n${text}\n\`\`\`` : text;
    if (whole.length <= limit) return [whole];

    const overhead = (label ? MARKER_RESERVE : 0) + (fence ? FENCE_OVERHEAD : 0);
    // A limit so small that the overhead eats it is a caller error, not a reason to loop forever:
    // fall back to packing against at least a quarter of the limit and let the wrap step clamp.
    const budget = Math.max(Math.ceil(limit / 4), limit - overhead);

    const chunks = packChunks(text, budget);
    const total = chunks.length;

    return chunks.map((chunk, i) => {
        const body = fence ? `\`\`\`\n${chunk}\n\`\`\`` : chunk;
        const marked = label && total > 1 ? `${body}\n[part ${i + 1} of ${total}]` : body;
        // The clamp is the guarantee. It can only bite when `limit` was set absurdly low, and a
        // truncated message is still better than one the API refuses outright.
        return marked.length <= limit ? marked : marked.slice(0, limit);
    });
}

/** Greedy packing on blank lines, then on line ends, then on characters. */
function packChunks(text: string, budget: number): string[] {
    if (text.length <= budget) return [text];

    const chunks: string[] = [];
    let current = '';

    const flush = () => {
        if (current) {
            chunks.push(current);
            current = '';
        }
    };

    for (const block of text.split('\n\n')) {
        const candidate = current ? `${current}\n\n${block}` : block;
        if (candidate.length <= budget) {
            current = candidate;
            continue;
        }
        flush();
        if (block.length <= budget) {
            current = block;
            continue;
        }
        // One attacker with very long notes, or an enemy roster of fifty names on one line.
        let line = '';
        for (const raw of block.split('\n')) {
            const next = line ? `${line}\n${raw}` : raw;
            if (next.length <= budget) {
                line = next;
                continue;
            }
            if (line) {
                chunks.push(line);
                line = '';
            }
            let rest = raw;
            while (rest.length > budget) {
                chunks.push(rest.slice(0, budget));
                rest = rest.slice(budget);
            }
            line = rest;
        }
        current = line;
    }
    flush();
    return chunks.length > 0 ? chunks : [''];
}

/**
 * Build and split in one call — what a copy button wants.
 *
 * `codeBlock` is handed to the SPLITTER, never to the builder, so the fence is counted against the
 * limit instead of being added on top of a part that already filled it.
 */
export function buildWarPlanExportParts(
    rows: WarExportRow[],
    options: WarExportOptions & WarSplitOptions = {},
): string[] {
    const text = buildWarPlanExport(rows, { ...options, codeBlock: false });
    return splitWarPlanExport(text, {
        limit: options.limit,
        label: options.label,
        codeBlock: options.codeBlock,
    });
}
