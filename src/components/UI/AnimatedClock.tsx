import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useGameDataContext } from '../../context/GameDataContext';
import { resolveTextureVersion } from '../../utils/ascensionUtils';

interface AnimatedClockProps {
    className?: string;
}

export function AnimatedClock({ className }: AnimatedClockProps) {
    const { selectedVersion } = useGameDataContext();
    const texVersion = resolveTextureVersion(selectedVersion) ?? selectedVersion;
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const hours = time.getHours();
    const minutes = time.getMinutes();
    const seconds = time.getSeconds();

    // Calculate rotations
    const hourRotation = (hours % 12) * 30 + (minutes / 60) * 30;
    const minuteRotation = minutes * 6 + (seconds / 60) * 6;

    return (
        <div className={cn("relative flex items-center justify-center", className)}>
            <img
                src={`${import.meta.env.BASE_URL}Texture2D/${texVersion}/ProgressBarClockIcon.png`}
                alt="Clock Back"
                className="w-full h-full object-contain"
            />
            {/* Hour Hand */}
            <img
                src={`${import.meta.env.BASE_URL}Texture2D/${texVersion}/ProgressBarClockIconHand.png`}
                alt="Hour Hand"
                className="absolute w-[60%] h-[60%] object-contain transition-transform duration-1000 ease-linear"
                style={{ transform: `rotate(${hourRotation}deg)` }}
            />
            {/* Minute Hand */}
            <img
                src={`${import.meta.env.BASE_URL}Texture2D/${texVersion}/ProgressBarClockIconHand.png`}
                alt="Minute Hand"
                className="absolute w-full h-full object-contain transition-transform duration-1000 ease-linear"
                style={{ transform: `rotate(${minuteRotation}deg)` }}
            />
        </div>
    );
}
