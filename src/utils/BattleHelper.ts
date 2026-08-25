
// --- Battle Types ---

export interface DungeonLevelConfig {
    Level: number;
    Health: number;
    Damage: number;
    Wave1?: number;
    Wave2?: number;
    Wave3?: number;
    EnemyId1?: number;
    EnemyId2?: number;
}

export interface WaveResult {
    waveIndex: number;
    enemies: { id: number; count: number; damagePerHit: number; isRanged: boolean }[];
    totalEnemyHp: number;
    totalEnemyDps: number;
    playerHealthBeforeWave: number;
    playerHealthAfterWave: number;
    survived: boolean;
    timeToComplete: number;
}

export interface BattleResult {
    ageIdx?: number;
    battleIdx?: number;
    difficultyIdx: number;
    dungeonLevel?: number;
    dungeonType?: string;
    waves: WaveResult[];
    victory: boolean;
    winProbability: number; // 0-100%
    totalRuns: number;
    playerHealthRemaining: number;
    totalTime: number;
    totalEnemyHp?: number;
    totalEnemyDps?: number;
    playerStats: {
        effectiveDps: number;
        effectiveHp: number;
        healingPerSecond: number;
        damagePerHit: number; // Single hit damage
    };
}

export interface BattleConfig {
    DifficultyIdx: number;
    AgeIdx: number;
    BattleIdx: number;
    EnvironmentId: number;
    Waves: {
        WaveIdx: number;
        Enemies: {
            Id: number; // Enemy ID
            Count: number;
        }[];
    }[];
}

export interface AgeScaling {
    AgeIdx: number;
    /** Either the legacy `{ Raw }` wrapper or, from 2026_08_21 on, a plain number. See ageScale. */
    Damage: { Raw: number } | number;
    Health: { Raw: number } | number;
}

/**
 * Read one enemy age-scaling magnitude, whichever of the two shapes the config uses.
 *
 * Up to 2026_07 the extraction wrote these as `{"Damage": {"Raw": 500}}`. From 2026_08_21, the
 * build parsed with the fixed Metaplay parser, they are plain numbers: `{"Damage": 10.0}`. Reading
 * `.Raw` off a number gives `undefined`, which reached the engine as an enemy with no health at
 * all, so every battle ran to its tick cap and the progress predictor never produced a result.
 *
 * The two forms differ by a constant factor of 50, measured across all 11 ages for both fields:
 *
 *     age 0    Raw 500        plain 10.0        ratio 50.0
 *     age 5    Raw 256000     plain 5120.0      ratio 50.0
 *     age 10   Raw 786432000  plain 15728640.0  ratio 50.0
 *
 * The engine is calibrated against the legacy magnitude, so the plain form is brought up to it
 * rather than the other way round. Anything else silently makes every enemy 50 times weaker.
 */
const AGE_SCALE_FIXED_POINT = 50;

export function ageScale(value: { Raw: number } | number | null | undefined): number {
    if (typeof value === 'number') return value * AGE_SCALE_FIXED_POINT;
    if (value && typeof value.Raw === 'number') return value.Raw;
    return 0;
}

export interface WeaponInfo {
    Age: number;
    Idx: number;
    Type: string;
    AttackDuration: number;
    WindupTime: number;
    IsRanged: boolean | number;
    ProjectileId?: number;
    AttackRange?: number;
}

export interface LibraryData {
    mainBattleLibrary: Record<string, BattleConfig>;
    enemyAgeScalingLibrary: Record<string, AgeScaling>;
    enemyLibrary: Record<string, any>;
    weaponLibrary: Record<string, WeaponInfo>;
    mainBattleConfig: any;
    itemBalancingConfig?: any;
    projectilesLibrary: Record<string, any>;
    hammerThiefDungeonBattleLibrary: Record<string, DungeonLevelConfig>;
    skillDungeonBattleLibrary: Record<string, DungeonLevelConfig>;
    eggDungeonBattleLibrary: Record<string, DungeonLevelConfig>;
    potionDungeonBattleLibrary: Record<string, DungeonLevelConfig>;
    skillLibrary?: Record<string, any>;
    skillPassiveLibrary?: Record<string, any>;
    mainBattleLookup?: Record<string, BattleConfig>;
    missionBaseConfig?: any;
    missionBattleLibrary?: Record<string, any>;
}

export interface MissionBattleConfig {
    MissionId: number;
    MissionTitleId: string;
    MinLevel: number;
    BaseDamage: number;
    BaseHealth: number;
    UnitCount: number;
    MapAge: number;
    ChanceToHaveWeapon: number;
    ChanceToHaveHelmet: number;
    ChanceToHaveArmour: number;
    PossibleWeapons: { Item1: number; Item2: number }[] | null;
    PossibleHelmets: { Item1: number; Item2: number }[] | null;
    PossibleArmours: { Item1: number; Item2: number }[] | null;
}

// --- Helper Functions ---

export function getAvailableStages(libs: LibraryData): { ageIdx: number; battleIdx: number }[] {
    if (!libs.mainBattleLibrary) return [];

    const stages: { ageIdx: number; battleIdx: number }[] = [];
    const keys = Object.keys(libs.mainBattleLibrary);

    keys.forEach(key => {
        const ageMatch = key.match(/'AgeIdx': (\d+)/);
        const battleMatch = key.match(/'BattleIdx': (\d+)/);
        if (ageMatch && battleMatch) {
            stages.push({
                ageIdx: parseInt(ageMatch[1]),
                battleIdx: parseInt(battleMatch[1])
            });
        }
    });

    return stages.sort((a, b) => {
        if (a.ageIdx !== b.ageIdx) return a.ageIdx - b.ageIdx;
        return a.battleIdx - b.battleIdx;
    });
}

export function calculateEnemyHp(
    _progressDifficultyIdx: number,
    ageScaling: AgeScaling,
    _mainBattleConfig: any,
    _weaponInfo: WeaponInfo | null,
    _libs: LibraryData
): number {
    const baseHp = ageScale(ageScaling.Health);
    return baseHp;
}

export function calculateEnemyDmg(
    _progressDifficultyIdx: number,
    ageScaling: AgeScaling,
    _mainBattleConfig: any,
    weaponInfo: WeaponInfo | null,
    enemyRangedMulti: number,
    _libs: LibraryData
): number {
    const baseDmg = ageScale(ageScaling.Damage);
    const atkRange = weaponInfo?.AttackRange ?? 0;
    if (weaponInfo && atkRange > 1.0) {
        return baseDmg * enemyRangedMulti;
    }
    return baseDmg;
}

export function calculateProgressDifficultyIdx(
    ageIdx: number,
    battleIdx: number,
    difficultyMode: number,
    mainBattleLibrary: Record<string, BattleConfig>
): number {
    let totalBattles = 0;

    for (let age = 0; age < ageIdx; age++) {
        const ageKey = `{'AgeIdx': ${age}`;
        const battlesInAge = Object.keys(mainBattleLibrary).filter(k => k.includes(ageKey)).length;
        totalBattles += battlesInAge;
    }

    totalBattles += battleIdx;

    const battlesPerMode = 300;
    totalBattles += (difficultyMode * battlesPerMode);

    return totalBattles;
}
