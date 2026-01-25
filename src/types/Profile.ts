export interface ItemSlot {
    age: number; // Tier/Level bracket (corresponds to "Age" in JSON)
    idx: number; // Index within the tier (corresponds to "Idx" in JSON)
    level: number;
    rarity: string; // "Common", "Rare", "Epic", "Legendary", "Ultimate", "Mythic" - display or derived, but useful for filtering
    secondaryStats: {
        statId: string;
        value: number;
    }[];
}

export interface PetSlot {
    rarity: string;
    id: number;
    level: number;
    evolution: number;
    secondaryStats?: {
        statId: string;
        value: number;
    }[];
    customName?: string;
    hp?: number;
}

export interface MountSlot {
    rarity: string;
    id: number;
    level: number;
    evolution: number;
    skills: number[];
    secondaryStats?: {
        statId: string;
        value: number;
    }[];
    customName?: string;
    hp?: number;
}

export interface SkillSlot {
    id: string; // e.g., "Meat"
    rarity: string;
    level: number;
    evolution: number;
}

export interface UserProfile {
    id: string; // Unique identifier for the profile
    name: string;
    iconIndex: number; // Index in CardIcons.png spritesheet (8x8 = 64 icons)
    version: number;
    isShared?: boolean;

    items: {
        Weapon: ItemSlot | null;
        Helmet: ItemSlot | null;
        Body: ItemSlot | null;
        Gloves: ItemSlot | null;
        Belt: ItemSlot | null;
        Necklace: ItemSlot | null;
        Ring: ItemSlot | null;
        Shoe: ItemSlot | null; // Note: Review if "Shoes" or "Shoe" in JSON keys
    };

    savedItems: {
        [slot: string]: (ItemSlot & { customName?: string })[];
    };

    techTree: {
        Forge: { [nodeId: number]: number };
        Power: { [nodeId: number]: number };
        SkillsPetTech: { [nodeId: number]: number };
    };

    pets: {
        active: PetSlot[];
        collection: {
            [key: string]: PetSlot; // Key: `${rarity}_${id}`
        };
        savedBuilds: PetSlot[];
    };

    mount: {
        active: MountSlot | null;
        collection: { [key: string]: MountSlot };
        savedBuilds: MountSlot[];
    };

    skills: {
        equipped: SkillSlot[];
        collection: { [key: string]: SkillSlot };
        passives: { [skillId: string]: number }; // skillId -> level (0 = not owned)
    };

    misc: {
        forgeLevel: number;
        dungeonLevels: {
            [dungeonId: string]: number; // e.g. "Dungeon_Hammer" -> 50
        };
        eggSlots: number;
        eggStage?: number; // Persisted selection for Drop Rates tab
        dungeonKeys?: number; // Persisted for Drop Predictor
        researchLevel: number;
        forgeCalculator?: {
            hammers: string;
            targetGold: string;
            mode: 'hammers' | 'gold';
            usePlayerItems?: boolean;
        };
        skillCalculatorLevel?: number;
        skillCalculatorTickets?: number;
        mountCalculatorLevel?: number;
        mountCalculatorProgress?: number;
        mountCalculatorWinders?: number;
        techPotions?: number;
        dungeonKeyCounts?: {
            Hammer: number;
            Skill: number;
            Egg: number;
            Potion: number;
        };
    };
}

// Generate unique ID
export function generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const INITIAL_PROFILE: UserProfile = {
    id: '',
    name: "Profile 1",
    iconIndex: 0,
    version: 1,
    items: {
        Weapon: null,
        Helmet: null,
        Body: null,
        Gloves: null,
        Belt: null,
        Necklace: null,
        Ring: null,
        Shoe: null,
    },
    savedItems: {},
    techTree: {
        Forge: {},
        Power: {},
        SkillsPetTech: {},
    },
    pets: {
        active: [],
        collection: {},
        savedBuilds: [],
    },
    mount: {
        active: null,
        collection: {},
        savedBuilds: [],
    },
    skills: {
        equipped: [],
        collection: {},
        passives: {},
    },
    misc: {
        forgeLevel: 1,
        dungeonLevels: {},
        eggSlots: 2,
        eggStage: 1,
        dungeonKeys: 1,
        researchLevel: 1,
        forgeCalculator: {
            hammers: '0',
            targetGold: '0',
            mode: 'hammers'
        },
        skillCalculatorLevel: 1,
        skillCalculatorTickets: 0,
        mountCalculatorLevel: 1,
        mountCalculatorProgress: 0,
        mountCalculatorWinders: 0,
        techPotions: 0,
        dungeonKeyCounts: {
            Hammer: 0,
            Skill: 0,
            Egg: 0,
            Potion: 0
        }
    }
};
