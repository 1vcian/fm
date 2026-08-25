import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X, Maximize2 } from 'lucide-react';
import { AutoSyncModal } from './AutoSyncModal';
import type { ForcedTemplate } from '../../utils/ocr/guidedSync';
import { cn } from '../../lib/utils';

const PRESET_TITLE: Record<ForcedTemplate, string> = {
    item: 'equipment', mount: 'mount', pet: 'pets', skills: 'skills', clanTree: 'clan tech tree', skin: 'skins',
};

/** What to have on screen when the shot is taken, per template. */
const PRESET_HINT: Record<ForcedTemplate, string> = {
    item: 'Open the item so its "Equipped" detail card is showing, then capture.',
    mount: 'Open the mount detail popup (name, damage, health, stats), then capture.',
    pet: 'Open the pet detail popup (name, damage, health, stats), then capture. One pet per shot.',
    skills: 'Open the Skills tab with the level grid visible, then capture. Several shots are fine if the grid scrolls.',
    clanTree: 'Open the Clan → Tech Tree tab, then capture. Scroll and take several shots to cover every node.',
    skin: 'Open the skin popup (name + set bonus lines), then capture. One skin per shot.',
};

/**
 * Compact per-section AutoSync launcher: a "📷 Sync" button that opens the AutoSyncModal with
 * the section's template preset, plus an info button whose popover shows an example screenshot
 * for that template. The modal is conditionally mounted, so closing it fully resets its state.
 *
 * The help popover is PORTALLED and centred rather than absolutely positioned next to the button:
 * section headers sit near the right edge, so an `absolute right-0` panel overflowed the viewport
 * on phones and got clipped (both the heading and the bottom of the example). Centred + capped at
 * 85vh with its own scroll container, it fits any viewport down to 320px.
 *
 * The examples are WHOLE-SCREEN captures on purpose — every reader is calibrated on full screens
 * and locates panels from the screen edges, so a cropped reference would teach the wrong thing.
 *
 * DISMISSAL CONTRACT (this popover used to ignore Escape entirely):
 *  - Escape closes — the zoom overlay first if it is up, then the popover — and focus goes back to
 *    the control that opened what just closed, so keyboard users are not dumped at the top of the
 *    page. The listener is on `document`, so it fires wherever focus happens to be.
 *  - A press outside dismisses on POINTERDOWN, not click: on iOS a tap that starts on the backdrop
 *    and drifts onto the panel before lifting produces no click on the backdrop at all, and the
 *    popover stayed open. Only a press that lands on the backdrop itself closes it, so dragging
 *    inside the panel (scrolling the example) never dismisses.
 */
