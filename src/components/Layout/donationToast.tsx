/** The "Support the Forge" donation toast and the fullscreen-modal guard that keeps it out of the way. */
import { toast } from 'react-toastify';
import { GameAssetIcon } from '../UI/GameAssetIcon';

/** True while a fullscreen modal (battle viewer, data-fullscreen-modal) covers the app. */
export function fullscreenModalOpen(): boolean {
    return Number(document.body.dataset.fullscreenModal || '0') > 0;
}

/** The donation toast: compact on phone (title and tap hint only), never over a fullscreen modal. */
export function showDonationToast(message: string) {
    if (fullscreenModalOpen()) return;
    const phone = window.matchMedia('(max-width: 639px)').matches;
    toast(
        <div className="flex flex-col gap-0.5 select-none">
            <div className="font-black text-[10px] uppercase tracking-widest text-[#FFDD00] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FFDD00] animate-pulse" />
                Support the Forge
            </div>
            {!phone && (
                <div className="font-bold text-sm leading-tight text-white">
                    {message}
                </div>
            )}
            <div className="text-[9px] mt-1 font-black uppercase text-white/40 flex items-center gap-1">
                {phone ? 'Tap to support the developer' : 'Click to support the developer'} <GameAssetIcon asset={{ icon: 'GiftIcon' }} size={14} className="inline-block align-middle animate-bounce" />
            </div>
        </div>,
        {
            toastId: DONATION_TOAST_ID,
            icon: phone ? false : <GameAssetIcon asset={{ icon: 'Anvil' }} size={24} />,
            autoClose: phone ? 5000 : 10000,
            position: "bottom-left",
            onClick: () => window.open('https://www.buymeacoffee.com/1vcian', '_blank'),
            className: `!bg-bg-secondary/90 !backdrop-blur-md !text-white border border-[#FFDD00]/30 shadow-[0_8px_32px_rgba(0,0,0,0.5)] cursor-pointer hover:border-[#FFDD00]/60 transition-all font-sans rounded-2xl${phone ? ' !min-h-0 !py-1.5 !px-3 !mx-3 !mb-3 !w-auto max-w-[260px]' : ''}`,
            progressClassName: "!bg-[#FFDD00]"
        }
    );
}

export const DONATION_TOAST_ID = 'support-the-forge';

/** Mark a fullscreen modal open (returns the cleanup); the donation toast stays away meanwhile. */
export function holdFullscreenModal(): () => void {
    const body = document.body;
    body.dataset.fullscreenModal = String(Number(body.dataset.fullscreenModal || '0') + 1);
    toast.dismiss(DONATION_TOAST_ID);
    return () => {
        const n = Math.max(0, Number(body.dataset.fullscreenModal || '1') - 1);
        if (n) body.dataset.fullscreenModal = String(n);
        else delete body.dataset.fullscreenModal;
    };
}
