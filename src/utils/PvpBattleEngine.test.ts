import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_PROFILE, type UserProfile } from '../types/Profile';
import type { AggregatedStats } from './statEngine';
import {
    PvpBattleEngine,
    aggregatedStatsToPvpStats,
    enemyConfigToPvpStats,
    profileToEnemyConfig,
    type PvpPlayerStats,
} from './PvpBattleEngine';

const pvpConfig = {
    PvpHpBaseMultiplier: 1,
    PvpHpPetMultiplier: 0.5,
    PvpHpSkillMultiplier: 0.25,
    PvpHpMountMultiplier: 2,
};

const playerStats = (cooldownReduction: number): PvpPlayerStats => ({
    hp: 100,
    damage: 10,
    attackSpeed: 1,
    critChance: 0,
    critMulti: 1.5,
    blockChance: 0,
    lifesteal: 0,
    doubleDamage: 0,
    healthRegen: 0,
    damageMulti: 0,
    healthMulti: 0,
    skillDamageMulti: 1,
    skillCooldownMulti: cooldownReduction,
    skills: [{
        id: 'TestSkill',
        cooldown: 10,
        duration: 0,
        hasDamage: true,
        hasHealth: false,
        damage: 10,
        count: 1,
        damageIsPerHit: false,
    }],
});

const enemyConfig = (hp: number, pets: any[] = []) => ({
    name: 'Enemy',
    weapon: null,
    skills: [],
    stats: { hp, damage: 10 },
    passiveStats: {},
    pets,
    mount: null,
});

test('builds missing pet health from PetUpgradeLibrary', () => {
    const pet = { rarity: 'Rare', id: 7, level: 1, evolution: 0 };
    const petUpgradeLibrary = {
        Rare: {
            LevelInfo: [{
                Level: 0,
                PetStats: {
                    Stats: [{
                        Value: 100,
                        StatNode: { UniqueStat: { StatType: 'Health' } },
                    }],
                },
            }],
        },
    };
    const petLibrary = {
        "{'Rarity': 'Rare', 'Id': 7}": { Type: 'Tank' },
    };
    const petBalancingLibrary = {
        Tank: { DamageMultiplier: 1, HealthMultiplier: 2 },
    };

    const stats = enemyConfigToPvpStats(
        enemyConfig(1200, [pet]),
        undefined,
        { ...pvpConfig, PvpHpSkillMultiplier: 0.5, PvpHpMountMultiplier: 2 },
        undefined,
        petUpgradeLibrary,
        petLibrary,
        petBalancingLibrary,
    );

    assert.equal(stats.hp, 1100);
});

test('applies cooldown reduction to both players with the regular battle floor', () => {
    const engine = new PvpBattleEngine(playerStats(0.25), playerStats(0.95));
    const snapshot = engine.getSnapshot();

    assert.equal(snapshot.player1Skills[0].cooldown, 7.5);
    assert.equal(snapshot.player2Skills[0].cooldown, 1);
});

test('weights already-scaled health buckets without reapplying ascension', () => {
    const stats = {
        basePlayerHealth: 100,
        itemHealth: 100,
        petHealth: 10,
        skillPassiveHealth: 20,
        mountHealth: 30,
        healthMultiplier: 2,
        equipHealthMultiplier: 3,
        skinHealthMulti: 0.25,
        setHealthMulti: 0.25,
        totalHealth: 1080,
        totalDamage: 10,
    } as AggregatedStats;

    const result = aggregatedStatsToPvpStats(stats, [], {}, undefined, undefined, pvpConfig);

    assert.equal(result.hp, 1110);
});

test('subtracts common-scaled system health when deriving enemy equipment health', () => {
    const config = {
        ...enemyConfig(1600, [{ rarity: 'Rare', id: 7, level: 1, evolution: 0, hp: 100 }]),
        skillPassiveHp: 100,
        mount: {
            rarity: 'Rare',
            id: 1,
            level: 1,
            evolution: 0,
            skills: [],
            hp: 100,
        },
        passiveStats: {
            HealthMulti: { enabled: true, value: 100 },
        },
    };

    const result = enemyConfigToPvpStats(
        config,
        undefined,
        { ...pvpConfig, PvpHpPetMultiplier: 0.5, PvpHpSkillMultiplier: 0.5, PvpHpMountMultiplier: 0.5 },
    );

    assert.equal(result.hp, 1300);
});

test('preserves imported pet, skill, and mount health modifiers', () => {
    const profile: UserProfile = structuredClone(INITIAL_PROFILE);
    profile.pets.active = [{ rarity: 'Rare', id: 7, level: 1, evolution: 0 }];
    profile.mount.active = {
        rarity: 'Rare',
        id: 1,
        level: 1,
        evolution: 0,
        skills: [],
    };
    profile.misc.petAscensionLevel = 1;

    const stats = {
        totalDamage: 10,
        totalHealth: 11100,
        skillPassiveHealth: 500,
        mountHealth: 600,
        healthMultiplier: 2,
        skillDamageMultiplier: 1,
        damageMultiplier: 1,
    };
    const libs = {
        petUpgradeLibrary: {
            Rare: {
                LevelInfo: [{
                    Level: 0,
                    PetStats: {
                        Stats: [{
                            Value: 100,
                            StatNode: { UniqueStat: { StatType: 'Health' } },
                        }],
                    },
                }],
            },
        },
        petLibrary: {
            "{'Rarity': 'Rare', 'Id': 7}": { Type: 'Tank' },
        },
        petBalancingLibrary: {
            Tank: { DamageMultiplier: 1, HealthMultiplier: 2 },
        },
        ascensionConfigsLibrary: {
            Pets: {
                AscensionConfigPerLevel: [{
                    StatContributions: [{
                        Value: 49,
                        StatNode: { UniqueStat: { StatType: 'Health' } },
                    }],
                }],
            },
        },
    };

    const config = profileToEnemyConfig(profile, libs, stats);

    assert.equal(config.pets[0]?.hp, 10000);
    assert.equal(config.skillPassiveHp, 500);
    assert.equal(config.mount?.hp, 600);
    assert.deepEqual(config.passiveStats.HealthMulti, { enabled: true, value: 100 });
});
