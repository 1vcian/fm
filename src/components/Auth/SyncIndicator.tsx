/**
 * SyncIndicator — one pill that says where the user's profiles actually live right now.
 *
 * The states come straight from `SyncStatus` (`src/services/profileStore.ts`) and each one is
 * phrased as a *fact about the data*, not as a technical status, because that is the only thing
 * the user needs to decide whether it is safe to close the tab:
 *
 *   local-only  "Saved in this browser"     — signed out, or no backend in this build. NOT an error.
 *   saving      "Saving"                   — a push is in flight or queued.
 *   synced      "Synced"                    — this browser and the server agree.
 *   offline     "Offline — saved locally"   — signed in, unreachable, edits queued.
 *   conflict    "Needs your decision"       — a merge or a conflict is waiting.
 *   error       "Sync problem"              — everything is still safe locally.
 *
 * `local-only` is deliberately not styled as a warning: it is the app's default and always has
 * been.
 */

import { Check, Cloud, CloudOff, HardDrive, Loader2, AlertTriangle, GitBranch } from 'lucide-react';
import type { SyncStatus } from '../../services/profileStore';
import { cn } from '../../lib/utils';

interface SyncIndicatorProps {
    status: SyncStatus;
    /** Extra detail for the title attribute. */
    message?: string | null;
    /** Epoch ms of the last successful sync. */
    lastSyncedAt?: number | null;
    pendingCount?: number;
    className?: string;
}

const relative = (epoch: number): string => {
    const seconds = Math.max(0, Math.round((Date.now() - epoch) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(epoch).toLocaleDateString();
};

export function SyncIndicator({
    status,
    message,
    lastSyncedAt,
    pendingCount = 0,
    className,
}: SyncIndicatorProps) {
    const config: Record<SyncStatus, { label: string; icon: JSX.Element; tone: string; hint: string }> = {
        'local-only': {
            label: 'Saved in this browser',
            icon: <HardDrive className="w-3.5 h-3.5" />,
            tone: 'border-border bg-white/5 text-text-secondary',
            hint: 'Your profiles live in this browser only. Sign in to keep a copy across devices.',
        },
        saving: {
            label: 'Saving',
            icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
            tone: 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary',
            hint: 'Sending your latest changes to the server.',
        },
        synced: {
            label: 'Synced',
            icon: <Check className="w-3.5 h-3.5" />,
            tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
            hint: lastSyncedAt ? `Last synced ${relative(lastSyncedAt)}.` : 'This browser and the server agree.',
        },
        offline: {
            label: 'Offline. Saved locally',
            icon: <CloudOff className="w-3.5 h-3.5" />,
            tone: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
            hint: 'The server is unreachable. Nothing is lost: edits are queued and sent when you are back online.',
        },
        conflict: {
            label: 'Needs your decision',
            icon: <GitBranch className="w-3.5 h-3.5" />,
            tone: 'border-accent-tertiary/50 bg-accent-tertiary/10 text-accent-tertiary',
            hint: 'A profile differs between this browser and the server. Nothing is overwritten until you choose.',
        },
        error: {
            label: 'Sync problem',
            icon: <AlertTriangle className="w-3.5 h-3.5" />,
            tone: 'border-accent-secondary/40 bg-accent-secondary/10 text-accent-secondary',
            hint: 'Could not sync. Your data is still safe in this browser.',
        },
    };

    const { label, icon, tone, hint } = config[status];
    const title = [hint, message, pendingCount > 0 ? `${pendingCount} profile(s) waiting to upload.` : null]
        .filter(Boolean)
        .join(' ');

    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
                tone,
                className,
            )}
        >
            {icon}
            {label}
            {pendingCount > 0 && status !== 'saving' && (
                <span className="ml-0.5 rounded-full bg-black/30 px-1.5 py-px text-[10px] font-bold">
                    {pendingCount}
                </span>
            )}
        </span>
    );
}

/** Small helper reused by the account panel for "last synced" lines. */
export function relativeTime(epoch: number | null | undefined): string {
    return epoch ? relative(epoch) : 'never';
}

/** Decorative cloud, used when the panel wants an icon without a status. */
export function CloudGlyph({ className }: { className?: string }) {
    return <Cloud className={cn('w-4 h-4', className)} />;
}
