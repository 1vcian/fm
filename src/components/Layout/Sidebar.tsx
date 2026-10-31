import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { gameIcon, GameAssetIcon } from '../UI/GameAssetIcon';
import { AgeBackground } from '../AgeBackground/AgeBackground';
import { useMaxForgeAge } from '../../hooks/useMaxForgeAge';
import {
    Image, ChevronDown, Github, Coffee, Trash2, Check, Copy, Crown
} from 'lucide-react';
import { GameIcon } from '../UI/GameIcon';
import { ConfirmModal } from '../UI/ConfirmModal';
import { useProfile } from '../../context/ProfileContext';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { useGameDataContext } from '../../context/GameDataContext';
import { useGameData } from '../../hooks/useGameData';
import { computeWarDaysMap, getWarDayIndex, type WarCategory } from '../../utils/guildWarUtils';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * War-point categories each page helps with. Which days light up is never written here: it comes
 * from GuildWarDayConfigLibrary.json (computeWarDaysMap) and the war day of the UTC reset.
 */
const PAGE_WAR_CATEGORIES: Record<string, WarCategory[]> = {
    '/calculators/forge': ['forge', 'forgeSpend'],
    '/wiki/forge': ['forge', 'forgeSpend'],
    '/dungeons': ['dungeons'],
    '/calculators/tree': ['tech'],
    '/tech-tree': ['tech'],
    '/skills': ['skills'],
    '/mounts': ['mounts'],
    '/eggs': ['eggs', 'pets'],
    '/pets': ['pets'],
    '/calculators/summons': ['skills', 'mounts', 'eggs'],
};

const isRecommended = (path: string, warDays: Partial<Record<WarCategory, number[]>>, today: number) =>
    (PAGE_WAR_CATEGORIES[path] || []).some(c => warDays[c]?.includes(today));

const CoffeeFountain = () => {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-visible">
            {Array.from({ length: 6 }).map((_, i) => (
                <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.5, x: 0, y: 0 }}
                    animate={{
                        opacity: [0, 1, 1, 0],
                        scale: [0.5, 1.2, 0.8],
                        x: (i % 2 === 0 ? 1 : -1) * (Math.random() * 40 + 20),
                        y: -(Math.random() * 100 + 50),
                        rotate: Math.random() * 360
                    }}
                    transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: i * 0.2,
                        ease: "easeOut"
                    }}
                    className="absolute left-1/2 top-1/2 text-lg"
                >
                    <GameAssetIcon asset={{ icon: ['Hammer', 'Coin', 'GemSquare'][i % 3] }} size={18} />
                </motion.span>
            ))}
        </div>
    );
};

/**
 * Navigation icons: real game assets (Icons.png sprites, standalone Texture2D PNGs, icon sheet
 * cells), chosen by what the page is about. GitHub and the Gallery keep a generic glyph: the game
 * has nothing for them.
 */
