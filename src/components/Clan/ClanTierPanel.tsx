/**
 * ClanTierPanel — what your guild tier is actually worth, and what a defeat does to it.
 * ====================================================================================
 *
 * THE ONE FACT THIS SCREEN EXISTS FOR
 * -----------------------------------
 * Guild tier decides two things, and only one of them is obvious. The obvious one is the reward
 * list: a war at the top tier pays roughly twenty times what the bottom tier pays. The one that
 * decides whether a war is worth entering at all is the TIER-POINT SWING, and it changes SIGN as
 * you climb. Measured in `GuildTierConfig.json` for 2026_08_21_00_29:
 *
 *     tier E    TierPointsOnWin +5    TierPointsOnLose **+3**   losing still promotes you
 *     tier SSS  TierPointsOnWin +5    TierPointsOnLose **-5**   losing demotes you
 *
 * A bare "3" and a bare "5" next to the word "lose" read as gains in both cases. So every tier-point
 * figure on this screen carries its sign in the digits, a colour, an arrow and a sentence in words,
 * and the losing row is drawn as a callout rather than as a list item. The existing War Prizes
 * calculator renders `+{TierPointsOnLose}`, which prints `+-5` at SSS; that is the mistake this
 * component is built not to repeat.
 *
 * EVERY NUMBER IS READ AT RENDER TIME
 * -----------------------------------
 * Nothing here is tabulated. The tiers, their reward lists, their `RequiredPoints` and both
 * tier-point figures come from `GuildTierConfig.json` through `useGameData`, which follows the app's
 * selected config version. That is not decoration: the values really do move between versions, and
 * so does the SET OF TIERS. Versions before 2026_05 ship six tiers (E..S); newer ones ship eight
 * (E..SSS). A clan recorded as SSS is therefore a clan whose tier the older config cannot describe,
 * and this panel says exactly that instead of falling back to a tier it can describe.
 *
 * A TIER IS A STATEMENT, NOT AN ENFORCEMENT
 * -----------------------------------------
 * Nothing in this app can read the game. `clans.tier` is whatever a human typed after looking at
 * their guild screen; it does not move when a war is won or lost and it changes nothing in game.
 * Every surface that shows it has to say so, or the reward list starts looking like a promise.
 *
 * `null` IS A REAL STATE
 * ----------------------
 * 0011 made `clans.tier` nullable with no default precisely so "nobody has told us" stays sayable.
 * Rendering tier E's numbers for a clan that never chose would tell an SSS guild that a defeat gains
 * them three points when it costs them five. So a clan with no tier gets an empty state, and only
 * its owner gets a way out of it.
 *
 * NO CONFIG VOCABULARY REACHES THE SCREEN
 * ---------------------------------------
 * `WarWonRewards`, `TierPointsOnLose`, `$type`, `SkillSummonTickets`, `ClockWinders` and the file
 * name itself are all internal. Currency ids are mapped to the words the rest of this app already
 * uses for them (`ResourcesEditor` is the source: "Skill Tickets", "Clock Winders", "Tech Potions",
 * "Guild Potions") and to the sprite names `SpriteIcon` already knows. An id with no entry in that
 * map is shown as an unnamed reward with its amount, never as its id.
 */

import { useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus, ShieldQuestion, Swords, Trophy } from 'lucide-react';
import { SpriteIcon } from '../UI/SpriteIcon';
import { useClan } from '../../context/ClanContext';
import { useGameData } from '../../hooks/useGameData';
import { useGameDataContext } from '../../context/GameDataContext';
import { isClanTier, type ClanTier } from '../../services/clanApi';
import { cn } from '../../lib/utils';

/* ------------------------------------------------------------------------------------------ *
 * The config shape — read, never written, and every field optional except the ones we branch on
 * ------------------------------------------------------------------------------------------ */

/** One entry of a tier's two reward arrays. */
interface TierRewardRaw {
    Amount?: number;
    Type?: string;
    /** Discriminates a currency from a dungeon key. Older versions pay a dungeon key; newer ones do not. */
    $type?: string;
}

interface GuildTierRaw {
    Tier?: string;
    RequiredPoints?: number;
    WarWonRewards?: TierRewardRaw[];
    WarLostRewards?: TierRewardRaw[];
    TierPointsOnWin?: number;
    TierPointsOnLose?: number;
}

