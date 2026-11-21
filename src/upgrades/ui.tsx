import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODE_NAMES, RANK_MODES, type RankMode } from './ranking';

const FOCUS_KEY = 'fm.upgradeFocus';

function readFocus(): RankMode[] {
    try {
        const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null');
        const modes = Array.isArray(saved) ? RANK_MODES.filter(m => saved.includes(m)) : [];
        if (modes.length) return modes;
    } catch { /* storage blocked or a bad value: the default */ }
    return RANK_MODES;
}

/** The modes the player ranks for, remembered on this device. Never empty. */
export function useFocus(): [RankMode[], (m: RankMode[]) => void] {
    const [focus, setFocus] = useState<RankMode[]>(readFocus);
    const set = useCallback((m: RankMode[]) => {
        const value = m.length ? RANK_MODES.filter(x => m.includes(x)) : RANK_MODES;
        setFocus(value);
        try { localStorage.setItem(FOCUS_KEY, JSON.stringify(value)); } catch { /* per-device preference */ }
    }, []);
    return [focus, set];
}

/** The sum of a score table over the focus modes. */
export const focusSum = (scores: Partial<Record<RankMode, number>>, focus: RankMode[]) => focus.reduce((a, m) => a + (scores[m] ?? 0), 0);

export function FocusChips({ focus, onChange }: { focus: RankMode[]; onChange: (m: RankMode[]) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-text-muted mr-1">Rank for</span>
            {RANK_MODES.map(m => (
                <button key={m} onClick={() => onChange(focus.includes(m) ? focus.filter(x => x !== m) : [...focus, m])} aria-pressed={focus.includes(m)}
                    className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors', focus.includes(m) ? 'border-accent-primary/50 bg-accent-primary/10 text-text-primary' : 'border-border text-text-muted')}>
                    {MODE_NAMES[m]}
                </button>
            ))}
        </div>
    );
}

/** A signed score change; inside `noise` it reads as no change. */
export const Gain = ({ value, className, noise = 0.0005 }: { value: number; className?: string; noise?: number }) => (
    <span className={cn('font-mono tabular-nums', value > noise ? 'text-green-400' : value < -noise ? 'text-red-400' : 'text-text-muted', className)}>
        {Math.abs(value) > noise ? `${value > 0 ? '+' : ''}${value.toFixed(Math.abs(value) < 0.1 ? 3 : 2)}` : '±0'}
    </span>
);

export const Waiting = ({ label }: { label: string }) => (
    <span className="inline-flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="w-4 h-4 animate-spin" />{label}</span>
);
