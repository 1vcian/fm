import { useState, useRef, useEffect } from 'react';
import { Menu, ChevronDown, Copy, Trash2, Check, Share2, Save } from 'lucide-react';
import { toast } from 'react-toastify';
import LZString from 'lz-string';
import { Button } from '../UI/Button';
import { useTreeMode, TreeMode } from '../../context/TreeModeContext';
import { useProfile } from '../../context/ProfileContext';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { ConfirmModal } from '../UI/ConfirmModal';
import { cn } from '../../lib/utils';
import { useGlobalStats } from '../../hooks/useGlobalStats';
import { formatCompactNumber } from '../../utils/statsCalculator';

interface HeaderProps {
    onMenuToggle: () => void;
}

const treeModeLabels: Record<TreeMode, string> = {
    empty: 'Empty Tree',
    my: 'My Tree',
    max: 'Max Tree'
};

const treeModeColors: Record<TreeMode, string> = {
    empty: 'bg-gray-600 text-gray-200',
    my: 'bg-blue-600 text-blue-100',
    max: 'bg-emerald-600 text-emerald-100'
};

export function Header({ onMenuToggle }: HeaderProps) {
    const { treeMode, cycleTreeMode } = useTreeMode();
    const { profile, profiles, activeProfileId, switchProfile, createProfile, cloneProfile, deleteProfile, saveSharedProfile } = useProfile();
    const stats = useGlobalStats();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [profileToDelete, setProfileToDelete] = useState<string | null>(null);
    const [justCopied, setJustCopied] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSwitchProfile = (profileId: string) => {
        switchProfile(profileId);
        setIsDropdownOpen(false);
    };

    const handleCreateProfile = () => {
        createProfile();
        setIsDropdownOpen(false);
    };

    const handleCloneProfile = () => {
        cloneProfile();
        setIsDropdownOpen(false);
    };

    const handleDeleteProfile = (profileId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (profiles.length <= 1) {
            alert('Cannot delete the last profile');
            return;
        }
        setProfileToDelete(profileId);
    };

    const confirmDelete = () => {
        if (profileToDelete) {
            deleteProfile(profileToDelete);
            setProfileToDelete(null);
        }
    };

    const handleShare = () => {
        try {
            const json = JSON.stringify({ ...profile, isShared: true });
            // Use LZ-String compression for shorter URLs
            const compressed = LZString.compressToEncodedURIComponent(json);
            const url = `${window.location.origin}${window.location.pathname}?b62c=${compressed}`;
            navigator.clipboard.writeText(url);
            setJustCopied(true);
            setTimeout(() => setJustCopied(false), 2000);
        } catch (err) {
            console.error('Failed to share profile', err);
        }
    };

    return (
        <header className="h-16 sticky top-0 bg-bg-secondary/80 backdrop-blur-md border-b border-border z-30 flex items-center justify-between px-2 sm:px-4 lg:px-8">
            <div className="flex items-center gap-2 sm:gap-4">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onMenuToggle}
                    className="lg:hidden"
                >
                    <Menu className="w-6 h-6" />
                </Button>

                {/* Profile Selector */}
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-input border border-border hover:border-accent-primary/50 transition-colors"
                    >
                        <ProfileIcon iconIndex={profile.iconIndex} size={28} className="border-0" />
                        <span className="font-medium text-sm max-w-[120px] truncate hidden sm:block">{profile.name}</span>
                        <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform", isDropdownOpen && "rotate-180")} />
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute top-full left-0 mt-2 w-64 bg-bg-primary border border-border rounded-xl shadow-2xl overflow-hidden z-50">
                            <div className="p-2 border-b border-border">
                                <p className="text-xs text-text-muted uppercase font-bold px-2 mb-2">Profiles</p>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                    {profiles.map((p) => (
                                        <div
                                            key={p.id}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors group relative",
                                                p.id === activeProfileId
                                                    ? "bg-accent-primary/20 text-accent-primary"
                                                    : "hover:bg-bg-input text-text-primary"
                                            )}
                                        >
                                            <button
                                                onClick={() => handleSwitchProfile(p.id)}
                                                className="flex-1 flex items-center gap-2 min-w-0 text-left"
                                            >
                                                <ProfileIcon iconIndex={p.iconIndex} size={32} className="border-0 shrink-0" />
                                                <span className="truncate text-sm font-medium">{p.name}</span>
                                            </button>

                                            {p.id === activeProfileId && (
                                                <Check className="w-4 h-4 text-accent-primary shrink-0" />
                                            )}
                                            {profiles.length > 1 && (
                                                <button
                                                    onClick={(e) => handleDeleteProfile(p.id, e)}
                                                    className="p-1 text-text-muted hover:text-red-400 transition-colors shrink-0 z-10"
                                                    title="Delete profile"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="p-2 space-y-1">
                                <button
                                    onClick={handleCreateProfile}
                                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-bg-input text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    <img src="./Texture2D/PlusIcon.png" alt="New Profile" className="w-4 h-4 object-contain" />
                                    <span className="text-sm">New Profile</span>
                                </button>
                                <button
                                    onClick={handleCloneProfile}
                                    className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-bg-input text-text-secondary hover:text-text-primary transition-colors"
                                >
                                    <Copy className="w-4 h-4" />
                                    <span className="text-sm">Clone Current</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Global Stats - Visible on all screens, adjusting size/layout */}
            <div className="flex-1 px-1 sm:px-4 flex justify-center items-center min-w-0">
                <div className="flex items-center gap-1 sm:gap-6 bg-bg-input/50 px-1.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border border-border/50 backdrop-blur-sm overflow-x-auto no-scrollbar max-w-full">
                    {/* Power */}
                    <div className="flex flex-col items-center shrink-0">
                        <span className="text-[9px] sm:text-[10px] text-accent-primary font-bold uppercase tracking-wider">Pwr</span>
                        <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                            {stats ? formatCompactNumber(stats.power) : '-'}
                        </span>
                    </div>

                    {/* Separator */}
                    <div className="w-px h-6 bg-border/50 shrink-0" />

                    {/* Damage */}
                    <div className="flex flex-col items-center shrink-0">
                        <span className="text-[9px] sm:text-[10px] text-red-400 font-bold uppercase tracking-wider">Dmg</span>
                        <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                            {stats ? formatCompactNumber(stats.totalDamage) : '-'}
                        </span>
                    </div>

                    {/* Separator */}
                    <div className="w-px h-6 bg-border/50 shrink-0" />

                    {/* Health */}
                    <div className="flex flex-col items-center shrink-0">
                        <span className="text-[9px] sm:text-[10px] text-green-400 font-bold uppercase tracking-wider">HP</span>
                        <span className="text-xs sm:text-sm font-bold text-text-primary leading-none">
                            {stats ? formatCompactNumber(stats.totalHealth) : '-'}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
                {/* Share / Save Shared Logic */}
                {profile.isShared ? (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={saveSharedProfile}
                        className="gap-2"
                    >
                        <Save className="w-4 h-4" />
                        <span className="hidden sm:inline">Save to My Profiles</span>
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleShare}
                        className={cn("gap-2", justCopied && "text-green-400")}
                    >
                        {justCopied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                        <span className="hidden sm:inline">{justCopied ? 'Copied!' : 'Share'}</span>
                    </Button>
                )}

                {/* Tree Mode Toggle */}
                <button
                    onClick={() => {
                        cycleTreeMode();
                        // Show toast with next mode (cycleTreeMode goes empty->my->max->empty)
                        const nextMode = treeMode === 'empty' ? 'my' : treeMode === 'my' ? 'max' : 'empty';
                        toast(treeModeLabels[nextMode], {
                            icon: () => <img src="./Texture2D/SkillTabIcon.png" alt="" className="w-5 h-5" />,
                        });
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${treeModeColors[treeMode]} hover:opacity-90`}
                    title="Click to cycle: Empty → My → Max Tree"
                >
                    <img src="./Texture2D/SkillTabIcon.png" alt="Tree Mode" className="w-5 h-5 object-contain" />
                    <span className="hidden sm:inline">{treeModeLabels[treeMode]}</span>
                </button>

            </div>

            <ConfirmModal
                isOpen={!!profileToDelete}
                title="Delete Profile"
                message="Are you sure you want to delete this profile? This action cannot be undone."
                onConfirm={confirmDelete}
                onCancel={() => setProfileToDelete(null)}
                confirmText="Delete"
                variant="primary"
            />
        </header>
    );
}
