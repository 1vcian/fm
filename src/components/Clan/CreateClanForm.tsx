/**
 * CreateClanForm — found a clan with the profile that is on screen.
 * ================================================================
 *
 * WHAT THIS SCREEN IS RESPONSIBLE FOR
 * -----------------------------------
 * Three things the database cannot do for the user, and one it can:
 *
 *   1. **Say whose clan this will be.** Membership is per PROFILE, not per account
 *      (`clan_members`' primary key is `profile_id`), so "create a clan" is meaningless until the
 *      form names the profile it is about. An account with three profiles can found three clans,
 *      and the only way to know which one is being used is to read it off this form.
 *   2. **Refuse before the round trip, with a reason.** A profile that is already in a clan, and a
 *      shared/imported profile that exists in no database at all, both fail server-side — but with
 *      a 42501 that says nothing useful to a person. Both are known locally, so this form says so
 *      instead of spending a request.
 *   3. **Hand over the join password.** `create_clan()`'s response is the ONLY response in the whole
 *      schema that carries the password (0003 §8). If this screen does not show it, the owner has
 *      to go and read it back out of `clan_secrets` before anybody can join — and a clan whose
 *      owner never learned the password is a clan nobody can join. So the password is surfaced
 *      immediately, with a copy button and a sentence saying what it is for.
 *   4. The badge, which the database *can* do: a `BEFORE INSERT` trigger (0004 §, retightened by
 *      0006) assigns a random LEGAL badge to every new clan. The picker here is therefore a
 *      refinement and never a requirement, and the UI says exactly that — an empty picker cannot
 *      block creation, and skipping it still yields a real emblem.
 *   5. **The guild tier**, which the database explicitly *cannot* do. 0011 added `clans.tier` as a
 *      nullable column with NO default, because this app cannot read the game and so has never
 *      observed the tier: only a person who looked at their guild screen can supply it. The tier
 *      picks concrete war rewards and, more importantly, the SIGN of the tier-point swing on a
 *      defeat, so a default would put a wrong number on screen as a fact. Skipping it here is a
 *      first-class outcome — the clan is created with no tier and its owner can record one later.
 *
 * THE TIER IS A STATEMENT, NOT A SETTING THE TOOL ENFORCES
 * -------------------------------------------------------
 * Choosing a tier here records where the guild sits in game right now. It changes nothing in game,
 * nothing pushes it back the other way, and it does not move on its own when a war is won or lost.
 * The copy next to the picker says all three, because a control that looks like it configures the
 * guild is a control people will expect the guild to obey.
 *
 * VALIDATION COMES FROM THE GAME, NOT FROM MEMORY
 * ----------------------------------------------
 * `MaxGuildNameLength`, `MaxGuildTagLength`, `NameValidationRegex` and `TagValidationRegex` are read
 * out of `GuildBaseConfig.json` at runtime, so the form's rules move with the game's. The constants
 * in `clanApi` are the fallback for the moment before that config has loaded (and they are what the
 * `clans_name_check` / `clans_tag_check` CHECK constraints enforce anyway, so the two agree today).
 * The comparison is done on the values the database will actually store: `normalize_clan()` trims the
 * name and upper-cases the trimmed tag, so that is what gets measured and matched.
 *
 * THE BADGE IS APPLIED THROUGH clanApi, NOT THROUGH ClanContext
 * -----------------------------------------------------------
 * `create_clan()` takes no badge (0004 deliberately left the function alone and used a trigger), so
 * a chosen badge is a second call. It goes to `setClanBadge(created.id, badge)` directly rather than
 * to `clan.setBadge()`, because the context's action is bound to the clan id in the render that
 * produced it — at the moment `create()` resolves, the `setBadge` this component is holding still
 * closes over `clanId === null` and would refuse. The id from the creation response has no such
 * problem. A badge that fails to apply is reported as its own line: the clan exists either way, and
 * saying "creation failed" because a cosmetic follow-up call failed would be a lie.
 *
 * THE PASSWORD
 * ------------
 * It is rendered in exactly one place, once, as the deliberate reveal this screen exists for. It is
 * never written to the console, never put in a `title=` attribute (which screenshots and hover both
 * capture), and never stored anywhere by this component beyond the React state of the panel that
 * shows it. There is no `console.log` in this file for that reason.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
    AlertTriangle,
    Check,
    Copy,
    Info,
    KeyRound,
    Loader2,
    Palette,
    ShieldCheck,
    Swords,
    Users,
} from 'lucide-react';
import { Button } from '../UI/Button';
import { ClanBadge, ClanBadgePicker } from '../UI/ClanBadge';
import { TierOptions } from './ClanTierPanel';
import { useClan } from '../../context/ClanContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { DEFAULT_BADGE, type ClanBadge as ClanBadgeValue } from '../../utils/clanBadge';
import {
    CLAN_MEMBER_CAP_DEFAULT,
    CLAN_NAME_MAX_LENGTH,
    CLAN_NAME_PATTERN,
    CLAN_TAG_MAX_LENGTH,
    CLAN_TAG_PATTERN,
    setClanBadge,
    setClanTier,
    type ClanJoinPolicy,
    type ClanTier,
    type CreatedClan,
} from '../../services/clanApi';
import { cn } from '../../lib/utils';

/** The fields of `GuildBaseConfig.json` this form reads. Everything else in it is ignored. */
interface GuildBaseConfig {
    MaxGuildNameLength?: number;
    MaxGuildTagLength?: number;
    MaxGuildMemberCount?: number;
    NameValidationRegex?: string;
    TagValidationRegex?: string;
}

