import { useState, useEffect, useRef } from 'react';
import { TrendingUp, Shield, Zap, AlertTriangle, Flame, CheckCircle, XCircle, Play, Target, ChevronLeft, ChevronRight, Swords } from 'lucide-react';
import { useBattleSimulation } from '../hooks/useBattleSimulation';
import { BattleResult } from '../utils/BattleSimulator';
import { SpriteIcon } from '../components/UI/SpriteIcon';
import { BattleVisualizerModal } from '../components/Battle/BattleVisualizerModal';
import { DebugConfig } from '../utils/BattleEngine';

// Format large numbers
function formatNumber(num: number): string {
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(1);
}

// Custom Icons Path
const ICON_PATH = '/icons/game/';

// Tabs configuration
interface TabConfig {
    id: string;
    label: string;
    icon: string;
    type: 'image' | 'sprite';
}

const TABS: TabConfig[] = [
    { id: 'main', label: 'Main Battle', icon: 'MainGameProgressPassSwordIcon.png', type: 'image' },
    { id: 'hammer', label: 'Hammer Dungeon', icon: 'HammerKey', type: 'sprite' },
    { id: 'skill', label: 'Skill Dungeon', icon: 'SkillKey', type: 'sprite' },
    { id: 'egg', label: 'Egg Dungeon', icon: 'PetKey', type: 'sprite' }, // Using PetKey for Eggs as requested
    { id: 'potion', label: 'Potion Dungeon', icon: 'PotionKey', type: 'sprite' },
];

// Helper to get color scale for 0-100% progress (10 steps)
// 0-9, 10-19, 20-29, 30-39, 40-49, 50-59, 60-69, 70-79, 80-89, 90-99, 100
const getProgressColor = (progress: number, _isSelected: boolean) => {
    // 100% - Victory
    if (progress >= 100) return { bg: 'bg-[#4ADE80]/30', text: 'text-[#4ADE80]', border: 'border-[#4ADE80]/50' }; // Bright Green

    // 0% - No progress
    if (progress <= 0) return { bg: 'bg-surface-tertiary', text: 'text-text-tertiary', border: 'border-transparent' };

    // Gradients (10 distinct steps from Dark Red to Lime Green)
    if (progress < 10) return { bg: 'bg-[#450a0a]/50', text: 'text-[#991b1b]', border: 'border-[#450a0a]' }; // 0-9%
    if (progress < 20) return { bg: 'bg-[#7f1d1d]/50', text: 'text-[#b91c1c]', border: 'border-[#7f1d1d]' }; // 10-19%
    if (progress < 30) return { bg: 'bg-[#991b1b]/50', text: 'text-[#dc2626]', border: 'border-[#991b1b]' }; // 20-29%
    if (progress < 40) return { bg: 'bg-[#c2410c]/50', text: 'text-[#ea580c]', border: 'border-[#c2410c]' }; // 30-39%
    if (progress < 50) return { bg: 'bg-[#c2410c]/40', text: 'text-[#f97316]', border: 'border-[#c2410c]' }; // 40-49%
    if (progress < 60) return { bg: 'bg-[#b45309]/50', text: 'text-[#f59e0b]', border: 'border-[#b45309]' }; // 50-59%
    if (progress < 70) return { bg: 'bg-[#a16207]/50', text: 'text-[#fbbf24]', border: 'border-[#a16207]' }; // 60-69%
    if (progress < 80) return { bg: 'bg-[#854d0e]/50', text: 'text-[#facc15]', border: 'border-[#854d0e]' }; // 70-79%
    if (progress < 90) return { bg: 'bg-[#4d7c0f]/50', text: 'text-[#a3e635]', border: 'border-[#4d7c0f]' }; // 80-89%

    // 90-99%
    return { bg: 'bg-[#3f6212]/50', text: 'text-[#bef264]', border: 'border-[#3f6212]' };
};


