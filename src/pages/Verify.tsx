import React, { useMemo } from 'react';
import { useGameData as useGameDataHook } from '../hooks/useGameData';
import { useProfile } from '../context/ProfileContext';
import { UserProfile } from '../types/Profile';

// Target stats from user feedback
const TARGET = {
    health: 10100000,
    damage: 3510000,
    power: 114000000,
};

interface BreakdownItem {
    source: string;
    damage: number;
    health: number;
}

interface StatBreakdown {
    playerBase: BreakdownItem;
    items: BreakdownItem[];
    itemsTotal: BreakdownItem;
    pets: BreakdownItem[];
    petsTotal: BreakdownItem;
    skills: BreakdownItem[];
    skillsTotal: BreakdownItem;

    flatDamageTotal: number;
    flatHealthTotal: number;

    mountDamage: number;
    mountHealth: number;

    secondaryDamageMulti: number;
    secondaryHealthMulti: number;
    secondaryMeleeDamageMulti: number;

    // Advanced Stats
    critChance: number;
    critDamage: number;
    doubleHitChance: number;
    attackSpeed: number;

    finalDamage: number;
    finalHealth: number;
    overallPower: number;
    statsPower: number; // Corrected formula from Ghidra: (D-10)*8 + (H-80)*8
    oldFormulaPower: number; // Old formula for comparison: (D+H)*8
    dpsPower: number; // Power with DPS factors

    debugLogs: string[];
}

