import { memo } from 'react';

interface BreakpointTablesProps {
    weaponAttackDuration: number;
    weaponWindupTime: number;
    currentAttackSpeedMultiplier: number; // e.g. 1.5
    realCycleTime?: number;
    realWindup?: number;
}

export const BreakpointTables = memo(({
    weaponAttackDuration,
    weaponWindupTime,
    currentAttackSpeedMultiplier,
    realCycleTime: providedRealCycleTime,
    realWindup: providedRealWindup
}: BreakpointTablesProps) => {
    const currentBonus = (currentAttackSpeedMultiplier - 1) * 100;

    // Calculate current real-time values if not provided
    const realCycleTime = providedRealCycleTime !== undefined ? providedRealCycleTime : (() => {
        const steppedW = Math.floor((weaponWindupTime / currentAttackSpeedMultiplier) * 10) / 10;
        const steppedR = Math.floor((Math.max(0, weaponAttackDuration - weaponWindupTime) / currentAttackSpeedMultiplier) * 10) / 10;
        return Math.max(0.4, steppedW + steppedR + 0.2);
    })();

    const realWindup = providedRealWindup !== undefined ? providedRealWindup : (Math.floor((weaponWindupTime / currentAttackSpeedMultiplier) * 10) / 10);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Primary Cycle Table */}
            <div className="space-y-4">
                <div className="text-[9px] uppercase text-orange-400/60 font-bold tracking-wider">Primary Weapon Cycle</div>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left font-mono text-[10px] md:text-xs">
                        <thead>
                            <tr className="text-white/30 uppercase text-[9px]">
                                <th className="pb-2 font-sans font-bold">Target Cycle</th>
                                <th className="pb-2 font-sans font-bold">Req. Speed</th>
                                <th className="pb-2 font-sans font-bold text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {[1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4]
                                .filter(target => target <= weaponAttackDuration + 0.201)
                                .map(target => {
                                    let reqBonus = 0;
                                    const baseW = weaponWindupTime || 0.5;
                                    const baseR = Math.max(0, weaponAttackDuration - baseW);
                                    const targetPhases = target - 0.2;

                                    let low = 1.0, high = 15.0;
                                    for (let i = 0; i < 20; i++) {
                                        const mid = (low + high) / 2;
                                        const sum = Math.floor((baseW / mid) * 10) / 10 + Math.floor((baseR / mid) * 10) / 10;
                                        if (sum <= targetPhases + 0.001) high = mid;
                                        else low = mid;
                                    }
                                    reqBonus = (high - 1) * 100;
                                    const isReached = currentBonus >= reqBonus - 0.01;
                                    const isNext = !isReached && (target >= realCycleTime - 0.11);

                                    return (
                                        <tr key={target} className={`group ${isReached ? 'text-green-400/80' : isNext ? 'text-orange-400 bg-orange-400/5' : 'text-white/40'}`}>
                                            <td className="py-2.5 font-bold">
                                                {target.toFixed(1)}s
                                                {Math.abs(target - realCycleTime) < 0.01 && <span className="text-[8px] bg-orange-500/20 px-1 rounded uppercase font-sans text-orange-400 ml-1">Current</span>}
                                            </td>
                                            <td className="py-2.5">+{reqBonus.toFixed(1)}%</td>
                                            <td className="py-2.5 text-right font-bold text-[9px]">{isReached ? 'REACHED' : `+${(reqBonus - currentBonus).toFixed(1)}%`}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Rhythmic Windup Table */}
            <div className="space-y-4">
                <div className="text-[9px] uppercase text-blue-400/60 font-bold tracking-wider">Rhythmic Windup Steps</div>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left font-mono text-[10px] md:text-xs">
                        <thead>
                            <tr className="text-white/30 uppercase text-[9px]">
                                <th className="pb-2 font-sans font-bold">Windup Step</th>
                                <th className="pb-2 font-sans font-bold">Req. Speed</th>
                                <th className="pb-2 font-sans font-bold text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {[0.5, 0.4, 0.3, 0.2, 0.1]
                                .filter(target => target <= weaponWindupTime + 0.001)
                                .map(target => {
                                    let reqBonus = 0;
                                    const baseW = weaponWindupTime;
                                    let low = 1.0, high = 15.0;
                                    for (let i = 0; i < 20; i++) {
                                        const mid = (low + high) / 2;
                                        const stepped = Math.floor((baseW / mid) * 10) / 10;
                                        if (stepped <= target + 0.001) high = mid;
                                        else low = mid;
                                    }
                                    reqBonus = (high - 1) * 100;
                                    const isReached = currentBonus >= reqBonus - 0.01;
                                    const isNext = !isReached && (target >= realWindup - 0.11);

                                    return (
                                        <tr key={target} className={`group ${isReached ? 'text-green-400/80' : isNext ? 'text-orange-400 bg-orange-400/5' : 'text-white/40'}`}>
                                            <td className="py-2.5 font-bold">
                                                {target.toFixed(1)}s
                                                {Math.abs(target - realWindup) < 0.01 && <span className="text-[8px] bg-orange-500/20 px-1 rounded uppercase font-sans text-orange-400 ml-1">Current</span>}
                                                {target === 0.3 && <span className="ml-1 text-[7px] text-blue-400 font-sans uppercase">Meta</span>}
                                            </td>
                                            <td className="py-2.5">+{reqBonus.toFixed(1)}%</td>
                                            <td className="py-2.5 text-right font-bold text-[9px]">{isReached ? 'REACHED' : `+${(reqBonus - currentBonus).toFixed(1)}%`}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Double Attack Cycle Table (The "Second Table") */}
            <div className="space-y-4 lg:col-span-2 border-t border-white/5 pt-6">
                <div className="text-[9px] uppercase text-purple-400/60 font-bold tracking-wider">Double Attack Cycle Breakpoints </div>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left font-mono text-[10px] md:text-xs">
                        <thead>
                            <tr className="text-white/30 uppercase text-[9px]">
                                <th className="pb-2 font-sans font-bold">Target Double Cycle</th>
                                <th className="pb-2 font-sans font-bold">Req. Speed</th>
                                <th className="pb-2 font-sans font-bold text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {[2.0, 1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.6]
                                .filter(target => target <= weaponAttackDuration + 0.5)
                                .map(target => {
                                    let reqBonus = 0;
                                    const baseW = weaponWindupTime || 0.5;
                                    const baseR = Math.max(0, weaponAttackDuration - baseW);
                                    const baseD = 0.25; // Sequential delay base
                                    const targetPhases = target - 0.2;

                                    let low = 1.0, high = 15.0;
                                    for (let i = 0; i < 25; i++) {
                                        const mid = (low + high) / 2;
                                        const sum = Math.floor((baseW / mid) * 10) / 10 +
                                            Math.floor((baseR / mid) * 10) / 10 +
                                            Math.floor((baseD / mid) * 10) / 10;
                                        if (sum <= targetPhases + 0.001) high = mid;
                                        else low = mid;
                                    }
                                    reqBonus = (high - 1) * 100;

                                    // Current state
                                    const currentDDelay = Math.floor((0.25 / currentAttackSpeedMultiplier) * 10) / 10;
                                    const currentDoubleCycle = realCycleTime + currentDDelay;

                                    const isReached = currentBonus >= reqBonus - 0.01;
                                    const isNext = !isReached && (target >= currentDoubleCycle - 0.11);

                                    return (
                                        <tr key={target} className={`group ${isReached ? 'text-green-400/80' : isNext ? 'text-purple-400 bg-purple-400/5' : 'text-white/40'}`}>
                                            <td className="py-2.5 font-bold">
                                                {target.toFixed(1)}s
                                                {Math.abs(target - currentDoubleCycle) < 0.01 && <span className="text-[8px] bg-purple-500/20 px-1 rounded uppercase font-sans text-purple-400 ml-1">Current</span>}
                                            </td>
                                            <td className="py-2.5">+{reqBonus.toFixed(1)}%</td>
                                            <td className="py-2.5 text-right font-bold text-[9px]">{isReached ? 'REACHED' : `+${(reqBonus - currentBonus).toFixed(1)}%`}</td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
});

export const BreakpointExplanation = memo(() => (
    <div className="mt-8 space-y-4 text-[11px] text-white/50 leading-relaxed border-t border-white/10 pt-6">
        <div>
            <span className="text-orange-400 font-bold uppercase block mb-1">Primary Weapon Cycle</span>
            The total time between attacks. Due to the game's 0.1s frame-discretization, your Attack Speed only improves DPS when it pushes your cycle into the next "step".
        </div>
        <div>
            <span className="text-blue-400 font-bold uppercase block mb-1">Rhythmic Windup & Double Action</span>
            The Windup phase dictates animation fluidness. Reaching the <span className="text-blue-300">0.3s Meta bracket</span> significantly reduces the perceived delay between the primary strike and the Double Attack proc, maximizing real-time performance.
        </div>
        <div>
            <span className="text-purple-400 font-bold uppercase block mb-1">Double Attack Cycle</span>
            When a Double Attack procs, the total cycle is extended by a sequential delay (base 0.25s). High Double Attack builds should aim for breakpoints in this table to minimize the "dead time" between double strikes.
        </div>
        <div className="bg-white/5 p-3 rounded-lg border border-white/10 italic">
            Note: These calculations account for the independent rounding of Windup and Recovery phases (0.1s steps) + a fixed 0.2s post-attack interval.
        </div>
    </div>
));
