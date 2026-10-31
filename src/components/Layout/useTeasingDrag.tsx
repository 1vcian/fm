import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ATTEMPTS_KEY, COFFEE_SYNC_EVENT, coffeeChanged, startCoffeeSync } from '../../services/coffeeSync';

/**
 * Dragging for the donation buttons, with a running joke: dropping a button under the page
 * header counts as an attempt to hide it. Until the visitor has really done it HIDE_GOAL times
 * (counted in localStorage, shared by both buttons, and mirrored to the account when signed in:
 * src/services/coffeeSync.ts) the button complains in a speech bubble and
 * flies back to a random spot, and half the time plays "catch me" for a few seconds: grabbing
 * or (with a mouse) touching it makes it dodge, 1 to 4 times, so a visitor who wants to click it
 * always can. On the HIDE_GOAL-th attempt it gives up and stays under the header for good.
 * Moved anywhere else, it chats like a friendly assistant.
 */

export const HIDE_GOAL = 100;
/** Set once the positions saved before the hiding game existed were checked (see the hook). */
const MIGRATED_KEY = 'fm_coffee_tease_v1';
const MARGIN = 8;
/** Movement (px) past which a press becomes a drag instead of a tap. */
const DRAG_THRESHOLD = 6;
/** A dropped button counts as hidden when the header covers at least this share of it. */
const HIDDEN_SHARE = 0.5;
/** How long the complaint stays on screen before the button flies away (ms). */
const COMPLAIN_MS = 1600;
/** "Catch me" after a flight: how long (ms), how often it plays at all, and 1..MAX_DODGES dodges. */
const TEASE_MS = 7000;
const TEASE_CHANCE = 0.5;
const MAX_DODGES = 4;
const FLIGHT_MS = 700;

/** Top-left corner as fractions of the viewport. */
export interface FreePos { x: number; y: number }

