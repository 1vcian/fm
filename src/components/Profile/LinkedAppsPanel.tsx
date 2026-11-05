import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ChevronDown, Copy, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useGameLimits } from '../../hooks/useGameLimits';
import { EXCHANGE_CURRENT, profileToExchange } from '../../utils/profileExchange';
import { createLink, listLinks, revokeLink, rotateLink, setAutoApply, setExport, type ProfileLink } from '../../services/profileLinks';
import { ConfirmModal } from '../UI/ConfirmModal';
import { cn } from '../../lib/utils';

/** The first app that links profiles; the field starts with its name. */
const DEFAULT_LABEL = 'Forge Master Companion by Bobski';
/** Apps that can link a profile today, shown so players know where to get one. */
export const LINKABLE_APPS = [
    { name: 'Forge Master Companion by Bobski', store: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.bobski.forgemastercompanion' },
];

/** Where an app's developer finds the format and the calls (public/profile-exchange/). */
const SPEC_URL = `${import.meta.env.BASE_URL}profile-exchange/v1.md`;

/**
 * "Linked apps" on the profile page: keys that let another app read this profile or send it
 * updates (supabase/migrations/0012_profile_links.sql). A key is shown once, when it is made or
 * rotated; revoking it cuts the app off at once. Signed-in owners of a synced profile only.
 */
export function LinkedAppsPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
    const auth = useAuth();
    const { profile } = useProfile();
    const limits = useGameLimits();
    const [open, setOpen] = useState(defaultOpen);
    const [links, setLinks] = useState<ProfileLink[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [label, setLabel] = useState(DEFAULT_LABEL);
    const [canRead, setCanRead] = useState(true);
    const [canWrite, setCanWrite] = useState(true);
    const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
    const [toRevoke, setToRevoke] = useState<ProfileLink | null>(null);
    const [working, setWorking] = useState(false);

    const load = useCallback(async () => {
        const r = await listLinks(profile.id);
        if (r.ok) { setLinks(r.data ?? []); setError(null); } else setError(r.error);
    }, [profile.id]);
    useEffect(() => { setFresh(null); setLinks(null); if (open && auth.status === 'signed-in') load(); }, [open, auth.status, load]);

    if (auth.status !== 'signed-in' || profile.isShared || profile.preset) return null;

    const pushExport = () => setExport(profile.id, EXCHANGE_CURRENT, profileToExchange(profile, limits));
    const create = async () => {
        setWorking(true);
        const r = await createLink(profile.id, label.trim(), canRead, canWrite);
        setWorking(false);
        if (!r.ok) {
            setError(/profile not found/i.test(r.error) ? 'This profile is not on your account yet: sync it first (Account above), then make the key.' : r.error);
            return;
        }
        setFresh(r.data);
        setLabel(DEFAULT_LABEL);
        if (canRead) await pushExport();
        load();
    };
    const rotate = async (l: ProfileLink) => {
        const r = await rotateLink(l.id);
        if (r.ok) setFresh(r.data); else toast.error(r.error);
        load();
    };
    const revoke = async (l: ProfileLink) => {
        const r = await revokeLink(l.id);
        if (!r.ok) toast.error(r.error);
        if (fresh?.id === l.id) setFresh(null);
        load();
    };
    const toggleAuto = async (l: ProfileLink) => {
        const r = await setAutoApply(l.id, !l.auto_apply);
        if (!r.ok) toast.error(r.error);
        load();
    };
    const copy = (text: string) => navigator.clipboard.writeText(text)
        .then(() => toast.success('Key copied'), () => toast.error('Could not copy: the browser blocked the clipboard'));
    const when = (s: string | null) => (s ? new Date(s).toLocaleString() : 'never');

    return (
        <div className="rounded-2xl border border-border bg-bg-secondary/30">
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <KeyRound className="w-5 h-5 text-accent-primary shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-text-primary">Linked apps</div>
                    <div className="text-xs text-text-secondary">Let another app read {profile.name} or send it updates, with a key you can revoke.</div>
                </div>
                <ChevronDown className={cn('w-4 h-4 text-text-muted transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="px-4 pb-4 space-y-3 text-xs">
                    {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}

                    {fresh && (
                        <div className="rounded-xl border border-amber-400/60 bg-amber-400/10 p-3 space-y-2">
                            <div className="font-bold text-amber-200">Copy the key now: it is shown only this once.</div>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 min-w-0 break-all font-mono text-[11px] text-text-primary bg-black/30 rounded-lg px-2 py-1.5">{fresh.token}</code>
                                <button onClick={() => copy(fresh.token)} className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-accent-primary text-white font-bold"><Copy className="w-3.5 h-3.5" /> Copy</button>
                            </div>
                            <div className="text-text-muted">Paste it in the app. Lost it? Rotate the key for a new one.</div>
                        </div>
                    )}

                    {links === null && !error && <div className="text-text-muted">Loading</div>}
                    {links?.length === 0 && <div className="text-text-muted">No app is linked to this profile.</div>}
                    {links?.map(l => (
                        <div key={l.id} className="rounded-xl border border-border bg-bg-input/30 p-3 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-text-primary">{l.label}</span>
                                {l.can_read && <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-200 text-[10px] font-bold uppercase">read</span>}
                                {l.can_write && <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-200 text-[10px] font-bold uppercase">send updates</span>}
                                <span className="ml-auto text-[10px] text-text-muted">last used {when(l.last_used_at)}</span>
                            </div>
                            {l.can_write && (
                                <label className="flex items-center gap-2 text-text-secondary cursor-pointer">
                                    <input type="checkbox" checked={l.auto_apply} onChange={() => toggleAuto(l)} className="w-3.5 h-3.5 accent-accent-primary" />
                                    Apply its updates without asking (values outside the game's limits are still left out)
                                </label>
                            )}
                            <div className="flex gap-2">
                                <button onClick={() => rotate(l)} title="A new key for this app: the old one stops working" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-bg-input"><RefreshCw className="w-3.5 h-3.5" /> New key</button>
                                <button onClick={() => setToRevoke(l)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10"><Trash2 className="w-3.5 h-3.5" /> Revoke</button>
                            </div>
                        </div>
                    ))}

                    <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
                        <div className="font-bold text-text-primary">Link an app</div>
                        <AppsThatLink />
                        <input value={label} onChange={e => setLabel(e.target.value.slice(0, 40))} placeholder={DEFAULT_LABEL}
                            className="w-full px-3 py-2 rounded-lg bg-bg-input border border-border text-text-primary" />
                        <div className="flex flex-wrap gap-4 text-text-secondary">
                            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={canRead} onChange={e => setCanRead(e.target.checked)} className="accent-accent-primary" /> Can read this profile</label>
                            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={canWrite} onChange={e => setCanWrite(e.target.checked)} className="accent-accent-primary" /> Can send updates</label>
                        </div>
                        <button onClick={create} disabled={working || !label.trim() || !(canRead || canWrite)}
                            className="px-3 py-2 rounded-lg bg-accent-primary text-white font-bold disabled:opacity-40">Make a key</button>
                        <div className="text-[11px] text-text-muted">
                            Updates arrive as proposals you review before they change anything. For app developers: <a href={SPEC_URL} target="_blank" rel="noreferrer" className="text-accent-primary hover:underline">the format and the calls</a>.
                        </div>
                    </div>
                </div>
            )}
            <ConfirmModal
                isOpen={!!toRevoke}
                title="Revoke key"
                message={`"${toRevoke?.label ?? ''}" will no longer read or update ${profile.name}. Its pending updates are dropped.`}
                confirmText="Revoke"
                variant="danger"
                onConfirm={() => { if (toRevoke) revoke(toRevoke); setToRevoke(null); }}
                onCancel={() => setToRevoke(null)}
            />
        </div>
    );
}

/** Where to get an app that can link: one line per app, with its store link. */
export function AppsThatLink() {
    return (
        <div className="text-[11px] text-text-secondary">
            Apps that can link: {LINKABLE_APPS.map((a, i) => (
                <span key={a.url}>{i > 0 && ', '}<a href={a.url} target="_blank" rel="noreferrer" className="font-bold text-accent-primary hover:underline">{a.name}</a> ({a.store})</span>
            ))}.
        </div>
    );
}
