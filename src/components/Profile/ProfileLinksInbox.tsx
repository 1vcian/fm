import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameData } from '../../hooks/useGameData';
import { useGameLimits } from '../../hooks/useGameLimits';
import { applyChanges } from '../../utils/ocr/autoSync';
import { EXCHANGE_CURRENT, exchangeRows, profileToExchange } from '../../utils/profileExchange';
import { linkedAppsEnabled, listLinks, pendingPushes, resolvePush, setExport, type PendingPush } from '../../services/profileLinks';
import { AutoSyncModal } from './AutoSyncModal';

/** How often the pending updates are fetched while the site is open (and on focus). */
const POLL_MS = 120_000;
/** The export apps read is refreshed this long after the last edit. */
const EXPORT_DEBOUNCE_MS = 5_000;

/**
 * Updates sent by apps through profile links (supabase/migrations/0012_profile_links.sql), for the
 * signed-in owner: a banner lists them, Review opens them in the AutoSync review, and a link with
 * auto apply is applied as soon as its profile is the active one. It also keeps the export that
 * apps read (profile_link_read) in step with the active profile when that profile has a read link.
 */
export function ProfileLinksInbox() {
    const auth = useAuth();
    // Off unless app links are enabled (debug=1 for now): no polling, no export, no banner.
    const signedIn = auth.status === 'signed-in' && linkedAppsEnabled();
    const { profile, profiles, activeProfileId, switchProfile, updateProfile } = useProfile();
    const limits = useGameLimits();
    const { data: autoItemMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: localization } = useGameData<any>('Localization.json');
    const ctx = useMemo(() => ({ autoItemMapping, localization, limits }), [autoItemMapping, localization, limits]);

    const [pending, setPending] = useState<PendingPush[]>([]);
    const [reviewing, setReviewing] = useState<string | null>(null);
    const [hidden, setHidden] = useState(false);
    const busy = useRef(new Set<string>());

    const refresh = useCallback(async () => {
        if (!signedIn) { setPending([]); return; }
        const r = await pendingPushes();
        if (r.ok) setPending(r.data ?? []);
    }, [signedIn]);

    useEffect(() => {
        refresh();
        if (!signedIn) return;
        const t = setInterval(refresh, POLL_MS);
        const onFocus = () => refresh();
        window.addEventListener('focus', onFocus);
        return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
    }, [signedIn, refresh]);

    const resolve = useCallback(async (id: string, status: 'applied' | 'dismissed') => {
        setPending(ps => ps.filter(p => p.id !== id));
        const r = await resolvePush(id, status);
        if (!r.ok) toast.error(`Could not mark the update as ${status}: ${r.error}`);
    }, []);

    // Auto apply: only on the active profile, only once the game limits are loaded, and only a
    // document this site can read. Anything else waits in the banner.
    useEffect(() => {
        if (!limits || profile.isShared || profile.preset) return;
        for (const p of pending) {
            if (!p.auto_apply || p.profile_id !== activeProfileId || busy.current.has(p.id)) continue;
            const { rows, errors } = exchangeRows(p.format_version, p.payload, profile, ctx);
            if (errors.length) continue;
            busy.current.add(p.id);
            const accepted = rows.filter(r => r.accepted);
            if (accepted.length) updateProfile(applyChanges(profile, rows, { savePresets: false }));
            const held = rows.length - accepted.length;
            toast.success(`${profile.name} updated from ${p.link_label}: ${accepted.length} change${accepted.length === 1 ? '' : 's'}${held ? `, ${held} outside the game's limits left out` : ''}`);
            resolve(p.id, 'applied');
        }
    }, [pending, activeProfileId, profile, limits, ctx, updateProfile, resolve]);

    // The export apps read, for the active profile when it has a read link.
    const [readable, setReadable] = useState(false);
    useEffect(() => {
        setReadable(false);
        if (!signedIn || !activeProfileId) return;
        let live = true;
        listLinks(activeProfileId).then(r => { if (live && r.ok) setReadable((r.data ?? []).some(l => l.can_read)); });
        return () => { live = false; };
    }, [signedIn, activeProfileId]);
    const lastExport = useRef('');
    useEffect(() => {
        // Wait for the configs so the export carries the trees' totals.
        if (!readable || !limits || profile.isShared || profile.preset) return;
        const data = profileToExchange(profile, limits);
        const json = JSON.stringify(data);
        if (json === lastExport.current) return;
        const t = setTimeout(async () => {
            const r = await setExport(profile.id, EXCHANGE_CURRENT, data);
            if (r.ok) lastExport.current = json;
        }, EXPORT_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [readable, profile, limits]);

    const review = pending.find(p => p.id === reviewing) ?? null;
    const reviewRows = useMemo(() => (review && review.profile_id === activeProfileId ? exchangeRows(review.format_version, review.payload, profile, ctx) : null),
        // Built once per opened update: later profile edits must not rebuild the rows under the user.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [review?.id, activeProfileId, ctx]);

    const open = (p: PendingPush) => {
        if (p.profile_id !== activeProfileId) switchProfile(p.profile_id);
        setReviewing(p.id);
    };

    const shown = pending.filter(p => !(p.auto_apply && p.profile_id === activeProfileId && limits));
    const nameOf = (id: string) => profiles.find(x => x.id === id)?.name;

    return (
        <>
            {signedIn && shown.length > 0 && !hidden && !review && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] w-[calc(100%-2rem)] max-w-md rounded-2xl border border-accent-primary/50 bg-bg-secondary/95 backdrop-blur shadow-2xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-sm font-bold text-text-primary">{shown.length === 1 ? 'An app sent an update' : `Apps sent ${shown.length} updates`}</span>
                        <button onClick={() => setHidden(true)} title="Hide until the next visit" className="p-1 rounded-md text-text-muted hover:bg-white/10"><X className="w-4 h-4" /></button>
                    </div>
                    {shown.map(p => {
                        const name = nameOf(p.profile_id);
                        const { errors } = exchangeRows(p.format_version, p.payload, profile, ctx);
                        return (
                            <div key={p.id} className="flex items-center gap-2 text-xs">
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-text-primary">{p.link_label} for {name ?? 'a profile not on this device'}</div>
                                    <div className="text-[10px] text-text-muted">{new Date(p.created_at).toLocaleString()}{errors.length ? `: ${errors[0]}` : ''}</div>
                                </div>
                                {name && !errors.length && (
                                    <button onClick={() => open(p)} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-accent-primary text-white font-bold hover:brightness-110">Review</button>
                                )}
                                <button onClick={() => resolve(p.id, 'dismissed')} className="shrink-0 px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-bg-input">Dismiss</button>
                            </div>
                        );
                    })}
                </div>
            )}
            {review && reviewRows && !reviewRows.errors.length && (
                <AutoSyncModal
                    onClose={() => setReviewing(null)}
                    incoming={{
                        rows: reviewRows.rows,
                        source: review.link_label,
                        onApplied: () => resolve(review.id, 'applied'),
                        onDismiss: () => resolve(review.id, 'dismissed'),
                    }}
                />
            )}
        </>
    );
}
