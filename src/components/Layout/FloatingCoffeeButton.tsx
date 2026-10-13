import { useEffect, useRef, useState } from 'react';
import { Coffee } from 'lucide-react';
import { cn } from '../../lib/utils';

const STORAGE_KEY = 'fm_coffee_button_pos';
const SIZE = 44;
const MARGIN = 8;
/** Movement (px) past which a press becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 6;

interface Pos { side: 'left' | 'right'; /** Top edge as a fraction of the viewport height. */ y: number }

const DEFAULT_POS: Pos = { side: 'right', y: 0.82 };

function loadPos(): Pos {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_POS;
        const p = JSON.parse(raw);
        if ((p?.side === 'left' || p?.side === 'right') && typeof p.y === 'number' && isFinite(p.y)) {
            return { side: p.side, y: Math.min(1, Math.max(0, p.y)) };
        }
    } catch { /* storage blocked or bad JSON: use the default spot */ }
    return DEFAULT_POS;
}

function savePos(p: Pos) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

const clampTop = (top: number) => Math.min(window.innerHeight - SIZE - MARGIN, Math.max(MARGIN, top));

/**
 * Phone version of the donation button: a small round icon that can be dragged anywhere and
 * snaps to the nearest side edge. It sits below modals (z-40) so fullscreen views cover it.
 */
export function FloatingCoffeeButton({ href, bgClass, className }: { href: string; bgClass?: string; className?: string }) {
    const [pos, setPos] = useState<Pos>(loadPos);
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const [, setViewport] = useState(0);
    const start = useRef<{ px: number; py: number; left: number; top: number; moved: boolean; id: number } | null>(null);
    const suppressClick = useRef(false);

    // Re-clamp on rotation or resize.
    useEffect(() => {
        const onResize = () => setViewport(v => v + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const restingTop = clampTop(pos.y * window.innerHeight);
    const restingLeft = pos.side === 'left' ? MARGIN : window.innerWidth - SIZE - MARGIN;

    const onPointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        start.current = { px: e.clientX, py: e.clientY, left: restingLeft, top: restingTop, moved: false, id: e.pointerId };
        suppressClick.current = false;
    };

    const onPointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.px;
        const dy = e.clientY - s.py;
        if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!s.moved) {
            s.moved = true;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        }
        e.preventDefault();
        setDrag({
            x: Math.min(window.innerWidth - SIZE - MARGIN, Math.max(MARGIN, s.left + dx)),
            y: clampTop(s.top + dy),
        });
    };

    const finish = (e: React.PointerEvent<HTMLAnchorElement>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        start.current = null;
        if (!s.moved) return;
        suppressClick.current = true;
        const x = drag?.x ?? s.left;
        const y = drag?.y ?? s.top;
        const next: Pos = { side: x + SIZE / 2 < window.innerWidth / 2 ? 'left' : 'right', y: y / window.innerHeight };
        setDrag(null);
        setPos(next);
        savePos(next);
    };

    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Buy me a coffee"
            title="Buy me a coffee"
            draggable={false}
            onDragStart={e => e.preventDefault()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finish}
            onPointerCancel={finish}
            onClick={e => {
                if (suppressClick.current) {
                    e.preventDefault();
                    suppressClick.current = false;
                }
            }}
            onContextMenu={e => e.preventDefault()}
            style={{
                left: drag ? drag.x : restingLeft,
                top: drag ? drag.y : restingTop,
                width: SIZE,
                height: SIZE,
                touchAction: 'none',
            }}
            className={cn(
                'fixed z-40 flex items-center justify-center rounded-full select-none',
                'shadow-[0_4px_14px_-2px_rgba(0,0,0,0.5)] opacity-90 active:opacity-100',
                drag ? 'scale-110' : 'transition-[left,top,transform] duration-200 ease-out',
                bgClass,
                className,
            )}
            data-testid="coffee-fab"
        >
            <Coffee className="w-5 h-5 text-white icon-stroke-sm pointer-events-none" />
        </a>
    );
}
