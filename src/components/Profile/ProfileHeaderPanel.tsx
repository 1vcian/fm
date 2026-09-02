import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useProfile } from '../../context/ProfileContext';
import { useGameDataContext } from '../../context/GameDataContext';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { Pencil, Check, X, Trophy, Coffee } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSkinSets } from '../../hooks/useSkinSets';
import { useGameData } from '../../hooks/useGameData';

/**
 * CardIcons.png is a square atlas of profile avatars, 2048px on both axes in every version
 * shipped so far.
 *
 * Neither the icon count nor the grid pitch can be hardcoded. The 2026_09_02_09_08 build
 * halved each icon and so doubled the grid from 8 to 16 per row, which is what made every
 * tile in the picker render a 2x2 block of four avatars and left the tail blank. The game
 * ships the highest valid index as ProfileBaseConfig.IconsCount (63 before that build, 127
 * after), and the icons are packed into a square power-of-two grid, so the pitch follows
 * from the count: 64 icons fit an 8x8 grid, 128 need 16x16.
 *
 * The atlas URL stays pinned to `selectedVersion` rather than going through
 * resolveTextureVersion(): the count comes from that version's config, so falling back to an
 * older texture folder would pair a new count with an old pitch and reintroduce the same
 * misalignment.
 *
 * The atlas has no vertical gutter: measured across both grids the art runs right to the top
 * and bottom cell edges (padding median 0 on both), while horizontally it keeps about 8% of a
 * cell clear. Sampling exactly on the grid therefore lets a thin strip of the icon above bleed
 * into the top of the tile. CELL_INSET crops that away by drawing each cell slightly larger
 * than the tile and showing its middle, which trims top and bottom equally. Nudging the window
 * downwards instead would remove the strip from above only by pulling in the icon below, and
 * the inset is a fraction of a cell rather than a pixel count so it holds for both grids.
 */
const CELL_INSET = 0.06;
/** The square power-of-two grid that holds `count` icons. */
function iconsPerRow(count: number): number {
    let perRow = 1;
    while (perRow * perRow < count) perRow *= 2;
    return perRow;
}

/** Icon count and grid pitch for the selected version's atlas. */
function useProfileIconAtlas() {
    const { data } = useGameData<{ IconsCount: number }>('ProfileBaseConfig.json');
    // IconsCount is the highest valid index, so the number of icons is one more.
    const count = (data?.IconsCount ?? 63) + 1;
    return { count, perRow: iconsPerRow(count) };
}

interface ProfileIconProps {
    iconIndex: number;
    size?: number;
    className?: string;
    onClick?: () => void;
}

export function ProfileIcon({ iconIndex, size = 48, className, onClick }: ProfileIconProps) {
    const { selectedVersion } = useGameDataContext();
    const { perRow } = useProfileIconAtlas();

    if (iconIndex === -1) {
        return (
            <div
                onClick={onClick}
                className={cn(
                    "rounded-lg overflow-hidden bg-bg-secondary border-2 border-border shrink-0 flex items-center justify-center text-[#FFDD00]",
                    onClick && "cursor-pointer hover:border-[#FFDD00] transition-colors",
                    className
                )}
                style={{ width: size, height: size }}
            >
                <Coffee size={size * 0.6} className="fill-current" />
            </div>
        );
    }

    const col = iconIndex % perRow;
    const row = Math.floor(iconIndex / perRow);

    // Each cell is drawn at size * zoom and the tile shows the middle `size` of it, so
    // CELL_INSET of a cell is trimmed from every edge.
    const zoom = 1 + 2 * CELL_INSET;
    const bgSize = size * perRow * zoom;
    const posX = col * size * zoom + size * CELL_INSET;
    const posY = row * size * zoom + size * CELL_INSET;

    return (
        <div
            onClick={onClick}
            className={cn(
                "rounded-lg overflow-hidden bg-bg-secondary border-2 border-border shrink-0",
                onClick && "cursor-pointer hover:border-accent-primary transition-colors",
                className
            )}
            style={{
                width: size,
                height: size,
                backgroundImage: `url(${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}CardIcons.png)`,
                backgroundPosition: `-${posX}px -${posY}px`,
                backgroundSize: `${bgSize}px ${bgSize}px`,
            }}
        />
    );
}

interface IconSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (iconIndex: number) => void;
    currentIndex: number;
}

