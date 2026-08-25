/**
 * MergeDialog — the explicit "what should I keep?" screen.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The first time an account signs in on a device there are two sets of profiles that nobody has
 * ever reconciled: the ones in this browser and the ones on the server. Every automatic rule for
 * merging them (newest wins, server wins, biggest wins) throws away somebody's afternoon in some
 * case. So the app asks, once, per row — and the rows are phrased as *what happens to your data*,
 * not as sync jargon.
 *
 * Every row's default is the lossless option, and no choice on this screen can delete a profile
 * without the user selecting exactly that (only the `server-deleted` row offers it, and its
 * default is to keep the local copy).
 *
 * Reachable again later from the account panel ("Review differences"), which is also where a
 * divergence found mid-session shows up.
 *
 * It has a third job. "Sync now" reopens it when the only thing outstanding is a profile that has
 * never been uploaded — usually because the user said so here, once, and is now being offered the
 * chance to change their mind. Nothing *differs* in that case, so the header stops talking about
 * differences and says what is actually true; the rows themselves already read correctly.
 */

import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpFromLine, Copy, Loader2, MinusCircle, Trash2, X } from 'lucide-react';
import { Button } from '../UI/Button';
import { cn } from '../../lib/utils';
import type { MergeChoice, MergeRow } from '../../services/useProfileSync';

interface MergeDialogProps {
    rows: MergeRow[];
    busy: boolean;
    /** True for the once-per-account first login: the dialog then cannot be dismissed casually. */
    firstLogin: boolean;
    onChoose: (id: string, choice: MergeChoice) => void;
    onApply: () => void;
    onClose: () => void;
}

const KIND_TEXT: Record<MergeRow['kind'], { title: string; blurb: string }> = {
    'local-only': {
        title: 'Only in this browser',
        blurb: 'Never uploaded. Upload it to your account, or leave it here only.',
    },
    'server-only': {
        title: 'Only in your account',
        blurb: 'Saved on the server from another device. Download it into this browser, or leave it there.',
    },
    'unknown-base': {
        title: 'In both places',
        blurb: 'Both copies exist and this browser has no record of which is newer. Pick the one to keep. Or keep both.',
    },
    diverged: {
        title: 'Changed in both places',
        blurb: 'The server copy moved on since this browser last synced. Pick a winner, or keep both.',
    },
    'server-deleted': {
        title: 'Deleted on another device',
        blurb: 'Another device deleted this profile, but it is still here. Keep it (and restore it everywhere) or let it go.',
    },
};

/** Per-row wording, so "keep local" reads differently for an upload than for a conflict. */
function choiceLabel(kind: MergeRow['kind'], choice: MergeChoice): { label: string; icon: JSX.Element; hint: string } {
    if (choice === 'skip') {
        return {
            label: 'Leave as is',
            icon: <MinusCircle className="w-3.5 h-3.5" />,
            hint: 'Nothing is uploaded, downloaded or deleted.',
        };
    }
    if (choice === 'both') {
        return {
            label: 'Keep both',
            icon: <Copy className="w-3.5 h-3.5" />,
            hint: 'Your copy stays; the account copy arrives as an extra profile.',
        };
    }
    if (choice === 'local') {
        if (kind === 'local-only') {
            return { label: 'Upload', icon: <ArrowUpFromLine className="w-3.5 h-3.5" />, hint: 'Copy it to your account.' };
        }
        if (kind === 'server-deleted') {
            return { label: 'Keep it', icon: <ArrowUpFromLine className="w-3.5 h-3.5" />, hint: 'Restore it on every device.' };
        }
        return { label: 'Keep mine', icon: <ArrowUpFromLine className="w-3.5 h-3.5" />, hint: 'This browser wins; the account copy is replaced.' };
    }
    // 'server'
    if (kind === 'server-only') {
        return { label: 'Download', icon: <ArrowDownToLine className="w-3.5 h-3.5" />, hint: 'Add it to this browser.' };
    }
    if (kind === 'server-deleted') {
        return { label: 'Accept delete', icon: <Trash2 className="w-3.5 h-3.5" />, hint: 'Remove it from this browser too.' };
    }
    return { label: 'Take theirs', icon: <ArrowDownToLine className="w-3.5 h-3.5" />, hint: 'The account copy replaces this one.' };
}

const stamp = (epoch: number | null): string =>
    epoch ? new Date(epoch).toLocaleString() : '—';

