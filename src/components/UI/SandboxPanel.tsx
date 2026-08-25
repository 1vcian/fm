import { ReactNode } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SandboxField {
    key: string;
    label: string;
    /** current (possibly overridden) value, as a fraction (e.g. 0.4 = +40%) */
    value: number;
    /** value derived from the player's profile / tree mode */
    profileValue: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
}

/**
 * Reusable "sandbox" panel for calculators: lets a user without a built profile
 * override the tree-node bonuses that alter the result, and restore them to the
 * profile-derived values. Purely local to each calculator.
 */
export function SandboxPanel({ fields, onReset, children, isModified }: { fields: SandboxField[]; onReset: () => void; children?: ReactNode; isModified?: boolean }) {
    if (!fields.length && !children) return null;
    const modified = isModified !== undefined ? isModified : fields.some(f => Math.abs(f.value - f.profileValue) > 1e-9);
    const fmt = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;

    return (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-purple-300 text-xs font-black uppercase tracking-wider">
                    <FlaskConical size={14} />
                    Sandbox. Simulate tree bonuses
                </div>
                {modified && (
                    <button
                        onClick={onReset}
                        className="inline-flex items-center gap-1 text-[11px] text-accent-primary hover:text-white underline"
                    >
                        <RotateCcw size={12} /> Restore to profile
                    </button>
                )}
            </div>
            {fields.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                    {fields.map(f => {
                        const isMod = Math.abs(f.value - f.profileValue) > 1e-9;
                        return (
                            <div key={f.key} className="space-y-1">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-text-secondary">{f.label}</span>
                                    <span className={cn('font-mono font-bold', isMod ? 'text-purple-300' : 'text-white')}>{fmt(f.value)}</span>
                                </div>
                                <input
                                    type="range"
                                    min={f.min}
                                    max={f.max}
                                    step={f.step}
                                    value={f.value}
                                    onChange={(e) => f.onChange(parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-bg-input rounded-lg appearance-none cursor-pointer accent-purple-400"
                                />
                            </div>
                        );
                    })}
                </div>
            )}
            {children}
        </div>
    );
}
