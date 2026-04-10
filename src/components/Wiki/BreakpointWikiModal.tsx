import { memo } from 'react';
import { createPortal } from 'react-dom';
import { X, Zap, Info } from 'lucide-react';
import { BreakpointTables, BreakpointExplanation } from '../Profile/BreakpointTables';

interface BreakpointWikiModalProps {
    isOpen: boolean;
    onClose: () => void;
    weaponName: string;
    weaponAttackDuration: number;
    weaponWindupTime: number;
    currentSpeedMultiplier?: number;
}

export const BreakpointWikiModal = memo(({ 
    isOpen, 
    onClose, 
    weaponName,
    weaponAttackDuration,
    weaponWindupTime,
    currentSpeedMultiplier = 1.0 // Default to 1.0 (0% bonus) for wiki view
}: BreakpointWikiModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 drop-shadow-2xl">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-4xl bg-bg-primary border border-border/50 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-border/30 flex items-center justify-between bg-bg-secondary/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent-primary/10 rounded-xl">
                            <Zap className="w-6 h-6 text-accent-primary" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white leading-none mb-1">Breakpoint Analysis</h2>
                            <p className="text-xs text-text-muted">{weaponName} • {weaponAttackDuration.toFixed(2)}s Base Duration</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-white/5 rounded-full transition-colors text-text-muted hover:text-white"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
                    <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl flex items-start gap-3">
                        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-blue-200/70 leading-relaxed">
                            This table calculates the exact Attack Speed needed to reduce {weaponName}'s animation phases into faster 0.1s brackets. 
                            Reaching higher steps significantly improves <span className="text-blue-400 font-bold">Real-Time DPS</span> and <span className="text-blue-400 font-bold">Double Attack</span> fluidity.
                        </div>
                    </div>

                    <BreakpointTables 
                        weaponAttackDuration={weaponAttackDuration}
                        weaponWindupTime={weaponWindupTime}
                        currentAttackSpeedMultiplier={currentSpeedMultiplier}
                    />

                    <BreakpointExplanation />
                </div>

                {/* Footer */}
                <div className="p-4 bg-bg-secondary/30 border-t border-border/30 text-center">
                    <div className="text-[10px] uppercase text-text-muted font-bold tracking-widest">
                        Values calculated at {((currentSpeedMultiplier - 1) * 100).toFixed(1)}% Current Attack Speed
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
});
