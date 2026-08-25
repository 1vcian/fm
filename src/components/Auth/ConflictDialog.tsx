/**
 * ConflictDialog — a push was refused because the server row had moved on.
 *
 * This is the *live* counterpart of the merge screen: it appears mid-session, for exactly one
 * profile, when `update  where version = <base>` matched zero rows. That only happens when
 * another device (or another tab) wrote the same profile after this browser last synced.
 *
 * The three answers are the only three that lose nothing on purpose:
 *
 *   Keep mine       overwrite the account copy with what is in this browser
 *   Take theirs     replace what is in this browser with the account copy
 *   Duplicate mine  the local copy becomes a NEW profile, and this one takes the account copy —
 *                   the option to pick when you are not sure, because both survive
 *
 * The dialog cannot be dismissed without answering: leaving it open would mean the profile keeps
 * failing to sync with no visible reason. (The rest of the app stays fully usable behind it —
 * `localStorage` never stopped working.)
 */

import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpFromLine, Copy, Loader2, GitBranch } from 'lucide-react';
import type { ConflictInfo, ConflictResolution } from '../../services/useProfileSync';

interface ConflictDialogProps {
    conflict: ConflictInfo;
    busy: boolean;
    onResolve: (resolution: ConflictResolution) => void;
}

const OPTIONS: {
    key: ConflictResolution;
    label: string;
    detail: string;
    icon: JSX.Element;
    tone: string;
}[] = [
    {
        key: 'mine',
        label: 'Keep mine',
        detail: 'Upload this browser\'s copy and replace the one in your account.',
        icon: <ArrowUpFromLine className="w-4 h-4" />,
        tone: 'hover:border-accent-primary/70 hover:bg-accent-primary/10',
    },
    {
        key: 'theirs',
        label: 'Take theirs',
        detail: 'Download the account copy and replace what is in this browser.',
        icon: <ArrowDownToLine className="w-4 h-4" />,
        tone: 'hover:border-accent-primary/70 hover:bg-accent-primary/10',
    },
    {
        key: 'duplicate',
        label: 'Duplicate mine',
        detail: 'Keep both: this browser\'s copy becomes a new profile, and this one takes the account copy.',
        icon: <Copy className="w-4 h-4" />,
        tone: 'hover:border-emerald-500/70 hover:bg-emerald-500/10',
    },
];

export function ConflictDialog({ conflict, busy, onResolve }: ConflictDialogProps) {
    const when = conflict.serverUpdatedAt ? new Date(conflict.serverUpdatedAt).toLocaleString() : 'recently';

    return createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <div className="bg-bg-primary w-full max-w-lg rounded-2xl border border-accent-tertiary/40 shadow-2xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent-tertiary/20 flex items-center justify-center shrink-0">
                        <GitBranch className="w-5 h-5 text-accent-tertiary" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-black text-white">Two versions of “{conflict.localName}”</h3>
                        <p className="text-sm text-text-secondary mt-1">
                            Another device changed this profile ({when}) after this browser last synced it.
                            Nothing has been overwritten. Pick what should happen.
                        </p>
                    </div>
                </div>

                <div className="space-y-2">
                    {OPTIONS.map(option => (
                        <button
                            key={option.key}
                            type="button"
                            disabled={busy}
                            onClick={() => onResolve(option.key)}
                            className={`w-full text-left flex items-start gap-3 rounded-xl border border-border bg-bg-secondary/60 p-3.5 transition disabled:opacity-50 ${option.tone}`}
                        >
                            <span className="mt-0.5 text-accent-primary shrink-0">{option.icon}</span>
                            <span className="min-w-0">
                                <span className="block font-bold text-text-primary">{option.label}</span>
                                <span className="block text-xs text-text-secondary">{option.detail}</span>
                            </span>
                        </button>
                    ))}
                </div>

                {busy && (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
