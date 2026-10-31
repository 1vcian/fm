import { Coffee } from 'lucide-react';
import { AgeBackground } from '../AgeBackground/AgeBackground';
import { cn } from '../../lib/utils';
import { TeaseBubble, useTeasingDrag } from './useTeasingDrag';

const STORAGE_KEY = 'fm_coffee_button_pos';
const SIZE = 44;
const MARGIN = 8;
/** Where it sits before the visitor first moves it: right edge, 82% down. */
const DEFAULT_TOP = 0.82;

/**
 * Phone version of the donation button: a small round icon that can be dragged anywhere and
 * snaps to the nearest side edge (useTeasingDrag: it does not like being hidden under the
 * header). It sits below modals (z-40) so fullscreen views cover it.
 */
export function FloatingCoffeeButton({ href, ageIdx = 0, className }: { href: string; ageIdx?: number; className?: string }) {
    const t = useTeasingDrag<HTMLAnchorElement>({ storageKey: STORAGE_KEY, snapSides: true, fallbackSize: { w: SIZE, h: SIZE } });
    const corner = t.corner ?? {
        left: window.innerWidth - SIZE - MARGIN,
        top: Math.min(window.innerHeight - SIZE - MARGIN, DEFAULT_TOP * window.innerHeight),
    };

    return (
        <>
            <a
                ref={t.ref}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buy me a coffee"
                title="Buy me a coffee"
                draggable={false}
                onDragStart={e => e.preventDefault()}
                {...t.handlers}
                style={{ left: corner.left, top: corner.top, width: SIZE, height: SIZE, touchAction: 'none', ...t.flightStyle }}
                className={cn(
                    'fixed z-40 flex items-center justify-center rounded-full select-none overflow-hidden',
                    'shadow-[0_4px_14px_-2px_rgba(0,0,0,0.5)] opacity-90 active:opacity-100',
                    t.dragging ? 'scale-110' : !t.flying && 'transition-[left,top,transform] duration-200 ease-out',
                    t.flying && 'animate-[spin_0.7s_ease-out]',
                    className,
                )}
                data-testid="coffee-fab"
            >
                <AgeBackground ageIdx={ageIdx} className="absolute inset-0 pointer-events-none" />
                <Coffee className="relative w-5 h-5 text-white icon-stroke-sm pointer-events-none" />
            </a>
            <div className={className}>
                <TeaseBubble bubble={t.bubble} anchor={t.ref.current} />
            </div>
        </>
    );
}
