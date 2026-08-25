/**
 * Feature unlocks, from whichever config the selected game version actually shipped them in.
 * ==========================================================================================
 *
 * THE TABLE MOVED
 * ---------------
 * Up to the 2026_07_03 extraction the game shipped `UnlockConditions.json`: one flat record per
 * feature, carrying `AgeIdx`/`BattleIdx` plus the `RequireCompliance` and `FeatureToggle` flags.
 * From that build on the gate lives in `PlayerSegments.json` as a `PlayerCondition`: the same
 * `MainBattleId` coordinates, but wrapped in a list of property requirements that can express
 * things the old file could not, such as account age, a maxed forge, or a dependency on another
 * segment. The il2cpp dump of 2026_08_21 agrees: the `UnlockCondition` class is gone and
 * `FeatureId()` now returns a `PlayerSegmentId`.
 *
 * `PlayerSegments.json` exists in older extractions too, but only as a single placeholder entry,
 * so anything before that build has to keep reading the file that really carried the table.
 *
 * WHY THIS IS A HOOK AND NOT A COPY IN EACH PAGE
 * ---------------------------------------------
 * Two screens ask the same question. The Unlocks timeline wants every feature; the Shop wants the
 * stage for one product's feature. When the mapping lived in the page, only one of them was ever
 * moved to the new config and the other silently showed nothing, which is how the Shop lost its
 * unlock captions without anybody noticing: it reads with `?.` and never looks at `error`.
 */

import { useMemo } from 'react';
import { useGameData } from './useGameData';
import { useGameDataContext } from '../context/GameDataContext';

/** First extraction whose `PlayerSegments.json` carries the real table rather than a placeholder. */
const SEGMENTS_FROM_VERSION = '2026_07_03_12_39';

/**
 * Display names for feature ids.
 *
 * The segments carry a `DisplayName`, but it is a designer's field and sometimes a whole sentence
 * ("Guild missions are available"), so anything that reads badly on screen is named here instead.
 */
export const FEATURE_NAMES: Record<string, string> = {
    PlatformLogin: 'Platform Login',
    PlayerNameChange: 'Name Change',
    IdleCash: 'Idle Cash',
    Shop: 'Shop',
    StarterPackage: 'Starter Package',
    Dungeons: 'Dungeons',
    Dungeon_Hammer: 'Hammer Thief',
    AutoForge: 'Auto Forge',
    SkillCollection: 'Skills',
    SkillSlot0: 'Skill Slot 1',
    Dungeon_Skill: 'Ghost Town',
    Pets: 'Pets',
    PetSlot0: 'Pet Slot 1',
    Dungeon_Pet: 'Pet Dungeon',
    Chat: 'Chat',
    Arena: 'Arena',
    SkillSlot1: 'Skill Slot 2',
    TechTree: 'Tech Tree',
    Dungeon_Potion: 'Invasion',
    PetSlot1: 'Pet Slot 2',
    Guilds: 'Guilds',
    SkillSlot2: 'Skill Slot 3',
    Hammer_1: 'Extra Hammer 1',
    PetSlot2: 'Pet Slot 3',
    Hammer_2: 'Extra Hammer 2',
    RateUs_2: 'Rate Us (Phase 2)',
    Missions: 'Missions',
    SwitchWorlds: 'Switch Worlds',
    PrivacySettings: 'Privacy Settings',
    GuildAnnouncement: 'Guild Announcement',
    // Segments the game added when it retired UnlockConditions.
    GuildMissions: 'Guild Missions',
    AndroidNativeRateUs: 'Android Rate Us Popup',
    DiscordLink: 'Discord Link',
    ForgeAscension: 'Forge Ascension',
    MountsAscension: 'Mount Ascension',
    SkillsAscension: 'Skill Ascension',
    PetsAscension: 'Pet Ascension',
    AscensionStarsBonus: 'Ascension Bonuses',
    ClanTechTree: 'Clan Tech Tree',
    AutoForgeStack: 'Auto Forge Stack',
    EggStarterOffer: 'Egg Starter Offer',
};

/* ------------------------------------------------------------------------------------------ *
 * The two config shapes, read and never written
 * ------------------------------------------------------------------------------------------ */

interface LegacyUnlock {
    AgeIdx?: number;
    BattleIdx?: number;
    /** Older extractions write these as 0/1 rather than as booleans, so read them through Boolean(). */
    RequireCompliance?: boolean | number;
    FeatureToggle?: boolean | number;
}

interface Requirement {
    Id?: { $type?: string };
    Min?: { _value?: any } | null;
    Max?: { _value?: any } | null;
}

interface Segment {
    DisplayName?: string;
    Description?: string;
    PlayerCondition?: {
        PropertyRequirements?: Requirement[];
        RequireAnySegment?: string[] | null;
        RequireAllSegments?: string[] | null;
    };
}

/** One feature, normalised across both config generations. */
export interface FeatureUnlock {
    id: string;
    name: string;
    description?: string;
    /** null when the feature is not gated on story progress, so it has no place on a stage timeline. */
    ageIdx: number | null;
    battleIdx: number | null;
    /** The game is deliberately withholding this feature. */
    forceLocked: boolean;
    /** Legacy config only: the newer segments have no equivalent field. */
    requiresCompliance: boolean;
    /** Everything gating the feature other than the stage it opens at, in words. */
    extraRequirements: string[];
}

/* ------------------------------------------------------------------------------------------ *
 * Reading one requirement
 * ------------------------------------------------------------------------------------------ */

function stageLabel(value: any): string {
    return `Stage ${(value?.AgeIdx ?? 0) + 1}-${(value?.BattleIdx ?? 0) + 1}`;
}