function IconSelectorModal({ isOpen, onClose, onSelect, currentIndex }: IconSelectorModalProps) {
    // Read before the early return so the hook order stays stable across open/closed renders.
    const { count } = useProfileIconAtlas();

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-bg-primary w-full max-w-md rounded-2xl border border-border shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary rounded-t-2xl">
                    <h3 className="text-lg font-bold text-text-primary">Select Profile Icon</h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-text-primary">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-4 grid grid-cols-8 gap-1.5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Secret Supporter Icon */}
                    <ProfileIcon
                        iconIndex={-1}
                        size={44}
                        onClick={() => {
                            onSelect(-1);
                            onClose();
                        }}
                        className={cn(
                            "hover:scale-110 transition-transform bg-[#FFDD00]/10 border-[#FFDD00]/30",
                            currentIndex === -1 && "ring-2 ring-[#FFDD00]"
                        )}
                    />
                    
                    {Array.from({ length: count }, (_, i) => (
                        <ProfileIcon
                            key={i}
                            iconIndex={i}
                            size={44}
                            onClick={() => {
                                onSelect(i);
                                onClose();
                            }}
                            className={cn(
                                "hover:scale-110 transition-transform",
                                currentIndex === i && "ring-2 ring-accent-primary"
                            )}
                        />
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}

export function ProfileHeaderPanel() {
    const { profile, renameProfile, setProfileIcon, isNameTaken } = useProfile();
    const { sets } = useSkinSets();
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(profile.name);
    const [nameError, setNameError] = useState('');
    const [isIconModalOpen, setIsIconModalOpen] = useState(false);

    const handleStartEdit = () => {
        setEditName(profile.name);
        setNameError('');
        setIsEditing(true);
    };

    const handleSaveName = () => {
        const trimmedName = editName.trim();
        if (!trimmedName) {
            setNameError('Name cannot be empty');
            return;
        }
        if (isNameTaken(trimmedName, profile.id)) {
            setNameError('This name is already used');
            return;
        }
        renameProfile(trimmedName);
        setIsEditing(false);
        setNameError('');
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditName(profile.name);
        setNameError('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSaveName();
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    };

    return (
        <Card className="p-6">
            <div className="flex items-center gap-4">
                {/* Profile Icon */}
                <div className="relative group">
                    <ProfileIcon
                        iconIndex={profile.iconIndex}
                        size={72}
                        onClick={() => setIsIconModalOpen(true)}
                        className="group-hover:border-accent-primary"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl cursor-pointer"
                        onClick={() => setIsIconModalOpen(true)}
                    >
                        <Pencil className="w-5 h-5 text-white" />
                    </div>
                </div>

                {/* Profile Name */}
                <div className="flex-1 min-w-0">
                    {isEditing ? (
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <Input
                                    value={editName}
                                    onChange={(e) => {
                                        setEditName(e.target.value);
                                        setNameError('');
                                    }}
                                    onKeyDown={handleKeyDown}
                                    className="text-xl font-bold h-10"
                                    autoFocus
                                    placeholder="Profile name"
                                />
                                <Button variant="ghost" size="sm" onClick={handleSaveName} className="text-green-400 hover:text-green-300">
                                    <Check className="w-5 h-5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={handleCancelEdit} className="text-red-400 hover:text-red-300">
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                            {nameError && (
                                <p className="text-xs text-red-400">{nameError}</p>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group/name">
                            <h2 className="text-2xl font-bold whitespace-nowrap overflow-hidden text-clip">{profile.name}</h2>
                            <button
                                onClick={handleStartEdit}
                                className="p-1 text-text-muted hover:text-accent-primary opacity-0 group-hover/name:opacity-100 transition-opacity"
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                    <p className="text-sm text-text-muted mt-1">
                        Click the icon to change it
                    </p>
                    
                    {/* Skin Set Summary */}
                    <div className="flex flex-wrap gap-2 mt-3">
                        {sets.filter(s => s.isComplete).map(set => (
                            <div 
                                key={set.setId}
                                className="flex items-center gap-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.05)] animate-in fade-in zoom-in duration-500"
                                title={`${set.setId.replace(/Set$/, '')} Set Complete!`}
                            >
                                <Trophy className="w-3 h-3" />
                                <span>{set.setId.replace(/Set$/, '')}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <IconSelectorModal
                isOpen={isIconModalOpen}
                onClose={() => setIsIconModalOpen(false)}
                onSelect={setProfileIcon}
                currentIndex={profile.iconIndex}
            />
        </Card>
    );
}
