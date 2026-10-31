import { cn } from '../../lib/utils';

/**
 * BattleResult.lossProgress shown: the mean share of the battle's enemy HP removed in the lost
 * runs (waves not reached count as untouched), as a number and a coloured bar.
 */
export function LossProgressBar({ value, compact = false, className }: { value: number; compact?: boolean; className?: string }) {
    const pctText = `${(value * 100).toFixed(1)}%`;
    return (
        <div className={className}>
            <div className={cn('flex items-center justify-between mb-1', compact ? 'text-[10px]' : 'text-xs')}>
                <span className="text-text-secondary">Enemy HP removed when you lose</span>
                <span className="font-mono font-bold text-text-primary">{pctText}</span>
            </div>
            <div className={cn('rounded-full bg-surface-secondary overflow-hidden', compact ? 'h-1.5' : 'h-2')}>
                <div className="h-full bg-gradient-to-r from-red-500 to-amber-400" style={{ width: `${Math.min(100, value * 100)}%` }} />
            </div>
            {!compact && (
                <p className="text-[10px] text-text-muted mt-1">
                    Average over the lost runs, of the whole battle's enemy HP (waves you did not reach count as untouched): how close a loss gets to a win.
                </p>
            )}
        </div>
    );
}