const hideLines = [
    (n: number) => `Hey, are you trying to hide me? 🙈 Do it ${n} more times and I'll stay there. Or... maybe consider a coffee? ☕`,
    (n: number) => `Nice try! Only ${n} more to go 😏`,
    (n: number) => `I'm claustrophobic under there! ${n} left 😤`,
    (n: number) => `Back again? ${n} more and I'm all yours. A donation is faster though 💸`,
    (n: number) => `You can't get rid of me that easily! ${n} to go 🏃`,
    (n: number) => `Ouch, that header is heavy! ${n} left 🧱`,
    (n: number) => `${n} more times? Your finger must be tired by now 💪`,
    (n: number) => `I'll be back! ${n} attempts left 🤖`,
    (n: number) => `It's dark in here and it smells like CSS 🕯️ ${n} to go`,
    (n: number) => `Hiding me won't make the coffee disappear ☕ ${n} more`,
    (n: number) => `Achievement progress: Coffee Hider ${HIDE_GOAL - n}/${HIDE_GOAL} 🏅`,
    (n: number) => `Are you sure? I have feelings, you know 🥺 ${n} left`,
    (n: number) => `Plot twist: I'm back! 🎬 Only ${n} to go`,
    (n: number) => `Let me guess, the header looked cozy? ${n} more 🛏️`,
    (n: number) => `Every attempt is counted. Yes, really. ${n} left 📋`,
    (n: number) => `You could have forged a whole Divine set by now ⚒️ ${n} to go`,
    (n: number) => `I'm like a bad drop: I keep coming back 🎲 ${n} left`,
    (n: number) => `Shh, don't tell the other buttons 🤫 ${n} more`,
    (n: number) => `Persistence! I respect that. Still ${n} to go 🫡`,
    (n: number) => `Hide and seek champion? Not yet: ${n} left 🙈`,
    (n: number) => `Buy me a coffee and take me to dinner first, before dragging me to places like this 🍝 ${n} to go`,
    (n: number) => `Wow, straight under the header? We barely know each other 😳 ${n} left`,
];
const dodgeLines = [
    'Catch me if you can! 🏃', 'Too slow! 😜', 'Nope! 💨', 'Missed me! 🙃', 'Over here! 👋', 'Almost! 🤏',
    'Is that your best attack speed? ⚔️', 'Dodged! That was a block chance roll 🛡️', 'Whoosh! 🌪️',
    'You need more agility! 🐇', 'Ha! Missed by a mile 📏', 'Not today! 🙅',
];
/** A friendly assistant's chatter on an ordinary move. */
const agentLines = [
    "Have you ever noticed that the clock on the stats button up top is a real clock? It shows your actual time ⏰",
    'Wheee! I love a good ride 🎢',
    "It looks like you're moving me. Need help finding the donate button? It's me! ☕",
    'New spot, same coffee ☕',
    'Comfy here. Thanks for the lift! 🛋️',
    'Psst... the Preset Builds page has the strongest builds the simulator found 🏆',
    "I'll just wait here. Patiently. Next to the coffee ☕",
    'Careful, I spill easily! ☕💦',
    'Ooh, nice view from here 👀',
    'You can hide me under the header bar if you want, but it will take a while ⏳',
    'Is this where we keep the good stuff? 📦',
    "Tip: you can drag me anywhere. Well, almost anywhere 😉",
    'Psst... the Images Maker can export your character as a GIF 🎞️',
    'Fun fact: this whole site is built by one person, with lots of ideas from the community (and lots of coffee ☕)',
    'Moving day! I hope you labeled the boxes 📦',
    'Psst... the Forge Calculator shows how many items each age drops ⚒️',
    'Right here? Perfect. You have great taste 👌',
    "Weee! Do it again! Actually, don't, I'm dizzy 😵",
    'Psst... the Substats Calculator can load the best substats of every preset 🧮',
];
const SURRENDER = `Okay, okay, you win! ${HIDE_GOAL} times?! 🏆 I'll stay hidden. Respect. (A coffee would still be nice ☕)`;

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function loadNumber(key: string): number {
    try {
        const v = Number(localStorage.getItem(key));
        return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch { return 0; }
}
function saveNumber(key: string, v: number) {
    try { localStorage.setItem(key, String(v)); } catch { /* storage blocked */ }
    coffeeChanged();
}
export function loadFreePos(key: string): FreePos | null {
    try {
        const p = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (p && typeof p.y === 'number' && isFinite(p.y)) {
            // The phone button used to store { side, y }.
            const x = typeof p.x === 'number' && isFinite(p.x) ? p.x : p.side === 'left' ? 0 : 1;
            return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, p.y)) };
        }
    } catch { /* storage blocked or bad JSON */ }
    return null;
}
function saveFreePos(key: string, p: FreePos) {
    try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage blocked */ }
    coffeeChanged(key);
}

function headerRect(): DOMRect | null {
    return document.querySelector('header')?.getBoundingClientRect() ?? null;
}
function coveredShare(left: number, top: number, w: number, h: number): number {
    const r = headerRect();
    if (!r || w <= 0 || h <= 0) return 0;
    const ix = Math.max(0, Math.min(left + w, r.right) - Math.max(left, r.left));
    const iy = Math.max(0, Math.min(top + h, r.bottom) - Math.max(top, r.top));
    return (ix * iy) / (w * h);
}

interface Bubble { id: number; text: string }

export interface TeasingDragOptions {
    storageKey: string;
    /** Snap to the nearest side edge on release (the phone button). */
    snapSides?: boolean;
    /** Size before the element is measured. */
    fallbackSize: { w: number; h: number };
}

