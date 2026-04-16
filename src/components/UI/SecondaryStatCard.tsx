import React from 'react';
import { Trash2 } from 'lucide-react';
import { SecondaryStatInput } from './SecondaryStatInput';
import { cn } from '../../lib/utils';

interface SecondaryStatOption {
    id: string | number;
    name: string;
}

interface SecondaryStatCardProps {
    statId: string | number;
    value: number;
    options: SecondaryStatOption[];
    onStatIdChange: (id: any) => void;
    onValueChange: (value: number) => void;
    onRemove: () => void;
    range?: { min: number, max: number } | null;
    className?: string;
}

export const SecondaryStatCard: React.FC<SecondaryStatCardProps> = ({
    statId,
    value,
    options,
    onStatIdChange,
    onValueChange,
    onRemove,
    range,
    className
}) => {
    return (
        <div className={cn("bg-black/20 rounded-xl p-2.5 border border-white/5 space-y-2", className)}>
            <div className="flex items-center gap-2">
                <select
                    value={statId}
                    onChange={(e) => onStatIdChange(e.target.value)}
                    className="flex-1 bg-bg-input border border-border rounded-lg px-2 py-2 text-xs focus:outline-none focus:border-accent-primary transition-all transition-colors"
                >
                    {options.map(opt => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                </select>
                <button
                    onClick={onRemove}
                    className="p-2 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                    title="Remove Stat"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex flex-col gap-1 px-1">
                <SecondaryStatInput
                    value={value}
                    onChange={onValueChange}
                    min={(range?.min || 0) * 100}
                    max={(range?.max || 1) * 100}
                    className="w-full text-sm py-1.5"
                />
                {range && (
                    <div className="flex justify-between text-[8px] text-text-muted uppercase font-bold tracking-tighter">
                        <span>Range</span>
                        <span>{(range.min * 100).toFixed(1)}% — {(range.max * 100).toFixed(1)}%</span>
                    </div>
                )}
            </div>
        </div>
    );
};
