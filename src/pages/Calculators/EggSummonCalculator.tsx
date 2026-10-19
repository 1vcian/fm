import { useState } from 'react';
import { useEggSummonCalculator } from '../../hooks/useEggSummonCalculator';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/UI/Card';
import { Calculator, Plus, Info, Minus, RefreshCcw } from 'lucide-react';
import { useProfile } from '../../context/ProfileContext';
import { SpriteIcon } from '../../components/UI/SpriteIcon';
import { useGameDataContext } from '../../context/GameDataContext';
import { EggIcon } from '../../components/UI/EggIcon';

/**
 * Eggshell summon calculator: the Eggs tab of the Summons calculator. Moved out of the Eggs page,
 * which now links here; the simulation is the shared summon engine (src/utils/summonEngine.ts).
 */
export default function EggSummonCalculator() {
    const { profile, updateNestedProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const eggSummon = useEggSummonCalculator();

    // Target Calculator State
    // Defaults to the top level of EggSummonConfig.Levels until the player picks one.
    const [pickedTargetLevel, setTargetLevel] = useState<number | null>(null);
    const targetLevel = pickedTargetLevel ?? eggSummon.maxPossibleLevel;
    // Defaults to the last ascension in AscensionConfigsLibrary until the player picks one.
    const [pickedTargetAscension, setTargetAscension] = useState<number | null>(null);
    const targetAscension = pickedTargetAscension ?? eggSummon.maxAscension;

    if (eggSummon.loading) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                <RefreshCcw className="w-8 h-8 opacity-50 animate-spin" />
                <p>Loading game data</p>
            </div>
        );
    }

    if (!eggSummon.available || !eggSummon.ready) {
        return (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                <Info className="w-8 h-8 opacity-50" />
                <p>Eggshell summons are not available in this game data version.</p>
            </div>
        );
    }

    return (
            <div className="space-y-6">
                {/* Tech Status Tag (Consistent with Mount Calculator) */}
                <div className="flex justify-center gap-3 text-xs -mt-2 mb-4">
                    {eggSummon.techBonuses.costReduction > 0 && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                            <span className="text-text-muted uppercase font-bold">Cost Red.:</span>
                            <span className="text-accent-primary font-bold">-{Math.round(eggSummon.techBonuses.costReduction * 100)}%</span>
                        </div>
                    )}
                    {eggSummon.techBonuses.extraChance > 0 && (
                        <div className="flex items-center gap-2 bg-bg-secondary/50 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
                            <span className="text-text-muted uppercase font-bold">Extra Eggs:</span>
                            <span className="text-accent-secondary font-bold">x{(1 + eggSummon.techBonuses.extraChance).toFixed(2)}</span>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* CONFIGURATION */}
                    <Card className="p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <SpriteIcon name="Timer" size={20} className="text-text-tertiary" />
                                Configuration
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            {/* Level & Progress */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-3 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                                    <label className="text-[10px] font-bold text-text-secondary uppercase">Current Level</label>
                                    <div className="flex items-center justify-between gap-2">
                                        <button
                                            onClick={() => eggSummon.setLevel(Math.max(1, eggSummon.level - 1))}
                                            className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                            disabled={eggSummon.level <= 1}
                                        >
                                            <Minus className="w-3 h-3 text-text-primary" />
                                        </button>
                                        <input
                                            type="number"
                                            min="1"
                                            max={eggSummon.maxPossibleLevel}
                                            value={eggSummon.level}
                                            onChange={(e) => eggSummon.setLevel(Math.max(1, Math.min(eggSummon.maxPossibleLevel, Number(e.target.value))))}
                                            className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                        />
                                        <button
                                            onClick={() => eggSummon.setLevel(Math.min(eggSummon.maxPossibleLevel, eggSummon.level + 1))}
                                            className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                            disabled={eggSummon.level >= eggSummon.maxPossibleLevel}
                                        >
                                            <Plus className="w-3 h-3 text-text-primary" />
                                        </button>
                                    </div>
                                    <div className="text-[10px] text-text-muted text-center font-mono opacity-50">Max: {eggSummon.maxPossibleLevel}</div>
                                </div>
                                <div className="space-y-3 bg-bg-primary/30 p-4 rounded-xl border border-white/5">
                                    <label className="text-[10px] font-bold text-text-secondary uppercase">Current Progress</label>
                                    <div className="flex items-center justify-between gap-2">
                                        <button
                                            onClick={() => eggSummon.setProgress(Math.max(0, eggSummon.progress - 1))}
                                            className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                            disabled={eggSummon.progress <= 0 || eggSummon.level >= eggSummon.maxPossibleLevel}
                                        >
                                            <Minus className="w-3 h-3 text-text-primary" />
                                        </button>
                                        <div className="flex-1 text-center">
                                            {eggSummon.level >= eggSummon.maxPossibleLevel ? (
                                                <span className="text-2xl font-black text-amber-500">MAX</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={eggSummon.progress}
                                                    onChange={(e) => eggSummon.setProgress(Number(e.target.value))}
                                                    className="w-full bg-transparent text-2xl font-black text-white outline-none text-center"
                                                />
                                            )}
                                        </div>
                                        <button
                                            onClick={() => eggSummon.setProgress(eggSummon.progress + 1)}
                                            className="p-1.5 bg-bg-tertiary rounded hover:bg-bg-input transition-colors disabled:opacity-30 flex items-center justify-center shrink-0 w-8 h-8"
                                            disabled={eggSummon.level >= eggSummon.maxPossibleLevel}
                                        >
                                            <Plus className="w-3 h-3 text-text-primary" />
                                        </button>
                                    </div>
                                    <div className="text-[10px] text-text-muted text-center font-mono opacity-50">
                                        Next: {eggSummon.level >= eggSummon.maxPossibleLevel ? 'MAX' : (eggSummon.levels[eggSummon.level]?.SummonsRequired?.toLocaleString() || '?')}
                                    </div>
                                </div>
                            </div>

                            {/* Currency Input */}
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-text-secondary uppercase flex items-center gap-2">
                                        <SpriteIcon name="Eggshell" size={16} />
                                        Available {eggSummon.currency}
                                    </label>
                                    <div className="relative group">
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-primary transition-colors">
                                            <SpriteIcon name="Eggshell" size={20} />
                                        </div>
                                        <input
                                            type="number"
                                            value={eggSummon.eggshellCount}
                                            onChange={(e) => eggSummon.setEggshellCount(Number(e.target.value))}
                                            className="w-full bg-bg-input border border-border rounded-xl py-4 pl-12 pr-4 text-white font-mono text-xl font-bold focus:border-accent-primary outline-none transition-colors"
                                            placeholder="0"
                                            min="0"
                                        />
                                    </div>
                                    <div className="text-[10px] text-text-muted px-1">
                                        Estimated cost per summon: <span className="text-accent-primary font-bold">{eggSummon.finalCostPerSummon}</span> 🥚
                                    </div>
                                </div>

                                {/* Target Calculator */}
                                <div className="p-4 bg-bg-primary/30 rounded-xl border border-white/5 space-y-4">
                                    <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase">
                                        <Calculator className="w-4 h-4 text-accent-primary" />
                                        Target Goal Calculator
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-text-muted uppercase font-bold">Target Ascension</label>
                                            <select
                                                value={targetAscension}
                                                onChange={(e) => setTargetAscension(Number(e.target.value))}
                                                className="w-full bg-bg-input border border-border rounded-lg p-2 text-xs font-bold outline-none focus:border-accent-primary transition-colors cursor-pointer"
                                            >
                                                {Array.from({ length: eggSummon.maxAscension + 1 }, (_, a) => a).map(a => (
                                                    <option key={a} value={a}>Ascension {a}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] text-text-muted uppercase font-bold">Target Level</label>
                                            <select
                                                value={targetLevel}
                                                onChange={(e) => setTargetLevel(Number(e.target.value))}
                                                className="w-full bg-bg-input border border-border rounded-lg p-2 text-xs font-bold outline-none focus:border-accent-primary transition-colors cursor-pointer"
                                            >
                                                {Array.from({ length: eggSummon.maxPossibleLevel }, (_, i) => i + 1).map(lv => {
                                                    const config = eggSummon.levels[lv - 1];
                                                    const rarities = ['Mythic', 'Ultimate', 'Legendary', 'Epic', 'Rare', 'Common'];
                                                    const maxRarity = config ? (rarities.find(r => config[r] > 0) || 'Common') : 'Common';
                                                    const val = config ? (config[maxRarity] * 100) : 0;
                                                    const percentage = val < 0.1 ? val.toFixed(2) : val.toFixed(1);
                                                    return (
                                                        <option key={lv} value={lv}>
                                                            Level {lv} ({maxRarity} {percentage}%)
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                                        <div className="text-[10px] text-text-muted">
                                            Required: <span className="text-white font-bold">{eggSummon.calculateNeededCurrency(targetLevel, targetAscension).toLocaleString()}</span> {eggSummon.currency}
                                        </div>
                                        <button
                                            onClick={() => eggSummon.setEggshellCount(eggSummon.calculateNeededCurrency(targetLevel, targetAscension))}
                                            className="text-[10px] bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary px-3 py-1 rounded border border-accent-primary/30 transition-colors font-bold uppercase active:scale-95"
                                        >
                                            Set as Available
                                        </button>
                                    </div>
                                </div>

                                {/* Ascension Toggle */}
                                <div className="p-4 bg-bg-primary/30 rounded-xl border border-white/5 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase">
                                            <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}AscensionStar.png`} alt="Star" className="w-4 h-4 object-contain" />
                                            Simulate Ascension
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={profile.misc.simulateAscensionInCalculators}
                                                onChange={(e) => updateNestedProfile('misc', { simulateAscensionInCalculators: e.target.checked })}
                                            />
                                            <div className="w-11 h-6 bg-bg-input peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-text-muted leading-relaxed">
                                        When ON, reaching max level resets it to 1 of the next tier. When OFF, extra eggshells progress only the max level.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* RESULTS */}
                    <Card className="h-full p-6 bg-gradient-to-r from-bg-secondary via-bg-secondary/80 to-bg-secondary border-accent-primary/20 relative overflow-hidden">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-accent-primary">
                                <RefreshCcw className="w-5 h-5" />
                                Simulation Results
                            </CardTitle>
                        </CardHeader>

                        <CardContent className="space-y-6 relative z-10">
                            {eggSummon.results && eggSummon.results.totalSummons > 0 ? (
                                <>
                                    {eggSummon.results.summonsToMax && (
                                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                                                <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}AscensionStar.png`} alt="Star" className="w-6 h-6 object-contain" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-xs font-bold text-amber-400 uppercase">Max Level Milestone</div>
                                                <div className="text-[11px] text-text-secondary leading-relaxed">
                                                    You reach <span className="text-white font-bold">Max Level</span> in <span className="text-amber-400 font-bold">{eggSummon.results.summonsToMax.toLocaleString()} summons</span> ({(eggSummon.results.summonsToMax * eggSummon.results.finalCost).toLocaleString()} shells).
                                                    The remaining <span className="text-white font-bold">{((eggSummon.results.totalSummons - eggSummon.results.summonsToMax) * eggSummon.results.finalCost).toLocaleString()}</span> shells progress
                                                    into <span className="text-amber-400 font-bold">{eggSummon.results.simulateAscension ? `Ascension ${eggSummon.results.endAscensionLevel}` : 'Max Level'}</span>.
                                                </div>
                                            </div>
                                        </div>
                                    )}


                                    {/* Summons Info Grid */}
                                    <div className="grid grid-cols-3 gap-3 pb-2 border-b border-white/5">
                                        <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                            <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Summons</div>
                                            <div className="text-lg font-mono font-bold text-white">
                                                {eggSummon.results.totalSummons.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                            <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">End Level</div>
                                            <div className="text-lg font-mono font-bold text-accent-primary flex flex-col justify-center">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs opacity-50 font-normal">Lv.{eggSummon.level} ➔</span>
                                                    Lv.{eggSummon.results.endLevel}
                                                </div>
                                                {eggSummon.results.endAscensionLevel > (profile.misc.petAscensionLevel || 0) && (
                                                    <div className="text-[10px] text-amber-500 font-bold">
                                                        (Ascension {eggSummon.results.endAscensionLevel})
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="bg-bg-tertiary/50 p-3 rounded-lg border border-white/5">
                                            <div className="text-[10px] text-text-muted uppercase font-bold mb-0.5">Price</div>
                                            <div className="text-lg font-mono font-bold text-green-400 flex items-baseline gap-1">
                                                {eggSummon.results.finalCost}
                                                {eggSummon.results.costReduction > 0 && (
                                                    <span className="text-[10px] text-text-muted line-through font-normal decoration-white/30">
                                                        {eggSummon.results.baseCost}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Rarity Breakdown */}
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-xs font-bold text-text-secondary uppercase border-b border-white/5 pb-2">
                                            <span>Rarity</span>
                                            <span>Expected Eggs</span>
                                        </div>
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                            {eggSummon.results.breakdown.map((item) => (
                                                <div key={item.rarity} className="flex justify-between items-center p-2 rounded bg-bg-tertiary/50 border border-white/5 hover:bg-bg-tertiary transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        <EggIcon
                                                            rarity={item.rarity}
                                                            size={24}
                                                            ascensionLevel={profile.misc.petAscensionLevel || 0}
                                                            className="shrink-0"
                                                        />
                                                        <span className="text-sm font-medium text-white">{item.rarity}</span>
                                                        <span className="text-xs text-text-muted">({item.percentage.toFixed(2)}%)</span>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span className="font-mono font-bold text-accent-primary leading-none">
                                                            {item.count.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                                        </span>

                                                        {eggSummon.results?.simulateAscension && eggSummon.results?.phases && eggSummon.results?.phases.length > 1 && (
                                                            <div className="flex flex-wrap gap-1 justify-end max-w-[150px] mt-1">
                                                                {(item.phaseCounts || []).map((p, pIdx) => (
                                                                    <div key={pIdx} className={`px-1 rounded border ${p.ascension > 0 ? 'bg-amber-500/5 border-amber-500/10' : 'bg-white/5 border-white/5'}`}>
                                                                        <div className="flex items-center gap-0.5 text-[8px] font-mono leading-tight">
                                                                            <span className={p.ascension > 0 ? 'text-amber-500/80 font-bold' : 'text-text-muted'}>
                                                                                {p.ascension === 0 ? 'N' : `A${p.ascension}`}:
                                                                            </span>
                                                                            <span className="text-white/90">{p.count.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => eggSummon.applyResultsToProfile()}
                                        className="w-full py-3 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 rounded-xl text-accent-primary font-bold text-sm transition-all flex items-center justify-center gap-2 group shadow-lg shadow-accent-primary/5 active:scale-95"
                                    >
                                        <RefreshCcw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                                        Update Level to Lv.{eggSummon.results.endLevel}{eggSummon.results.endAscensionLevel > (profile.misc.petAscensionLevel || 0) ? ` (Asc. ${eggSummon.results.endAscensionLevel})` : ''}
                                    </button>
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2">
                                    <Info className="w-8 h-8 opacity-50" />
                                    <p>Enter eggshells to see results</p>
                                </div>
                            )}
                        </CardContent>

                        <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                            <SpriteIcon name="Eggshell" size={256} className="text-accent-primary" />
                        </div>
                    </Card>
                </div>
            </div>
    );
}
