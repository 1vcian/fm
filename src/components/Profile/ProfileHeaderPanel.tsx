import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useProfile } from '../../context/ProfileContext';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { Input } from '../UI/Input';
import { Pencil, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

// CardIcons.png is 8x8 spritesheet with offset
const ICONS_PER_ROW = 8;
const TOTAL_ICONS = 64;
const SPRITE_OFFSET_X = 5; // Horizontal padding offset
const SPRITE_OFFSET_Y = 7; // Vertical padding offset
const ORIGINAL_SHEET_SIZE = 1024;

interface ProfileIconProps {
    iconIndex: number;
    size?: number;
    className?: string;
    onClick?: () => void;
}

export function ProfileIcon({ iconIndex, size = 48, className, onClick }: ProfileIconProps) {
    const col = iconIndex % ICONS_PER_ROW;
    const row = Math.floor(iconIndex / ICONS_PER_ROW);

    // Scale factor from original to display size
    const scale = size / (ORIGINAL_SHEET_SIZE / ICONS_PER_ROW);

    // Calculate position accounting for the offset in the spritesheet
    const cellSize = ORIGINAL_SHEET_SIZE / ICONS_PER_ROW; // 128px per cell
    const posX = (col * cellSize + SPRITE_OFFSET_X) * scale;
    const posY = (row * cellSize + SPRITE_OFFSET_Y) * scale;
    const bgSize = ORIGINAL_SHEET_SIZE * scale;

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
                backgroundImage: `url(./Texture2D/CardIcons.png)`,
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
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
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
                    {Array.from({ length: TOTAL_ICONS }, (_, i) => (
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
                            <h2 className="text-2xl font-bold truncate">{profile.name}</h2>
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