export function MergeDialog({ rows, busy, firstLogin, onChoose, onApply, onClose }: MergeDialogProps) {
    const destructive = rows.filter(r => r.kind === 'server-deleted' && r.choice === 'server').length;
    // Derived rather than passed in: "every row is a profile that is not in the account" is a fact
    // about the rows, and a prop would be a second copy of it that could disagree.
    const uploadOnly = rows.every(r => r.kind === 'local-only');

    return createPortal(
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
            onClick={e => { if (e.target === e.currentTarget && !firstLogin && !busy) onClose(); }}
        >
            <div className="bg-bg-primary w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-border shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 p-6 pb-4 border-b border-border">
                    <div className="min-w-0">
                        <h3 className="text-xl font-black text-white">
                            {firstLogin
                                ? 'Merge your profiles'
                                : uploadOnly
                                    ? 'Profiles not in your account'
                                    : 'Review differences'}
                        </h3>
                        <p className="text-sm text-text-secondary mt-1">
                            {firstLogin
                                ? 'This browser and your account each have profiles. Choose what happens to each one. Nothing is uploaded, downloaded or deleted until you confirm.'
                                : uploadOnly
                                    ? 'These profiles exist only in this browser. Upload the ones you want in your account. The others stay here, and nothing is deleted either way.'
                                    : 'These profiles differ between this browser and your account. Nothing has been overwritten.'}
                        </p>
                    </div>
                    {!firstLogin && (
                        <button
                            onClick={onClose}
                            disabled={busy}
                            className="p-1.5 rounded-lg text-text-muted hover:text-white hover:bg-white/10 transition disabled:opacity-40"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {/* Rows */}
                <div className="overflow-y-auto px-6 py-4 space-y-3">
                    {rows.map(row => {
                        const kind = KIND_TEXT[row.kind];
                        const name = row.localName || row.serverName || 'Profile';
                        return (
                            <div key={row.id} className="rounded-xl border border-border bg-bg-secondary/60 p-4">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="font-bold text-text-primary whitespace-nowrap overflow-hidden text-clip max-w-full">{name}</span>
                                    <span className="text-[10px] uppercase tracking-widest font-bold text-accent-primary/90 bg-accent-primary/15 rounded px-1.5 py-0.5">
                                        {kind.title}
                                    </span>
                                </div>
                                <p className="text-xs text-text-secondary mt-1.5">{kind.blurb}</p>

                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-text-muted">
                                    <div>
                                        This browser:{' '}
                                        <span className="text-text-secondary">
                                            {row.localName ? row.localName : 'not present'}
                                        </span>
                                    </div>
                                    <div>
                                        Your account:{' '}
                                        <span className="text-text-secondary">
                                            {row.serverName ? `${row.serverName} · saved ${stamp(row.serverUpdatedAt)}` : 'not present'}
                                        </span>
                                    </div>
                                    {row.lastSyncedAt && (
                                        <div className="sm:col-span-2">
                                            Last synced from this browser: {stamp(row.lastSyncedAt)}
                                        </div>
                                    )}
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {row.choices.map(choice => {
                                        const { label, icon, hint } = choiceLabel(row.kind, choice);
                                        const selected = row.choice === choice;
                                        const isDelete = row.kind === 'server-deleted' && choice === 'server';
                                        return (
                                            <button
                                                key={choice}
                                                type="button"
                                                title={hint}
                                                disabled={busy}
                                                onClick={() => onChoose(row.id, choice)}
                                                className={cn(
                                                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50',
                                                    selected
                                                        ? isDelete
                                                            ? 'border-accent-secondary bg-accent-secondary/20 text-red-200'
                                                            : 'border-accent-primary bg-accent-primary/20 text-accent-primary'
                                                        : 'border-border text-text-secondary hover:border-accent-primary/50 hover:text-text-primary',
                                                )}
                                            >
                                                {icon}
                                                {label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-6 pt-4 border-t border-border">
                    <p className="text-xs text-text-muted max-w-md">
                        {destructive > 0
                            ? `${destructive} profile${destructive === 1 ? '' : 's'} will be removed from this browser.`
                            : 'Nothing on this screen deletes a profile.'}
                    </p>
                    <div className="flex gap-2 ml-auto">
                        {!firstLogin && (
                            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                        )}
                        <Button onClick={onApply} disabled={busy}>
                            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying</> : 'Apply'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
