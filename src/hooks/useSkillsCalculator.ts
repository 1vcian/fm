import { useState, useMemo, useEffect } from 'react';
import { useGameData } from './useGameData';
import { useProfile } from '../context/ProfileContext';
import { useTreeModifiers } from './useCalculatedStats';
import { useTreeLimits } from './useTreeLimits';
import { getWarPointsForTask, isWarPointDay, getDayBoostNodeType } from '../utils/guildWarUtils';
import { simulateSummons, summonCost, affordableSummons, currencyToReach, summonRowAt, maxAscensionFrom, baseSummonCount, SUMMON_RARITIES } from '../utils/summonEngine';

/** Skill summon simulation plus war points, shaped for the Summons calculator's Skills tab. */
export function buildSkillSummonResults(p: {
    levels: any[];
    level: number;
    progress: number;
    currency: number;
    costPerSummon: number;
    unitsPerSummon: number;
    startAscension: number;
    simulateAscension: boolean;
    maxAscension: number;
    pointsPerSkill: Record<string, number>;
}) {
    const numSummons = affordableSummons(p.currency, p.costPerSummon);
    const sim = simulateSummons({
        levels: p.levels,
        startLevel: p.level,
        startProgress: p.progress,
        startAscension: p.startAscension,
        simulateAscension: p.simulateAscension,
        maxAscension: p.maxAscension,
        summons: numSummons,
        unitsPerSummon: p.unitsPerSummon,
    });

    const pointsOf = (counts: Record<string, number>) => {
        let points = 0;
        for (const rarity of SUMMON_RARITIES) points += (counts[rarity] || 0) * (p.pointsPerSkill[rarity] || 0);
        return points;
    };
    const phases = sim.phases.map(ph => ({ ...ph, points: pointsOf(ph.counts) }));
    const endProbs = summonRowAt(p.levels, sim.endLevel);

    // No summon made: no rows, as before (the rarity rows only list what the pile produced).
    const breakdown = numSummons <= 0 ? [] : Object.entries(sim.byRarity).map(([rarity, count]) => {
        const unitPoints = p.pointsPerSkill[rarity] || 0;
        return {
            rarity,
            count,
            percentage: ((endProbs[rarity] || 0) * 100),
            pointsPerUnit: unitPoints,
            totalPoints: count * unitPoints
        };
    });

    return {
        breakdown: breakdown.filter(b => b.count > 0 || b.percentage > 0),
        totalSkills: numSummons <= 0 ? 0 : sim.units,
        totalPoints: pointsOf(sim.byRarity),
        normalPoints: phases.filter(ph => ph.startAscension === 0).reduce((sum, ph) => sum + ph.points, 0),
        ascensionPoints: phases.filter(ph => ph.startAscension > 0).reduce((sum, ph) => sum + ph.points, 0),
        phases,
        numSummons,
        endLevel: sim.endLevel,
        endProgress: Math.round(sim.endProgress),
        endAscensionLevel: sim.endAscension,
        summonsToMax: sim.summonsToMax,
        simulateAscension: p.simulateAscension
    };
}

export interface ProbabilityResult {
    rarity: string;
    count: number;
    percentage: number;
}