/** A reward, resolved to the words and the sprite this app already uses for it. */
export interface TierReward {
    amount: number;
    /** The words a player would use. Never a config id. */
    label: string;
    /** A `SpriteIcon` name this app is known to have, or `null` when there is no icon for it. */
    icon: string | null;
    /** True when the id had no entry in the map, so the row is deliberately nameless. */
    unnamed: boolean;
}

/** One tier, normalised. `key` is what the database stores; `pointsOnWin/Lose` may be absent. */
export interface GuildTier {
    key: ClanTier;
    requiredPoints: number;
    won: TierReward[];
    lost: TierReward[];
    pointsOnWin: number | null;
    pointsOnLose: number | null;
}

/* ------------------------------------------------------------------------------------------ *
 * Config id -> the words and the sprite the rest of the app already uses
 * ------------------------------------------------------------------------------------------ */

/**
 * Currency ids, as `GuildTierConfig.json` spells them, mapped to the app's own vocabulary.
 *
 * The words come from `Profile/ResourcesEditor.tsx`, which is where a player already reads and edits
 * these same five resources, so the reward list and their own resource panel agree. The sprite names
 * come from `SpriteIcon`'s sheet map, and every one of them was checked to be in it: an unknown name
 * makes that component log a warning and draw a grey circle.
 */
const CURRENCY_WORDS: Record<string, { label: string; icon: string }> = {
    Hammers: { label: 'Hammers', icon: 'Hammer' },
    Coins: { label: 'Coins', icon: 'Coin' },
    Gems: { label: 'Gems', icon: 'GemSquare' },
    SkillSummonTickets: { label: 'Skill Tickets', icon: 'SkillTicket' },
    TechPotions: { label: 'Tech Potions', icon: 'Potion' },
    ClockWinders: { label: 'Clock Winders', icon: 'MountKey' },
    Eggshells: { label: 'Eggshells', icon: 'Eggshell' },
    GuildPotions: { label: 'Guild Potions', icon: 'GuildPotions' },
};

/**
 * Dungeon-key ids. Only the older config versions pay one of these for a war, and only ever `Pet`.
 *
 * `Pet` is the EGG dungeon's key, not a pet's: `pages/Dungeons.tsx` is the app's existing authority
 * on that pairing (its Egg Dungeon tab draws the `PetKey` sprite, and its own comment records that
 * the Invasion/Egg dungeon is "mapped as 'Pet' in JSON"). Naming it "pet keys" here would send a
 * player looking for a dungeon that does not exist.
 */
const DUNGEON_KEY_WORDS: Record<string, { label: string; icon: string }> = {
    Hammer: { label: 'Hammer Thief keys', icon: 'HammerKey' },
    Skill: { label: 'Skill Dungeon keys', icon: 'SkillKey' },
    Pet: { label: 'Egg Dungeon keys', icon: 'PetKey' },
    Potion: { label: 'Potion Dungeon keys', icon: 'PotionKey' },
};

function resolveReward(raw: TierRewardRaw): TierReward | null {
    const amount = Number(raw?.Amount);
    if (!Number.isFinite(amount)) return null;
    const type = typeof raw?.Type === 'string' ? raw.Type : '';
    const known = raw?.$type === 'DungeonKeyReward' ? DUNGEON_KEY_WORDS[type] : CURRENCY_WORDS[type];
    if (known) return { amount, label: known.label, icon: known.icon, unnamed: false };
    // The id is deliberately NOT shown. A player cannot act on "SkillSummonTickets", and a raw id on
    // screen is the app admitting it does not know what it is paying you in a way that looks like a
    // name. The amount is still true, so the row stays.
    return { amount, label: 'Unnamed reward', icon: null, unnamed: true };
}

/* ------------------------------------------------------------------------------------------ *
 * Reading the tiers
 * ------------------------------------------------------------------------------------------ */

export interface GuildTiersState {
    /** Every tier this config version defines that the clan server also accepts, weakest first. */
    tiers: GuildTier[];
    /** The config is still being fetched. Not the same as "there are no tiers". */
    loading: boolean;
    /** The config could not be read at all. */
    failed: boolean;
    /**
     * Tier keys this config version defines that `clans_tier_chk` would reject. Zero today; a value
     * above zero means the game shipped a tier the clan server has not been migrated for, and a
     * picker has to say so rather than offer a button that earns a `22023` on save.
     */
    unsupported: string[];
    /** The config version these numbers came from, for a screen that wants to name it. */
    version: string;
}