function plural(count: number, unit: string): string {
    return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function durationLabel(ms: number): string {
    const hours = ms / 3600000;
    if (hours >= 48) return plural(Math.round(hours / 24), 'day');
    if (hours >= 1) return plural(Math.round(hours), 'hour');
    return plural(Math.round(ms / 60000), 'minute');
}

/** One property requirement as a line a player can act on, or null when it says nothing useful. */
function describeRequirement(req: Requirement): string | null {
    const type = (req.Id?.$type || '').replace('PlayerPropertyId', '').replace('PlayerProperty', '');
    const min = req.Min?._value;
    const max = req.Max?._value;

    switch (type) {
        case 'MainBattleProgress':
            if (min) return `From ${stageLabel(min)}`;
            if (max) return `Before ${stageLabel(max)}`;
            return null;
        case 'AccountAge':
            if (typeof max === 'number') return `Account younger than ${durationLabel(max)}`;
            if (typeof min === 'number') return `Account older than ${durationLabel(min)}`;
            return null;
        case 'SwitchedWorldCount':
            if (max === 0) return 'Never switched world';
            return typeof max === 'number' ? `At most ${max} world switches` : null;
        case 'HasGuild':
            if (typeof min !== 'boolean') return null;
            return min ? 'In a guild' : 'Not in a guild';
        case 'ForgeLevel':
            return typeof min === 'number' ? `Forge level ${min}` : null;
        case 'ForgeLevelMaxed': return 'Forge level maxed';
        case 'MountsSummonLevelMaxed': return 'Mount summon level maxed';
        case 'SkillsSummonLevelMaxed': return 'Skill summon level maxed';
        case 'EggsSummonLevelMaxed': return 'Egg summon level maxed';
        // Reported through forceLocked rather than as a requirement line.
        case 'FeatureForceLock': return null;
        default: return null;
    }
}

function featureName(id: string, segment?: Segment): string {
    return FEATURE_NAMES[id] || segment?.DisplayName || id;
}

/* ------------------------------------------------------------------------------------------ *
 * The two adapters
 * ------------------------------------------------------------------------------------------ */

function fromSegments(raw: Record<string, Segment>): FeatureUnlock[] {
    return Object.entries(raw).map(([id, segment]) => {
        const condition = segment?.PlayerCondition || {};
        const requirements = condition.PropertyRequirements || [];

        // Only a requirement with a Min puts the feature on a timeline. SwitchWorlds carries a Max
        // instead, meaning it is withdrawn after that stage rather than granted at it.
        const start = requirements.find(
            r => (r.Id?.$type || '').endsWith('MainBattleProgress') && r.Min?._value,
        );
        const forceLock = requirements.find(r => (r.Id?.$type || '').endsWith('FeatureForceLock'));

        const extraRequirements = requirements
            .filter(r => r !== start)
            .map(describeRequirement)
            .filter((line): line is string => Boolean(line));

        for (const gate of [...(condition.RequireAllSegments || []), ...(condition.RequireAnySegment || [])]) {
            extraRequirements.push(`After ${featureName(gate, raw[gate])}`);
        }

        return {
            id,
            name: featureName(id, segment),
            description: segment?.Description,
            ageIdx: start ? start.Min?._value?.AgeIdx ?? null : null,
            battleIdx: start ? start.Min?._value?.BattleIdx ?? null : null,
            // Min true means the gate only opens while the flag is set, which is how the game
            // withholds a feature. Min false is satisfied by anything and is no gate at all.
            forceLocked: forceLock?.Min?._value === true,
            requiresCompliance: false,
            extraRequirements,
        };
    });
}

function fromLegacy(raw: Record<string, LegacyUnlock>): FeatureUnlock[] {
    return Object.entries(raw).map(([id, data]) => ({
        id,
        name: featureName(id),
        ageIdx: typeof data?.AgeIdx === 'number' ? data.AgeIdx : null,
        battleIdx: typeof data?.BattleIdx === 'number' ? data.BattleIdx : null,
        forceLocked: Boolean(data?.FeatureToggle),
        requiresCompliance: Boolean(data?.RequireCompliance),
        extraRequirements: [],
    }));
}

/* ------------------------------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------------------------------ */

export interface FeatureUnlocksState {
    /** Every feature the selected version defines, in config order. */
    features: FeatureUnlock[];
    /** The same features by their config id, for a caller that knows which one it wants. */
    byId: Record<string, FeatureUnlock>;
    /** Still fetching. Not the same as "this version defines no features". */
    loading: boolean;
    /** The config could not be read at all. */
    failed: boolean;
    /** True when the numbers came from PlayerSegments rather than from the retired flat file. */
    usesSegments: boolean;
    /** The config version these came from, for a screen that wants to name it. */
    version: string;
}

export function useFeatureUnlocks(): FeatureUnlocksState {
    const { selectedVersion } = useGameDataContext();
    const usesSegments = selectedVersion >= SEGMENTS_FROM_VERSION;
    const { data, loading, error } = useGameData<Record<string, any>>(
        usesSegments ? 'PlayerSegments.json' : 'UnlockConditions.json',
    );

    return useMemo(() => {
        const features = !data ? [] : usesSegments ? fromSegments(data) : fromLegacy(data);
        const byId: Record<string, FeatureUnlock> = {};
        for (const feature of features) byId[feature.id] = feature;
        return {
            features,
            byId,
            loading: loading && features.length === 0,
            failed: !!error || (!loading && features.length === 0),
            usesSegments,
            version: selectedVersion,
        };
    }, [data, loading, error, usesSegments, selectedVersion]);
}