export function useSkillsCalculator() {
    // 1. Contexts
    const { profile, updateNestedProfile } = useProfile();

    // 2. Game Data — use unified SkillSummonConfig.json (has Levels with SummonsRequired + probabilities)
    const { data: skillSummonConfig } = useGameData<any>('SkillSummonConfig.json');
    const { data: ascensionConfigs } = useGameData<any>('AscensionConfigsLibrary.json');
    const maxAscension = maxAscensionFrom(ascensionConfigs, 'Skills');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');

    // 3. State
    const [level, _setLevel] = useState<number>(1);
    const [progress, _setProgress] = useState<number>(0);
    const [ticketCount, _setTicketCount] = useState<number>(0);

    // 4. Persistence Load
    useEffect(() => {
        if (profile?.misc) {
            if (profile.misc.skillCalculatorLevel) {
                _setLevel(profile.misc.skillCalculatorLevel);
            }
            if (profile.misc.skillCalculatorTickets) {
                _setTicketCount(profile.misc.skillCalculatorTickets);
            }
        }
    }, [profile]);

    // 5. Setters (Persistence)
    const setLevel = (val: number) => {
        const safeVal = Math.min(Math.max(1, val), maxPossibleLevel);
        _setLevel(safeVal);
        updateNestedProfile('misc', { skillCalculatorLevel: safeVal });
    };

    const setProgress = (val: number) => {
        _setProgress(Math.max(0, val));
    };

    const setTicketCount = (val: number) => {
        const safeVal = Math.max(0, val);
        _setTicketCount(safeVal);
        updateNestedProfile('misc', { skillCalculatorTickets: safeVal });
    };

    const treeModifiers = useTreeModifiers();
    // Personal + clan tree sums from useTreeModifiers (tree mode aware, unlock requirements checked).
    // Cost is a OneMinusMultiplier node and the extra chance a FreebieChance roll (TechNodesLibrary).
    const techBonuses = useMemo(() => ({
        costReduction: treeModifiers['SkillSummonCost'] || 0,
        extraChance: 0, // no tech node grants a FreebieChance on ActiveSkill
    }), [treeModifiers]);

    // Clan tech tree boost to war points earned from summoning skills.
    const treeLimits = useTreeLimits();
    const profileSkillSummonWarBonus = treeModifiers['WarPointsFromSkillSummon'] || 0;

    // Sandbox: local overrides of the result-altering tree bonuses (see SandboxPanel).
    const [sandbox, setSandbox] = useState<Record<string, number>>({});
    const costReduction = sandbox.costReduction ?? techBonuses.costReduction;
    const extraChance = sandbox.extraChance ?? techBonuses.extraChance;
    const skillSummonWarBonus = sandbox.warSummon ?? profileSkillSummonWarBonus;
    // Day boost: WarPointsOnDayN multiplier, only when skills are active today.
    const dayActive = isWarPointDay(new Date(), 'skills', guildWarConfig);
    const profileDayBoost = dayActive ? (treeModifiers[getDayBoostNodeType()] || 0) : 0;
    const dayBoost = sandbox.dayBoost ?? profileDayBoost;
    const sandboxControls = {
        reset: () => setSandbox({}),
        fields: [
            { key: 'costReduction', label: 'Summon cost reduction', value: costReduction, profileValue: techBonuses.costReduction, min: 0, ...treeLimits.personal('SkillSummonCost'), onChange: (v: number) => setSandbox(p => ({ ...p, costReduction: v })) },
            { key: 'warSummon', label: 'War points: skill summon', value: skillSummonWarBonus, profileValue: profileSkillSummonWarBonus, min: 0, ...treeLimits.clan('WarPointsFromSkillSummon'), onChange: (v: number) => setSandbox(p => ({ ...p, warSummon: v })) },
            { key: 'dayBoost', label: 'Day war-points boost (today)', value: dayBoost, profileValue: profileDayBoost, min: 0, ...treeLimits.clan('WarPointsOnDay1'), onChange: (v: number) => setSandbox(p => ({ ...p, dayBoost: v })) },
        ],
    };

    // 7. Constants from unified config
    const unitCost = skillSummonConfig?.SingleSummonCost?.Amount || 40;
    // SummonConfig.BaseSummonCount (RVA 0x7865E88) = PossibleSummonCount[0]; SkillBaseConfig has no SummonCount.
    const SKILLS_PER_SUMMON = baseSummonCount(skillSummonConfig, 5);
    const BASE_SUMMON_COST = unitCost * SKILLS_PER_SUMMON;
    const levels: any[] = skillSummonConfig?.Levels || [];
    const currency = skillSummonConfig?.SingleSummonCost?.Currency || 'SkillSummonTickets';
    // SummonConfig.CanAffordSummon (RVA 0x7865EDC): RoundToInt(CalculateValue(Cost, Amount * count)),
    // so the reduction applies to the whole batch and rounds to nearest, not up.
    const finalCostPerSummon = summonCost(unitCost, SKILLS_PER_SUMMON, costReduction);
    const maxPossibleLevel = levels.length || 100;

    // 8. War Points
    const warPointsPerSummonSkill = useMemo(() => {
        if (!guildWarConfig) return null;

        const points: Record<string, number> = {};
        const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Ultimate', 'Mythic'];

        // Read from whatever day holds the task (independent of day layout) + clan boost.
        rarities.forEach(rarity => {
            const base = getWarPointsForTask(guildWarConfig, `Summon${rarity}Skill`);
            points[rarity] = base * (1 + skillSummonWarBonus + dayBoost);
        });

        return points;
    }, [guildWarConfig, skillSummonWarBonus, dayBoost]);

    // 9. Simulation Results (with level progression like mount/egg calculators)
    const results = useMemo(() => {
        if (!levels.length || !warPointsPerSummonSkill) return null;
        return {
            ...buildSkillSummonResults({
                levels,
                level,
                progress,
                currency: ticketCount,
                costPerSummon: finalCostPerSummon,
                unitsPerSummon: SKILLS_PER_SUMMON * (1 + extraChance),
                startAscension: profile?.misc?.skillAscensionLevel || 0,
                simulateAscension: profile?.misc?.simulateAscensionInCalculators ?? true,
                maxAscension,
                pointsPerSkill: warPointsPerSummonSkill,
            }),
            finalCost: finalCostPerSummon,
            baseCost: BASE_SUMMON_COST,
            costReduction: techBonuses.costReduction,
        };
    }, [ticketCount, level, progress, levels, warPointsPerSummonSkill, SKILLS_PER_SUMMON, techBonuses, extraChance, costReduction, finalCostPerSummon, BASE_SUMMON_COST, profile?.misc?.simulateAscensionInCalculators, maxAscension, profile?.misc?.skillAscensionLevel]);

    // Apply results
    const applyResultsToProfile = () => {
        if (!results) return;
        setLevel(results.endLevel);
        _setProgress(results.endProgress);
    };

    // Target Calculation
    const calculateNeededCurrency = (targetLevel: number, targetAscension: number) => currencyToReach({
        levels,
        level,
        progress,
        ascension: profile?.misc?.skillAscensionLevel || 0,
        targetLevel,
        targetAscension,
        unitsPerSummon: SKILLS_PER_SUMMON * (1 + extraChance),
        costPerSummon: finalCostPerSummon,
        maxAscension,
    });

    return {
        level, setLevel,
        progress, setProgress,
        ticketCount, setTicketCount,
        results,
        techBonuses,
        maxPossibleLevel,
        levels,
        applyResultsToProfile,
        calculateNeededCurrency,
        maxAscension,
        currency,
        baseCost: BASE_SUMMON_COST,
        finalCostPerSummon,
        skillsPerSummon: SKILLS_PER_SUMMON,
        warPointBonuses: { summon: skillSummonWarBonus },
        sandbox: sandboxControls
    };
}
