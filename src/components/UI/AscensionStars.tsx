import { cn } from '../../lib/utils';
import { Ban } from 'lucide-react';

interface AscensionStarsProps {
    value: number;
    onChange: (newValue: number) => void;
    maxLevel?: number;
    className?: string;
}

export function AscensionStars({ value, onChange, maxLevel = 3, className }: AscensionStarsProps) {
    return (
        <div className={cn("flex flex-col items-center gap-1", className)}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/80">Ascension</span>
            <div className="flex items-center gap-1">
                {/* None option */}
                <button
                    onClick={() => onChange(0)}
                    className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center transition-all hover:scale-110 border",
                        value === 0
                            ? "bg-bg-input border-text-muted/50 text-text-primary"
                            : "bg-bg-input/30 border-transparent text-text-muted/40 hover:text-text-muted hover:bg-bg-input/50"
                    )}
                    title="No Ascension"
                >
                    <Ban className="w-3.5 h-3.5" />
                </button>
                {/* Star levels */}
                {Array.from({ length: maxLevel }).map((_, idx) => {
                    const isFilled = idx < value;
                    return (
                        <button
                            key={idx}
                            onClick={() => onChange(idx + 1)}
                            className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center transition-all hover:scale-110 border border-transparent",
                                isFilled 
                                    ? "bg-amber-500/20 shadow-[0_0_8px_rgba(251,191,36,0.3)] border-amber-500/30" 
                                    : "bg-bg-input/50 hover:bg-bg-input opacity-50 grayscale hover:grayscale-0 hover:opacity-100"
                            )}
                            title={`Ascension ${idx + 1}`}
                        >
                            <img src={`${import.meta.env.BASE_URL}Texture2D/AscensionStar.png`} alt="Star" className="w-5 h-5 object-contain pointer-events-none drop-shadow-md" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

