import { useState } from 'react';
import { Shield } from 'lucide-react';
import Emblems from './Emblems';
import { CharacterMaker } from '../components/ImagesMaker/CharacterMaker';
import { cn } from '../lib/utils';
import { GameAssetIcon, gameIcon } from '../components/UI/GameAssetIcon';

/** The character tab: a character icon from the game. */
const CharacterIcon = gameIcon({ icon: 'SteppingStoneCharIcon0' });

/**
 * Images Maker: the clan emblem designer and the character maker, each exporting a PNG.
 */
export default function ImagesMaker({ initialTab = 'character' }: { initialTab?: 'character' | 'emblem' }) {
    const [tab, setTab] = useState<'character' | 'emblem'>(initialTab);
    return (
        <div className="w-full space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2"><GameAssetIcon asset={{ icon: 'Pen' }} size={28} /> Images Maker</h1>
                    <p className="text-sm text-text-secondary mt-1">Build a character or a clan emblem with the game's own art and export it as a PNG.</p>
                </div>
                <div className="flex rounded-xl border border-border overflow-hidden text-sm font-bold self-start">
                    {([['character', 'Character', CharacterIcon], ['emblem', 'Clan emblem', Shield]] as const).map(([id, label, Icon]) => (
                        <button key={id} onClick={() => setTab(id)} className={cn('px-4 py-2 inline-flex items-center gap-1.5', tab === id ? 'bg-accent-primary text-white' : 'text-text-secondary hover:bg-bg-input')}>
                            <Icon size={16} className="w-4 h-4" /> {label}
                        </button>
                    ))}
                </div>
            </div>
            {tab === 'character' ? <CharacterMaker /> : <Emblems />}
        </div>
    );
}