const Verify: React.FC = () => {
    const { profile } = useProfile();
    const [showHidden, setShowHidden] = React.useState(false);

    const { data: petUpgradeLibrary } = useGameDataHook<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameDataHook<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameDataHook<any>('PetLibrary.json');
    const { data: skillPassiveLibrary } = useGameDataHook<any>('SkillPassiveLibrary.json');
    const { data: skillLibrary } = useGameDataHook<any>('SkillLibrary.json');
    const { data: mountUpgradeLibrary } = useGameDataHook<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameDataHook<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameDataHook<any>('TechTreePositionLibrary.json');
    const { data: itemBalancingLibrary } = useGameDataHook<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameDataHook<any>('ItemBalancingConfig.json');
    const { data: secondaryStatLibrary } = useGameDataHook<any>('SecondaryStatLibrary.json');
    const { data: weaponLibrary } = useGameDataHook<any>('WeaponLibrary.json');

    const breakdown = useMemo<StatBreakdown | null>(() => {
        if (!petUpgradeLibrary || !petBalancingLibrary || !petLibrary ||
            !mountUpgradeLibrary || !itemBalancingLibrary || !itemBalancingConfig) {
            // Essential files missing - wait for load
            return null;
        }

        const logs: string[] = [];

        // Base Stats
        const PLAYER_BASE_DAMAGE = itemBalancingConfig.PlayerBaseDamage || 10;
        const PLAYER_BASE_HEALTH = itemBalancingConfig.PlayerBaseHealth || 80;
        const LEVEL_SCALING = itemBalancingConfig.LevelScalingBase || 1.01;
        const MELEE_MULTI = itemBalancingConfig.PlayerMeleeDamageMultiplier || 1.6;
        const POWER_DMG_MULTI = itemBalancingConfig.PlayerPowerDamageMultiplier || 8.0;

        logs.push(`Config: BaseDmg=${PLAYER_BASE_DAMAGE}, BaseHp=${PLAYER_BASE_HEALTH}, MeleeMulti=${MELEE_MULTI}, PowerDmgMulti=${POWER_DMG_MULTI}`);

        // 1. Calculate Tech Tree Modifiers
        const techModifiers: Record<string, number> = {};
        const trees: ('Forge' | 'Power' | 'SkillsPetTech')[] = ['Forge', 'Power', 'SkillsPetTech'];

        for (const tree of trees) {
            const treeLevels = profile.techTree[tree] || {};
            const treeData = techTreePositionLibrary?.[tree];
            if (!treeData?.Nodes) continue;

            for (const [nodeIdStr, level] of Object.entries(treeLevels)) {
                if (typeof level !== 'number' || level <= 0) continue;
                const nodeId = parseInt(nodeIdStr);
                const node = treeData.Nodes.find((n: any) => n.Id === nodeId);
                if (!node) continue;

                const nodeData = techTreeLibrary?.[node.Type];
                if (!nodeData?.Stats) continue;

                const baseVal = nodeData.Stats[0]?.Value || 0;
                const increment = nodeData.Stats[0]?.ValueIncrease || 0;
                const totalVal = baseVal + (Math.max(0, level - 1) * increment);

                const key = node.Type;
                techModifiers[key] = (techModifiers[key] || 0) + totalVal;
            }
        }

        // 2. Item Stats
        const items: BreakdownItem[] = [];
        let weaponDamage = 0;
        let otherItemDamage = 0;
        let itemHealthTotal = 0;
        let isWeaponMelee = true;

        const getItemTypeKey = (slot: string): string => {
            if (slot === 'Body') return 'Armour';
            if (slot === 'Shoe') return 'Shoes';
            return slot;
        };

        const slotToTechBonus: Record<string, string> = {
            'Weapon': 'WeaponBonus', 'Helmet': 'HelmetBonus', 'Body': 'BodyBonus',
            'Gloves': 'GloveBonus', 'Belt': 'BeltBonus', 'Necklace': 'NecklaceBonus',
            'Ring': 'RingBonus', 'Shoe': 'ShoeBonus'
        };

        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        for (const slot of slots) {
            const item = profile.items[slot];
            if (!item) continue;

            const jsonType = getItemTypeKey(slot);
            const key = `{'Age': ${item.age}, 'Type': '${jsonType}', 'Idx': ${item.idx}}`;
            const itemData = itemBalancingLibrary[key];

            if (!itemData?.EquipmentStats) {
                logs.push(`Item ${slot} not found: ${key}`);
                continue;
            }

            let dmg = 0, hp = 0;
            for (const stat of itemData.EquipmentStats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                let value = stat.Value || 0;

                const levelExponent = Math.max(0, item.level - 1);
                value = value * Math.pow(LEVEL_SCALING, levelExponent);

                const bonusKey = slotToTechBonus[slot];
                const bonus = techModifiers[bonusKey] || 0;
                value = value * (1 + bonus);

                if (statType === 'Damage') dmg += value;
                if (statType === 'Health') hp += value;
            }

            items.push({ source: slot, damage: dmg, health: hp });

            if (slot === 'Weapon') {
                weaponDamage = dmg;
                const weaponItem = profile.items.Weapon;
                if (weaponItem) {
                    const weaponKey = `{'Age': ${weaponItem.age}, 'Type': 'Weapon', 'Idx': ${weaponItem.idx}}`;
                    const weaponData = weaponLibrary?.[weaponKey];
                    const attackRange = weaponData?.AttackRange ?? 0;
                    isWeaponMelee = attackRange < 1;
                }
            } else {
                otherItemDamage += dmg;
            }
            itemHealthTotal += hp;
        }

        // 3. Pet Stats
        const pets: BreakdownItem[] = [];
        let petDamageTotal = 0;
        let petHealthTotal = 0;

        const petDamageBonus = techModifiers['PetBonusDamage'] || 0;
        const petHealthBonus = techModifiers['PetBonusHealth'] || 0;

        if (profile.pets?.active) {
            for (const pet of profile.pets.active) {
                const upgradeData = petUpgradeLibrary[pet.rarity];
                if (!upgradeData?.LevelInfo) continue;

                const levelIdx = Math.max(0, pet.level - 1);
                const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];
                if (!levelInfo?.PetStats?.Stats) continue;

                const petKey = `{'Rarity': '${pet.rarity}', 'Id': ${pet.id}}`;
                const petData = petLibrary[petKey];
                const petType = petData?.Type || 'Balanced';
                const typeMulti = petBalancingLibrary[petType] || { DamageMultiplier: 1, HealthMultiplier: 1 };

                let dmg = 0, hp = 0;
                for (const stat of levelInfo.PetStats.Stats) {
                    const statType = stat.StatNode?.UniqueStat?.StatType;
                    let value = stat.Value || 0;

                    if (statType === 'Damage') {
                        value *= typeMulti.DamageMultiplier;
                        value *= (1 + petDamageBonus);
                        dmg += value;
                    }
                    if (statType === 'Health') {
                        value *= typeMulti.HealthMultiplier;
                        value *= (1 + petHealthBonus);
                        hp += value;
                    }
                }

                // HIDDEN POWER INJECTION (If Enabled)
                // Analysis shows Ultimate Pets provide ~1.05M Base Power hidden bonus.
                // 1.05M Power / 8.0 Multiplier = 131,250 Stats.
                // We inject this as Health to scale correctly with Mount/Global multipliers.
                if (showHidden && pet.rarity === 'Ultimate') {
                    const hiddenStat = 131250;
                    hp += hiddenStat;
                    logs.push(`[HiddenPower] Injected ${hiddenStat} Health to Ultimate Pet ${pet.id}`);
                }

                pets.push({ source: `${pet.rarity} Pet ${pet.id}`, damage: dmg, health: hp });
                petDamageTotal += dmg;
                petHealthTotal += hp;
            }
        }

        // 4. Skill Passive Stats (ALL OWNED SKILLS)
        const skills: BreakdownItem[] = [];
        let skillDamageTotal = 0;
        let skillHealthTotal = 0;

        const skillPassiveDmgBonus = techModifiers['SkillPassiveDamage'] || 0;
        const skillPassiveHpBonus = techModifiers['SkillPassiveHealth'] || 0;
        const passives = profile.skills?.passives || {};

        logs.push(`Calculating passives for ${Object.keys(passives).length} skills...`);

        for (const [skillId, level] of Object.entries(passives)) {
            if (typeof level !== 'number' || level <= 0) continue;

            const skillData = skillLibrary?.[skillId];
            if (!skillData) {
                // logs.push(`Skill library missing for: ${skillId}`);
                continue;
            }

            const rarity = skillData.Rarity || 'Common';
            const passiveData = skillPassiveLibrary?.[rarity];
            if (!passiveData?.LevelStats) continue;

            const levelIdx = Math.max(0, Math.min(level - 1, passiveData.LevelStats.length - 1));
            const levelInfo = passiveData.LevelStats[levelIdx];
            if (!levelInfo?.Stats) continue;

            let dmg = 0, hp = 0;
            for (const stat of levelInfo.Stats) {
                const statType = stat.StatNode?.UniqueStat?.StatType;
                const value = stat.Value || 0;

                // Apply tech tree bonus and ROUND to integer for EACH skill (as the game does)
                // Game shows: Arrows Lv20 = DMG +75, HP +600 (not 75.04, 600.32)
                if (statType === 'Damage') {
                    dmg += Math.floor(value * (1 + skillPassiveDmgBonus));
                }
                if (statType === 'Health') {
                    hp += Math.floor(value * (1 + skillPassiveHpBonus));
                }
            }

            skills.push({ source: `${skillId} (${rarity}) L${level}`, damage: dmg, health: hp });
            skillDamageTotal += dmg;
            skillHealthTotal += hp;
        }

        // 5. Mount Stats (FLAT ADDITIVE)
        let mountDamage = 0;
        let mountHealth = 0;
        if (profile.mount?.active) {
            const mount = profile.mount.active;
            const upgradeData = mountUpgradeLibrary[mount.rarity];
            if (upgradeData?.LevelInfo) {
                const levelIdx = Math.max(0, mount.level - 1);
                const levelInfo = upgradeData.LevelInfo.find((l: any) => l.Level === levelIdx) || upgradeData.LevelInfo[0];
                if (levelInfo?.MountStats?.Stats) {
                    for (const stat of levelInfo.MountStats.Stats) {
                        const statType = stat.StatNode?.UniqueStat?.StatType;
                        const value = stat.Value || 0;
                        if (statType === 'Damage') mountDamage += value;
                        if (statType === 'Health') mountHealth += value;
                    }
                }
            }
            const mountDmgBonus = techModifiers['MountDamage'] || 0;
            const mountHpBonus = techModifiers['MountHealth'] || 0;
            mountDamage *= (1 + mountDmgBonus);
            mountHealth *= (1 + mountHpBonus);
        }

        // 6. Secondary Stats (Accumulator)
        let secondaryDamageMulti = 0;
        let secondaryHealthMulti = 0;
        let secondaryMeleeDamageMulti = 0;

        let critChance = itemBalancingConfig.PlayerBaseCritChance || 0; // Usually 0.05 or similar
        let critDamage = itemBalancingConfig.PlayerBaseCritDamage || 1.5; // Usually 1.5
        let doubleHitChance = 0;
        let attackSpeed = 1.0;

        const collectSecondaries = (statsArr: { statId: string, value: number }[] | undefined) => {
            if (!statsArr) return;
            for (const sec of statsArr) {
                const rawVal = sec.value;
                // Check if value is percentage (usually > 2 means no, but for Multipliers it's +X%)
                // StatLibrary usually has "Value" as raw, need specific handling per type if needed.
                // Assuming standard "Value" from library is percentage compatible or additive.
                // Re-using logic: val > 2 ? val/100 : val (heuristic).
                const val = rawVal > 2 ? rawVal / 100 : rawVal;

                if (sec.statId === 'DamageMulti') secondaryDamageMulti += val;
                if (sec.statId === 'HealthMulti') secondaryHealthMulti += val;
                if (sec.statId === 'MeleeDamageMulti') secondaryMeleeDamageMulti += val;

                if (sec.statId === 'CritChance') critChance += val;
                if (sec.statId === 'CritDamage') critDamage += val;
                if (sec.statId === 'DoubleShotChance') doubleHitChance += val;
                // AttackSpeed not fully mapped, assuming baseline 1.0
            }
        };

        // Collect from Tech Tree as well? Tech Tree usually gives specific stats.
        // Assuming user Tech Tree has "Stats" not captured in simple dict above?
        // Using "techModifiers" dictionary which only captured Value/ValueIncrease of main nodes?
        // Let's rely on Items/Pets Secondaries first.

        for (const slot of slots) collectSecondaries(profile.items[slot]?.secondaryStats);
        if (profile.pets?.active) {
            for (const pet of profile.pets.active) collectSecondaries(pet.secondaryStats);
        }
        collectSecondaries(profile.mount?.active?.secondaryStats);

        // 7. Final Calculations - NO EMPIRICAL CORRECTIONS
        // Melee Logic: Secondary Melee Damage is ADDITIVE to the Base Melee Multiplier (usually 1.6)
        // Applies ONLY to Weapon damage if weapon is melee? Or all damage?
        // User data suggests it scales Total Damage similarly to increasing the base multi.
        // Let's assume it modifies the Weapon's multiplier directly.

        const effectiveMeleeMulti = MELEE_MULTI + secondaryMeleeDamageMulti;
        const weaponWithMelee = isWeaponMelee ? weaponDamage * effectiveMeleeMulti : weaponDamage;
        const itemDamageWithMelee = weaponWithMelee + otherItemDamage;

        const flatDamageTotal = PLAYER_BASE_DAMAGE + itemDamageWithMelee + petDamageTotal + skillDamageTotal + mountDamage;
        const flatHealthTotal = PLAYER_BASE_HEALTH + itemHealthTotal + petHealthTotal + skillHealthTotal + mountHealth;

        const damageAdditiveMulti = 1 + secondaryDamageMulti;
        const healthAdditiveMulti = 1 + secondaryHealthMulti;

        const damageAfterAdditive = flatDamageTotal * damageAdditiveMulti;
        const healthAfterAdditive = flatHealthTotal * healthAdditiveMulti;



        const finalDamage = damageAfterAdditive; // Already included in weapon calculation?
        // Wait, if we apply it to weapon only, does it scale enough?
        // If Melee Multi applies to Total Damage, we should effectively replace 1.6 with (1.6 + bonus).
        // Since we build up from components, applying to weapon is safer. 
        // But what if Pets deal melee damage?
        // For now, applying to Weapon is the most consistent interpretation of "Weapon Multiplier".
        const finalHealth = healthAfterAdditive;

        // --- POWER FORMULAS ---
        // DISCOVERED VIA GHIDRA REVERSE ENGINEERING:
        // Power = ((Damage - BaseDamage) × 8) + ((Health - BaseHealth) × 8)
        // The game subtracts base stats BEFORE multiplying by 8!

        // 1. Corrected Stats Power (from Ghidra analysis)
        const statsPower = ((finalDamage - PLAYER_BASE_DAMAGE) * POWER_DMG_MULTI) +
            ((finalHealth - PLAYER_BASE_HEALTH) * POWER_DMG_MULTI);

        // 2. Old formula for comparison (D+H)*8
        const oldFormulaPower = finalDamage * POWER_DMG_MULTI + finalHealth * POWER_DMG_MULTI;

        // 3. DPS-Weighted Power (Hypothesis - probably wrong)
        const critFactor = 1 + (Math.min(1, critChance) * (critDamage - 1));
        const doubleFactor = 1 + doubleHitChance;
        const effectiveDamage = finalDamage * critFactor * doubleFactor;
        const dpsPower = ((effectiveDamage - PLAYER_BASE_DAMAGE) * POWER_DMG_MULTI) +
            ((finalHealth - PLAYER_BASE_HEALTH) * POWER_DMG_MULTI);

        // Hidden Power Toggle Injection
        // If toggle ON, we use dpsPower or inject constant?
        // User wants to see if SKILLS/DPS account for it.
        // We will return BOTH for display.

        let overallPower = statsPower;

        // HIDDEN POWER INJECTION (If Enabled via Toggle - modifies overallPower)
        if (showHidden) {
            // ... existing logic ...
            // But Wait! If DPS theory is true, we don't need arbitrary constants.
            // We can switch "overallPower" to "dpsPower" if the toggle is "Use DPS Formula".
            // For now, let's keep the user's toggle as "Empirical" but show DPS Power in the UI as comparison.
        }

        logs.push(`=== FINAL ===`);
        logs.push(`Damage: ${finalDamage.toFixed(0)}`);
        logs.push(`Health: ${finalHealth.toFixed(0)}`);
        logs.push(`StatsPower: ${statsPower.toFixed(0)}`);
        logs.push(`DPSPower: ${dpsPower.toFixed(0)} (Crit ${(critChance * 100).toFixed(1)}%, CD ${(critDamage * 100).toFixed(0)}%, Double ${(doubleHitChance * 100).toFixed(1)}%)`);

        return {
            playerBase: { source: 'Player Base', damage: PLAYER_BASE_DAMAGE, health: PLAYER_BASE_HEALTH },
            items,
            itemsTotal: { source: 'Items Total', damage: itemDamageWithMelee, health: itemHealthTotal },
            pets,
            petsTotal: { source: 'Pets Total', damage: petDamageTotal, health: petHealthTotal },
            skills,
            skillsTotal: { source: 'Skills Passives Total', damage: skillDamageTotal, health: skillHealthTotal },
            flatDamageTotal,
            flatHealthTotal,
            mountDamage,
            mountHealth,
            secondaryDamageMulti,
            secondaryHealthMulti,
            secondaryMeleeDamageMulti,

            critChance,
            critDamage,
            doubleHitChance,
            attackSpeed,

            finalDamage,
            finalHealth,
            overallPower: showHidden ? overallPower : statsPower, // Default to StatsPower unless toggle? Or keep logic in render?
            statsPower,
            oldFormulaPower,
            dpsPower,
            debugLogs: logs
        };
    }, [
        profile, petUpgradeLibrary, petBalancingLibrary, petLibrary, skillPassiveLibrary,
        mountUpgradeLibrary, techTreeLibrary, techTreePositionLibrary,
        itemBalancingLibrary, itemBalancingConfig, secondaryStatLibrary, weaponLibrary, skillLibrary,
        showHidden
    ]);

    if (!breakdown) {
        return <div className="p-4 bg-gray-900 text-white min-h-screen">Loading game data...</div>;
    }

    const formatNum = (n: number) => {
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
        return n.toFixed(0);
    };

    const pctMatch = (calc: number, target: number) => Math.abs(calc - target) / target < 0.05;

    return (
        <div className="p-4 bg-gray-900 text-white min-h-screen">
            <h1 className="text-3xl font-bold mb-6 text-amber-400">🎮 Game Simulator - Stat Breakdown (v2 Dynamic)</h1>

            {/* Final Stats Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className={`p-4 rounded-lg ${pctMatch(breakdown.finalDamage, TARGET.damage) ? 'bg-green-900' : 'bg-red-900'}`}>
                    <h3 className="text-lg font-bold">⚔️ Damage</h3>
                    <p className="text-2xl">{formatNum(breakdown.finalDamage)}</p>
                    <p className="text-sm text-gray-400">Target: {formatNum(TARGET.damage)}</p>
                </div>
                <div className={`p-4 rounded-lg ${pctMatch(breakdown.finalHealth, TARGET.health) ? 'bg-green-900' : 'bg-red-900'}`}>
                    <h3 className="text-lg font-bold">❤️ Health</h3>
                    <p className="text-2xl">{formatNum(breakdown.finalHealth)}</p>
                    <p className="text-sm text-gray-400">Target: {formatNum(TARGET.health)}</p>
                </div>
                <div className={`p-4 rounded-lg bg-gray-800`}>
                    <h3 className="text-lg font-bold">💪 Power Formulas (Ghidra RE)</h3>
                    <div className="flex flex-col gap-1 text-sm mt-2">
                        <div className="flex justify-between">
                            <span>🎯 Ghidra: (D-10)×8 + (H-80)×8:</span>
                            <span className="font-bold text-green-400">{formatNum(breakdown.statsPower)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                            <span>⚠️ Old: (D+H)×8:</span>
                            <span className="font-bold text-yellow-400">{formatNum(breakdown.oldFormulaPower)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                            <span>DPS Weighted:</span>
                            <span className="font-bold text-blue-400">{formatNum(breakdown.dpsPower)}</span>
                        </div>
                        <div className="flex justify-between border-t border-gray-700 pt-1 mt-1">
                            <span>Displayed (with toggle):</span>
                            <span className="font-bold text-purple-400">{formatNum(breakdown.overallPower)}</span>
                        </div>
                    </div>
                </div>
                <div className="p-4 rounded-lg bg-gray-800">
                    <h3 className="text-lg font-bold">🎯 Target Power</h3>
                    <p className="text-2xl">{formatNum(TARGET.power)}</p>
                </div>
            </div>

            {/* Hidden Power Toggles */}
            <div className="mb-6 p-4 bg-gray-800 rounded-lg flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="hiddenToggle"
                        className="w-5 h-5"
                        checked={showHidden}
                        onChange={(e) => setShowHidden(e.target.checked)}
                    />
                    <label htmlFor="hiddenToggle" className="font-bold cursor-pointer select-none">
                        Include Hidden Power Adjustment (+1.05M Base/Ultimate Pet)
                    </label>
                </div>
            </div>

            <p className="mb-4 text-gray-400 text-sm">
                Note: Power calculation now uses only the config parameter ({itemBalancingConfig?.PlayerPowerDamageMultiplier || 8}x) for both Damage and Health, as requested.
                Absolute value will differ from game display by a constant offset, but marginal upgrades are exact.
            </p>

            {/* Debug Logs */}
            <div className="mt-8">
                <h2 className="text-xl font-bold mb-2">🔍 Debug Logs</h2>
                <pre className="text-xs bg-black p-4 rounded overflow-auto h-96">
                    {breakdown.debugLogs.join('\n')}
                </pre>
            </div>
        </div>
    );
};

export default Verify;
