import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { useProfile } from '../../context/ProfileContext';
import { useComparison } from '../../context/ComparisonContext';
import { useGameData } from '../../hooks/useGameData';
import { StatsSummaryPanel } from '../../components/Profile/StatsSummaryPanel';
import { RefreshCw, Sliders, Hash, Zap, TrendingUp, Sparkles, Wand2 } from 'lucide-react';
import { getStatName } from '../../utils/statNames';
import { cn } from '../../lib/utils';
import { UserProfile } from '../../types/Profile';
import { calculateStats, LibraryData } from '../../utils/statEngine';

export default function SubstatsCalculator() {
    const { profile } = useProfile();
    const { 
        isComparing, 
        enterCompareMode, 
        exitCompareMode, 
        updateTestItem, 
        updateTestPet, 
        updateTestMount 
    } = useComparison();

    const { data: petUpgradeLibrary } = useGameData<any>('PetUpgradeLibrary.json');
    const { data: petBalancingLibrary } = useGameData<any>('PetBalancingLibrary.json');
    const { data: petLibrary } = useGameData<any>('PetLibrary.json');
    const { data: skillLibrary } = useGameData<any>('SkillLibrary.json');
    const { data: skillPassiveLibrary } = useGameData<any>('SkillPassiveLibrary.json');
    const { data: mountUpgradeLibrary } = useGameData<any>('MountUpgradeLibrary.json');
    const { data: techTreeLibrary } = useGameData<any>('TechTreeLibrary.json');
    const { data: techTreePositionLibrary } = useGameData<any>('TechTreePositionLibrary.json');
    const { data: guildPositionLibrary } = useGameData<any>('GuildTechTreePositionLibrary.json');
    const { data: guildUpgradeLibrary } = useGameData<any>('GuildTechTreeUpgradeLibrary.json');
    const { data: itemBalancingLibrary } = useGameData<any>('ItemBalancingLibrary.json');
    const { data: itemBalancingConfig } = useGameData<any>('ItemBalancingConfig.json');
    const { data: weaponLibrary } = useGameData<any>('WeaponLibrary.json');
    const { data: projectilesLibrary } = useGameData<any>('ProjectilesLibrary.json');
    const { data: secondaryStatLibrary } = useGameData<any>('SecondaryStatLibrary.json');
    const { data: skinsLibrary } = useGameData<any>('SkinsLibrary.json');
    const { data: setsLibrary } = useGameData<any>('SetsLibrary.json');
    const { data: ascensionConfigsLibrary } = useGameData<any>('AscensionConfigsLibrary.json');

    const libs: LibraryData = useMemo(() => ({
        petUpgradeLibrary, petBalancingLibrary, petLibrary, skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary,
        guildTechTreePositionLibrary: guildPositionLibrary || undefined,
        guildTechTreeUpgradeLibrary: guildUpgradeLibrary || undefined,
        itemBalancingLibrary, itemBalancingConfig, weaponLibrary,
        projectilesLibrary, secondaryStatLibrary, skinsLibrary, setsLibrary, ascensionConfigsLibrary
    }), [
        petUpgradeLibrary, petBalancingLibrary, petLibrary, skillLibrary, skillPassiveLibrary, mountUpgradeLibrary,
        techTreeLibrary, techTreePositionLibrary, guildPositionLibrary, guildUpgradeLibrary,
        itemBalancingLibrary, itemBalancingConfig, weaponLibrary,
        projectilesLibrary, secondaryStatLibrary, skinsLibrary, setsLibrary, ascensionConfigsLibrary
    ]);

    const [itemSubstatsConfig, setItemSubstatsConfig] = useState(1);
    const [petSubstatsConfig, setPetSubstatsConfig] = useState(1);
    const [mountSubstatsConfig, setMountSubstatsConfig] = useState(1);
    const [statAllocations, setStatAllocations] = useState<Record<string, number>>({});
    const [optimizeType, setOptimizeType] = useState<'real' | 'theor'>('real');
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [includeSkills, setIncludeSkills] = useState(false);
    const [perfectionPercentage, setPerfectionPercentage] = useState(100);
    
    // Auto-enter compare mode when opening the page
    useEffect(() => {
        enterCompareMode();
        return () => {
            exitCompareMode();
        };
    }, [enterCompareMode, exitCompareMode]);

    const handleResetToProfile = useCallback(() => {
        const initialAllocations: Record<string, number> = {};

        const addAlloc = (statId: string) => {
            initialAllocations[statId] = (initialAllocations[statId] || 0) + 1;
        };

        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        slots.forEach(slot => {
            const item = profile.items[slot];
            if (item?.secondaryStats) {
                item.secondaryStats.forEach(s => addAlloc(s.statId));
            }
        });

        profile.pets.active.forEach(pet => {
            if (pet?.secondaryStats) {
                pet.secondaryStats.forEach(s => addAlloc(s.statId));
            }
        });

        const mount = profile.mount.active;
        if (mount?.secondaryStats) {
            mount.secondaryStats.forEach(s => addAlloc(s.statId));
        }

        const clampedAllocations: Record<string, number> = {};
        Object.keys(initialAllocations).forEach(key => {
            clampedAllocations[key] = Math.min(initialAllocations[key], 12);
        });

        setStatAllocations(clampedAllocations);
    }, [profile]);

    // Pre-fill initial configuration based on current profile
    useEffect(() => {
        if (!secondaryStatLibrary) return;

        let maxItemSubstats = 1;
        let maxPetSubstats = 1;
        let maxMountSubstats = 1;
        const initialAllocations: Record<string, number> = {};

        const addAlloc = (statId: string) => {
            initialAllocations[statId] = (initialAllocations[statId] || 0) + 1;
        };

        const slots: (keyof UserProfile['items'])[] = ['Weapon', 'Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        slots.forEach(slot => {
            const item = profile.items[slot];
            if (item?.secondaryStats) {
                if (item.secondaryStats.length > maxItemSubstats) maxItemSubstats = item.secondaryStats.length;
                item.secondaryStats.forEach(s => addAlloc(s.statId));
            }
        });

        profile.pets.active.forEach(pet => {
            if (pet?.secondaryStats) {
                if (pet.secondaryStats.length > maxPetSubstats) maxPetSubstats = pet.secondaryStats.length;
                pet.secondaryStats.forEach(s => addAlloc(s.statId));
            }
        });

        const mount = profile.mount.active;
        if (mount?.secondaryStats) {
            if (mount.secondaryStats.length > maxMountSubstats) maxMountSubstats = mount.secondaryStats.length;
            mount.secondaryStats.forEach(s => addAlloc(s.statId));
        }

        setItemSubstatsConfig(maxItemSubstats);
        setPetSubstatsConfig(maxPetSubstats);
        setMountSubstatsConfig(maxMountSubstats);
        
        // Ensure initial allocations don't exceed max possible per stat (12)
        handleResetToProfile();
    }, [secondaryStatLibrary, profile, handleResetToProfile]); // Run once when library and profile are loaded

    const totalAvailablePool = (itemSubstatsConfig * 8) + (petSubstatsConfig * 3) + (mountSubstatsConfig * 1);
    const currentAllocated = Object.values(statAllocations).reduce((sum, val) => sum + val, 0);
    const remainingPool = totalAvailablePool - currentAllocated;

    const optimizeSubstats = useCallback((objective: 'dps' | 'hps' | 'hybrid' | 'power' | 'damage' | 'health') => {
        if (!secondaryStatLibrary || !itemBalancingConfig || !itemBalancingLibrary) return;
        setIsOptimizing(true);

        // Small timeout to allow UI to update with "Optimizing" state
        setTimeout(() => {
            const maxPossible = 12; // 8 items + 3 pets + 1 mount
            let currentAllocs: Record<string, number> = {};
            const statList = Object.keys(secondaryStatLibrary);
            
            // Pre-calculate the base profile to avoid deep cloning 10,000 times
            const baseTestProfile = JSON.parse(JSON.stringify(profile));
            if (!baseTestProfile.items.Weapon) {
                baseTestProfile.items.Weapon = { age: 1, idx: 0, level: 1, rarity: "Legendary", secondaryStats: [] };
            }
            const slots: (keyof UserProfile['items'])[] = ['Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
            slots.forEach(slot => { if (baseTestProfile.items[slot]) baseTestProfile.items[slot].secondaryStats = []; });
            baseTestProfile.pets.active.forEach((pet: any) => { pet.secondaryStats = []; });
            if (baseTestProfile.mount.active) baseTestProfile.mount.active.secondaryStats = [];

            const getScore = (allocs: Record<string, number>) => {
                // Create simulated stats
                const simulatedStats = Object.entries(allocs)
                    .filter(([_, count]) => count > 0)
                    .map(([statId, count]) => ({ statId, value: count * (secondaryStatLibrary[statId]?.UpperRange || 0) * perfectionPercentage }));
                
                // Inject directly into the cached base profile (calculateStats does not mutate it)
                baseTestProfile.items.Weapon.secondaryStats = simulatedStats;
                
                const stats = calculateStats(baseTestProfile, libs);
                
                // Calculate objective
                const cappedCrit = Math.min(stats.criticalChance, 1);
                const cappedDouble = Math.min(stats.doubleDamageChance, 1);
                const critMult = 1 + cappedCrit * (stats.criticalDamage - 1);
                const doubleMult = 1 + cappedDouble;
                const aps = 1 / (stats.weaponAttackDuration / stats.attackSpeedMultiplier);
                const weaponTheor = stats.totalDamage * aps * critMult * doubleMult;
                const weaponReal = stats.realWeaponDps;
                
                const theorDps = weaponTheor + (includeSkills ? stats.skillDps + (stats.skillBuffDps || 0) : 0);
                const realDps = weaponReal + (includeSkills ? stats.skillDps + (stats.skillBuffDps || 0) : 0);
                
                const blockChance = Math.min(stats.blockChance || 0, 0.95);
                const theorHps = (stats.totalHealth * stats.healthRegen + weaponTheor * stats.lifeSteal + (includeSkills ? stats.skillHps : 0)) / (1 - blockChance);
                const realHps = (stats.totalHealth * stats.healthRegen + weaponReal * stats.lifeSteal + (includeSkills ? stats.skillHps : 0)) / (1 - blockChance);

                const dps = optimizeType === 'real' ? realDps : theorDps;
                const hps = optimizeType === 'real' ? realHps : theorHps;

                if (objective === 'dps') return dps;
                if (objective === 'hps') return hps;
                if (objective === 'power') {
                    const powerDmgMulti = stats.powerDamageMultiplier || 8.0;
                    return ((stats.totalDamage - 10) * powerDmgMulti + (stats.totalHealth - 80)) * 3;
                }
                if (objective === 'damage') return stats.totalDamage;
                if (objective === 'health') return stats.totalHealth;
                return dps * hps; // hybrid
            };

            // Lookahead Greedy Ascent algorithm
            let remainingPoints = totalAvailablePool;
            while (remainingPoints > 0) {
                let bestStat = '';
                let bestPointsToADD = 0;
                let bestScoreIncreasePerPoint = -1;
                const baseScore = getScore(currentAllocs);
                
                for (const stat of statList) {
                    const currentPoints = currentAllocs[stat] || 0;
                    const maxToAdd = Math.min(remainingPoints, maxPossible - currentPoints);
                    if (maxToAdd <= 0) continue;
                    
                    // Lookahead: try adding 1, 2, ..., maxToAdd points to find breakpoint jumps
                    let localBestIncreasePerPoint = -1;
                    let localBestPoints = 0;
                    
                    for (let k = 1; k <= maxToAdd; k++) {
                        const tempAllocs = { ...currentAllocs, [stat]: currentPoints + k };
                        const score = getScore(tempAllocs);
                        const increasePerPoint = (score - baseScore) / k;
                        
                        // We strictly want the highest return on investment per stat point
                        if (increasePerPoint > localBestIncreasePerPoint) {
                            localBestIncreasePerPoint = increasePerPoint;
                            localBestPoints = k;
                        }
                    }
                    
                    if (localBestIncreasePerPoint > bestScoreIncreasePerPoint) {
                        bestScoreIncreasePerPoint = localBestIncreasePerPoint;
                        bestStat = stat;
                        bestPointsToADD = localBestPoints;
                    }
                }
                
                if (bestStat && bestScoreIncreasePerPoint > 0) {
                    currentAllocs[bestStat] = (currentAllocs[bestStat] || 0) + bestPointsToADD;
                    remainingPoints -= bestPointsToADD;
                } else {
                    // Fallback: if no score improvement can be found at all, just add 1 point randomly
                    const fallbackStat = statList.find(s => (currentAllocs[s] || 0) < maxPossible);
                    if (fallbackStat) {
                        currentAllocs[fallbackStat] = (currentAllocs[fallbackStat] || 0) + 1;
                        remainingPoints -= 1;
                    } else {
                        break;
                    }
                }
            }

            // ---------------------------------------------------------
            // RANDOM RESTART LOCAL SEARCH
            // ---------------------------------------------------------
            // The state space has complex submodular synergies (e.g. 1 point in Cooldown + 1 point in AttackSpeed).
            // A pure greedy/hill-climb approach can get stuck if a synergy requires 2-3 points across DIFFERENT stats.
            // By running multiple random starting points and hill-climbing them, we can find global maximums.
            
            const maxRestarts = 20;
            let globalBestAllocs = { ...currentAllocs }; // start by trusting the greedy solution
            let globalBestScore = getScore(globalBestAllocs);
            
            const startingPoints = [currentAllocs]; // 0th is greedy
            
            // Generate Random Starting Points
            for (let i = 0; i < maxRestarts; i++) {
                let randomAlloc: Record<string, number> = {};
                let pointsLeft = totalAvailablePool;
                let availableStats = [...statList];
                
                while (pointsLeft > 0 && availableStats.length > 0) {
                    const idx = Math.floor(Math.random() * availableStats.length);
                    const s = availableStats[idx];
                    const maxCanAdd = Math.min(pointsLeft, maxPossible - (randomAlloc[s] || 0));
                    
                    if (maxCanAdd <= 0) {
                        availableStats.splice(idx, 1);
                        continue;
                    }
                    
                    const add = Math.floor(Math.random() * maxCanAdd) + 1;
                    randomAlloc[s] = (randomAlloc[s] || 0) + add;
                    pointsLeft -= add;
                    
                    if (randomAlloc[s] === maxPossible) {
                        availableStats.splice(idx, 1);
                    }
                }
                startingPoints.push(randomAlloc);
            }

            // Run Multi-Point Hill Climbing for each starting point
            for (const startAlloc of startingPoints) {
                let localAllocs = { ...startAlloc };
                let improved = true;
                
                while (improved) {
                    improved = false;
                    let bestSwapScore = getScore(localAllocs);
                    let bestSwap: { remove: string, add: string, count: number } | null = null;
                    
                    const currentStats = Object.keys(localAllocs).filter(s => localAllocs[s] > 0);
                    for (const removeStat of currentStats) {
                        const removeAvailable = localAllocs[removeStat];
                        
                        for (const addStat of statList) {
                            if (removeStat === addStat) continue;
                            const addAvailable = maxPossible - (localAllocs[addStat] || 0);
                            if (addAvailable <= 0) continue;
                            
                            // Try swapping 1 to 2 points to jump over local minimums caused by breakpoints
                            const maxSwap = Math.min(removeAvailable, addAvailable, 2); 
                            for (let k = 1; k <= maxSwap; k++) {
                                const tempAllocs = { ...localAllocs };
                                tempAllocs[removeStat] -= k;
                                tempAllocs[addStat] = (tempAllocs[addStat] || 0) + k;
                                
                                const score = getScore(tempAllocs);
                                if (score > bestSwapScore) {
                                    bestSwapScore = score;
                                    bestSwap = { remove: removeStat, add: addStat, count: k };
                                }
                            }
                        }
                    }
                    
                    if (bestSwap) {
                        localAllocs[bestSwap.remove] -= bestSwap.count;
                        localAllocs[bestSwap.add] = (localAllocs[bestSwap.add] || 0) + bestSwap.count;
                        improved = true;
                    }
                }
                
                const finalLocalScore = getScore(localAllocs);
                if (finalLocalScore > globalBestScore) {
                    globalBestScore = finalLocalScore;
                    globalBestAllocs = { ...localAllocs };
                }
            }
            
            setStatAllocations(globalBestAllocs);
            setIsOptimizing(false);
        }, 50);
    }, [secondaryStatLibrary, itemSubstatsConfig, petSubstatsConfig, mountSubstatsConfig, profile, libs, optimizeType, includeSkills, itemBalancingConfig, itemBalancingLibrary, totalAvailablePool]);

    // Update test build whenever allocations change
    useEffect(() => {
        if (!isComparing || !secondaryStatLibrary) return;

        // Generate the simulated secondary stats array
        const simulatedStats = Object.entries(statAllocations)
            .filter(([_, count]) => count > 0)
            .map(([statId, count]) => {
                const upperRange = secondaryStatLibrary[statId]?.UpperRange || 0;
                // Game stores percentage points (e.g., 0.1 -> 10.0), scaled by perfection
                return { statId, value: count * upperRange * perfectionPercentage };
            });

        // Inject into Weapon, clear others
        const testWeapon = profile.items.Weapon ? JSON.parse(JSON.stringify(profile.items.Weapon)) : {
            age: 1, idx: 0, level: 1, rarity: "Legendary", secondaryStats: []
        };
        testWeapon.secondaryStats = simulatedStats;
        updateTestItem('Weapon', testWeapon);

        // Clear other items
        const slots: (keyof UserProfile['items'])[] = ['Helmet', 'Body', 'Gloves', 'Belt', 'Necklace', 'Ring', 'Shoe'];
        slots.forEach(slot => {
            if (profile.items[slot]) {
                const clearedItem = JSON.parse(JSON.stringify(profile.items[slot]));
                clearedItem.secondaryStats = [];
                updateTestItem(slot, clearedItem);
            }
        });

        // Clear pets
        const testPets = JSON.parse(JSON.stringify(profile.pets.active));
        testPets.forEach((pet: any) => { pet.secondaryStats = []; });
        updateTestPet(testPets);

        // Clear mount
        if (profile.mount.active) {
            const testMount = JSON.parse(JSON.stringify(profile.mount.active));
            testMount.secondaryStats = [];
            updateTestMount(testMount);
        }

    }, [statAllocations, isComparing, secondaryStatLibrary, profile]);

    const handleSliderChange = (statId: string, newValue: number) => {
        setStatAllocations(prev => {
            const currentValue = prev[statId] || 0;
            const diff = newValue - currentValue;
            
            // Allow if decreasing, or if increasing and we have remaining pool
            if (diff <= 0 || diff <= remainingPool) {
                return { ...prev, [statId]: newValue };
            }
            // If trying to increase more than remaining, just add the remaining
            if (remainingPool > 0) {
                return { ...prev, [statId]: currentValue + remainingPool };
            }
            return prev;
        });
    };

    if (!secondaryStatLibrary) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-accent-primary opacity-20" />
                <p className="text-text-muted">Loading</p>
            </div>
        );
    }

    const statList = Object.keys(secondaryStatLibrary).sort();

    return (
        <div className="max-w-[100rem] mx-auto space-y-6 animate-fade-in pb-12 px-4 xl:px-8">
            <div className="flex flex-col md:flex-row justify-between items-start gap-6 border-b border-border pb-6">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent flex items-center gap-3">
                        <Sliders className="w-8 h-8 text-accent-primary" />
                        Substats Calculator
                    </h1>
                    <p className="text-text-secondary max-w-2xl mt-2 font-medium">
                        Simulate the perfect secondary stats distribution and see the impact on your real-time DPS and HPS. 
                        Values are calculated assuming maximum rolls for each substat.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStatAllocations({})}>
                        Clear All
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleResetToProfile}>
                        Reset to Profile
                    </Button>
                </div>
            </div>

            {/* Comparison Strip */}
            <div className="sticky top-0 z-40 py-2 -mx-4 px-4 bg-bg-primary/80 backdrop-blur-md border-b border-border shadow-lg">
                <StatsSummaryPanel variant="horizontal-strip" hideActions={true} defaultTab="metrics" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Configuration & Totals */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Auto-Optimizer */}
                    <Card className="p-4 border-orange-500/30 bg-orange-500/5 relative overflow-hidden">
                        {isOptimizing && (
                            <div className="absolute inset-0 bg-bg-primary/80 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center">
                                <RefreshCw className="w-6 h-6 text-orange-400 animate-spin mb-2" />
                                <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">Optimizing</span>
                            </div>
                        )}
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-orange-400">
                            <Wand2 className="w-5 h-5" /> Auto-Optimizer
                        </h3>
                        
                        <div className="flex bg-bg-secondary border border-border/50 rounded-lg p-1 mb-4">
                            <button
                                onClick={() => setOptimizeType('theor')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    optimizeType === 'theor' ? "bg-orange-500 text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                Theoretical
                            </button>
                            <button
                                onClick={() => setOptimizeType('real')}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-all",
                                    optimizeType === 'real' ? "bg-orange-500 text-white shadow" : "text-text-muted hover:text-text-primary"
                                )}
                            >
                                Real-Time
                            </button>
                        </div>
                        
                        <div className="bg-bg-input/30 p-3 rounded-lg border border-border/30 mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium">Substats Perfection</span>
                                <span className="text-xs font-bold text-accent-primary">{perfectionPercentage}%</span>
                            </div>
                            <input 
                                type="range" 
                                min="1" 
                                max="100" 
                                value={perfectionPercentage} 
                                onChange={(e) => setPerfectionPercentage(Number(e.target.value))}
                                className="w-full accent-accent-primary"
                            />
                        </div>
                        
                        <div className="flex items-center justify-between bg-bg-input/30 p-2 rounded-lg border border-border/30 mb-4 cursor-pointer" onClick={() => setIncludeSkills(!includeSkills)}>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Include Skills</span>
                                <span className="text-[9px] text-orange-400 font-bold uppercase tracking-wider">Experimental. Recommend disabled.</span>
                            </div>
                            <div className={cn("w-10 h-5 rounded-full relative transition-colors", includeSkills ? "bg-emerald-500" : "bg-bg-card")}>
                                <div className={cn("w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all", includeSkills ? "left-5" : "left-1")}></div>
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500/50 hover:text-orange-400"
                                onClick={() => optimizeSubstats('dps')}
                            >
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Maximize DPS</span>
                            </Button>
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50 hover:text-emerald-400"
                                onClick={() => optimizeSubstats('hps')}
                            >
                                <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Maximize HPS</span>
                            </Button>
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-purple-500/30 hover:bg-purple-500/10 hover:border-purple-500/50 hover:text-purple-400"
                                onClick={() => optimizeSubstats('hybrid')}
                            >
                                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" /> Maximize DPS & HPS</span>
                            </Button>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-4 text-text-muted">
                            <span className="text-[10px] font-bold uppercase tracking-widest border-t border-border/50 flex-1 ml-2"></span>
                            <span className="text-[10px] font-bold uppercase tracking-widest">Base Stats</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest border-t border-border/50 flex-1 mr-2"></span>
                        </div>
                        <div className="space-y-2 mt-2">
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-cyan-500/30 hover:bg-cyan-500/10 hover:border-cyan-500/50 hover:text-cyan-400"
                                onClick={() => optimizeSubstats('power')}
                            >
                                <span className="flex items-center gap-2"><Hash className="w-4 h-4" /> Maximize Power</span>
                            </Button>
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50 hover:text-red-400"
                                onClick={() => optimizeSubstats('damage')}
                            >
                                <span className="flex items-center gap-2"><Zap className="w-4 h-4" /> Maximize Damage</span>
                            </Button>
                            <Button 
                                variant="outline" 
                                className="w-full flex justify-between items-center bg-bg-input/50 border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50 hover:text-green-400"
                                onClick={() => optimizeSubstats('health')}
                            >
                                <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Maximize Health</span>
                            </Button>
                        </div>
                        <p className="text-[10px] text-text-muted mt-3 text-center uppercase tracking-wide">Calculates using {optimizeType === 'real' ? 'Real-Time' : 'Theoretical'} Metrics {includeSkills ? '(With Skills)' : '(Weapon Attacks Only)'}</p>
                    </Card>

                    <Card className="p-4 border-accent-primary/20 bg-accent-primary/5">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <Hash className="w-5 h-5 text-accent-primary" /> Max Substats Config
                        </h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center bg-bg-input/30 p-2 rounded-lg border border-border/30">
                                <span className="text-sm font-medium">Items (8x)</span>
                                <select 
                                    className="bg-bg-secondary border border-border rounded px-2 py-1 outline-none text-sm font-bold"
                                    value={itemSubstatsConfig}
                                    onChange={e => setItemSubstatsConfig(Number(e.target.value))}
                                >
                                    <option value={1}>1</option>
                                    <option value={2}>2</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center bg-bg-input/30 p-2 rounded-lg border border-border/30">
                                <span className="text-sm font-medium">Pets (3x)</span>
                                <select 
                                    className="bg-bg-secondary border border-border rounded px-2 py-1 outline-none text-sm font-bold"
                                    value={petSubstatsConfig}
                                    onChange={e => setPetSubstatsConfig(Number(e.target.value))}
                                >
                                    <option value={1}>1</option>
                                    <option value={2}>2</option>
                                </select>
                            </div>
                            <div className="flex justify-between items-center bg-bg-input/30 p-2 rounded-lg border border-border/30">
                                <span className="text-sm font-medium">Mount (1x)</span>
                                <select 
                                    className="bg-bg-secondary border border-border rounded px-2 py-1 outline-none text-sm font-bold"
                                    value={mountSubstatsConfig}
                                    onChange={e => setMountSubstatsConfig(Number(e.target.value))}
                                >
                                    <option value={1}>1</option>
                                    <option value={2}>2</option>
                                </select>
                            </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-border/30">
                            <div className="flex justify-between items-end">
                                <div>
                                    <div className="text-xs text-text-muted font-bold uppercase tracking-wider">Remaining Pool</div>
                                    <div className={cn("text-3xl font-black", remainingPool > 0 ? "text-accent-primary" : "text-text-muted")}>
                                        {remainingPool} <span className="text-lg font-medium text-text-muted">/ {totalAvailablePool}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                    
                    <Card className="p-4 border-border/50">
                        <h3 className="text-sm font-bold text-text-muted uppercase tracking-wider mb-2">Instructions</h3>
                        <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                            <li>Set the maximum substats your gear can have.</li>
                            <li>A single item/pet/mount cannot have the same stat twice.</li>
                            <li>The absolute maximum rolls for a single stat is 12 (8 items + 3 pets + 1 mount).</li>
                            <li>Move the sliders or use the Auto-Optimizer.</li>
                        </ul>
                    </Card>
                </div>

                {/* Right Column: Sliders */}
                <div className="lg:col-span-2">
                    <Card className="p-4 sm:p-6 border-border/50 bg-bg-secondary/20">
                        <h3 className="text-lg font-bold mb-6">Substats Allocation</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                            {statList.map(statId => {
                                const alloc = statAllocations[statId] || 0;
                                const upperRange = secondaryStatLibrary[statId]?.UpperRange || 0;
                                const maxPossible = 12; // 8 items + 3 pets + 1 mount
                                const resultingValue = alloc * upperRange * (perfectionPercentage / 100);

                                return (
                                    <div key={statId} className="bg-bg-input/20 border border-border/20 p-3 rounded-xl hover:border-accent-primary/20 hover:bg-bg-input/40 transition-colors">
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-text-primary">{getStatName(statId)}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-xs font-mono font-bold text-accent-primary">
                                                    {(resultingValue * 100).toFixed(1)}%
                                                </span>
                                                <span className="text-[10px] text-text-muted">
                                                    {alloc} / {maxPossible} rolls
                                                </span>
                                            </div>
                                        </div>
                                        <input 
                                            type="range"
                                            min="0"
                                            max={maxPossible}
                                            value={alloc}
                                            onChange={e => handleSliderChange(statId, parseInt(e.target.value))}
                                            className={cn(
                                                "w-full h-2 rounded-lg appearance-none cursor-pointer",
                                                alloc > 0 ? "bg-accent-primary" : "bg-bg-card"
                                            )}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}
