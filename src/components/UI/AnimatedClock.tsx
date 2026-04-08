import { cn } from '../../lib/utils';

interface AnimatedClockProps {
    className?: string;
}

export function AnimatedClock({ className }: AnimatedClockProps) {
    return (
        <div className={cn("relative flex items-center justify-center", className)}>
            <img
                src={`${import.meta.env.BASE_URL}Texture2D/ProgressBarClockIcon.png`}
                alt="Clock Back"
                className="w-full h-full object-contain"
            />
            <img
                src={`${import.meta.env.BASE_URL}Texture2D/ProgressBarClockIconHand.png`}
                alt="Clock Hand"
                className="absolute w-full h-full object-contain animate-clock-pendulum"
            />
        </div>
    );
}
