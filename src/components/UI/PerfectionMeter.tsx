import { cn } from '../../lib/utils';

/** Colored perfection bar with the % to its right — matches the item/pet cards. */
export function PerfectionMeter({
    value,
    className,
    barClassName
}: {
    /** 0–100, or null when nothing has secondary stats yet. */
    value: number | null;
    className?: string;
    barClassName?: string;
}) {
    const v = value ?? 0;
    const has = value !== null;

    const textColor = !has ? 'text-text-muted'
        : v >= 100 ? 'text-yellow-400'
        : v >= 80 ? 'text-green-500'
        : v >= 50 ? 'text-blue-500'
        : 'text-gray-400';
    const barColor = v >= 100 ? 'bg-yellow-400'
        : v >= 80 ? 'bg-green-500'
        : v >= 50 ? 'bg-blue-500'
        : 'bg-gray-500';

    return (
        <div className={cn('flex items-center gap-2', className)}>
            <div className={cn('flex-1 min-w-0 bg-gray-700 rounded-full overflow-hidden', barClassName ?? 'h-2')}>
                <div className={cn('h-full', barColor)} style={{ width: `${Math.min(100, v)}%` }} />
            </div>
            <span className={cn('font-mono font-bold shrink-0', textColor)}>
                {has ? `${v.toFixed(1)}%` : '—'}
            </span>
        </div>
    );
}