export interface CreateClanFormProps {
    /**
     * Called once the clan exists (after the success panel is dismissed), so a page can switch to
     * its clan view. The `CreatedClan` is passed through, minus nothing — including the password,
     * which the caller must treat the same way this component does.
     */
    onCreated?: (created: CreatedClan) => void;
    className?: string;
}

/**
 * Turn a config regex string into a RegExp, or `null` if it will not compile.
 *
 * The config's patterns are authored for the game's own runtime, so a future one could use syntax
 * JavaScript does not accept. A `null` here means "fall back to the pattern the CHECK constraint
 * enforces" rather than "let anything through": the database is still the enforcement either way.
 */
function compilePattern(source: string | undefined, fallback: RegExp): RegExp {
    if (!source) return fallback;
    try {
        return new RegExp(source);
    } catch {
        return fallback;
    }
}

const POLICIES: { id: ClanJoinPolicy; label: string; blurb: string }[] = [
    {
        id: 'invite',
        label: 'Password joins straight away',
        // join_clan(): for an `invite` clan a correct name + tag + password inserts the membership.
        blurb: 'Anyone who has the clan name, the tag and the password is in immediately.',
    },
    {
        id: 'request',
        label: 'Password asks to join',
        // join_clan(): for a `request` clan the same three values only create a clan_requests row.
        blurb: 'The password gets them onto a waiting list. A leader still approves each one.',
    },
];