/**
 * Every tier of the SELECTED config version, ordered by `RequiredPoints` ascending.
 *
 * Ordered by points and never by the key: the keys sort A, B, C, D, E, S, SS, SSS as text, which is
 * the game's ranking almost exactly backwards at the front. 0011 puts the same warning on the
 * column comment. `RequiredPoints` is the rank, and it is in the config.
 */
export function useGuildTiers(): GuildTiersState {
    const { data, loading, error } = useGameData<Record<string, GuildTierRaw>>('GuildTierConfig.json');
    const { selectedVersion } = useGameDataContext();

    return useMemo(() => {
        const tiers: GuildTier[] = [];
        const unsupported: string[] = [];

        for (const [key, raw] of Object.entries(data ?? {})) {
            if (!raw || typeof raw !== 'object') continue;
            if (!isClanTier(key)) {
                // A tier the game defines and the database would refuse. Counted, not offered.
                unsupported.push(key);
                continue;
            }
            tiers.push({
                key,
                requiredPoints: Number.isFinite(Number(raw.RequiredPoints)) ? Number(raw.RequiredPoints) : 0,
                won: (raw.WarWonRewards ?? []).map(resolveReward).filter((r): r is TierReward => r !== null),
                lost: (raw.WarLostRewards ?? []).map(resolveReward).filter((r): r is TierReward => r !== null),
                // `?? null`, never `?? 0`: a config that does not say is not a config that says zero.
                pointsOnWin: typeof raw.TierPointsOnWin === 'number' ? raw.TierPointsOnWin : null,
                pointsOnLose: typeof raw.TierPointsOnLose === 'number' ? raw.TierPointsOnLose : null,
            });
        }

        tiers.sort((a, b) => a.requiredPoints - b.requiredPoints);
        return {
            tiers,
            loading: loading && tiers.length === 0,
            failed: !!error || (!loading && tiers.length === 0),
            unsupported,
            version: selectedVersion,
        };
    }, [data, loading, error, selectedVersion]);
}

/* ------------------------------------------------------------------------------------------ *
 * Formatting — the sign is part of the number, always
 * ------------------------------------------------------------------------------------------ */

/**
 * Carries the sign in the digits whenever there is one to carry: `+3`, `-5`, and a bare `0`, which
 * has none. No reader ever has to infer a sign from the surrounding words.
 */
function signed(n: number): string {
    if (n > 0) return `+${n.toLocaleString()}`;
    if (n < 0) return n.toLocaleString();
    return '0';
}

function amountText(n: number): string {
    return Math.round(n).toLocaleString();
}

/* ------------------------------------------------------------------------------------------ *
 * The tier chip — one letter, readable at a glance, never a rank comparison
 * ------------------------------------------------------------------------------------------ */