export function SectionSyncButton({ preset, label = 'Sync', className }: {
    preset: ForcedTemplate;
    label?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [zoom, setZoom] = useState(false);
    const infoBtnRef = useRef<HTMLButtonElement>(null);   // the trigger focus returns to
    const zoomBtnRef = useRef<HTMLButtonElement>(null);   // the example thumbnail inside the panel
    const panelRef = useRef<HTMLDivElement>(null);

    const exampleSrc = `${import.meta.env.BASE_URL}autosync/examples/${preset}.webp`;
    const closeInfo = () => { setShowInfo(false); setZoom(false); infoBtnRef.current?.focus(); };
    const closeZoom = () => { setZoom(false); zoomBtnRef.current?.focus(); };

    // Escape: innermost layer first, then the popover. Nothing else on the page should act on the
    // same key press while a modal layer of ours is up.
    useEffect(() => {
        if (!showInfo && !zoom) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            e.preventDefault();
            if (zoom) closeZoom(); else closeInfo();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showInfo, zoom]);

    // Focus lands inside the panel when it opens, so Tab/Escape act on the popover and not on
    // whatever was focused behind it.
    useEffect(() => { if (showInfo) panelRef.current?.focus(); }, [showInfo]);

    return (
        <div className={cn('relative inline-flex items-center gap-1', className)}>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title={`Sync your ${PRESET_TITLE[preset]} from screenshots`}
                className="h-7 px-2 rounded-lg border border-accent-primary/20 hover:bg-accent-primary/10 hover:border-accent-primary/40 text-accent-primary text-[10px] font-bold flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap"
            >
                <span aria-hidden>📷</span> {label}
            </button>
            <button
                ref={infoBtnRef}
                type="button"
                onClick={() => (showInfo ? closeInfo() : setShowInfo(true))}
                aria-expanded={showInfo}
                title="Which screenshot to take"
                aria-label="Which screenshot to take"
                className="h-7 w-7 rounded-lg border border-border/50 hover:border-accent-primary/40 text-text-muted hover:text-accent-primary flex items-center justify-center transition-all shrink-0"
            >
                <Info className="w-3.5 h-3.5" />
            </button>

            {showInfo && createPortal(
                <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-[2px] p-3"
                    // pointerdown, and only when the press LANDS on the backdrop itself
                    onPointerDown={e => { if (e.target === e.currentTarget) closeInfo(); }}>
                    <div
                        ref={panelRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Which ${PRESET_TITLE[preset]} screenshot to take`}
                        className="w-full max-w-[22rem] max-h-[85vh] rounded-2xl border border-border bg-bg-primary text-text-primary shadow-2xl flex flex-col overflow-hidden outline-none"
                    >
                        <div className="flex items-start gap-2 p-3 border-b border-border/70 shrink-0">
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-black text-white">Take a screenshot like this</p>
                                <p className="text-[10px] text-text-muted mt-0.5">Example: {PRESET_TITLE[preset]}</p>
                            </div>
                            <button type="button" onClick={closeInfo} aria-label="Close"
                                className="p-1 -m-1 rounded-lg text-text-muted hover:text-white hover:bg-white/10 shrink-0">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* scrolls on short viewports instead of overflowing them */}
                        <div className="overflow-y-auto p-3 space-y-2 overscroll-contain">
                            <p className="text-[11px] font-bold text-amber-400/90">
                                Capture the WHOLE screen. Don't crop it.
                            </p>
                            <p className="text-[10px] text-text-secondary">
                                The reader finds each panel from the screen edges and the bottom tab bar, so a cropped
                                image usually reads nothing. Your phone's normal screenshot is exactly right.
                            </p>
                            <button ref={zoomBtnRef} type="button" onClick={() => setZoom(true)} title="Tap to enlarge"
                                className="relative block w-full rounded-lg overflow-hidden border border-border/60 group">
                                <img src={exampleSrc} alt={`Example full-screen ${PRESET_TITLE[preset]} screenshot`}
                                    className="w-full max-h-[45vh] object-contain bg-black/30" />
                                <span className="absolute bottom-1 right-1 p-1 rounded bg-black/70 text-white/90 group-hover:text-white">
                                    <Maximize2 className="w-3 h-3" />
                                </span>
                            </button>
                            <p className="text-[10px] text-text-secondary">{PRESET_HINT[preset]}</p>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {zoom && createPortal(
                // the lightbox dismisses on a press anywhere (the image included) — same
                // pointerdown rule, so an iOS tap that drifts still closes it
                <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/95 p-2" onPointerDown={closeZoom}>
                    <img src={exampleSrc} alt={`Example full-screen ${PRESET_TITLE[preset]} screenshot`}
                        className="max-w-full max-h-full object-contain rounded-lg" />
                    <button type="button" onClick={closeZoom} aria-label="Close"
                        className="absolute top-3 right-3 p-2 rounded-full bg-white/10 text-white hover:bg-white/20">
                        <X className="w-5 h-5" />
                    </button>
                </div>,
                document.body
            )}

            {open && <AutoSyncModal preset={preset} onClose={() => setOpen(false)} />}
        </div>
    );
}
