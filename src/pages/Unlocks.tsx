import { useMemo } from 'react';
import { Card } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { Unlock, AlertCircle } from 'lucide-react';

// Constants for Ages as they might not be in a simple config list
const AGES = ['Primitive', 'Medieval', 'Early-Modern', 'Modern', 'Space', 'Interstellar', 'Multiverse', 'Quantum', 'Underworld', 'Divine'];
const AGE_COLORS = ['#F1F1F1', '#5DD8FF', '#5CFE89', '#FDFF5D', '#FF5D5D', '#D55DFF', '#75FFEE', '#886DFF', '#A77373', '#FF9E0D'];

// Mapping for cleaner display names if JSON keys are raw
const FEATURE_NAMES: Record<string, string> = {
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
    RateUs_1: 'Rate Us (Phase 1)',
    RateUs_2: 'Rate Us (Phase 2)',
};

interface UnlockCondition {
    AgeIdx: number;
    BattleIdx: number;
}

export default function Unlocks() {
    const { data: unlockData, loading, error } = useGameData<Record<string, UnlockCondition>>('UnlockConditions.json');

    const timeline = useMemo(() => {
        if (!unlockData) return [];

        // Group by Age
        const byAge: Record<number, { feature: string; data: UnlockCondition }[]> = {};

        Object.entries(unlockData).forEach(([feature, data]) => {
            const age = data.AgeIdx;
            if (!byAge[age]) byAge[age] = [];
            byAge[age].push({ feature, data });
        });

        // Convert to array and sort
        return Object.entries(byAge)
            .map(([ageStr, features]) => {
                const age = parseInt(ageStr);
                // Sort features within age by battle stage
                features.sort((a, b) => a.data.BattleIdx - b.data.BattleIdx);
                return {
                    age,
                    ageName: AGES[age] || `Age ${age + 1}`,
                    color: AGE_COLORS[age] || '#FFF',
                    features
                };
            })
            .sort((a, b) => a.age - b.age);
    }, [unlockData]);

    if (loading) return <div className="text-center p-12 text-text-muted animate-pulse">Loading Unlock Data...</div>;
    if (error) return (
        <div className="text-center p-12 text-red-400 flex flex-col items-center gap-2">
            <AlertCircle className="w-8 h-8" />
            <p>Failed to load unlocks data.</p>
            <p className="text-xs text-text-muted">{error}</p>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <Unlock className="w-10 h-10 text-accent-primary" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Feature Unlocks
                    </h1>
                    <p className="text-text-muted">Timeline of when game features become available</p>
                </div>
            </div>

            <div className="relative pl-8 border-l-2 border-border space-y-12">
                {timeline.map((group) => (
                    <div key={group.age} className="relative">
                        {/* Age Dot */}
                        <div
                            className="absolute -left-[41px] top-0 w-5 h-5 rounded-full border-4 border-bg-primary"
                            style={{ backgroundColor: group.color }}
                        />

                        <h2
                            className="text-xl font-bold mb-6 flex items-center gap-3"
                            style={{ color: group.color }}
                        >
                            {group.ageName} Age
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {group.features.map(({ feature, data }) => (
                                <Card key={feature} className="flex items-center gap-4 p-4 hover:border-accent-primary/50 transition-colors">
                                    <div className="w-10 h-10 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                                        <GameIcon name={getFeatureIcon(feature)} className="w-6 h-6" />
                                    </div>
                                    <div className="overflow-hidden">
                                        <div className="font-semibold truncate" title={FEATURE_NAMES[feature] || feature}>
                                            {FEATURE_NAMES[feature] || feature}
                                        </div>
                                        <div className="text-sm text-text-muted">
                                            Stage {group.age + 1}-{data.BattleIdx + 1}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Detailed Table View if needed, or just keep timeline which is nicer */}
        </div>
    );
}

function getFeatureIcon(feature: string): string {
    const f = feature.toLowerCase();
    if (f.includes('hammer')) return 'Hammer';
    if (f.includes('coin') || f.includes('idle')) return 'Coin';
    if (f.includes('shop') || f.includes('starter')) return 'GemSquare';
    if (f.includes('skill')) return 'SkillTicket';
    if (f.includes('pet') || f.includes('egg')) return 'Egg';
    if (f.includes('dungeon_hammer')) return 'HammerKey';
    if (f.includes('dungeon_skill')) return 'SkillKey';
    if (f.includes('dungeon_pet')) return 'PetKey';
    if (f.includes('dungeon_potion')) return 'PotionKey';
    if (f.includes('dungeon')) return 'Battle';
    if (f.includes('arena')) return 'Battle';
    if (f.includes('techtree')) return 'Potion';
    if (f.includes('guild')) return 'MasterShield';
    if (f.includes('rateus')) return 'Star';
    if (f.includes('login') || f.includes('name')) return 'Male';
    return 'CommonChest';
}
