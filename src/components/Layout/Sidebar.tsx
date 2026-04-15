import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
    Star, Egg, Key, Shirt, Cat,
    Cpu, Swords, Shield, Lock, Coins, Palette, FileJson, HelpCircle, Github, TrendingUp, Hammer, Coffee, Zap, ShoppingCart
} from 'lucide-react';
import { GameIcon } from '../UI/GameIcon';
import { useProfile } from '../../context/ProfileContext';
import { ProfileIcon } from '../Profile/ProfileHeaderPanel';

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

export function Sidebar({ isOpen, onClose }: SidebarProps) {
    const location = useLocation();
    const { profile } = useProfile();

    const NAV_GROUPS = [
        {
            title: 'Profile',
            items: [
                { name: 'My Profile', path: '/', isProfile: true },
                { name: 'Progress Prediction', path: '/progress-prediction', icon: TrendingUp },
                { name: 'PVP Simulator', path: '/pvp-arena', icon: Swords },
                { name: 'Colors', path: '/colors', icon: Palette },
                { name: 'Emblems', path: '/emblems', icon: Shield },
            ]
        },
        {
            title: 'Calculators',
            items: [
                { name: 'Offline', path: '/offline', icon: Coins },
                { name: 'Dungeons', path: '/dungeons', icon: Key },
                { name: 'Forge', path: '/forge-calculator', icon: Hammer },
                { name: 'Tech Tree - Planner', path: '/calculators/tree', icon: Cpu },
                { name: 'Eggs', path: '/eggs', icon: Egg },
                { name: 'Skills', path: '/calculators/skills', icon: Star },
                { name: 'Mounts', path: '/calculators/mounts', icon: Star },
            ]
        },
        {
            title: 'Wiki',
            items: [
                { name: 'Items', path: '/items', icon: Shirt }, // Shirt as placeholder for Items/Chest
                { name: 'Skins', path: '/skins', icon: Shirt },
                { name: 'Pets', path: '/pets', icon: Cat },
                { name: 'Mounts', path: '/mounts', icon: Star },
                { name: 'Skills', path: '/skills', icon: Star },
                { name: 'Base Drops', path: '/wiki/base-drops', icon: HelpCircle },
                { name: 'Forge', path: '/wiki/forge', icon: Hammer },
                { name: 'Tech Tree', path: '/tech-tree', icon: Cpu },
                { name: 'Arena', path: '/arena', icon: Swords },
                { name: 'Guild War', path: '/guild-war', icon: Shield },
                { name: 'Shop', path: '/wiki/shop', icon: ShoppingCart },
            ]
        },
        {
            title: 'Info',
            items: [
                { name: 'Unlocks', path: '/unlocks', icon: Lock },
                { name: 'Configs', path: '/configs', icon: FileJson },
                { name: 'FAQ', path: '/faq', icon: HelpCircle },
                { name: 'GitHub', path: 'https://github.com/1vcian/fm', icon: Github, external: true },
            ]
        },
        {
            title: 'Support',
            items: [
                { name: 'Buy me a coffee', path: 'https://www.buymeacoffee.com/1vcian', icon: Coffee, external: true },
            ]
        }
    ];

    return (
        <>
            {/* Mobile Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Sidebar Container */}
            <aside className={cn(
                "fixed top-0 left-0 bottom-0 w-64 bg-bg-secondary border-r border-border z-50 transition-transform duration-300 ease-in-out flex flex-col",
                isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0" // Hidden on mobile unless open, always visible on desktop
            )}>
                {/* Logo */}
                <div className="h-16 flex items-center gap-3 px-6 border-b border-border bg-bg-secondary/50 backdrop-blur-sm">
                    <GameIcon name="hammer" className="w-8 h-8 animate-hammer-swing" />
                    <span className="font-bold text-xl bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        ForgeMaster
                    </span>
                </div>

                {/* Links */}
                <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8 custom-scrollbar">
                    {NAV_GROUPS.map((group) => (
                        <div key={group.title}>
                            <h3 className="text-xs font-semibold text-accent-primary uppercase tracking-wider mb-3 px-2">
                                {group.title}
                            </h3>
                            <div className="space-y-1">
                                {group.items.map((item) => {
                                    const isActive = location.pathname === item.path;
                                    const Icon = item.icon;
                                    const recommended = isRecommended(item.path);

                                    if ('external' in item && item.external) {
                                        const isCoffee = item.name.toLowerCase().includes('coffee');
                                        return (
                                            <a
                                                key={item.path}
                                                href={item.path}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => window.innerWidth < 1024 && onClose()}
                                                className={cn(
                                                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                                                    isCoffee
                                                        ? "bg-[#FFDD00]/10 text-[#FFDD00] hover:bg-[#FFDD00]/20 border border-[#FFDD00]/20 animate-pulse-subtle"
                                                        : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                                                )}
                                            >
                                                {Icon && <Icon size={18} className={isCoffee ? "fill-current" : ""} />}
                                                {item.name}
                                            </a>
                                        );
                                    }

                                    return (
                                        <Link
                                            key={item.path}
                                            to={item.path}
                                            onClick={() => window.innerWidth < 1024 && onClose()}
                                            className={cn(
                                                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                                                isActive
                                                    ? "bg-gradient-to-r from-accent-primary/20 to-transparent text-accent-primary border border-accent-primary/20"
                                                    : recommended
                                                        ? "text-text-primary hover:bg-white/5 border border-dashed border-accent-primary/20 bg-accent-primary/5"
                                                        : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                                            )}
                                        >
                                            {'isProfile' in item && item.isProfile ? (
                                                <ProfileIcon iconIndex={profile.iconIndex} size={18} className="border-0" />
                                            ) : Icon ? (
                                                <Icon size={18} className={cn(recommended && !isActive && "text-accent-primary")} />
                                            ) : null}
                                            <span className="flex-1">{item.name}</span>
                                            {recommended && !isActive && (
                                                <Zap size={12} className="text-accent-primary fill-accent-primary animate-pulse" />
                                            )}
                                        </Link>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border space-y-2">
                    <div className="text-xs text-text-muted text-center flex items-center justify-center gap-2">
                        <Github size={12} className="opacity-50" />
                        <a href="https://github.com/1vcian/fm" target="_blank" rel="noopener noreferrer" className="hover:text-accent-primary transition-colors">Source Code</a>
                    </div>
                    <div className="text-xs text-text-muted text-center">
                        v2.0.0 • by <a href="https://1vcian.me" target="_blank" rel="noopener noreferrer" className="hover:text-accent-primary transition-colors">1vcian</a>
                    </div>
                </div>
            </aside>
        </>
    );
}
