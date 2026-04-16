import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalLevelSelectorProps {
    level: number;
    maxLevel: number;
    onChange: (level: number) => void;
    label?: string;
    className?: string;
}

export const ModalLevelSelector: React.FC<ModalLevelSelectorProps> = ({
    level,
    maxLevel,
    onChange,
    label = "LEVEL",
    className
}) => {
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val)) {
            onChange(Math.max(1, Math.min(maxLevel, val)));
        }
    };

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{label}</label>
                <span className="text-[10px] font-bold text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">MAX {maxLevel}</span>
            </div>
            <div className="flex items-center bg-bg-input rounded-xl border border-white/10 overflow-hidden divide-x divide-white/10 shadow-inner">
                <button
                    onClick={() => onChange(Math.max(1, level - 1))}
                    className="w-12 h-12 flex items-center justify-center hover:bg-white/5 active:bg-white/10 transition-colors shrink-0"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <input
                    type="number"
                    value={level}
                    onChange={handleInputChange}
                    className="flex-1 bg-transparent text-center text-sm font-bold focus:outline-none h-12 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onFocus={(e) => e.target.select()}
                />
                <button
                    onClick={() => onChange(Math.min(maxLevel, level + 1))}
                    className="w-12 h-12 flex items-center justify-center hover:bg-white/5 active:bg-white/10 transition-colors shrink-0"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