// Win probability visual
function WinProbabilityDisplay({ probability, victory, totalRuns }: { probability: number; victory: boolean; totalRuns: number }) {
    let colorClass = 'from-red-500 to-red-600';
    let textColor = 'text-red-400';
    const wins = Math.round((probability / 100) * totalRuns);
    const label = `${wins} / ${totalRuns} Wins`;

    if (victory) {
        colorClass = 'from-green-500 to-green-600';
        textColor = 'text-green-400';
    } else {
        // Dynamic color based on prob detailed steps
        if (probability < 20) colorClass = 'from-red-900 to-red-800';
        else if (probability < 40) colorClass = 'from-red-700 to-orange-800';
        else if (probability < 60) colorClass = 'from-orange-700 to-yellow-700';
        else if (probability < 80) colorClass = 'from-yellow-600 to-lime-600';
        else colorClass = 'from-lime-600 to-green-600';

        textColor = probability > 50 ? 'text-yellow-400' : 'text-red-400';
    }

    return (
        <div className="flex flex-col items-center gap-3">
            {/* Probability bar */}
            <div className="w-full max-w-xs">
                <div className="h-4 bg-surface-tertiary rounded-full overflow-hidden relative">
                    <div
                        className={`h-full bg-gradient-to-r ${colorClass} transition-all duration-500 rounded-full`}
                        style={{ width: `${probability}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-bold text-white drop-shadow-lg">
                            {probability.toFixed(1)}% ({totalRuns} runs)
                        </span>
                    </div>
                </div>
            </div>

            {/* Status */}
            <div className={`flex items-center gap-2 ${textColor}`}>
                {victory ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                <span className="font-semibold">{label}</span>
            </div>
        </div>
    );
}

// Wave breakdown compact
function WaveBreakdownCompact({ result }: { result: BattleResult }) {
    return (
        <div className="flex gap-2 flex-wrap justify-center">
            {result.waves.map((wave, idx) => {
                const healthPercent = Math.max(0, (wave.playerHealthAfterWave / result.playerStats.effectiveHp) * 100);
                let bgColor = 'bg-green-500';
                if (healthPercent < 30) bgColor = 'bg-red-500';
                else if (healthPercent < 60) bgColor = 'bg-yellow-500';

                const enemyCount = wave.enemies.reduce((a, e) => a + e.count, 0);

                return (
                    <div
                        key={idx}
                        className={`flex flex-col items-center p-2 rounded-lg ${wave.survived ? 'bg-surface-secondary' : 'bg-red-500/20'}`}
                        title={`Wave ${idx + 1}: ${enemyCount} enemies, ${formatNumber(wave.totalEnemyHp)} HP`}
                    >
                        <span className="text-xs text-text-secondary">W{idx + 1}</span>
                        <div className="w-8 h-1 bg-surface-tertiary rounded-full mt-1 overflow-hidden mb-1">
                            <div className={`h-full ${bgColor}`} style={{ width: `${healthPercent}%` }} />
                        </div>
                        <span className="text-[10px] text-text-tertiary">{enemyCount} enemies</span>

                        {/* Damage Stats Display */}
                        <div className="flex flex-col gap-0.5 mt-1 border-t border-border pt-1 w-full text-center">
                            {wave.enemies.map((e, eIdx) => (
                                <div key={eIdx} className="text-[9px] text-text-secondary leading-tight whitespace-nowrap">
                                    <span className={e.isRanged ? "text-blue-300" : "text-red-300"}>
                                        {formatNumber(e.damagePerHit)}
                                    </span>
                                    {e.isRanged && <span className="text-[8px] ml-0.5 opacity-70">(R)</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// --- MAIN BATTLE VIEW ---

// --- MAIN BATTLE VIEW ---

function MainBattleView({
    simulate,
    findMaxBeatable,
    playerStats,
    isDebugMode,
    onDebug,
    getBattleCountForAge,
    debugConfig,
    recalcTrigger
}: {
    simulate: any;
    findMaxBeatable: any;
    playerStats: any;
    isDebugMode?: boolean;
    onDebug?: (age: number, battle: number, diff: number) => void;
    getBattleCountForAge: (age: number) => number;
    debugConfig?: DebugConfig;
    recalcTrigger?: number;
}) {
    const [selectedAge, setSelectedAge] = useState(0);
    const [selectedLevel, setSelectedLevel] = useState(0);
    const [difficulty, setDifficulty] = useState(0); // 0=Normal, 1=Hard
    const [result, setResult] = useState<BattleResult | null>(null);
    const [maxBeatable, setMaxBeatable] = useState<{ ageIdx: number; battleIdx: number; difficulty: number } | null>(null);
    const [autoScrollDone, setAutoScrollDone] = useState(false);
    const [isRecalculating, setIsRecalculating] = useState(false);
    const resultsCache = useRef<Map<string, BattleResult>>(new Map());

    // Optimization: Use Ref for grid statuses to allow frequent updates without re-render spam, 
    // then trigger re-render once with tick.
    const [levelStatuses, setLevelStatuses] = useState<Map<string, number>>(new Map());
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Calculate Global Max Beatable (Furthest Progress)
    useEffect(() => {
        // Check Normal Max
        const maxNormal = findMaxBeatable(50, 0);
        // Check Hard Max (only if Normal is fully cleared? Or just check both?)
        // Let's check Hard.
        const maxHard = findMaxBeatable(50, 1);

        // If Hard has ANY progress (Age 0, Battle 0+), it might be the "Furthest".
        // But user might be stuck on Hard 1-1 while beating Normal 10-10.
        // Conceptually, Hard 1-1 > Normal 10-10.

        if (maxHard && (maxHard.ageIdx > 0 || maxHard.battleIdx >= 0)) {
            // If found valid Hard result
            setMaxBeatable({ ...maxHard, difficulty: 1 });
        } else if (maxNormal) {
            setMaxBeatable({ ...maxNormal, difficulty: 0 });
        }
    }, [findMaxBeatable]);

    // Auto-Scroll to Max Progress on Load
    useEffect(() => {
        if (!autoScrollDone && maxBeatable) {
            // Set Selection
            setSelectedAge(maxBeatable.ageIdx);
            setSelectedLevel(maxBeatable.battleIdx);
            setDifficulty(maxBeatable.difficulty);

            // Scroll
            const targetId = `level-btn-${maxBeatable.difficulty}-${maxBeatable.ageIdx}-${maxBeatable.battleIdx}`;
            setTimeout(() => {
                const el = document.getElementById(targetId);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Also focus?
                }
            }, 100); // Small delay to allow render

            setAutoScrollDone(true);
        }
    }, [maxBeatable, autoScrollDone]);

    // 1. Single Level Result (Right Panel Update)
    useEffect(() => {
        if (playerStats) {
            const cacheKey = `main-${difficulty}-${selectedAge}-${selectedLevel}`;
            let simResult: BattleResult | null = null;

            if (resultsCache.current.has(cacheKey)) {
                simResult = resultsCache.current.get(cacheKey)!;
            } else {
                simResult = simulate(selectedAge, selectedLevel, difficulty, 1, debugConfig);
                if (simResult) {
                    resultsCache.current.set(cacheKey, simResult);
                }
            }
            setResult(simResult);
        }
    }, [selectedAge, selectedLevel, difficulty, simulate, playerStats, debugConfig, recalcTrigger]);

    // 2. Batch Grid Coloring (Global Sim - Chunked)
    // 2. Batch Grid Coloring (Global Sim - Chunked) with PROGRESSIVE simulation strategy
    // 2. Batch Grid Coloring (Global Sim - Chunked with Progressive Refinement)
    // 2. Batch Grid Coloring (Global Sim - Sequential Smart Logic)
    useEffect(() => {
        let isCancelled = false;

        const runSimulations = async () => {
            if (!playerStats) return;

            // Generate all tasks first
            const tasks: { age: number; level: number; diff: number }[] = [];

            for (let a = 0; a <= 10; a++) {
                const count = getBattleCountForAge(a);
                for (let l = 0; l < count; l++) tasks.push({ age: a, level: l, diff: 0 });
                for (let l = 0; l < count; l++) tasks.push({ age: a, level: l, diff: 1 });
            }

            // Sort: Process Normal fully (Age 0..10), then Hard (Age 0..10)
            tasks.sort((a, b) => {
                if (a.diff !== b.diff) return a.diff - b.diff; // Normal first
                if (a.age !== b.age) return a.age - b.age;
                return a.level - b.level;
            });

            // Clear previous state before starting new simulations
            resultsCache.current.clear();
            setLevelStatuses(new Map());


            // Tracking consecutive failures for Early Stop
            let consecutiveFailures = 0;
            let currentDiff = -1;

            const updateStatus = (key: string, prob: number) => {
                setLevelStatuses(prev => {
                    const next = new Map(prev);
                    next.set(key, prob);
                    return next;
                });
            };

            for (const task of tasks) {
                if (isCancelled) return;

                // Reset failure count if difficulty changes (Treat Normal/Hard as separate runs)
                if (task.diff !== currentDiff) {
                    currentDiff = task.diff;
                    consecutiveFailures = 0;
                }

                // If 3 consecutive failures at max depth, skip remaining in this difficulty
                if (consecutiveFailures >= 3) {
                    continue; // Skip this task
                }

                const key = `${task.age}-${task.level}-${task.diff}`;



                // Smart Logic:
                // 1. Easy Check (2 runs)
                const res2 = simulate(task.age, task.level, task.diff, 2, debugConfig);


                if (!res2) continue; // Should not happen

                if (res2.winProbability >= 100) {
                    const cacheKey = `main-${task.diff}-${task.age}-${task.level}`;
                    resultsCache.current.set(cacheKey, res2);

                    updateStatus(key, 100);
                    consecutiveFailures = 0; // Reset failures on win
                    await new Promise(r => setTimeout(r, 0)); // Yield
                    continue; // Stop, 100%
                }

                // If not 100%, we are in "Frontier" -> Deepening Search
                // Step 1: 10 runs
                const res10 = simulate(task.age, task.level, task.diff, 10, debugConfig);
                if (res10 && res10.winProbability > 0) {
                    const cacheKey = `main-${task.diff}-${task.age}-${task.level}`;
                    resultsCache.current.set(cacheKey, res10);

                    updateStatus(key, res10.winProbability);
                    consecutiveFailures = 0;
                    await new Promise(r => setTimeout(r, 0));
                    continue; // Found win, Stop
                }

                // Step 2: 100 runs
                const res100 = simulate(task.age, task.level, task.diff, 100, debugConfig);
                if (res100 && res100.winProbability > 0) {
                    const cacheKey = `main-${task.diff}-${task.age}-${task.level}`;
                    resultsCache.current.set(cacheKey, res100);

                    updateStatus(key, res100.winProbability);
                    consecutiveFailures = 0;
                    await new Promise(r => setTimeout(r, 0));
                    continue;
                }

                // Step 3: 1000 runs (Final)
                const res1000 = simulate(task.age, task.level, task.diff, 1000, debugConfig);
                if (res1000) {
                    const cacheKey = `main-${task.diff}-${task.age}-${task.level}`;
                    resultsCache.current.set(cacheKey, res1000);

                    updateStatus(key, res1000.winProbability);
                    if (res1000.winProbability <= 0) {
                        consecutiveFailures++;
                    } else {
                        consecutiveFailures = 0;
                    }
                }

                await new Promise(r => setTimeout(r, 0));
            }
        };

        runSimulations();

        runSimulations();

        return () => { isCancelled = true; };
    }, [simulate, playerStats, getBattleCountForAge, debugConfig, recalcTrigger]);
    // Clear cache when stats change
    // Merged into main effect

    // Manual recalculation handler
    const handleRecalculate = (runs: number) => {
        setIsRecalculating(true);

        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            const simResult = simulate(selectedAge, selectedLevel, difficulty, runs, debugConfig);

            if (simResult) {
                // Update cache
                const cacheKey = `main-${difficulty}-${selectedAge}-${selectedLevel}`;
                resultsCache.current.set(cacheKey, simResult);

                // Update grid status
                const statusKey = `${selectedAge}-${selectedLevel}-${difficulty}`;
                setLevelStatuses(prev => {
                    const newMap = new Map(prev);
                    newMap.set(statusKey, simResult.winProbability);
                    return newMap;
                });

                // Update result display
                setResult(simResult);
            }

            setIsRecalculating(false);
        }, 50);
    };
    // --- Render List of Ages ---
    const renderAgeBlock = (ageIdx: number, modeDiff: number) => {
        const isHard = modeDiff === 1;
        // DYNAMIC LEVEL COUNT
        const levels = getBattleCountForAge(ageIdx);

        const modeName = isHard ? 'Hard' : 'Normal';
        const colorClass = isHard ? 'text-orange-400 border-orange-500/30' : 'text-blue-400 border-blue-500/30';
        const ageNum = ageIdx + 1;

        return (
            <div key={`${modeDiff}-${ageIdx}`} className={`p-4 rounded-xl border bg-black/20 ${colorClass} mb-4`}>
                <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2 rounded-lg ${isHard ? 'bg-orange-500/20' : 'bg-blue-500/20'}`}>
                        {isHard ? <Flame className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
                    </div>
                    <div>
                        <div className="font-bold text-lg">{modeName} - Age {ageNum}</div>
                        <div className="text-xs text-text-muted">Levels 1-{levels}</div>
                    </div>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                    {Array.from({ length: levels }, (_, l) => {
                        const statusKey = `${ageIdx}-${l}-${modeDiff}`;
                        const progress = levelStatuses.get(statusKey);
                        const isSelected = selectedAge === ageIdx && selectedLevel === l && difficulty === modeDiff;

                        // Style based on progress
                        const style = getProgressColor(progress ?? -1, isSelected);

                        // ID for auto-scroll
                        const btnId = `level-btn-${modeDiff}-${ageIdx}-${l}`;



                        return (
                            <button
                                key={btnId}
                                id={btnId}
                                onClick={() => {
                                    setDifficulty(modeDiff);
                                    setSelectedAge(ageIdx);
                                    setSelectedLevel(l);
                                }}
                                className={`
                                    relative aspect-square rounded-lg border flex items-center justify-center font-bold text-sm
                                    transition-all duration-200
                                    ${style.bg} ${style.text} ${style.border}
                                    ${isSelected ? 'ring-2 ring-white scale-110 z-10 shadow-xl' : 'hover:brightness-125'}
                                `}
                            >
                                {l + 1}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in h-[calc(100vh-140px)]">

            {/* Left Column: Scrollable List of Ages */}
            <div className="lg:col-span-2 flex flex-col h-full bg-[#0f0f13] rounded-2xl border border-gray-800 overflow-hidden shadow-2xl relative">
                {/* Header */}
                <div className="p-4 border-b border-gray-800 bg-[#16161e] flex justify-between items-center z-10 shadow-md">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-accent-primary" />
                        Full Progression Path
                    </h2>
                    <div className="text-xs text-gray-400">
                        {maxBeatable ? `Max: ${maxBeatable.difficulty === 1 ? 'Hard' : 'Normal'} ${maxBeatable.ageIdx + 1}-${maxBeatable.battleIdx + 1}` : 'Calculating...'}
                    </div>
                </div>

                {/* Scrollable Content */}
                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-2 relative">
                    {/* Normal Mode Blocks */}
                    <div className="sticky top-0 z-0 py-2 mb-2 flex items-center gap-4 opacity-50 pointer-events-none">
                        <div className="h-[1px] bg-blue-500/50 flex-1"></div>
                        <span className="text-blue-400 font-bold tracking-widest text-xs uppercase">Normal Timeline</span>
                        <div className="h-[1px] bg-blue-500/50 flex-1"></div>
                    </div>
                    {Array.from({ length: 11 }, (_, i) => renderAgeBlock(i, 0))}

                    {/* Hard Mode Blocks */}
                    <div className="sticky top-0 z-0 py-6 mb-2 flex items-center gap-4 opacity-50 pointer-events-none">
                        <div className="h-[1px] bg-orange-500/50 flex-1"></div>
                        <span className="text-orange-400 font-bold tracking-widest text-xs uppercase">Hard Timeline</span>
                        <div className="h-[1px] bg-orange-500/50 flex-1"></div>
                    </div>
                    {Array.from({ length: 11 }, (_, i) => renderAgeBlock(i, 1))}

                    {/* End Padding */}
                    <div className="h-20 flex items-center justify-center text-gray-600 text-sm">
                        End of Content
                    </div>
                </div>

                {/* Debug Trigger Overlay (Absolute) */}
                {isDebugMode && (
                    <div className="absolute bottom-4 right-4 z-20">
                        <button
                            onClick={() => onDebug?.(selectedAge, selectedLevel, difficulty)}
                            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 text-red-400 border border-red-500/50 rounded-full hover:bg-red-600/30 backdrop-blur-sm shadow-lg font-bold text-xs"
                        >
                            <Play className="w-4 h-4" /> DEBUG CURRENT
                        </button>
                    </div>
                )}
            </div>

            {/* Right Column: Result Details (Sticky/Fixed) */}
            <div className="h-full overflow-hidden flex flex-col">
                <ResultPanel
                    result={result}
                    onRecalculate={handleRecalculate}
                    isRecalculating={isRecalculating}
                    onShowBattle={() => onDebug?.(selectedAge, selectedLevel, difficulty)}
                />
            </div>
        </div>
    );
}

// Ensure Play icon is imported (it is imported at top)
// import { Play } from 'lucide-react';

// --- DUNGEON VIEW ---

function DungeonView({
    dungeonType,
    simulateDungeon,
    findMaxBeatableDungeon,
    playerStats,
    isDebugMode,
    onDebug,
    debugConfig,
    recalcTrigger
}: {
    dungeonType: 'hammer' | 'skill' | 'egg' | 'potion';
    simulateDungeon: any;
    findMaxBeatableDungeon: any;
    playerStats: any;
    isDebugMode?: boolean;
    onDebug?: (level: number) => void;
    debugConfig?: DebugConfig;
    recalcTrigger?: number;
}) {
    const [selectedLevel, setSelectedLevel] = useState(0); // 0-99
    const [result, setResult] = useState<BattleResult | null>(null);
    const [maxLevel, setMaxLevel] = useState<number>(-1);
    const resultsCache = useRef<Map<string, BattleResult>>(new Map());
    const [levelStatuses, setLevelStatuses] = useState<Map<number, number>>(new Map()); // Level -> Progress %
    const [isSimulating, setIsSimulating] = useState(false);
    const [isRecalculating, setIsRecalculating] = useState(false);

    // Find max level on mount
    // In DungeonView, trova questo useEffect e sostituiscilo:

    // Find max level on mount
    useEffect(() => {
        let isCancelled = false;

        const max = findMaxBeatableDungeon(dungeonType);
        if (!isCancelled) {
            setMaxLevel(max);
            if (max >= 0) {
                setSelectedLevel(max);
            }
        }
    }, [dungeonType, findMaxBeatableDungeon]);

    // Batch calculate progress for all 100 levels with SMART strategy (Sequential for early stop)
    useEffect(() => {
        let isCancelled = false;

        // Reset state on new dungeon type
        setLevelStatuses(new Map());
        setIsSimulating(true);

        const runSimulations = async () => {
            let consecutiveFailures = 0;

            const updateStatus = (lvl: number, prob: number) => {
                setLevelStatuses(prev => {
                    const next = new Map(prev);
                    next.set(lvl, prob);
                    return next;
                });
            };

            for (let l = 0; l < 100; l++) {
                if (isCancelled) break;

                // Early Stop Check
                if (consecutiveFailures >= 3) {
                    // Optionally mark remaining as 0 or just stop
                    break;
                }

                // 1. Easy Check (2 runs)
                const res2 = simulateDungeon(dungeonType, l, 2, debugConfig);
                if (!res2) continue;

                if (res2.winProbability >= 100) {
                    const cacheKey = `${dungeonType}-${l}`;
                    resultsCache.current.set(cacheKey, res2);

                    updateStatus(l, 100);
                    consecutiveFailures = 0;
                    await new Promise(r => setTimeout(r, 0));
                    continue; // Stop, 100%
                }

                // Frontier Logic
                // Step 1: 10 runs
                const res10 = simulateDungeon(dungeonType, l, 10, debugConfig);
                if (res10 && res10.winProbability > 0) {
                    const cacheKey = `${dungeonType}-${l}`;
                    resultsCache.current.set(cacheKey, res10);

                    updateStatus(l, res10.winProbability);
                    consecutiveFailures = 0;
                    await new Promise(r => setTimeout(r, 0));
                    continue;
                }

                // Step 2: 100 runs
                const res100 = simulateDungeon(dungeonType, l, 100, debugConfig);
                if (res100 && res100.winProbability > 0) {
                    const cacheKey = `${dungeonType}-${l}`;
                    resultsCache.current.set(cacheKey, res100);

                    updateStatus(l, res100.winProbability);
                    consecutiveFailures = 0;
                    await new Promise(r => setTimeout(r, 0));
                    continue;
                }

                // Step 3: 1000 runs (Final)
                const res1000 = simulateDungeon(dungeonType, l, 1000, debugConfig);
                if (res1000) {
                    const cacheKey = `${dungeonType}-${l}`;
                    resultsCache.current.set(cacheKey, res1000);

                    updateStatus(l, res1000.winProbability);
                    if (res1000.winProbability <= 0) {
                        consecutiveFailures++;
                    } else {
                        consecutiveFailures = 0;
                    }
                }

                await new Promise(r => setTimeout(r, 0));
            }

            if (!isCancelled) {
                setIsSimulating(false);
            }
        };

        runSimulations();

        runSimulations();

        return () => { isCancelled = true; setIsSimulating(false); };
    }, [dungeonType, simulateDungeon, playerStats, findMaxBeatableDungeon, debugConfig, recalcTrigger]);
    // Simulate selected level
    useEffect(() => {
        if (playerStats) {
            const cacheKey = `${dungeonType}-${selectedLevel}`;
            if (resultsCache.current.has(cacheKey)) {
                setResult(resultsCache.current.get(cacheKey)!);
            } else {
                const simResult = simulateDungeon(dungeonType, selectedLevel, 1, debugConfig);
                if (simResult) {
                    resultsCache.current.set(cacheKey, simResult);
                    setResult(simResult);
                } else {
                    setResult(null);
                }
            }
        }
    }, [dungeonType, selectedLevel, simulateDungeon, playerStats, debugConfig, recalcTrigger]);

    const navigateLevel = (delta: number) => {
        setSelectedLevel(prev => Math.max(0, Math.min(99, prev + delta)));
    };

    const getLevelLabel = (lvl: number) => {
        const world = Math.floor(lvl / 10) + 1;
        const stage = (lvl % 10) + 1;
        return `${world}-${stage}`;
    };

    // Manual recalculation handler
    const handleRecalculate = (runs: number) => {
        setIsRecalculating(true);

        setTimeout(() => {
            const simResult = simulateDungeon(dungeonType, selectedLevel, runs, debugConfig);

            if (simResult) {
                // Update cache
                const cacheKey = `${dungeonType}-${selectedLevel}`;
                resultsCache.current.set(cacheKey, simResult);

                // Update grid status
                setLevelStatuses(prev => {
                    const newMap = new Map(prev);
                    newMap.set(selectedLevel, simResult.winProbability);
                    return newMap;
                });

                // Update result display
                setResult(simResult);
            }

            setIsRecalculating(false);
        }, 50);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
            <div className="lg:col-span-2 card p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-text-primary capitalize">{dungeonType} Dungeon Level</h2>
                        {isDebugMode && (
                            <button
                                onClick={() => onDebug?.(selectedLevel)}
                                className="flex items-center gap-2 px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/30 rounded hover:bg-red-500/20 text-xs font-mono"
                            >
                                <Play className="w-3 h-3" />
                                DEBUG
                            </button>
                        )}
                    </div>
                    {maxLevel >= 0 && (
                        <div className="flex items-center gap-3">
                            {isSimulating && (
                                <div className="flex items-center gap-2 text-[10px] text-accent-primary animate-pulse bg-surface-secondary px-2 py-1 rounded-full border border-accent-primary/20">
                                    <div className="w-2 h-2 rounded-full border-2 border-current border-t-transparent animate-spin" />
                                    Simulating 1,000+ battles...
                                </div>
                            )}
                            <button onClick={() => setSelectedLevel(maxLevel)} className="text-sm text-accent-primary hover:underline flex items-center gap-1">
                                <Target className="w-4 h-4" /> Max: {getLevelLabel(maxLevel)}
                            </button>
                        </div>
                    )}
                </div>

                {/* 10x10 Grid for 100 levels */}
                <div className="space-y-2">
                    {Array.from({ length: 10 }, (_, worldIdx) => (
                        <div key={worldIdx} className="flex gap-2">
                            <div className="flex items-center justify-center w-8 text-xs font-bold text-text-tertiary">
                                {worldIdx + 1}-
                            </div>
                            <div className="flex-1 grid grid-cols-10 gap-1">
                                {Array.from({ length: 10 }, (_, stageIdx) => {
                                    const lvl = worldIdx * 10 + stageIdx;
                                    const isSelected = selectedLevel === lvl;
                                    const isMax = maxLevel === lvl;
                                    const progress = levelStatuses.get(lvl);
                                    const style = getProgressColor(progress ?? -1, isSelected);

                                    return (
                                        <button
                                            key={lvl}
                                            onClick={() => setSelectedLevel(lvl)}
                                            className={`h-8 rounded text-[10px] font-medium transition-all relative flex items-center justify-center
                                                ${style.bg} ${style.text} ${style.border}
                                                ${isSelected ? 'shadow-md ring-2 ring-accent-primary ring-offset-2 ring-offset-surface-secondary' : 'hover:brightness-110'}
                                                ${isMax ? 'ring-2 ring-purple-500 ring-offset-1 ring-offset-surface-secondary z-10' : ''}
                                            `}
                                        >
                                            {stageIdx + 1}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Navigator */}
                <div className="flex items-center justify-center gap-4 mt-6 pt-4 border-t border-border">
                    <button onClick={() => navigateLevel(-1)} disabled={selectedLevel === 0} className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-tertiary disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
                    <div className="text-center min-w-[100px]">
                        <div className="text-3xl font-bold text-text-primary">{getLevelLabel(selectedLevel)}</div>
                        <div className="text-xs text-text-secondary">Stage</div>
                    </div>
                    <button onClick={() => navigateLevel(1)} disabled={selectedLevel >= 99} className="p-2 rounded-lg bg-surface-secondary hover:bg-surface-tertiary disabled:opacity-30"><ChevronRight className="w-5 h-5" /></button>
                </div>
            </div>

            <ResultPanel
                result={result}
                onRecalculate={handleRecalculate}
                isRecalculating={isRecalculating}
                onShowBattle={() => onDebug?.(selectedLevel)}
            />
        </div>
    );
}

function ResultPanel({ result, onRecalculate, isRecalculating, onShowBattle }: {
    result: BattleResult | null;
    onRecalculate?: (runs: number) => void;
    isRecalculating?: boolean;
    onShowBattle?: () => void;
}) {
    const [runCount, setRunCount] = useState(1000);

    if (!result) return <div className="card p-6 text-center text-text-secondary">Level Data Not Found</div>;

    return (
        <div className="space-y-4">
            {/* Win probability */}
            <div className="card p-6">
                <h3 className="text-sm font-medium text-text-secondary mb-4 text-center">Battle Progress</h3>
                <WinProbabilityDisplay
                    probability={result.winProbability}
                    victory={result.victory}
                    totalRuns={result.totalRuns || 100}
                />

                {/* Watch Battle Button */}
                {onShowBattle && (
                    <button
                        onClick={onShowBattle}
                        className="w-full mt-4 py-2.5 rounded-lg text-sm font-bold transition-all bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:brightness-110 flex items-center justify-center gap-2"
                    >
                        <Play className="w-4 h-4" />
                        Watch Battle
                    </button>
                )}

                {/* Manual Recalculation */}
                {onRecalculate && (
                    <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={10}
                                max={100000}
                                step={1000}
                                value={runCount}
                                onChange={(e) => setRunCount(Math.max(10, Math.min(100000, parseInt(e.target.value) || 1000)))}
                                className="flex-1 px-3 py-2 bg-[#1a1a24] border border-gray-700 rounded-lg text-sm text-white text-center font-mono focus:border-accent-primary focus:outline-none"
                                placeholder="Runs"
                            />
                            <button
                                onClick={() => onRecalculate(runCount)}
                                disabled={isRecalculating}
                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${isRecalculating
                                    ? 'bg-surface-tertiary text-text-muted cursor-wait'
                                    : 'bg-accent-primary text-bg-primary hover:brightness-110'
                                    }`}
                            >
                                {isRecalculating ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                        ...
                                    </>
                                ) : (
                                    <>
                                        <Zap className="w-4 h-4" />
                                        Recalc
                                    </>
                                )}
                            </button>
                        </div>
                        <p className="text-[10px] text-text-muted mt-1 text-center">
                            More runs = more accurate (10-100000)
                        </p>
                    </div>
                )}
            </div>

            {/* Wave breakdown */}
            <div className="card p-6">
                <h3 className="text-sm font-medium text-text-secondary mb-4 text-center">
                    Wave Progress ({result.waves.length} waves)
                </h3>
                <WaveBreakdownCompact result={result} />
            </div>

            {/* Combat stats */}
            <div className="card p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        <div>
                            <div className="text-text-secondary text-xs">Battle Time</div>
                            <div className="font-semibold text-text-primary">{result.totalTime.toFixed(1)}s</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Swords className="w-4 h-4 text-accent-primary" />
                        <div>
                            <div className="text-text-secondary text-xs">Your DPS</div>
                            <div className="font-semibold text-text-primary">{formatNumber(result.playerStats.effectiveDps)}</div>
                        </div>
                    </div>


                </div>
            </div>
        </div>
    );
}

// Play imported at top
// import { Play } from 'lucide-react';

export default function ProgressPrediction() {
    const { simulate, simulateDungeon, findMaxBeatable, findMaxBeatableDungeon, playerStats, isLoading, libs, profile, getBattleCountForAge } = useBattleSimulation();
    const [activeTab, setActiveTab] = useState('main');
    const [isDebugMode, setIsDebugMode] = useState(false);
    const [visualizerOpen, setVisualizerOpen] = useState(false);
    const [debugConfig, setDebugConfig] = useState<DebugConfig>({
        skillStartupTimer: 3.2,
        playerStartPos: 2.0,
        fieldWidth: 28,
        enemySpawnDistance: 21,
        enemySpawnDistanceNext: 28,
        playerSpeed: 4.0,
        enemySpeed: 4.0,
        playerRangeMultiplier: 1.0,
        walkingSpeed: 4.0 // Legacy fallback
    });

    // Check localStorage for debug mode
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const debug = localStorage.getItem('debug') === 'true' || searchParams.get('debug') === 'true';
        setIsDebugMode(debug);
    }, []);

    const [recalcVersion, setRecalcVersion] = useState(0);

    const [debugTarget, setDebugTarget] = useState<{ age: number, battle: number, diff: number, dungeon?: string } | null>(null);

    const handleDebugRequest = (age: number, battle: number, diff: number, dungeonType?: string) => {
        setDebugTarget({ age, battle, diff, dungeon: dungeonType });
        setVisualizerOpen(true);
    };

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto flex items-center justify-center h-[60vh]">
                <div className="text-center space-y-4">
                    <div className="animate-spin w-12 h-12 border-4 border-accent-primary border-t-transparent rounded-full mx-auto" />
                    <p className="text-text-secondary">Loading game data...</p>
                </div>
            </div>
        );
    }

    if (!playerStats) {
        return (
            <div className="max-w-7xl mx-auto p-6">
                <div className="card p-8 text-center">
                    <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-text-primary mb-2">Profile Required</h2>
                    <p className="text-text-secondary max-w-md mx-auto">
                        Configure your equipment, pets, and skills in the Profile page to see battle predictions.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-fade-in pb-12 px-4 relative">
            {/* Debug Inputs (Synced with Modal) */}
            {isDebugMode && (
                <div className="px-3 py-2 bg-red-900/10 border-b border-red-500/20 flex flex-wrap gap-4 justify-center items-center text-xs rounded-lg mb-4">
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Skill Start (s):</label>
                        <input
                            type="number"
                            step="0.1"
                            value={debugConfig.skillStartupTimer ?? 3.2}
                            onChange={(e) => setDebugConfig({ ...debugConfig, skillStartupTimer: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Player Start:</label>
                        <input
                            type="number"
                            step="1"
                            value={debugConfig.playerStartPos ?? 2.0}
                            onChange={(e) => setDebugConfig({ ...debugConfig, playerStartPos: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Actual Width:</label>
                        <input
                            type="number"
                            step="1"
                            value={debugConfig.fieldWidth ?? 28}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setDebugConfig({
                                    ...debugConfig,
                                    fieldWidth: val,
                                    enemySpawnDistance: val / 2,
                                    enemySpawnDistanceNext: val
                                });
                            }}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Spawn Dist:</label>
                        <input
                            type="number"
                            step="1"
                            value={debugConfig.enemySpawnDistance ?? 21}
                            onChange={(e) => setDebugConfig({ ...debugConfig, enemySpawnDistance: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Next:</label>
                        <input
                            type="number"
                            step="1"
                            value={debugConfig.enemySpawnDistanceNext ?? 28}
                            onChange={(e) => setDebugConfig({ ...debugConfig, enemySpawnDistanceNext: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">P. Speed:</label>
                        <input
                            type="number"
                            step="0.1"
                            value={debugConfig.playerSpeed ?? 4.0}
                            onChange={(e) => setDebugConfig({ ...debugConfig, playerSpeed: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">E. Speed:</label>
                        <input
                            type="number"
                            step="0.1"
                            value={debugConfig.enemySpeed ?? 4.0}
                            onChange={(e) => setDebugConfig({ ...debugConfig, enemySpeed: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-red-300 font-bold">Range Mul:</label>
                        <input
                            type="number"
                            step="0.1"
                            value={debugConfig.playerRangeMultiplier ?? 1.0}
                            onChange={(e) => setDebugConfig({ ...debugConfig, playerRangeMultiplier: parseFloat(e.target.value) })}
                            className="w-16 bg-black/50 border border-red-500/30 rounded px-1 py-0.5 text-white text-center"
                        />
                    </div>
                </div>
            )}
            {/* Visualizer Modal */}
            {visualizerOpen && debugTarget && (
                <BattleVisualizerModal
                    isOpen={visualizerOpen}
                    onClose={() => setVisualizerOpen(false)}
                    playerStats={playerStats}
                    profile={profile}
                    libs={libs}
                    ageIdx={debugTarget.age}
                    battleIdx={debugTarget.battle}
                    difficultyMode={debugTarget.diff}
                    dungeonType={debugTarget.dungeon}
                    dungeonLevel={debugTarget.battle} // Reuse battleIdx for dungeon level (0-99)
                    debugConfig={debugConfig}
                    onDebugConfigChange={setDebugConfig}
                />
            )}

            {/* Main Header */}
            <div>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent flex items-center gap-3">
                            <TrendingUp className="w-7 h-7 text-accent-primary" />
                            Battle Predictor
                        </h1>
                        <p className="text-text-secondary text-sm mt-1">
                            Your Power: <span className="text-accent-primary font-semibold">{formatNumber(playerStats.power)}</span>
                        </p>
                        <p className="text-text-muted text-xs mt-1 italic">
                            Empirical tool based on observations and uncertain deductions. Predictions may not be 100% accurate.
                        </p>
                    </div>

                    {/* Debug Controls (Global) */}
                    {isDebugMode && (
                        <div className="flex items-center gap-4 bg-red-900/10 border border-red-500/20 rounded-lg p-3">

                            <button
                                onClick={() => setRecalcVersion(v => v + 1)}
                                className="px-3 py-1 bg-red-600/20 text-red-400 border border-red-500/50 rounded hover:bg-red-600/30 font-bold text-xs flex items-center gap-1 ml-2"
                            >
                                <Zap className="w-3 h-3" />
                                Force Recalc
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-border overflow-x-auto">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-3 flex items-center gap-2 font-medium border-b-2 transition-colors whitespace-nowrap
                            ${activeTab === tab.id ? 'border-accent-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}
                        `}
                    >
                        {tab.type === 'sprite' ? (
                            <SpriteIcon name={tab.icon} size={20} />
                        ) : (
                            <img
                                src={`${ICON_PATH}${tab.icon}`}
                                alt={tab.label}
                                className="w-5 h-5 object-contain"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        )}
                        <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Content */}
            {activeTab === 'main' ? (
                <MainBattleView
                    simulate={simulate}
                    findMaxBeatable={findMaxBeatable}
                    playerStats={playerStats}
                    isDebugMode={isDebugMode}
                    onDebug={(age, battle, diff) => handleDebugRequest(age, battle, diff)}
                    getBattleCountForAge={getBattleCountForAge}
                    debugConfig={debugConfig}
                    recalcTrigger={recalcVersion}
                />
            ) : (
                <DungeonView
                    dungeonType={activeTab as any}
                    simulateDungeon={simulateDungeon}
                    findMaxBeatableDungeon={findMaxBeatableDungeon}
                    playerStats={playerStats}
                    isDebugMode={isDebugMode}
                    onDebug={(lvl) => handleDebugRequest(0, lvl, 0, activeTab)}
                    debugConfig={debugConfig}
                    recalcTrigger={recalcVersion}
                />
            )}
        </div>
    );
}