export function CreateClanForm({ onCreated, className }: CreateClanFormProps) {
    const clan = useClan();
    const { profile } = useProfile();
    const { data: baseConfig } = useGameData<GuildBaseConfig>('GuildBaseConfig.json');

    const [name, setName] = useState('');
    const [tag, setTag] = useState('');
    const [joinPolicy, setJoinPolicy] = useState<ClanJoinPolicy>('invite');
    const [badge, setBadge] = useState<ClanBadgeValue>({ ...DEFAULT_BADGE });
    const [badgeChosen, setBadgeChosen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    /**
     * `null` is the default and it is a real answer, not an empty field: 0011 keeps `clans.tier`
     * nullable with no default so that "nobody has told us" survives as a distinct state. Nothing
     * here defaults it to E.
     */
    const [tier, setTier] = useState<ClanTier | null>(null);

    const [submitting, setSubmitting] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [created, setCreated] = useState<CreatedClan | null>(null);
    /**
     * Something that happened AFTER the clan existed and the owner should still know about: an
     * emblem that did not apply, a clipboard the browser refused. Deliberately separate from
     * `failure` — a clan that exists must never be reported as a failed creation.
     */
    const [afterNote, setAfterNote] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    /* -------------------------------------------------------------------------------------- *
     * The game's own rules
     * -------------------------------------------------------------------------------------- */

    const maxName = Math.max(1, baseConfig?.MaxGuildNameLength ?? CLAN_NAME_MAX_LENGTH);
    const maxTag = Math.max(1, baseConfig?.MaxGuildTagLength ?? CLAN_TAG_MAX_LENGTH);
    const namePattern = useMemo(
        () => compilePattern(baseConfig?.NameValidationRegex, CLAN_NAME_PATTERN),
        [baseConfig?.NameValidationRegex],
    );
    const tagPattern = useMemo(
        () => compilePattern(baseConfig?.TagValidationRegex, CLAN_TAG_PATTERN),
        [baseConfig?.TagValidationRegex],
    );

    // What the database will actually store: `normalize_clan()` trims the name and upper-cases the
    // trimmed tag before any CHECK runs, so the normalised values are the ones worth validating.
    const storedName = name.trim();
    const storedTag = tag.trim().toUpperCase();

    const nameError = !storedName
        ? null
        : storedName.length > maxName
            ? `At most ${maxName} characters.`
            : !namePattern.test(storedName)
                ? "Letters, digits, spaces and ' & - _ only."
                : null;

    const tagError = !storedTag
        ? null
        : storedTag.length > maxTag
            ? `At most ${maxTag} characters.`
            : !tagPattern.test(storedTag)
                ? 'A–Z, 0–9, - and _ only.'
                : null;

    const canSubmit =
        !!storedName && !!storedTag && !nameError && !tagError && !submitting && !clan.busy;

    /* -------------------------------------------------------------------------------------- *
     * Submit
     * -------------------------------------------------------------------------------------- */

    async function submit() {
        if (!canSubmit) return;
        setSubmitting(true);
        setFailure(null);
        setAfterNote(null);
        try {
            const result = await clan.create({ name: storedName, tag: storedTag, joinPolicy });
            if (!result.ok) {
                // `error.message` is the human sentence from the taxonomy; `error.raw` carries ids
                // and function names and is never rendered (nor logged — see the header).
                setFailure(result.error.message);
                return;
            }
            const clanRow = result.data;
            setCreated(clanRow);

            // Two follow-up calls, for the same reason: `create_clan()` takes neither the badge
            // (0004 used a trigger) nor the tier (0011 left the function alone and extended
            // `set_clan_settings` instead). Both go straight to `clanApi` rather than through a
            // context action — see the header — and neither one failing undoes the clan.
            const notes: string[] = [];
            let applied = false;

            if (badgeChosen) {
                const badgeResult = await setClanBadge(clanRow.id, badge);
                if (!badgeResult.ok) {
                    notes.push(
                        `Your emblem could not be saved: ${badgeResult.error.message} A random one is in place; you can change it from the clan settings.`,
                    );
                } else {
                    applied = true;
                }
            }

            if (tier !== null) {
                // The creator IS the owner, so the owner-only rule on set_clan_settings() is
                // satisfied by construction. It is still reported honestly if the server disagrees:
                // a clan with no tier is a working clan, and its owner can record one at any time.
                const tierResult = await setClanTier(clanRow.id, tier);
                if (!tierResult.ok) {
                    notes.push(
                        `The tier could not be saved: ${tierResult.error.message} The clan has no tier recorded; set it from the clan settings whenever you like.`,
                    );
                } else {
                    applied = true;
                }
            }

            // The clan row in context still holds the trigger's random badge and no tier.
            if (applied) await clan.refresh();
            if (notes.length > 0) setAfterNote(`The clan was created, but: ${notes.join(' ')}`);
        } finally {
            setSubmitting(false);
        }
    }

    async function copyPassword() {
        if (!created) return;
        try {
            await navigator.clipboard?.writeText(created.join_password);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Clipboard permission denied, or an insecure context. The password is on screen
            // anyway, so the honest fallback is to say "select it and copy it yourself".
            setCopied(false);
            setAfterNote('This browser would not let the page write to the clipboard. Select the password and copy it by hand.');
        }
    }

    /* -------------------------------------------------------------------------------------- *
     * States that are not a form
     * -------------------------------------------------------------------------------------- */

    // No backend in this build: clans do not exist here at all. Render NOTHING — not a disabled
    // button, not an explanation of a feature that cannot be reached (the app's hard rule).
    if (clan.status === 'unconfigured') return null;

    const shell = (children: ReactNode) => (
        <section
            className={cn('rounded-2xl border border-border bg-bg-secondary/60 p-5', className)}
            aria-labelledby="create-clan-heading"
        >
            <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-primary/30 bg-accent-primary/15">
                    <Users className="h-5 w-5 text-accent-primary" />
                </div>
                <div className="min-w-0">
                    <h3 id="create-clan-heading" className="text-lg font-black text-white">
                        Create a clan
                    </h3>
                    <p className="mt-0.5 text-sm text-text-secondary">
                        You get a name, a tag, an emblem and a join password to hand out.
                    </p>
                </div>
            </div>
            {children}
        </section>
    );

    /**
     * Once the clan exists, nothing else on this screen matters — and this check has to come FIRST.
     * `create()` reloads the context, so a heartbeat later `status` is `'loading'` and then
     * `'ready'` with a membership: both of the branches below would otherwise take over and swallow
     * the one and only view of the join password. Creation is a terminal state for this form.
     */
    if (created) return renderCreated(created);

    if (clan.status === 'signed-out') {
        return shell(
            <p className="text-sm text-text-secondary">
                Clans live on your account. Sign in first, then come back here.
            </p>,
        );
    }

    if (clan.status === 'shared-profile') {
        return shell(
            <p className="flex items-start gap-2 text-sm text-text-secondary">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
                <span>
                    You are looking at a profile somebody shared with you. A shared profile is not
                    yours and belongs to no clan — save it as your own profile first, then create a
                    clan with it.
                </span>
            </p>,
        );
    }

    if (clan.status === 'loading') {
        return shell(
            <p className="flex items-center gap-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking whether this profile is already
                in a clan
            </p>,
        );
    }

    // Already in a clan: one clan per PROFILE. Say which profile, because another profile on the
    // same account may well be free.
    if (clan.status === 'ready' && clan.membership) {
        return shell(
            <div className="space-y-2 text-sm text-text-secondary">
                <p className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
                    <span>
                        <span className="font-semibold text-text-primary">{profile.name}</span> is
                        already in{' '}
                        <span className="font-semibold text-text-primary">
                            {clan.clan ? `${clan.clan.name} [${clan.clan.tag}]` : 'a clan'}
                        </span>{' '}
                        as {clan.role}. A profile can only be in one clan.
                    </span>
                </p>
                <p className="text-xs text-text-muted">
                    Leave that clan first, or switch to another profile — membership is per profile,
                    so a second profile on this account can found its own clan.
                </p>
            </div>,
        );
    }

    if (clan.status === 'error') {
        return shell(
            <div className="space-y-3">
                <p className="text-sm text-red-300">{clan.error?.message ?? 'Something went wrong.'}</p>
                <Button variant="secondary" size="sm" onClick={() => void clan.refresh()}>
                    Try again
                </Button>
            </div>,
        );
    }

    /* -------------------------------------------------------------------------------------- *
     * Created — the one deliberate reveal of the join password
     * -------------------------------------------------------------------------------------- */

    // A function declaration, so it is hoisted above the early return that calls it.
    function renderCreated(created: CreatedClan) {
        return shell(
            <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-3">
                    <ClanBadge badge={clan.badge ?? badge} size={40} />
                    <div className="min-w-0">
                        <div className="whitespace-nowrap overflow-hidden text-clip text-base font-black text-white">
                            {created.name}{' '}
                            <span className="font-mono text-sm text-accent-primary">[{created.tag}]</span>
                        </div>
                        <div className="text-xs text-green-300">
                            Created. You are the owner, as {profile.name}.
                        </div>
                    </div>
                </div>

                {/* THE PASSWORD. The only place it is rendered, and it is rendered on purpose:
                    create_clan()'s response is the only response in the schema that carries it. */}
                <div className="rounded-xl border border-accent-primary/40 bg-accent-primary/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-accent-primary">
                        <KeyRound className="h-3.5 w-3.5" /> Join password
                    </div>
                    <p className="mb-3 text-sm text-text-secondary">
                        This is what your members need. To join, they type the clan name{' '}
                        <span className="font-semibold text-text-primary">{created.name}</span>, the tag{' '}
                        <span className="font-mono font-semibold text-text-primary">{created.tag}</span>{' '}
                        and this password. Post it in your clan chat — and copy it now, because after
                        this screen only you and your admins can look it up again.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <code
                            data-testid="created-join-password"
                            className="min-w-0 flex-1 select-all break-all rounded-lg border border-border bg-bg-input px-3 py-2 font-mono text-base tracking-wider text-white"
                        >
                            {created.join_password}
                        </code>
                        <Button variant="secondary" size="sm" onClick={() => void copyPassword()}>
                            {copied ? (
                                <>
                                    <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
                                </>
                            ) : (
                                <>
                                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                                </>
                            )}
                        </Button>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                        You can change it, or generate a new one, from the clan settings at any time.
                    </p>
                </div>

                {afterNote && (
                    <p className="flex items-start gap-2 text-xs text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{afterNote}</span>
                    </p>
                )}

                <div className="flex justify-end">
                    <Button onClick={() => onCreated?.(created)}>Go to my clan</Button>
                </div>
            </div>,
        );
    }

    /* -------------------------------------------------------------------------------------- *
     * The form
     * -------------------------------------------------------------------------------------- */

    return shell(
        <form
            className="space-y-4"
            onSubmit={e => {
                e.preventDefault();
                void submit();
            }}
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
                <label className="block">
                    <span className="mb-1 flex items-baseline justify-between text-xs font-bold uppercase tracking-wider text-text-secondary">
                        Clan name
                        <span className={cn('font-mono text-[10px]', storedName.length > maxName ? 'text-red-400' : 'text-text-muted')}>
                            {storedName.length}/{maxName}
                        </span>
                    </span>
                    <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Anvil"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!nameError}
                        className="h-10 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                    />
                    {nameError && <span className="mt-1 block text-xs text-red-400">{nameError}</span>}
                </label>

                <label className="block">
                    <span className="mb-1 flex items-baseline justify-between text-xs font-bold uppercase tracking-wider text-text-secondary">
                        Tag
                        <span className={cn('font-mono text-[10px]', storedTag.length > maxTag ? 'text-red-400' : 'text-text-muted')}>
                            {storedTag.length}/{maxTag}
                        </span>
                    </span>
                    <input
                        type="text"
                        value={tag}
                        // The database upper-cases the tag anyway (normalize_clan); doing it here
                        // means the field shows what will actually be stored.
                        onChange={e => setTag(e.target.value.toUpperCase())}
                        placeholder="ANV"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={!!tagError}
                        className="h-10 w-full rounded-lg border border-border bg-bg-input px-3 font-mono text-sm uppercase tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                    />
                    {tagError && <span className="mt-1 block text-xs text-red-400">{tagError}</span>}
                </label>
            </div>

            {/* Whose clan this is. Membership is per profile, so this line is not decoration. */}
            <p className="flex items-start gap-2 rounded-lg border border-border bg-bg-input/60 p-3 text-xs text-text-secondary">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-primary" />
                <span>
                    <span className="font-semibold text-text-primary">{profile.name}</span> becomes the
                    owner. Clan membership belongs to a profile, not to your account — your other
                    profiles stay unaffected and can be in other clans.
                </span>
            </p>

            {/* Join policy: this is what the password DOES, so it is worded as an outcome. */}
            <fieldset>
                <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-secondary">
                    When somebody uses the password
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {POLICIES.map(policy => {
                        const active = joinPolicy === policy.id;
                        return (
                            <button
                                key={policy.id}
                                type="button"
                                onClick={() => setJoinPolicy(policy.id)}
                                aria-pressed={active}
                                className={cn(
                                    'rounded-lg border p-3 text-left transition',
                                    active
                                        ? 'border-accent-primary bg-accent-primary/10'
                                        : 'border-border bg-bg-input/40 hover:border-accent-primary/50',
                                )}
                            >
                                <span className={cn('block text-sm font-bold', active ? 'text-accent-primary' : 'text-text-primary')}>
                                    {policy.label}
                                </span>
                                <span className="mt-0.5 block text-xs text-text-secondary">{policy.blurb}</span>
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            {/* The emblem. A legal random one is assigned server-side, so this is optional and the
                copy says so — otherwise a picker looks like a required step. */}
            <div className="rounded-lg border border-border bg-bg-input/40 p-3">
                {/* Wraps rather than squeezes: at 360px the three-across version crushed the
                    explanation into a ~90px column, seven lines of two words each. `basis-48` on the
                    text is what pushes the button onto its own line instead. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {/* No badge preview until one is CHOSEN. `<ClanBadge badge={null}>` would draw
                        shape 0 / symbol 0, which looks like a decision the user has not made and
                        contradicts the sentence next to it. */}
                    {badgeChosen ? (
                        <ClanBadge badge={badge} size={32} />
                    ) : (
                        <span
                            aria-hidden="true"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-border bg-bg-input text-text-muted"
                        >
                            <Palette className="h-4 w-4" />
                        </span>
                    )}
                    <div className="min-w-0 flex-1 basis-48">
                        <div className="text-sm font-bold text-text-primary">Emblem (optional)</div>
                        <div className="text-xs text-text-secondary">
                            {badgeChosen
                                ? 'Your pick is applied right after the clan is created.'
                                : 'Skip this and the game picks a random one for you. You can change it whenever you like.'}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPickerOpen(open => !open)}
                    >
                        <Palette className="mr-1.5 h-3.5 w-3.5" />
                        {pickerOpen ? 'Close' : badgeChosen ? 'Change' : 'Choose'}
                    </Button>
                </div>
                {pickerOpen && (
                    <ClanBadgePicker
                        className="mt-3"
                        value={badge}
                        onChange={next => {
                            setBadge(next);
                            setBadgeChosen(true);
                        }}
                    />
                )}
            </div>

            {/* The guild tier. Optional, like the emblem, but for the opposite reason: the emblem
                has a server-side default and this deliberately has none, so "not set" is the
                honest answer rather than a gap. The options come from the game data, never from a
                list typed out here — the set of tiers has really changed between game versions. */}
            <div className="rounded-lg border border-border bg-bg-input/40 p-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                    <span
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-input text-text-muted"
                    >
                        <Swords className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 basis-48">
                        <div className="text-sm font-bold text-text-primary">Guild tier (optional)</div>
                        <div className="text-xs text-text-secondary">
                            Where your guild sits in game right now. This app cannot read the game, so
                            it will not guess: pick the tier off your guild screen, or leave it unset
                            and record it later.
                        </div>
                    </div>
                </div>
                <TierOptions className="mt-2.5" value={tier} onChange={setTier} disabled={submitting} />
                <p className="mt-2 text-xs text-text-muted">
                    It is a note to yourselves, not a setting: it changes nothing in game, and it does
                    not move on its own when you win or lose a war. The planner uses it to show what
                    your wars actually pay, and what a defeat costs you at that tier.
                </p>
            </div>

            {failure && (
                <p className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{failure}</span>
                </p>
            )}

            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-text-muted">
                    Up to {baseConfig?.MaxGuildMemberCount ?? CLAN_MEMBER_CAP_DEFAULT} members, the
                    same cap as in game.
                </p>
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating
                        </>
                    ) : (
                        'Create clan'
                    )}
                </Button>
            </div>
        </form>,
    );
}

export default CreateClanForm;
