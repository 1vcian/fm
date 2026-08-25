import { useEffect, useRef, useState } from 'react';
import { PvpBattleEngine, PvpPlayerStats, Projectile } from '../../utils/PvpBattleEngine';
import { useGameDataContext } from '../../context/GameDataContext';
import { SpriteSheetIcon } from '../UI/SpriteSheetIcon';
import { Play, Pause, X, Zap, Heart, Sword, Shield, Clock, RotateCcw } from 'lucide-react';
import { getRarityBgStyle } from '../../lib/utils';
import { useGameData } from '../../hooks/useGameData';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';

const basePath = import.meta.env.BASE_URL;

interface PvpBattleVisualizerProps {
    isOpen: boolean;
    onClose: () => void;
    player1Stats: PvpPlayerStats;
    player2Stats: PvpPlayerStats;
    player1Name?: string;
    player2Name?: string;
}

export function PvpBattleVisualizer({
    isOpen,
    onClose,
    player1Stats,
    player2Stats,
    player1Name = "Player",
    player2Name = "Enemy"
}: PvpBattleVisualizerProps) {
    const { selectedVersion } = useGameDataContext();
    const [engine, setEngine] = useState<PvpBattleEngine | null>(null);
    const [snapshot, setSnapshot] = useState<any>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [battleOutcome, setBattleOutcome] = useState<'playing' | 'player1Win' | 'player2Win' | 'tie'>('playing');
    const [restartKey, setRestartKey] = useState(0);
    const animationFrameRef = useRef<number>();
    const autoPlayRef = useRef(false);

    // Battle Logs
    const [battleLogs, setBattleLogs] = useState<string[]>([]);

    const { data: spriteMapping } = useGameData<any>('ManualSpriteMapping.json');
    const { data: skillsConfig } = useGameData<any>('SkillLibrary.json');

    // Initialization
    useEffect(() => {
        if (!isOpen) return;

        // Reset state
        setBattleOutcome('playing');
        setBattleLogs([]);

        // Create Engine
        const newEngine = new PvpBattleEngine(player1Stats, player2Stats);
        setEngine(newEngine);
        setSnapshot(newEngine.getSnapshot());

        // Handle Auto-Play on Restart
        if (autoPlayRef.current) {
            setIsPlaying(true);
            autoPlayRef.current = false;
        } else {
            setIsPlaying(false);
        }

        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isOpen, player1Stats, player2Stats, restartKey]);

    // Main Loop
    const accumulatorRef = useRef(0);

    useEffect(() => {
        if (!isPlaying || !engine) return;

        let prevTime = performance.now();
        let loopCancelled = false;
        const FIXED_STEP = 1 / 60; // 60 FPS fixed physics step
        const MAX_STEPS = 5; // Max steps per frame to avoid spiral of death

        const loop = (currentTime: number) => {
            if (loopCancelled) return;

            const delta = (currentTime - prevTime) / 1000;
            prevTime = currentTime;

            // Accumulate time scaled by speed
            accumulatorRef.current += delta * speed;

            let steps = 0;
            // Consume accumulator in fixed steps
            while (accumulatorRef.current >= FIXED_STEP && steps < MAX_STEPS) {
                try {
                    (engine as any).tick(FIXED_STEP);
                } catch (e) {
                    console.error("PvpBattleLoop Error:", e);
                    loopCancelled = true;
                    return;
                }
                accumulatorRef.current -= FIXED_STEP;
                steps++;
            }

            // Safety: Discard excess time if we couldn't keep up
            if (accumulatorRef.current > FIXED_STEP * MAX_STEPS) {
                accumulatorRef.current = 0;
            }

            const state = engine.getSnapshot();
            setSnapshot(state);

            // Update logs
            const logs = state.logs || [];
            if (logs.length > 0) {
                const formattedLogs = logs.map((l: any) => `[${l.time.toFixed(1)}s] ${l.event}: ${l.details}`);
                setBattleLogs(formattedLogs);
            }

            // Check End Conditions
            if (state.player1.isDead && state.player2.isDead) {
                setBattleOutcome('tie');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }
            if (state.player1.isDead) {
                setBattleOutcome('player2Win');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }
            if (state.player2.isDead) {
                setBattleOutcome('player1Win');
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }
            if (state.time >= 60.0) {
                // Timeout - determine winner by HP%
                const p1HpPercent = state.player1.health / state.player1.maxHealth;
                const p2HpPercent = state.player2.health / state.player2.maxHealth;
                if (p1HpPercent > p2HpPercent) {
                    setBattleOutcome('player1Win');
                } else if (p2HpPercent > p1HpPercent) {
                    setBattleOutcome('player2Win');
                } else {
                    setBattleOutcome('tie');
                }
                setIsPlaying(false);
                loopCancelled = true;
                return;
            }

            if (!loopCancelled) {
                animationFrameRef.current = requestAnimationFrame(loop);
            }
        };

        animationFrameRef.current = requestAnimationFrame(loop);

        return () => {
            loopCancelled = true;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isPlaying, engine, speed]);

    if (!isOpen || !snapshot) return null;

    const { player1, player2, player1Skills, player2Skills, time, projectiles } = snapshot;

    // --- Visualization Helpers ---
    const VIEWPORT_WIDTH = 20; // PvP field width (player1 at 2, player2 at 18)
    const viewportStart = Math.max(0, Math.min(player1.position, player2.position) - 2);

    const worldToScreen = (worldPos: number): number => {
        const normalized = (worldPos - viewportStart) / VIEWPORT_WIDTH;
        return 5 + normalized * 90;
    };

    const getPlayer1Position = () => worldToScreen(player1.position);
    const getPlayer2Position = () => worldToScreen(player2.position);

    // Format number with dot separators (Italian style: 1.593.590)
    const fmt = (n: number) => Math.round(n).toLocaleString('it-IT');

    const getOutcomeMessage = () => {
        switch (battleOutcome) {
            case 'player1Win': return `${player1Name} WINS!`;
            case 'player2Win': return `${player2Name} WINS!`;
            case 'tie': return 'DRAW!';
            default: return '';
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-[#0d0d11] w-full max-w-4xl max-h-[95vh] rounded-xl border border-gray-800 flex flex-col overflow-hidden shadow-2xl">

                {/* Compact Header */}
                <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-800 bg-[#12121a] flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-base sm:text-lg font-bold text-white whitespace-nowrap overflow-hidden text-clip">PvP Battle</h2>
                        <div className="text-[10px] sm:text-xs text-gray-400 flex gap-2 sm:gap-3 flex-wrap">
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {(time || 0).toFixed(1)}s / 60.0s
                            </span>
                            <span className={player1.combatState === 'FIGHTING' || player2.combatState === 'FIGHTING' ? "text-red-400 font-semibold" : "text-blue-400"}>
                                {player1.combatState === 'FIGHTING' || player2.combatState === 'FIGHTING' ? "⚔️ Combat" : "🏃 Moving"}
                            </span>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                        {/* Speed buttons */}
                        <div className="flex bg-gray-800/50 rounded-lg p-0.5">
                            {[0.25, 0.5, 1, 1.5, 2].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSpeed(s)}
                                    className={`px-1.5 py-1 rounded text-[10px] sm:text-xs font-bold transition-all ${speed === s ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            disabled={battleOutcome !== 'playing'}
                            className={`p-2 rounded-lg transition-all ${battleOutcome !== 'playing'
                                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                                : isPlaying
                                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                }`}
                        >
                            {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5" />}
                        </button>

                        <button
                            onClick={onClose}
                            className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
                        >
                            <X className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>
                </div>

                {/* Battle Outcome Overlay */}
                {battleOutcome !== 'playing' && (
                    <div className={`py-3 text-center font-bold text-lg flex items-center justify-center gap-4 ${battleOutcome === 'player1Win' ? 'bg-green-500/20 text-green-400' :
                        battleOutcome === 'player2Win' ? 'bg-red-500/20 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                        }`}>
                        <span>{getOutcomeMessage()}</span>
                        <button
                            onClick={() => {
                                autoPlayRef.current = true;
                                setRestartKey(k => k + 1);
                            }}
                            className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Restart
                        </button>
                    </div>
                )}

                {/* Battlefield */}
                <div className="flex-1 bg-[#080810] relative overflow-hidden min-h-[200px] sm:min-h-[280px]">
                    {/* Grid background */}
                    <div className="absolute inset-0 opacity-10"
                        style={{
                            backgroundImage: 'linear-gradient(#444 1px, transparent 1px), linear-gradient(90deg, #444 1px, transparent 1px)',
                            backgroundSize: '40px 40px',
                            backgroundPosition: `${-viewportStart * 30}px 0px`,
                        }}>
                    </div>

                    {/* Ground markers */}
                    <div className="absolute bottom-[15%] left-0 h-1 opacity-20"
                        style={{
                            width: '200%',
                            backgroundImage: 'repeating-linear-gradient(90deg, #555 0px, #555 5px, transparent 5px, transparent 100px)',
                            transform: `translateX(${-(viewportStart * 30) % 100}px)`,
                        }}>
                    </div>

                    {/* Center line */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-700/30"></div>

                    {/* Player 1 */}
                    <div
                        className="absolute top-1/2 z-50 flex flex-col items-center"
                        style={{ left: `${getPlayer1Position()}%`, transform: 'translate(-50%, -50%)' }}
                    >
                        {/* Active Buffs Display */}
                        <div className="flex gap-1 mb-1 absolute bottom-full pb-2">
                            {(snapshot.player1ActiveBuffs || []).map((buff: any, idx: number) => {
                                const mapping = spriteMapping?.[buff.skillId];
                                if (!mapping) return null;

                                return (
                                    <div key={`p1-buff-${idx}`} className="relative group">
                                        <div className="w-6 h-6 border border-yellow-500 rounded bg-black/50 overflow-hidden relative">
                                            <SpriteSheetIcon
                                                textureSrc={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${mapping.texture}`}
                                                spriteWidth={mapping.sprite_size.width}
                                                spriteHeight={mapping.sprite_size.height}
                                                sheetWidth={mapping.texture_size.width}
                                                sheetHeight={mapping.texture_size.height}
                                                iconIndex={mapping.index}
                                                className="w-full h-full"
                                            />
                                            <div className={`absolute bottom-0 right-0 text-[6px] font-bold px-0.5 rounded-tl flex items-center justify-center ${buff.bonusMaxHealth > 0 ? 'bg-green-600' : 'bg-red-600'
                                                } text-white`}>
                                                {buff.bonusMaxHealth > 0 ? 'HP' : 'DMG'}
                                            </div>
                                        </div>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-black/90 border border-gray-700 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                                            <div className="font-bold text-yellow-400">{buff.skillId}</div>
                                            {buff.bonusMaxHealth > 0 && <span className="block text-green-400">+{fmt(buff.bonusMaxHealth)} HP</span>}
                                            {buff.bonusDamage > 0 && <span className="block text-red-400">+{fmt(buff.bonusDamage)} DMG</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* HP Text */}
                        <span className="text-[9px] sm:text-[10px] font-mono text-gray-300 mb-1 font-bold drop-shadow-md">
                            {Math.round(player1.health || 0).toLocaleString()} / {Math.round(player1.maxHealth || 0).toLocaleString()}
                        </span>

                        {/* Health Bar */}
                        <div className="w-20 h-2.5 bg-gray-800 rounded-full mb-1 overflow-hidden border border-gray-700 relative">
                            <div
                                className="h-full bg-green-500"
                                style={{ width: `${Math.max(0, Math.min(100, (player1.health || 0) / (player1.maxHealth || 1) * 100))}%` }}
                            />
                        </div>

                        {/* Character Sprite */}
                        <div className={`relative ${player1.combatPhase === 'CHARGING' ? 'scale-110' : 'scale-100'} transition-transform`}>
                            <ProfileIcon
                                iconIndex={0}
                                size={48}
                                className="border-2 border-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.4)] transform scale-x-[-1] rounded-full bg-gray-900"
                            />
                        </div>
                        <div className="mt-1 text-[10px] font-bold text-blue-400 bg-black/60 px-2 rounded">{player1Name}</div>
                    </div>

                    {/* Player 2 */}
                    <div
                        className="absolute top-1/2 z-50 flex flex-col items-center"
                        style={{ left: `${getPlayer2Position()}%`, transform: 'translate(-50%, -50%)' }}
                    >
                        {/* Active Buffs Display */}
                        <div className="flex gap-1 mb-1 absolute bottom-full pb-2">
                            {(snapshot.player2ActiveBuffs || []).map((buff: any, idx: number) => {
                                const mapping = spriteMapping?.[buff.skillId];
                                if (!mapping) return null;

                                return (
                                    <div key={`p2-buff-${idx}`} className="relative group">
                                        <div className="w-6 h-6 border border-yellow-500 rounded bg-black/50 overflow-hidden relative">
                                            <SpriteSheetIcon
                                                textureSrc={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${mapping.texture}`}
                                                spriteWidth={mapping.sprite_size.width}
                                                spriteHeight={mapping.sprite_size.height}
                                                sheetWidth={mapping.texture_size.width}
                                                sheetHeight={mapping.texture_size.height}
                                                iconIndex={mapping.index}
                                                className="w-full h-full"
                                            />
                                            <div className={`absolute bottom-0 right-0 text-[6px] font-bold px-0.5 rounded-tl flex items-center justify-center ${buff.bonusMaxHealth > 0 ? 'bg-green-600' : 'bg-red-600'
                                                } text-white`}>
                                                {buff.bonusMaxHealth > 0 ? 'HP' : 'DMG'}
                                            </div>
                                        </div>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-black/90 border border-gray-700 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                                            <div className="font-bold text-yellow-400">{buff.skillId}</div>
                                            {buff.bonusMaxHealth > 0 && <span className="block text-green-400">+{fmt(buff.bonusMaxHealth)} HP</span>}
                                            {buff.bonusDamage > 0 && <span className="block text-red-400">+{fmt(buff.bonusDamage)} DMG</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* HP Text */}
                        <span className="text-[9px] sm:text-[10px] font-mono text-gray-300 mb-1 font-bold drop-shadow-md">
                            {Math.round(player2.health || 0).toLocaleString()} / {Math.round(player2.maxHealth || 0).toLocaleString()}
                        </span>

                        {/* Health Bar */}
                        <div className="w-20 h-2.5 bg-gray-800 rounded-full mb-1 overflow-hidden border border-gray-700 relative">
                            <div
                                className="h-full bg-red-500"
                                style={{ width: `${Math.max(0, Math.min(100, (player2.health || 0) / (player2.maxHealth || 1) * 100))}%` }}
                            />
                        </div>

                        {/* Character Sprite */}
                        <div className={`relative ${player2.combatPhase === 'CHARGING' ? 'scale-110' : 'scale-100'} transition-transform`}>
                            <ProfileIcon
                                iconIndex={0}
                                size={48}
                                className="border-2 border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)] rounded-full bg-gray-900"
                            />
                        </div>
                        <div className="mt-1 text-[10px] font-bold text-red-400 bg-black/60 px-2 rounded">{player2Name}</div>
                    </div>

                    {/* Projectiles */}
                    {(projectiles || []).map((proj: Projectile) => {
                        const posPercent = worldToScreen(proj.currentX);
                        const staggerX = (proj.id % 2) * (proj.isPlayer1Source ? -3.0 : 3.0);

                        return (
                            <div
                                key={proj.id}
                                className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-20 ${!proj.isPlayer1Source ? 'flex-row-reverse' : ''}`}
                                style={{
                                    left: `calc(${posPercent}% + ${staggerX}%)`,
                                    transform: `translateX(-50%) translateY(-50%)`
                                }}
                            >
                                <div className={`w-2 h-1 rounded-full opacity-50 ${proj.isPlayer1Source ? 'bg-yellow-300' : 'bg-red-400'}`} />
                                <div className={`w-3 h-1.5 rounded-full opacity-70 ${proj.isPlayer1Source ? 'bg-yellow-400' : 'bg-red-500'}`} />
                                <div className={`w-4 h-4 rounded-full ${proj.isPlayer1Source
                                    ? 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,1)]'
                                    : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,1)]'
                                    }`} />
                            </div>
                        );
                    })}
                </div>

                {/* Bottom Stats & Skills */}
                <div className="border-t border-gray-800 bg-[#0a0a10]">
                    {/* Stats Bar - Two Columns for Two Players */}
                    <div className="px-3 py-2 border-b border-gray-800/50">
                        <div className="grid grid-cols-2 gap-4">
                            {/* Player 1 Stats */}
                            <div>
                                <div className="text-[10px] text-blue-400 font-bold mb-2">{player1Name}</div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" /> Crit %</div>
                                        <div className="text-xs font-bold text-yellow-400">{(player1.critChance * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-red-500" /> Crit Dmg</div>
                                        <div className="text-xs font-bold text-red-400">x{player1.critMulti.toFixed(1)}</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-500" /> Double</div>
                                        <div className="text-xs font-bold text-orange-400">{(player1.doubleDamage * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3 text-blue-300" /> Atk Spd</div>
                                        <div className="text-xs font-bold text-blue-300">x{player1.attackSpeed.toFixed(2)}</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Shield className="w-3 h-3 text-blue-500" /> Block</div>
                                        <div className="text-xs font-bold text-blue-400">{(player1.blockChance * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Heart className="w-3 h-3 text-pink-500" /> Steal</div>
                                        <div className="text-xs font-bold text-pink-400">{(player1.lifesteal * 100).toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>

                            {/* Player 2 Stats */}
                            <div>
                                <div className="text-[10px] text-red-400 font-bold mb-2">{player2Name}</div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" /> Crit %</div>
                                        <div className="text-xs font-bold text-yellow-400">{(player2.critChance * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3 text-red-500" /> Crit Dmg</div>
                                        <div className="text-xs font-bold text-red-400">x{player2.critMulti.toFixed(1)}</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Sword className="w-3 h-3 text-orange-500" /> Double</div>
                                        <div className="text-xs font-bold text-orange-400">{(player2.doubleDamage * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3 text-blue-300" /> Atk Spd</div>
                                        <div className="text-xs font-bold text-blue-300">x{player2.attackSpeed.toFixed(2)}</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Shield className="w-3 h-3 text-blue-500" /> Block</div>
                                        <div className="text-xs font-bold text-blue-400">{(player2.blockChance * 100).toFixed(0)}%</div>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <div className="text-[10px] text-gray-500 flex items-center gap-1"><Heart className="w-3 h-3 text-pink-500" /> Steal</div>
                                        <div className="text-xs font-bold text-pink-400">{(player2.lifesteal * 100).toFixed(1)}%</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Skills - Two Rows for Two Players */}
                    <div className="px-3 py-2 border-b border-gray-800/50">
                        {/* Player 1 Skills */}
                        {player1Skills.length > 0 && (
                            <div className="mb-3">
                                <div className="text-[10px] text-blue-400 font-bold mb-2">{player1Name} Skills</div>
                                <div className="flex gap-2 justify-center flex-wrap">
                                    {player1Skills.map((skill: any, idx: number) => {
                                        const isActive = skill.state === 'Active';
                                        const isCooldown = skill.state === 'Cooldown';

                                        const spriteMap = spriteMapping?.skills;
                                        const spriteEntry = spriteMap?.mapping
                                            ? Object.entries(spriteMap.mapping).find(([_, info]: [string, any]) => info.name === skill.id)
                                            : null;
                                        const spriteIndex = spriteEntry ? parseInt(spriteEntry[0]) : -1;

                                        const libSkill = skillsConfig ? skillsConfig[skill.id] : null;
                                        const rarity = libSkill?.Rarity || 'Common';

                                        return (
                                            <div
                                                key={`p1-skill-${idx}`}
                                                className={`relative w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center border-2 transition-all overflow-hidden ${isActive ? 'border-green-500 bg-green-900/30' :
                                                    isCooldown ? 'border-gray-700 bg-gray-900 opacity-60' :
                                                        'border-gray-600 bg-gray-800'
                                                    }`}
                                                title={skill.id}
                                                style={getRarityBgStyle(rarity)}
                                            >
                                                {(spriteIndex >= 0 && spriteMapping) ? (
                                                    <SpriteSheetIcon
                                                        textureSrc={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}SkillIcons.png`}
                                                        spriteWidth={spriteMapping.skills.sprite_size.width}
                                                        spriteHeight={spriteMapping.skills.sprite_size.height}
                                                        sheetWidth={spriteMapping.skills.texture_size.width}
                                                        sheetHeight={spriteMapping.skills.texture_size.height}
                                                        iconIndex={spriteIndex}
                                                        className="w-full h-full"
                                                    />
                                                ) : (
                                                    <span className="text-[10px] text-gray-400 font-bold">{skill.id.substring(0, 3)}</span>
                                                )}
                                                {isCooldown && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-lg">
                                                        <span className="text-sm font-bold text-white">{Math.ceil(skill.timer)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Player 2 Skills */}
                        {player2Skills.length > 0 && (
                            <div>
                                <div className="text-[10px] text-red-400 font-bold mb-2">{player2Name} Skills</div>
                                <div className="flex gap-2 justify-center flex-wrap">
                                    {player2Skills.map((skill: any, idx: number) => {
                                        const isActive = skill.state === 'Active';
                                        const isCooldown = skill.state === 'Cooldown';

                                        const spriteMap = spriteMapping?.skills;
                                        const spriteEntry = spriteMap?.mapping
                                            ? Object.entries(spriteMap.mapping).find(([_, info]: [string, any]) => info.name === skill.id)
                                            : null;
                                        const spriteIndex = spriteEntry ? parseInt(spriteEntry[0]) : -1;

                                        const libSkill = skillsConfig ? skillsConfig[skill.id] : null;
                                        const rarity = libSkill?.Rarity || 'Common';

                                        return (
                                            <div
                                                key={`p2-skill-${idx}`}
                                                className={`relative w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center border-2 transition-all overflow-hidden ${isActive ? 'border-green-500 bg-green-900/30' :
                                                    isCooldown ? 'border-gray-700 bg-gray-900 opacity-60' :
                                                        'border-gray-600 bg-gray-800'
                                                    }`}
                                                title={skill.id}
                                                style={getRarityBgStyle(rarity)}
                                            >
                                                {(spriteIndex >= 0 && spriteMapping) ? (
                                                    <SpriteSheetIcon
                                                        textureSrc={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}SkillIcons.png`}
                                                        spriteWidth={spriteMapping.skills.sprite_size.width}
                                                        spriteHeight={spriteMapping.skills.sprite_size.height}
                                                        sheetWidth={spriteMapping.skills.texture_size.width}
                                                        sheetHeight={spriteMapping.skills.texture_size.height}
                                                        iconIndex={spriteIndex}
                                                        className="w-full h-full"
                                                    />
                                                ) : (
                                                    <span className="text-[10px] text-gray-400 font-bold">{skill.id.substring(0, 3)}</span>
                                                )}
                                                {isCooldown && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-lg">
                                                        <span className="text-sm font-bold text-white">{Math.ceil(skill.timer)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Compact Log */}
                    <div className="max-h-32 sm:max-h-40 overflow-y-auto px-3 py-2 border-t border-gray-800/50 flex flex-col-reverse">
                        {battleLogs.length === 0 ? (
                            <p className="text-[10px] text-gray-600 italic text-center">Press play to start battle</p>
                        ) : (
                            <div className="space-y-0.5">
                                {battleLogs.map((log, i) => (
                                    <div key={i} className="text-[10px] text-gray-400 font-mono whitespace-nowrap overflow-hidden text-clip">{log}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