export function TierChip({ tier, size = 'md' }: { tier: ClanTier | null; size?: 'sm' | 'md' | 'lg' }) {
    const dims =
        size === 'lg' ? 'h-14 min-w-[3.5rem] px-2 text-2xl' : size === 'sm' ? 'h-7 min-w-[1.75rem] px-1.5 text-xs' : 'h-10 min-w-[2.5rem] px-2 text-lg';
    if (!tier) {
        return (
            <span
                className={cn(
                    'inline-flex items-center justify-center rounded-xl border border-dashed border-border bg-bg-input font-black text-text-muted',
                    dims,
                )}
                aria-label="Guild tier not set"
            >
                ?
            </span>
        );
    }
    return (
        <span
            className={cn(
                'inline-flex items-center justify-center rounded-xl border border-accent-primary/50 bg-accent-primary/15 font-black tracking-wide text-accent-primary',
                dims,
            )}
            aria-label={`Guild tier ${tier}`}
        >
            {tier}
        </span>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * The tier picker — shared by CreateClanForm and ClanAdminPanel so the copy cannot drift
 * ------------------------------------------------------------------------------------------ */

export interface TierOptionsProps {
    /** The tier currently chosen, or `null` for "not set". */
    value: ClanTier | null;
    onChange: (tier: ClanTier | null) => void;
    /** Whether to offer the "not set" option. Creation offers it; clearing an existing tier does too. */
    allowClear?: boolean;
    disabled?: boolean;
    className?: string;
}

/**
 * Eight buttons, or six, or however many this config version defines — the list is the config's, and
 * when the config has not loaded the control says so rather than showing an empty row or a list
 * typed out from memory. A hard-coded set would be wrong on two counts: the tiers changed between
 * config versions, and a list in the client is a second place for the game's own data to be stale.
 */
export function TierOptions({ value, onChange, allowClear = true, disabled, className }: TierOptionsProps) {
    const { tiers, loading, failed, unsupported } = useGuildTiers();

    if (loading) {
        return (
            <p className={cn('text-xs text-text-secondary', className)}>
                Reading the tier list out of the game data
            </p>
        );
    }
    if (failed) {
        return (
            <p className={cn('text-xs text-amber-300', className)}>
                The game data for this version does not list any guild tiers, so there is nothing to
                choose from. Pick another game version at the top of the page, or leave the tier unset
                and set it later.
            </p>
        );
    }

    return (
        <div className={className}>
            <div className="flex flex-wrap gap-1.5">
                {allowClear && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(null)}
                        aria-pressed={value === null}
                        className={cn(
                            'rounded-lg border px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-40',
                            value === null
                                ? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
                                : 'border-border bg-bg-input text-text-secondary hover:border-accent-primary/50 hover:text-white',
                        )}
                    >
                        Not set
                    </button>
                )}
                {tiers.map(tier => {
                    const active = value === tier.key;
                    return (
                        <button
                            key={tier.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(tier.key)}
                            aria-pressed={active}
                            title={`Starts at ${tier.requiredPoints} tier points`}
                            className={cn(
                                'min-w-[2.75rem] rounded-lg border px-2.5 py-1.5 text-xs font-black transition disabled:opacity-40',
                                active
                                    ? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
                                    : 'border-border bg-bg-input text-text-secondary hover:border-accent-primary/50 hover:text-white',
                            )}
                        >
                            {tier.key}
                        </button>
                    );
                })}
            </div>
            {unsupported.length > 0 && (
                <p className="mt-1.5 text-xs text-amber-300">
                    This game version also has {unsupported.length} tier
                    {unsupported.length === 1 ? '' : 's'} the clan server has not been taught yet, so
                    {unsupported.length === 1 ? ' it is' : ' they are'} not offered here.
                </p>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------------------------------ *
 * Pieces of the panel
 * ------------------------------------------------------------------------------------------ */

function RewardList({ rewards, tone }: { rewards: TierReward[]; tone: 'win' | 'lose' }) {
    if (rewards.length === 0) {
        return <p className="text-xs text-text-muted">This game version lists no rewards here.</p>;
    }
    return (
        <ul className="space-y-1">
            {rewards.map((reward, index) => (
                <li
                    key={`${reward.label}-${index}`}
                    className="flex items-center justify-between gap-2 border-b border-white/5 py-1 last:border-0"
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {reward.icon ? (
                            <SpriteIcon name={reward.icon} size={18} />
                        ) : (
                            <span aria-hidden="true" className="inline-block h-[18px] w-[18px] shrink-0 rounded bg-white/10" />
                        )}
                        <span className={cn('whitespace-nowrap overflow-hidden text-clip text-xs', reward.unnamed ? 'italic text-text-muted' : 'text-text-secondary')}>
                            {reward.label}
                        </span>
                    </span>
                    <span
                        className={cn(
                            'shrink-0 font-mono text-sm font-bold tabular-nums',
                            tone === 'win' ? 'text-emerald-300' : 'text-red-300',
                        )}
                    >
                        {amountText(reward.amount)}
                    </span>
                </li>
            ))}
        </ul>
    );
}

/**
 * One tier-point figure, drawn so that its sign cannot be missed: the digits carry it, the colour
 * carries it, an arrow carries it and a sentence says it in words. Three of those four are redundant
 * on purpose. `null` means the config did not say, which is never rendered as a zero.
 */
function SwingRow({
    outcome,
    points,
    sentence,
}: {
    outcome: 'win' | 'lose';
    points: number | null;
    sentence: string;
}) {
    const positive = points !== null && points > 0;
    const negative = points !== null && points < 0;
    const tone = negative
        ? 'border-red-500/50 bg-red-500/10'
        : positive
            ? 'border-emerald-500/50 bg-emerald-500/10'
            : 'border-border bg-bg-input/50';
    const digits = negative ? 'text-red-300' : positive ? 'text-emerald-300' : 'text-text-muted';

    return (
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5', tone)}>
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-black uppercase tracking-wider text-text-secondary">
                {outcome === 'win' ? <Trophy className="h-3.5 w-3.5" /> : <Swords className="h-3.5 w-3.5" />}
                {outcome === 'win' ? 'War won' : 'War lost'}
            </span>
            <span className={cn('flex shrink-0 items-center gap-1 font-mono text-xl font-black tabular-nums', digits)}>
                {points === null ? null : negative ? (
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                ) : positive ? (
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                    <Minus className="h-4 w-4" aria-hidden="true" />
                )}
                {points === null ? <span className="text-sm font-normal text-text-muted">not stated</span> : signed(points)}
            </span>
            <span className="min-w-0 flex-1 basis-48 text-xs text-text-secondary">{sentence}</span>
        </div>
    );
}

/**
 * The sentence next to a tier-point figure. Written out rather than templated on the number, because
 * the whole point is that "+3" and "-5" mean opposite things and only words make that unmissable.
 */
function loseSentence(points: number | null): string {
    if (points === null) return 'This game version does not say what a defeat does to your tier points.';
    if (points > 0) return `A defeat still GAINS you ${points} tier point${points === 1 ? '' : 's'} at this tier. You climb either way.`;
    if (points < 0) return `A defeat COSTS you ${Math.abs(points)} tier point${Math.abs(points) === 1 ? '' : 's'} at this tier. Losing sends you back down.`;
    return 'A defeat neither gains nor costs tier points at this tier.';
}

function winSentence(points: number | null): string {
    if (points === null) return 'This game version does not say what a win does to your tier points.';
    if (points > 0) return `A win gains you ${points} tier point${points === 1 ? '' : 's'}.`;
    if (points < 0) return `A win COSTS you ${Math.abs(points)} tier point${Math.abs(points) === 1 ? '' : 's'} at this tier.`;
    return 'A win neither gains nor costs tier points at this tier.';
}

/** The per-currency difference between two reward lists, matched by label. */
function rewardDelta(from: TierReward[], to: TierReward[]): { label: string; icon: string | null; delta: number }[] {
    const before = new Map(from.map(r => [r.label, r.amount]));
    const out: { label: string; icon: string | null; delta: number }[] = [];
    for (const reward of to) {
        const delta = reward.amount - (before.get(reward.label) ?? 0);
        if (Math.round(delta) === 0) continue;
        out.push({ label: reward.label, icon: reward.icon, delta });
    }
    return out;
}

/* ------------------------------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------------------------------ */

export interface ClanTierPanelProps {
    /**
     * A control the caller wants in the header. `ClanAdminPanel` puts the owner's "change the tier"
     * button here and gives an admin or a member nothing at all, so this component never has to know
     * who is allowed to write.
     */
    action?: ReactNode;
    className?: string;
}

export function ClanTierPanel({ action, className }: ClanTierPanelProps) {
    const clan = useClan();
    const { tiers, loading, failed, version } = useGuildTiers();

    const clanRow = clan.clan;
    const tierKey = clanRow?.tier ?? null;

    const current = useMemo(() => tiers.find(t => t.key === tierKey) ?? null, [tiers, tierKey]);
    const next = useMemo(() => {
        if (!current) return null;
        return tiers.find(t => t.requiredPoints > current.requiredPoints) ?? null;
    }, [tiers, current]);

    // No backend, signed out, a shared profile, still loading, or this profile is in no clan: there
    // is no clan whose tier this could be, so nothing is drawn. The surfaces that own those states
    // say what to do instead.
    if (clan.status !== 'ready' || !clanRow || !clan.role || !clan.membership) return null;

    const shell = (children: ReactNode) => (
        <section
            className={cn('rounded-xl border border-border bg-bg-secondary/50 p-4', className)}
            aria-labelledby="clan-tier-heading"
        >
            <div className="mb-3 flex flex-wrap items-start gap-3">
                <TierChip tier={tierKey} size="lg" />
                <div className="min-w-0 flex-1 basis-40">
                    <h4 id="clan-tier-heading" className="text-sm font-black uppercase tracking-wider text-white">
                        Guild tier
                    </h4>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        {tierKey
                            ? `This clan is recorded as tier ${tierKey}. It is what somebody typed in after looking at the guild screen in game: it does not move on its own when you win or lose, and changing it here changes nothing in game.`
                            : 'Nobody has recorded this clan’s tier yet, so there is nothing to price a war with.'}
                    </p>
                </div>
                {action && <div className="shrink-0">{action}</div>}
            </div>
            {children}
        </section>
    );

    /* ---- the states that are not a tier table ---- */

    if (!tierKey) {
        return shell(
            <p className="flex items-start gap-2 rounded-lg border border-border bg-bg-input/50 p-3 text-xs text-text-secondary">
                <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <span>
                    Guild tier decides what a war pays and what a defeat costs, and the two are not the
                    same at the bottom and at the top of the ladder. Until somebody records it, this
                    app will not guess: a guessed tier would put a wrong number on screen as a fact.
                    {clan.role === 'owner'
                        ? ' You are the owner, so you can set it here.'
                        : ' Only the clan owner can set it.'}
                </span>
            </p>,
        );
    }

    if (loading) {
        return shell(<p className="text-xs text-text-secondary">Reading what tier {tierKey} pays out of the game data</p>);
    }

    if (failed) {
        return shell(
            <p className="text-xs text-amber-300">
                The game data for this version does not list any guild tiers, so there is nothing to
                show for tier {tierKey}. Pick another game version at the top of the page.
            </p>,
        );
    }

    if (!current) {
        // The tier is set and legal, but THIS config version has never heard of it. Real and
        // common: versions before 2026_05 stop at S, so an SSS clan viewed on an old version lands
        // here. Falling back to the nearest tier would be inventing numbers.
        return shell(
            <p className="text-xs text-amber-300">
                This clan is recorded as tier {tierKey}, but the game version you are looking at
                ({version}) only goes up to {tiers[tiers.length - 1]?.key ?? 'nothing'}. Switch to a
                newer game version at the top of the page to see what tier {tierKey} pays.
            </p>,
        );
    }

    /* ---- the tier, priced ---- */

    const gapToNext = next ? next.requiredPoints - current.requiredPoints : 0;
    const winsToNext =
        next && current.pointsOnWin !== null && current.pointsOnWin > 0
            ? Math.ceil(gapToNext / current.pointsOnWin)
            : null;
    const wonDelta = next ? rewardDelta(current.won, next.won) : [];
    const lossTurnsSour = !!next && current.pointsOnLose !== null && next.pointsOnLose !== null &&
        current.pointsOnLose >= 0 && next.pointsOnLose < 0;

    return shell(
        <div className="space-y-4">
            {/* THE SWING. First, because it is the number that decides whether a war is worth
                entering, and the one a reader is most likely to misread. */}
            <div>
                <h5 className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-text-muted">
                    What a war does to your tier points
                </h5>
                <div className="space-y-1.5">
                    <SwingRow outcome="win" points={current.pointsOnWin} sentence={winSentence(current.pointsOnWin)} />
                    <SwingRow outcome="lose" points={current.pointsOnLose} sentence={loseSentence(current.pointsOnLose)} />
                </div>
            </div>

            {/* THE REWARDS. Two columns side by side above 640px, stacked below it: six currencies
                times two outcomes is twelve rows, and at 360px a row of two lists puts four
                characters per line in each. */}
            <div>
                <h5 className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-text-muted">
                    What a war pays at tier {current.key}
                </h5>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-emerald-300">
                            <Trophy className="h-3.5 w-3.5" /> If you win
                        </div>
                        <RewardList rewards={current.won} tone="win" />
                    </div>
                    <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-red-300">
                            <Swords className="h-3.5 w-3.5" /> If you lose
                        </div>
                        <RewardList rewards={current.lost} tone="lose" />
                    </div>
                </div>
                {(current.won.some(r => r.unnamed) || current.lost.some(r => r.unnamed)) && (
                    <p className="mt-1.5 text-xs text-text-muted">
                        One of these rewards is something this app has no name for yet, so it is listed
                        without one. The amount is the game&apos;s.
                    </p>
                )}
            </div>

            {/* THE CLIMB. "Is it worth going up" is the leader's real question, and the answer is a
                delta, not two absolute tables the reader has to subtract in their head. */}
            <div>
                <h5 className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-text-muted">
                    Climbing
                </h5>
                <div className="rounded-lg border border-border bg-bg-input/50 p-3">
                    <p className="text-xs text-text-secondary">
                        Tier {current.key} starts at{' '}
                        <span className="font-mono font-bold text-text-primary">{current.requiredPoints}</span> tier
                        point{current.requiredPoints === 1 ? '' : 's'}.
                    </p>
                    {next ? (
                        <>
                            <p className="mt-1 text-xs text-text-secondary">
                                Tier {next.key} starts at{' '}
                                <span className="font-mono font-bold text-text-primary">{next.requiredPoints}</span>:{' '}
                                <span className="font-bold text-text-primary">{gapToNext}</span> more tier point
                                {gapToNext === 1 ? '' : 's'}
                                {winsToNext !== null && (
                                    <>
                                        , which is{' '}
                                        <span className="font-bold text-text-primary">{winsToNext}</span> more win
                                        {winsToNext === 1 ? '' : 's'}
                                        {/* "with no defeat in between" is only true where a defeat
                                            takes points off you. At the bottom of the ladder a
                                            defeat pays too, so the clause would be a lie there. */}
                                        {current.pointsOnLose !== null && current.pointsOnLose < 0
                                            ? ' with no defeat in between'
                                            : ''}
                                    </>
                                )}
                                .
                            </p>
                            {wonDelta.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {/* Keyed on the index too: two rewards this app cannot name
                                        would both be labelled "Unnamed reward". */}
                                    {wonDelta.map((item, index) => (
                                        <li key={`${item.label}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                {item.icon ? (
                                                    <SpriteIcon name={item.icon} size={16} />
                                                ) : (
                                                    <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded bg-white/10" />
                                                )}
                                                <span className="whitespace-nowrap overflow-hidden text-clip text-text-secondary">{item.label} per win</span>
                                            </span>
                                            <span
                                                className={cn(
                                                    'shrink-0 font-mono font-bold tabular-nums',
                                                    item.delta < 0 ? 'text-red-300' : 'text-emerald-300',
                                                )}
                                            >
                                                {signed(Math.round(item.delta))}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {/* The cost of climbing, and the reason this section is not just a list
                                of bigger numbers. */}
                            {lossTurnsSour ? (
                                <p className="mt-2 flex items-start gap-1.5 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
                                    <ArrowDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>
                                        Careful: at tier {next.key} a defeat starts COSTING you{' '}
                                        {Math.abs(next.pointsOnLose ?? 0)} tier point
                                        {Math.abs(next.pointsOnLose ?? 0) === 1 ? '' : 's'} instead of paying you{' '}
                                        {current.pointsOnLose}. Above here, losing sends you back down.
                                    </span>
                                </p>
                            ) : (
                                next.pointsOnLose !== null && (
                                    <p className="mt-2 text-xs text-text-muted">
                                        At tier {next.key} a defeat is worth{' '}
                                        <span className={cn('font-mono font-bold', next.pointsOnLose < 0 ? 'text-red-300' : 'text-emerald-300')}>
                                            {signed(next.pointsOnLose)}
                                        </span>{' '}
                                        tier points{next.pointsOnLose < 0 ? ', so a bad week costs you the place' : ''}.
                                    </p>
                                )
                            )}
                        </>
                    ) : (
                        <p className="mt-1 text-xs text-text-secondary">
                            This is the highest tier this game version defines. There is nothing above
                            it to climb to, so every war from here is about holding the place.
                        </p>
                    )}
                </div>
            </div>

            <p className="text-xs text-text-muted">
                All of these numbers come from game data version{' '}
                <span className="font-mono text-text-secondary">{version}</span> and change with it.
                Pick another version at the top of the page to see what it paid then.
            </p>
        </div>,
    );
}

export default ClanTierPanel;
