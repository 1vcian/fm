import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Settings, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AccountPanel } from './AccountPanel';
import { AppsThatLink, LinkedAppsPanel } from './LinkedAppsPanel';
import { linkedAppsEnabled } from '../../services/profileLinks';

/**
 * Account settings in one window: sign-in and sync, clan sync, notifications, and the apps linked
 * to the active profile (signed in only, and only with debug=1 for now). Opened from the Settings button on the profile page.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
    const auth = useAuth();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    // z-[90]: under ConfirmModal (100) and the sync dialogs (120, 130) these panels open.
    return createPortal(
        <div className="fixed inset-0 z-[90] flex items-start md:items-center justify-center bg-black/80 backdrop-blur-sm p-2 md:p-4"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-label="Settings" className="bg-bg-primary text-text-primary w-full max-w-4xl max-h-[95dvh] rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                    <Settings className="w-5 h-5 text-accent-primary" />
                    <h2 className="flex-1 font-black text-lg">Settings</h2>
                    <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4">
                    <AccountPanel />
                    {!linkedAppsEnabled() ? null : auth.status === 'signed-in'
                        ? <LinkedAppsPanel defaultOpen />
                        : <div className="rounded-2xl border border-border bg-bg-secondary/30 px-4 py-3 text-xs text-text-secondary"><span className="font-bold text-text-primary">Linked apps.</span> Sign in to let another app read this profile or send it updates.<div className="mt-1"><AppsThatLink /></div></div>}
                </div>
            </div>
        </div>,
        document.body,
    );
}
