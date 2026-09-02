import { useState, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { cn } from '../../lib/utils';
import {
    Star, Egg, Key, Shirt, Cat, Image, ChevronDown,
    Cpu, Swords, Shield, Lock, Coins, Palette, FileJson, HelpCircle, Github, TrendingUp, Hammer, Coffee, Zap, ShoppingCart, Target, Sliders,
    Trash2, Check, Copy, Trophy, Users, Sparkles
} from 'lucide-react';
import { GameIcon } from '../UI/GameIcon';
import { useProfile } from '../../context/ProfileContext';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';
import { useGameDataContext } from '../../context/GameDataContext';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

const getTodayIdx = () => {
    const day = new Date().getDay(); // 0 is Sunday
    const mapping: Record<number, number> = {
        2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 0: 5, 1: 5
    };
    return mapping[day] ?? 0;
};

const isRecommended = (path: string) => {
    const today = getTodayIdx();
    // Forge
    if (path === '/forge-calculator' || path === '/wiki/forge') return true;
    // Dungeons
    if (path === '/dungeons') return [1, 3, 4].includes(today);
    // Tech Tree
    if (path === '/calculators/tree' || path === '/tech-tree') return [0, 3].includes(today);
    // Skills
    if (path === '/calculators/skills' || path === '/skills') return [0, 2, 4].includes(today);
    // Mounts
    if (path === '/calculators/mounts' || path === '/mounts') return [2, 4].includes(today);
    return false;
};

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
                    {i % 2 === 0 ? '☕' : '❤️'}
                </motion.span>
            ))}
        </div>
    );
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const location = useLocation();
    const { profile, profiles, activeProfileId, switchProfile, createProfile, cloneProfile, deleteProfile } = useProfile();
    const { selectedVersion } = useGameDataContext();
    const [isHoveringCoffee, setIsHoveringCoffee] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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

    const NAV_GROUPS = [
        {
            title: 'Profile',
            items: [
                { name: 'My Profile', path: '/', isProfile: true },
                { name: 'Clan', path: '/clan', icon: Users },
                { name: 'Progress Prediction', path: '/progress-prediction', icon: TrendingUp },
                { name: 'Mission Calculator', path: '/solo-mission', icon: Target },
                { name: 'PVP Simulator', path: '/pvp-arena', icon: Swords },
                { name: 'Colors', path: '/colors', icon: Palette },
                { name: 'Emblems', path: '/emblems', icon: Shield },
            ]
        },
        {
            title: 'Calculators',
            collapsible: true,
            items: [
                { name: 'Offline', path: '/offline', icon: Coins },
                { name: 'Dungeons', path: '/dungeons', icon: Key },
                { name: 'Forge', path: '/forge-calculator', icon: Hammer },
                { name: 'Tech Tree - Planner', path: '/calculators/tree', icon: Cpu },
                { name: 'Eggs', path: '/eggs', icon: Egg },
                { name: 'Skills', path: '/calculators/skills', icon: Star },
                { name: 'Mounts', path: '/calculators/mounts', icon: Star },
                { name: 'War Prizes', path: '/calculators/war-prizes', icon: Trophy },
                { name: 'Substats', path: '/calculators/substats', icon: Sliders },
                { name: 'Loadout Optimizer', path: '/calculators/loadout', icon: Trophy },
            ]
        },
        {
            title: 'Wiki',
            collapsible: true,
            items: [
                { name: 'Items', path: '/items', icon: Shirt },
                { name: 'Skins', path: '/skins', icon: Shirt },
                { name: 'Pets', path: '/pets', icon: Cat },
                { name: 'Mounts', path: '/mounts', icon: Star },
                { name: 'Skills', path: '/skills', icon: Star },
                { name: 'Unlocks', path: '/unlocks', icon: Lock },
                { name: 'Base Drops', path: '/wiki/base-drops', icon: HelpCircle },
                { name: 'Forge', path: '/wiki/forge', icon: Hammer },
                { name: 'Tech Tree', path: '/tech-tree', icon: Cpu },
                { name: 'Arena', path: '/arena', icon: Swords },
                { name: 'Guild War', path: '/guild-war', icon: Shield },
                { name: 'Missions', path: '/wiki/missions', icon: Target },
                { name: 'Shop', path: '/wiki/shop', icon: ShoppingCart },
                { name: 'Progress Pass', path: '/wiki/progress-pass', icon: Zap },
                { name: 'Secondary Stats', path: '/wiki/secondary-stats', icon: TrendingUp },
                { name: 'Fairies', path: '/wiki/fairies', icon: Sparkles },
            ]
        },
        {
            title: 'Info',
            items: [
                { name: 'Gallery', path: '/gallery', icon: Image, theme: 'interstellar' },
                { name: 'Configs', path: '/configs', icon: FileJson, theme: 'multiverse' },
                { name: 'FAQ', path: '/faq', icon: HelpCircle, theme: 'quantum' },
                { name: 'GitHub', path: 'https://github.com/1vcian/fm', icon: Github, external: true, theme: 'underworld' },
            ]
        }
    ];

    const getThemeInfo = (themeName?: string) => {
        if (!themeName) return null;
        const info: Record<string, { className: string, asset?: string }> = {
            divine: { className: 'divine-animation', asset: 'DivineBackground.png' },
            underworld: { className: 'underworld-animation', asset: 'UnderworldBackground.png' },
            multiverse: { className: 'multiverse-animation', asset: 'MultiverseBackground.png' },
            interstellar: { className: 'interstellar-animation', asset: 'InterstellarBackground.png' },
            quantum: { className: 'quantum-animation' }
        };
        const theme = info[themeName];
        if (!theme) return null;
        return {
            className: theme.className,
            style: theme.asset ? { '--theme-url': `url(${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${theme.asset})` } : {}
        };
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
                                                        if (window.confirm(`Are you sure you want to delete profile "${p.name}"?`)) {
                                                            deleteProfile(p.id);
                                                        }
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
                                            {group.items.map((item) => {
                                                const isActive = location.pathname === item.path;
                                                const Icon = item.icon;
                                                const recommended = isRecommended(item.path);

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
                                                            {themeInfo && (
                                                                <div
                                                                    className={cn(themeInfo.className, "rounded-lg")}
                                                                    style={themeInfo.style as React.CSSProperties}
                                                                >
                                                                    {themeInfo.className === 'quantum-animation' && (
                                                                        <>
                                                                            <span></span><span></span><span></span><span></span>
                                                                            <span></span><span></span><span></span><span></span>
                                                                            <span></span><span></span><span></span><span></span>
                                                                            <span></span><span></span><span></span><span></span><span></span><span></span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
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
                                                        to={item.path}
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
                                                        {themeInfo && (
                                                            <div
                                                                className={cn(themeInfo.className, "rounded-lg")}
                                                                style={themeInfo.style as React.CSSProperties}
                                                            >
                                                                {themeInfo.className === 'quantum-animation' && (
                                                                    <>
                                                                        <span></span><span></span><span></span><span></span>
                                                                        <span></span><span></span><span></span><span></span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )}
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
                                                                ? <Swords size={12} className="text-red-500 animate-bounce relative z-10" />
                                                                : <Zap size={12} className="text-accent-primary fill-accent-primary animate-pulse relative z-10" />
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
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 relative group/coffee overflow-visible coffee-btn-animated shadow-lg hover:shadow-accent-primary/20 hover:-translate-y-0.5"
                    >
                        <div
                            className="divine-animation rounded-xl"
                            style={{ '--theme-url': `url(${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}DivineBackground.png)` } as React.CSSProperties}
                        />
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