export function useTeasingDrag<E extends HTMLElement>({ storageKey, snapSides = false, fallbackSize }: TeasingDragOptions) {
    const ref = useRef<E>(null);
    const [pos, setPos] = useState<FreePos | null>(() => loadFreePos(storageKey));
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const [flying, setFlying] = useState(false);
    const [bubble, setBubble] = useState<Bubble | null>(null);
    const [, setViewport] = useState(0);
    const start = useRef<{ px: number; py: number; left: number; top: number; moved: boolean; id: number } | null>(null);
    const suppressClick = useRef(false);
    const tease = useRef<{ until: number; dodges: number }>({ until: 0, dodges: 0 });
    const timers = useRef<number[]>([]);
    const surrendered = () => loadNumber(ATTEMPTS_KEY) >= HIDE_GOAL;

    // A button left under the header before this game existed goes back to its default spot once.
    useEffect(() => {
        try {
            const flag = `${MIGRATED_KEY}:${storageKey}`;
            if (localStorage.getItem(flag)) return;
            localStorage.setItem(flag, '1');
        } catch { return; }
        if (!pos || surrendered()) return;
        const r = place(pos), { w, h } = size();
        if (coveredShare(r.left, r.top, w, h) >= HIDDEN_SHARE) {
            setPos(null);
            try { localStorage.removeItem(storageKey); } catch { /* storage blocked */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Signed in, the attempts and positions follow the account: another device's arrive here.
    useEffect(() => {
        startCoffeeSync();
        const onSync = () => setPos(loadFreePos(storageKey));
        window.addEventListener(COFFEE_SYNC_EVENT, onSync);
        return () => window.removeEventListener(COFFEE_SYNC_EVENT, onSync);
    }, [storageKey]);

    useEffect(() => {
        const onResize = () => setViewport(v => v + 1);
        window.addEventListener('resize', onResize);
        // The button's own size changes too (the desktop label folds away with the sidebar open):
        // placed from its left edge, it has to be placed again or it ends past the right edge.
        const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(onResize) : null;
        if (ro && ref.current) ro.observe(ref.current);
        return () => {
            ro?.disconnect();
            window.removeEventListener('resize', onResize);
            timers.current.forEach(t => window.clearTimeout(t));
        };
    }, []);
    const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

    // Layout size (offsetWidth/Height): a hover or press scale must not move where it rests.
    const size = () => {
        const el = ref.current;
        return el && el.offsetWidth > 0 ? { w: el.offsetWidth, h: el.offsetHeight } : fallbackSize;
    };
    const clampLeft = (x: number, w: number) => Math.min(window.innerWidth - w - MARGIN, Math.max(MARGIN, x));
    const clampTop = (y: number, h: number) => Math.min(window.innerHeight - h - MARGIN, Math.max(MARGIN, y));
    /** Resting corner (px) of a stored position. */
    const place = (p: FreePos) => {
        const { w, h } = size();
        const left = snapSides ? (p.x < 0.5 ? MARGIN : window.innerWidth - w - MARGIN) : clampLeft(p.x * window.innerWidth, w);
        return { left, top: clampTop(p.y * window.innerHeight, h) };
    };

    const say = (text: string, ms = 2600) => {
        const id = Date.now() + Math.random();
        setBubble({ id, text });
        later(() => setBubble(b => (b?.id === id ? null : b)), ms);
    };

    /** A random spot below the header, then "catch me" for a while. */
    const flyAway = (teaseAfter: boolean) => {
        const { w, h } = size();
        const top0 = (headerRect()?.bottom ?? 0) + MARGIN;
        const left = MARGIN + Math.random() * Math.max(0, window.innerWidth - w - 2 * MARGIN);
        const top = top0 + Math.random() * Math.max(0, window.innerHeight - h - MARGIN - top0);
        const next = { x: left / window.innerWidth, y: top / window.innerHeight };
        if (snapSides) next.x = Math.random() < 0.5 ? 0 : 1;
        setFlying(true);
        setPos(next);
        saveFreePos(storageKey, next);
        later(() => setFlying(false), FLIGHT_MS);
        if (teaseAfter && Math.random() < TEASE_CHANCE) {
            tease.current = { until: Date.now() + TEASE_MS, dodges: 1 + Math.floor(Math.random() * MAX_DODGES) };
        }
    };

    /** In "catch me": dodge instead of being grabbed. True when it dodged. */
    const dodge = () => {
        const t = tease.current;
        if (t.dodges <= 0 || Date.now() > t.until || flying) return false;
        t.dodges--;
        suppressClick.current = true;
        flyAway(false);
        say(t.dodges > 0 ? pick(dodgeLines) : 'Fine, you caught me. Now buy me a coffee? ☕');
        return true;
    };

    const onPointerDown = (e: React.PointerEvent<E>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (dodge()) { e.preventDefault(); return; }
        const corner = pos ? place(pos) : (() => { const r = ref.current!.getBoundingClientRect(); return { left: r.left, top: r.top }; })();
        start.current = { px: e.clientX, py: e.clientY, left: corner.left, top: corner.top, moved: false, id: e.pointerId };
        suppressClick.current = false;
        // Captured from the press (touch does this by itself): a fast first move can leave the
        // button before the drag threshold, and its events would go elsewhere.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    };

    const onPointerEnter = (e: React.PointerEvent<E>) => {
        if (e.pointerType === 'mouse' && !start.current) dodge();
    };

    const onPointerMove = (e: React.PointerEvent<E>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.px, dy = e.clientY - s.py;
        if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        s.moved = true;
        e.preventDefault();
        const { w, h } = size();
        setDrag({ x: clampLeft(s.left + dx, w), y: clampTop(s.top + dy, h) });
    };

    const finish = (e: React.PointerEvent<E>) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        start.current = null;
        if (!s.moved) return;
        suppressClick.current = true;
        const x = drag?.x ?? s.left, y = drag?.y ?? s.top;
        const { w, h } = size();
        setDrag(null);
        const dropped = { x: x / window.innerWidth, y: y / window.innerHeight };
        if (snapSides) dropped.x = x + w / 2 < window.innerWidth / 2 ? 0 : 1;
        setPos(dropped);
        if (coveredShare(x, y, w, h) < HIDDEN_SHARE || surrendered()) {
            saveFreePos(storageKey, dropped);
            if (coveredShare(x, y, w, h) < HIDDEN_SHARE) say(pick(agentLines), 4000);
            return;
        }
        const attempts = loadNumber(ATTEMPTS_KEY) + 1;
        saveNumber(ATTEMPTS_KEY, attempts);
        if (attempts >= HIDE_GOAL) {
            saveFreePos(storageKey, dropped);
            say(SURRENDER, 6000);
            return;
        }
        const left = HIDE_GOAL - attempts;
        say(attempts === 1 ? hideLines[0](left) : pick(hideLines.slice(1))(left), COMPLAIN_MS + 2200);
        later(() => flyAway(true), COMPLAIN_MS);
    };

    const onClick = (e: React.MouseEvent<E>) => {
        if (suppressClick.current) {
            e.preventDefault();
            suppressClick.current = false;
        }
    };

    const resting = pos ? place(pos) : null;
    const corner = drag ? { left: drag.x, top: drag.y } : resting;
    const { w, h } = size();
    /** On the header, while dragged or resting: drawn below it, so the header covers it at once. */
    const parked = !!corner && coveredShare(corner.left, corner.top, w, h) >= HIDDEN_SHARE;

    return {
        ref,
        /** Where it is (px), or null while it keeps its default CSS position. */
        corner,
        dragging: !!drag,
        flying,
        parked,
        bubble,
        handlers: { onPointerDown, onPointerEnter, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onClick, onContextMenu: (e: React.MouseEvent) => e.preventDefault() },
        flightStyle: flying ? { transition: `left ${FLIGHT_MS}ms cubic-bezier(.34,1.56,.64,1), top ${FLIGHT_MS}ms cubic-bezier(.34,1.56,.64,1)` } : undefined,
    };
}

/** The button's speech bubble, kept inside the viewport next to the button. */
export function TeaseBubble({ bubble, anchor }: { bubble: Bubble | null; anchor: HTMLElement | null }) {
    const r = anchor?.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 2 * MARGIN);
    const left = r ? Math.min(window.innerWidth - width - MARGIN, Math.max(MARGIN, r.left + r.width / 2 - width / 2)) : MARGIN;
    // Below the button when it is near the top (under the header), above it otherwise.
    const below = !r || r.top < 140;
    const top = r ? (below ? r.bottom + 10 : undefined) : 80;
    const bottom = r && !below ? window.innerHeight - r.top + 10 : undefined;
    return (
        <AnimatePresence>
            {bubble && (
                <motion.div
                    key={bubble.id}
                    initial={{ opacity: 0, scale: 0.7, y: below ? -8 : 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    style={{ position: 'fixed', left, top, bottom, width }}
                    className="z-[110] pointer-events-none bg-white text-black px-4 py-2.5 rounded-2xl shadow-xl text-xs font-black border-2 border-[#FFDD00] text-center"
                    role="status"
                >
                    {bubble.text}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
