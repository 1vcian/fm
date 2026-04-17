import { cn } from '../../lib/utils';


interface AscensionStarsProps {
    value: number;
    onChange: (newValue: number) => void;
    maxLevel?: number;
    className?: string;
    size?: 'xs' | 'sm' | 'md';
}

export function AscensionStars({ value, onChange, maxLevel = 3, className, size = 'md' }: AscensionStarsProps) {
    const isXS = size === 'xs';
    const isSM = size === 'sm';

    return (
        <div className={cn("flex flex-col items-center", isXS ? "gap-0" : "gap-1", className)}>
            {!isXS && (
                <span className={cn(
                    "font-bold uppercase tracking-wider text-amber-500/80",
                    isSM ? "text-[9px]" : "text-[10px]"
                )}>
                    Ascension
                </span>
            )}
            <div className={cn("flex items-center", isXS || isSM ? "gap-0.5" : "gap-1")}>
                {/* None option */}
                <button
                    onClick={() => onChange(0)}
                    className={cn(
                        "rounded-full flex items-center justify-center transition-all hover:scale-110 border tabular-nums",
                        isXS ? "w-4 h-4 text-[8px]" : isSM ? "w-5 h-5 text-[9px]" : "w-6 h-6 text-[10px]",
                        value === 0
                            ? "bg-red-500/20 border-red-500/40 text-red-500 shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                            : "bg-bg-input/30 border-transparent text-text-muted/40 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20"
                    )}
                    title="Reset to 0 stars"
                >
                    0
                </button>
                {/* Star levels */}
                {Array.from({ length: maxLevel }).map((_, idx) => {
                    const isFilled = idx < value;
                    return (
                        <button
                            key={idx}
                            onClick={() => onChange(idx + 1)}
                            className={cn(
                                "rounded-full flex items-center justify-center transition-all hover:scale-110 border border-transparent",
                                isXS ? "w-4 h-4" : isSM ? "w-5 h-5" : "w-6 h-6",
                                isFilled 
                                    ? "bg-amber-500/20 shadow-[0_0_8_rgba(251,191,36,0.3)] border-amber-500/30" 
                                    : "bg-bg-input/50 hover:bg-bg-input opacity-50 grayscale hover:grayscale-0 hover:opacity-100"
                            )}
                            title={`Ascension ${idx + 1}`}
                        >
                            <img 
                                src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} 
                                alt="Star" 
                                className={cn(
                                    "object-contain pointer-events-none drop-shadow-md",
                                    isXS ? "w-3 h-3" : isSM ? "w-4 h-4" : "w-5 h-5"
                                )} 
                            />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

