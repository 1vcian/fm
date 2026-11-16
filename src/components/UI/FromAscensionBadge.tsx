import { cn } from '../../lib/utils';
import { GameAssetIcon } from './GameAssetIcon';

interface FromAscensionBadgeProps {
    /** First ascension that can obtain the unit, item or age (derived from the config); nothing is drawn below 1. */
    ascension: number | undefined;
    /** What the ascension belongs to, for the tooltip ("summon", "forge"). */
    source?: string;
    className?: string;
}

/** Small "Unlocks at ascension N" tag for content only obtainable from a given ascension. */
export function FromAscensionBadge({ ascension, source, className }: FromAscensionBadgeProps) {
    if (!ascension || ascension < 1) return null;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/30 whitespace-nowrap',
                className
            )}
            title={`Only obtainable once the ${source ? `${source} ` : ''}ascension reaches ${ascension}`}
        >
            <GameAssetIcon asset={{ icon: 'AscensionStar' }} size={10} />
            Unlocks at ascension {ascension}
        </span>
    );
}