const NAV = {
    presets: gameIcon({ sheet: 'ArenaRankIcons', index: 0 }),
    clan: gameIcon({ icon: 'RallyIcon' }),
    progress: gameIcon({ icon: 'MainGameProgressPassSwordIcon' }),
    missionCalc: gameIcon({ sheet: 'ClanTechTreeIcons', index: 23 }),
    pvp: gameIcon({ icon: 'Battle' }),
    images: gameIcon({ icon: 'Pen' }),
    offline: gameIcon({ sheet: 'TechTreeIcons', index: 30 }),
    dungeons: gameIcon({ icon: 'DungeonTabIcon' }),
    forgeCalc: gameIcon({ icon: 'Anvil' }),
    treePlanner: gameIcon({ sheet: 'ClanTechTreeIcons', index: 3 }),
    eggs: gameIcon({ icon: 'Egg' }),
    summons: gameIcon({ icon: 'SkillTicket' }),
    warPrizes: gameIcon({ sheet: 'ClanTechTreeIcons', index: 19 }),
    substats: gameIcon({ sheet: 'TechTreeIcons', index: 14 }),
    items: gameIcon({ icon: 'IconMedievalWeaponSwordandshield' }),
    skins: gameIcon({ icon: 'SteppingStoneCharIcon0' }),
    pets: gameIcon({ sheet: 'Pets', index: 7 }),
    mounts: gameIcon({ sheet: 'MountIcons', index: 1 }),
    skills: gameIcon({ sheet: 'SkillIcons', index: 14 }),
    unlocks: gameIcon({ icon: 'Unlocked Lock Icon' }),
    baseDrops: gameIcon({ icon: 'CommonChest' }),
    forgeWiki: gameIcon({ icon: 'TechTreeForge' }),
    techTree: gameIcon({ icon: 'Potion' }),
    arena: gameIcon({ icon: 'ArenaTabIcon' }),
    guildWar: gameIcon({ icon: 'WarTicket' }),
    missions: gameIcon({ sheet: 'ClanTechTreeIcons', index: 21 }),
    shop: gameIcon({ icon: 'ShopTabIcon' }),
    progressPass: gameIcon({ icon: 'MainProgressPassIcon' }),
    secondaryStats: gameIcon({ icon: 'UpgradeArrow' }),
    fairies: gameIcon({ icon: 'FairyIconLora' }),
    achievements: gameIcon({ icon: 'PotionsRace' }),
    faq: gameIcon({ icon: 'RoleInfoIcon' }),
    settings: gameIcon({ icon: 'SettingsIcon' }),
    configs: gameIcon({ icon: 'Savegame' }),
    verify: gameIcon({ icon: 'CheckIcon' }),
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const location = useLocation();
    const { profile, profiles, activeProfileId, switchProfile, createProfile, cloneProfile, deleteProfile } = useProfile();

    const { selectedVersion, isDebug } = useGameDataContext();
    const { data: warDayConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const warDays = useMemo(() => computeWarDaysMap(warDayConfig), [warDayConfig]);
    const warToday = getWarDayIndex();
    const [isHoveringCoffee, setIsHoveringCoffee] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
        'Calculators': true,
        'Wiki': true
    });

    const toggleGroup = (title: string) => {
        setCollapsedGroups(prev => ({
            ...prev,
            [title]: !prev[title]
        }));
    };

    const donationLabel = useMemo(() => {
        const labels = [
            "Keep Dev Awake ☕", "Forge Fuel 🔥", "Buy Coffee ☕", "Dev Juice 🥤",
            "Hammer Lube 🔨", "Caffeine Boost ⚡", "Fuel the Dev 🚀", "Tips & Treats 🍬",
            "Mythic Espresso ☕", "Ultimate Latte 🥛", "Forge Coal 🔥",
            "Mana Potion 🧪", "Dev Energy ⚡", "Forge Master Tab 🍺",
            "Coffee Blessing ✨", "Support Craft 🔨", "Binary Beans 🫘",
            "Hot Dev Liquid ☕", "Pixel Caffeine 👾", "Legendary Brew 🍺",
            "Anti-Sleep Serum 🧪", "Code Cruncher Fuel 🍪", "Server Hamster Snacks 🐹",
            "Bug Repellent Fund 🦟", "Infinite Loop Coffee ♾️", "Overclock the Dev ⚡",
            "Dark Mode Power 🌙", "Keyboard Grease ⌨️", "RNG Luck Booster 🍀",
            "Divine Drop Rate Up 💎", "Pet Food for Dev 🍕", "Mount Stable Fund 🐎",
            "Tech Tree Fertilizer 🌱", "XP Boost for Dev 📈", "Sleep is for the Weak 💤",
            "Donation Crit Hit! 🎯", "Anvil Overheat 🌡️", "Magic Brew 🧙",
            "Supporter Aura ✨", "Godly Grind Fuel ⚡", "Bring back advanced chat 💬",
            "Bring Back Hex Colors 🎨"
        ];
        return labels[Math.floor(Math.random() * labels.length)];
    }, []);

    const maxAgeIdx = useMaxForgeAge();

    const NAV_GROUPS = [
        {
            title: 'Profile',
            items: [
                { name: 'My Profile', path: '/', isProfile: true },
                { name: 'Preset Builds', path: '/presets', icon: NAV.presets },
                { name: 'Clan', path: '/clan', icon: NAV.clan },
                { name: 'Progress Prediction', path: '/progress-prediction', icon: NAV.progress },
                { name: 'Mission Calculator', path: '/solo-mission', icon: NAV.missionCalc },
                { name: 'PVP Simulator (Beta)', path: '/pvp-arena', icon: NAV.pvp },
                // Colors is hidden while the game has no chat embeds to colour; the route still works.
                // { name: 'Colors', path: '/colors', icon: Palette },
                { name: 'Images Maker', path: '/images', icon: NAV.images },
            ]
        },
        {
            title: 'Calculators',
            collapsible: true,
            items: [
                { name: 'Offline', path: '/offline', icon: NAV.offline },
                { name: 'Dungeons', path: '/dungeons', icon: NAV.dungeons },
                { name: 'Forge', path: '/calculators/forge', icon: NAV.forgeCalc },
                { name: 'Tech Tree - Planner', path: '/calculators/tree', icon: NAV.treePlanner },
                { name: 'Eggs', path: '/eggs', icon: NAV.eggs },
                { name: 'Summons', path: '/calculators/summons', icon: NAV.summons },
                { name: 'War Prizes', path: '/calculators/war-prizes', icon: NAV.warPrizes },
                { name: 'Substats', path: '/calculators/substats', icon: NAV.substats },
            ]
        },
        {
            title: 'Wiki',
            collapsible: true,
            items: [
                { name: 'Items', path: '/items', icon: NAV.items },
                { name: 'Skins', path: '/skins', icon: NAV.skins },
                { name: 'Pets', path: '/pets', icon: NAV.pets },
                { name: 'Mounts', path: '/mounts', icon: NAV.mounts },
                { name: 'Skills', path: '/skills', icon: NAV.skills },
                { name: 'Unlocks', path: '/unlocks', icon: NAV.unlocks },
                { name: 'Base Drops', path: '/wiki/base-drops', icon: NAV.baseDrops },
                { name: 'Forge', path: '/wiki/forge', icon: NAV.forgeWiki },
                { name: 'Tech Tree', path: '/tech-tree', icon: NAV.techTree },
                { name: 'Arena', path: '/arena', icon: NAV.arena },
                { name: 'Guild War', path: '/guild-war', icon: NAV.guildWar },
                { name: 'Missions', path: '/wiki/missions', icon: NAV.missions },
                { name: 'Shop', path: '/wiki/shop', icon: NAV.shop },
                { name: 'Progress Pass', path: '/wiki/progress-pass', icon: NAV.progressPass },
                { name: 'Secondary Stats', path: '/wiki/secondary-stats', icon: NAV.secondaryStats },
                { name: 'Fairies', path: '/wiki/fairies', icon: NAV.fairies },
                { name: 'Achievements', path: '/wiki/achievements', icon: NAV.achievements },
            ]
        },
        {
            title: 'Info',
            items: [
                { name: 'Gallery', path: '/gallery', icon: Image, theme: 'interstellar' },
                { name: 'FAQ', path: '/faq', icon: NAV.faq, theme: 'quantum' },
                { name: 'Settings', path: '/settings', icon: NAV.settings },
                { name: 'Configs', path: '/configs', icon: NAV.configs, theme: 'multiverse' },
                // Verify is a developer page: listed (and routed) only with ?debug=true.
                { name: 'Verify', path: '/verify', icon: NAV.verify, debugOnly: true },
                { name: 'GitHub', path: 'https://github.com/1vcian/fm', icon: Github, external: true, theme: 'underworld' },
            ]
        }
    ];

    // An entry's theme is an age: its item background as the game draws it (AgeBackground).
    const getThemeInfo = (themeName?: string) => {
        const ages: Record<string, number> = { interstellar: 5, multiverse: 6, quantum: 7, underworld: 8, divine: 9 };
        return themeName && themeName in ages ? { ageIdx: ages[themeName] } : null;
    };

    return (
        <>
            {/* Mobile Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/50 backdrop-blur-sm z-[55] transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Sidebar Container */}
            <aside className={cn(
                "fixed top-0 left-0 bottom-0 w-64 bg-bg-secondary border-r border-border z-[60] transition-transform duration-300 ease-in-out flex flex-col shadow-2xl",
                isOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Logo */}
                <div className="h-16 flex items-center gap-3 px-6 border-b border-border bg-bg-secondary/50 backdrop-blur-sm">
                    <GameIcon name="hammer" className="w-8 h-8 animate-hammer-swing" />
                    <span className="font-bold text-xl bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        ForgeMaster
                    </span>
                </div>

                {/* Profile Selector in Sidebar */}
                <div className="px-4 py-3 border-b border-border bg-bg-secondary/20 relative z-30">
                    <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-bg-input border border-border hover:border-accent-primary/40 transition-all select-none animate-pulse-subtle"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <ProfileIcon iconIndex={profile.iconIndex} size={28} className="border-0 shrink-0" />
                            <span className="font-semibold text-sm text-left whitespace-nowrap overflow-hidden text-clip text-text-primary max-w-[130px]">{profile.name}</span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform shrink-0", isDropdownOpen && "rotate-180")} />
                    </button>

                    {isDropdownOpen && (
                        <div className="absolute top-full left-4 right-4 mt-1 bg-bg-primary border border-border rounded-xl shadow-2xl overflow-hidden z-50">
                            <div className="p-2 border-b border-border">
                                <p className="text-[10px] text-text-muted uppercase font-bold px-2 mb-1.5">Profiles</p>
                                <div className="max-h-40 overflow-y-auto space-y-0.5">
                                    {profiles.map((p) => (
                                        <div
                                            key={p.id}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors group relative",
                                                p.id === activeProfileId
                                                    ? "bg-accent-primary/20 text-accent-primary font-bold"
                                                    : "hover:bg-bg-input text-text-primary"
                                            )}
                                        >
                                            <button
                                                onClick={() => {
                                                    switchProfile(p.id);
                                                    setIsDropdownOpen(false);
                                                }}
                                                className="flex-1 flex items-center gap-2 min-w-0 text-left text-xs font-semibold"
                                            >
                                                <ProfileIcon iconIndex={p.iconIndex} size={24} className="border-0 shrink-0" />
                                                <span className="whitespace-nowrap overflow-hidden text-clip">{p.name}</span>
                                            </button>

                                            {p.id === activeProfileId && (
                                                <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                                            )}
                                            {profiles.length > 1 && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (profiles.length <= 1) return;
                                                        setToDelete({ id: p.id, name: p.name });
                                                    }}
                                                    className="p-1 text-text-muted hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                                                    title="Delete profile"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <ConfirmModal
                                    isOpen={!!toDelete}
                                    title="Delete profile"
                                    message={`Are you sure you want to delete profile "${toDelete?.name ?? ''}"? This cannot be undone.`}
                                    confirmText="Delete"
                                    variant="danger"
                                    onConfirm={() => { if (toDelete) deleteProfile(toDelete.id); setToDelete(null); }}
                                    onCancel={() => setToDelete(null)}
                                />
                            </div>
                            <div className="p-1.5 space-y-0.5">
                                <button
                                    onClick={() => {
                                        createProfile();
                                        setIsDropdownOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-input text-text-secondary hover:text-text-primary transition-colors text-xs font-semibold"
                                >
                                    <img src={`${import.meta.env.BASE_URL}Texture2D/${selectedVersion}/PlusIcon.png`} alt="New Profile" className="w-3.5 h-3.5 object-contain animate-pulse" />
                                    <span>New Profile</span>
                                </button>
                                <button
                                    onClick={() => {
                                        cloneProfile();
                                        setIsDropdownOpen(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-input text-text-secondary hover:text-text-primary transition-colors text-xs font-semibold"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Clone Current</span>
                                </button>
                                <Link
                                    to="/presets"
                                    onClick={() => { setIsDropdownOpen(false); onClose?.(); }}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-input text-text-secondary hover:text-text-primary transition-colors text-xs font-semibold"
                                >
                                    <Crown className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Preset builds</span>
                                </Link>
                            </div>
                        </div>
                    )}
                </div>

                {/* Links */}
                <div className="flex-1 overflow-y-auto py-6 px-4 space-y-5 custom-scrollbar">
                    {NAV_GROUPS.map((group) => {
                        const isCollapsed = collapsedGroups[group.title];
                        const isCollapsible = (group as any).collapsible;

                        return (
                            <div key={group.title}>
                                <button 
                                    onClick={() => isCollapsible && toggleGroup(group.title)}
                                    className={cn(
                                        "w-full flex items-center justify-between transition-all duration-200",
                                        isCollapsible 
                                            ? "mb-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/[0.08] border border-white/5 hover:border-accent-primary/20 group/title shadow-sm cursor-pointer" 
                                            : "mb-2 px-2 cursor-default"
                                    )}
                                >
                                    <h3 className={cn(
                                        "text-xs font-bold uppercase tracking-widest transition-colors",
                                        isCollapsible 
                                            ? (isCollapsed ? "text-text-secondary" : "text-accent-primary")
                                            : "text-accent-primary"
                                    )}>
                                        {group.title}
                                    </h3>
                                    {isCollapsible && (
                                        <div className={cn(
                                            "p-1 rounded-md transition-all duration-200",
                                            isCollapsed ? "bg-white/5 text-text-muted" : "bg-accent-primary/10 text-accent-primary"
                                        )}>
                                            <ChevronDown 
                                                size={12} 
                                                className={cn(
                                                    "transition-transform duration-300",
                                                    isCollapsed ? "-rotate-90" : "rotate-0"
                                                )} 
                                            />
                                        </div>
                                    )}
                                </button>

                                <AnimatePresence initial={false}>
                                    {!isCollapsed && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="space-y-1"
                                        >
                                            {group.items.filter((item) => isDebug || !('debugOnly' in item && item.debugOnly)).map((item) => {
                                                const isActive = location.pathname === item.path;
                                                const Icon = item.icon;
                                                const recommended = isRecommended(item.path, warDays, warToday);

                                                if ('external' in item && item.external) {
                                                    const isCoffee = item.name.toLowerCase().includes('awake');
                                                    const themeInfo = getThemeInfo((item as any).theme);
                                                    return (
                                                        <a
                                                            key={item.path}
                                                            href={item.path}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            onMouseEnter={() => isCoffee && setIsHoveringCoffee(true)}
                                                            onMouseLeave={() => isCoffee && setIsHoveringCoffee(false)}
                                                            onClick={() => {
                                                                if (isCoffee) {
                                                                    if ((window as any).__triggerTestToast) {
                                                                        (window as any).__triggerTestToast();
                                                                    }
                                                                }
                                                                onClose();
                                                            }}
                                                            className={cn(
                                                                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 relative group/coffee overflow-visible",
                                                                isCoffee
                                                                    ? "coffee-btn-animated"
                                                                    : themeInfo ? "text-white" : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                                                            )}
                                                        >
                                                            {themeInfo && <AgeBackground ageIdx={themeInfo.ageIdx} className="absolute inset-0 rounded-lg overflow-hidden" />}
                                                            {isCoffee && isHoveringCoffee && <CoffeeFountain />}
                                                            {Icon && <Icon size={18} className={cn(
                                                                "transition-transform relative z-10 text-white",
                                                                (themeInfo || isCoffee) ? "icon-stroke-sm" : "",
                                                                isCoffee && "group-hover/coffee:rotate-12"
                                                            )} />}
                                                            <span className={cn("relative z-10 font-bold", themeInfo || isCoffee ? "text-stroke-sm" : "")}>
                                                                {isCoffee ? donationLabel : item.name}
                                                            </span>
                                                        </a>
                                                    );
                                                }

                                                const themeInfo = getThemeInfo((item as any).theme);

                                                return (
                                                    <Link
                                                        key={item.path}
                                                        // Debug pages keep the flag in the link so the route guard lets them through.
                                                        to={'debugOnly' in item && item.debugOnly ? `${item.path}?debug=true` : item.path}
                                                        onClick={() => onClose()}
                                                        className={cn(
                                                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                                                            isActive
                                                                ? "bg-gradient-to-r from-accent-primary/20 to-transparent text-accent-primary border border-accent-primary/20"
                                                                : recommended
                                                                    ? group.title === 'Calculators'
                                                                        ? "text-red-400 hover:bg-white/5 border border-dashed border-red-500/40 bg-red-500/10 shadow-[inset_0_0_10px_rgba(239,68,68,0.1)]"
                                                                        : "text-text-primary hover:bg-white/5 border border-dashed border-accent-primary/20 bg-accent-primary/5"
                                                                    : themeInfo ? "text-white" : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                                                        )}
                                                    >
                                                        {themeInfo && <AgeBackground ageIdx={themeInfo.ageIdx} className="absolute inset-0 rounded-lg overflow-hidden" />}
                                                        {'isProfile' in item && item.isProfile ? (
                                                            <ProfileIcon iconIndex={profile.iconIndex} size={18} className="border-0" />
                                                        ) : Icon ? (
                                                            <Icon size={18} className={cn(
                                                                "relative z-10",
                                                                recommended && !isActive && (group.title === 'Calculators' ? "text-red-500" : "text-accent-primary"),
                                                                themeInfo && "text-white icon-stroke-sm"
                                                            )} />
                                                        ) : null}
                                                        <span className={cn("flex-1 relative z-10", themeInfo ? "text-stroke-sm" : "")}>{item.name}</span>
                                                        {recommended && !isActive && (
                                                            group.title === 'Calculators'
                                                                ? <GameAssetIcon asset={{ icon: 'WarTicket' }} size={14} className="animate-bounce relative z-10" />
                                                                : <GameAssetIcon asset={{ icon: 'Lightning' }} size={14} className="animate-pulse relative z-10" />
                                                        )}
                                                    </Link>
                                                );
                                            })}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border space-y-4">
                    <a
                        href="https://www.buymeacoffee.com/1vcian"
                        target="_blank"
                        rel="noopener noreferrer"
                        onMouseEnter={() => setIsHoveringCoffee(true)}
                        onMouseLeave={() => setIsHoveringCoffee(false)}
                        onClick={() => {
                            if ((window as any).__triggerTestToast) {
                                (window as any).__triggerTestToast();
                            }
                            onClose();
                        }}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 relative group/coffee overflow-visible shadow-lg hover:shadow-accent-primary/20 hover:-translate-y-0.5"
                    >
                        {/* The background of the highest age the forge level can drop, as the game draws it. */}
                        <AgeBackground ageIdx={maxAgeIdx} className="absolute inset-0 rounded-xl overflow-hidden" />
                        {isHoveringCoffee && <CoffeeFountain />}
                        <Coffee size={18} className="transition-transform relative z-10 text-white icon-stroke-sm group-hover/coffee:rotate-12" />
                        <span className="relative z-10 text-stroke-sm text-white">
                            {donationLabel}
                        </span>
                    </a>

                    <div className="text-[10px] text-text-muted text-center uppercase tracking-widest font-medium opacity-60">
                        v2.2.0 • by <a href="https://1vcian.me" target="_blank" rel="noopener noreferrer" className="hover:text-accent-primary transition-colors font-bold">1vcian</a>
                    </div>
                </div>
            </aside>
        </>
    );
}
