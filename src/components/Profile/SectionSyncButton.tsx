import { useState } from 'react';
import { Info } from 'lucide-react';
import { AutoSyncModal } from './AutoSyncModal';
import type { ForcedTemplate } from '../../utils/ocr/guidedSync';
import { cn } from '../../lib/utils';

const PRESET_TITLE: Record<ForcedTemplate, string> = {
    item: 'equipment', mount: 'mount', pet: 'pets', skills: 'skills', clanTree: 'clan tech tree', skin: 'skins',
};

/**
 * Compact per-section AutoSync launcher: a "📷 Sync" button that opens the AutoSyncModal with
 * the section's template preset, plus an info button whose popover shows an example screenshot
 * for that template. The modal is conditionally mounted, so closing it fully resets its state.
 */
export function SectionSyncButton({ preset, label = 'Sync', className }: {
    preset: ForcedTemplate;
    label?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [showInfo, setShowInfo] = useState(false);

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
                type="button"
                onClick={() => setShowInfo(v => !v)}
                title="Which screenshot to take"
                aria-label="Which screenshot to take"
                className="h-7 w-7 rounded-lg border border-border/50 hover:border-accent-primary/40 text-text-muted hover:text-accent-primary flex items-center justify-center transition-all shrink-0"
            >
                <Info className="w-3.5 h-3.5" />
            </button>

            {showInfo && (
                <>
                    <div className="fixed inset-0 z-[80]" onClick={() => setShowInfo(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-[90] w-56 p-2 rounded-xl border border-border bg-bg-primary shadow-2xl">
                        <p className="text-[11px] font-bold text-white mb-1.5">Take a screenshot like this</p>
                        <img
                            src={`${import.meta.env.BASE_URL}autosync/examples/${preset}.webp`}
                            alt={`Example ${PRESET_TITLE[preset]} screenshot`}
                            className="w-full rounded-lg border border-border/60"
                        />
                    </div>
                </>
            )}

            {open && <AutoSyncModal preset={preset} onClose={() => setOpen(false)} />}
        </div>
    );
}
