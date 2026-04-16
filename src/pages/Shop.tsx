import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { Search, Sparkles, TrendingUp, Package, Info, Lock, Clock } from 'lucide-react';
import { cn } from '../lib/utils';
import { getItemImage, getItemName } from '../utils/itemAssets';

interface Reward {
    Amount: number;
    Type: string;
    $type: string;
    DealSizeId?: number;
}

interface DealSize {
    SizeId: number;
    Rewards: Reward[];
}

interface DailyDeal {
    DailyDealType: string;
    Size: DealSize[];
}

interface IAPProduct {
    ProductId: string;
    Name: string;
    Price: number;
    Rewards: Reward[];
    Type: string;
}

interface UnlockCondition {
    AgeIdx: number;
    BattleIdx: number;
    FeatureId: string;
}

const AGES = ['Primitive', 'Medieval', 'Early-Modern', 'Modern', 'Space', 'Interstellar', 'Multiverse', 'Quantum', 'Underworld', 'Divine'];

/**
 * Maps game reward data to the correct icon name in Texture2D or IconsMap
 */
function getShopIcon(reward: Reward, product?: IAPProduct, autoMapping?: any): string {
    const type = reward.Type;
    const itemType = reward.$type;

    // 1. IAP / Special Offers specific textures (Prioritize product ID)
    if (product && product.ProductId) {
        const pid = product.ProductId;
        if (pid.includes('GemPack')) {
            const idx = pid.replace('GemPack', '');
            return `GemPack_${idx}`;
        }
        if (pid.includes('TokenPack')) {
            const idx = pid.replace('TokenPack', '');
            return `TokenPack_${idx}`;
        }
        if (pid.includes('DailyDeal')) {
            const idx = pid.replace('DailyDeal', '');
            return `Daily_Deal_${idx}`;
        }

        // Special handling for Starter Packs -> Map to actual items if data exists
        if (itemType === 'StarterPackageReward' && (reward as any).ItemId) {
            const itemId = (reward as any).ItemId;
            // Map Age Index to Name
            const ageName = AGES[itemId.Age];
            const spritePath = getItemImage(ageName, itemId.Type, itemId.Idx, autoMapping);
            if (spritePath) {
                // getItemImage returns full path, we just need the filename for GameIcon (it handles the rest)
                return spritePath.split('/').pop()?.replace('.png', '') || 'CommonChest';
            }
        }

        // Starter Packs fallback -> Map to Chests based on price
        if (pid.includes('StarterOffer')) {
            if (product.Price <= 2) return 'CommonChest';
            if (product.Price <= 7) return 'RareChest';
            return 'EpicChest';
        }

        if (pid.includes('ProgressPass')) return 'MainProgressPassIcon';
    }

    // 2. Dungeon Keys
    if (itemType === 'DungeonKeyReward') {
        if (type === 'Hammer') return 'HammerKey';
        if (type === 'Skill') return 'SkillKey';
        if (type === 'Pet') return 'PetKey';
        if (type === 'Potion') return 'PotionKey';
        return type + 'Key';
    }

    // 3. Currency Mappings (Sprite names from IconsMap.json or Texture2D)
    if (type === 'Coins') return 'Coin';
    if (type === 'SkillSummonTickets') return 'SkillTicket';
    if (type === 'TechPotions') return 'Potion';
    if (type === 'Eggshells') return 'Eggshell';
    if (type === 'Hammers') return 'Hammer';
    if (type === 'ClockWinders') return 'MountKey';
    if (type === 'Gems') return 'GemIcon';
    if (type === 'Token') return 'WarTicket';

    return type;
}

import { usePersistentState } from '../hooks/usePersistentState';

export default function Shop() {
    const { data: dailyDeals } = useGameData<Record<string, DailyDeal>>('DailyDealLibrary.json');
    const { data: iapProducts } = useGameData<Record<string, IAPProduct>>('InAppProducts.json');
    const { data: unlockData } = useGameData<Record<string, UnlockCondition>>('UnlockConditions.json');
    const { data: shopResources } = useGameData<any>('ShopResourcesLibrary.json');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');

    const [activeTab, setActiveTab] = usePersistentState<'daily' | 'iap' | 'offers'>('shop_active_tab', 'daily');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);



    const getUTCDayInfo = useMemo(() => {
        const day = currentTime.getUTCDay();
        const mapping: Record<number, number> = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 0: 5, 1: 5 };
        const currentIdx = mapping[day] ?? 0;

        const nextReset = new Date(currentTime);
        nextReset.setUTCHours(24, 0, 0, 0);
        const msUntilReset = nextReset.getTime() - currentTime.getTime();

        return { currentIdx, msUntilReset };
    }, [currentTime]);

    const isWarActive = useMemo(() => {
        if (!guildWarConfig) return false;
        return (guildWarConfig[getUTCDayInfo.currentIdx]?.Tasks?.length ?? 0) > 0;
    }, [guildWarConfig, getUTCDayInfo.currentIdx]);

    // The shop activation logic is not yet defined by a configuration file.
    // We will show all deals as available for now.
    const dynamicAvailability = useMemo(() => {
        return {};
    }, []);

    const filteredDailyDeals = useMemo(() => {
        if (!dailyDeals) return [];

        return Object.entries(dailyDeals).map(([key, value]) => {
            return {
                type: key,
                schedule: [],
                isActive: true,
                msUntilReset: 0,
                ...value
            };
        }).filter(deal =>
            deal.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
            deal.Size.some(s => s.Rewards.some(r => r.Type.toLowerCase().includes(searchQuery.toLowerCase())))
        );
    }, [dailyDeals, dynamicAvailability, getUTCDayInfo, searchQuery]);

    const products = useMemo(() => {
        if (!iapProducts) return [];
        return Object.values(iapProducts).filter(p => {
            return p.Name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.Rewards.some(r => r.Type.toLowerCase().includes(searchQuery.toLowerCase()));
        });
    }, [iapProducts, searchQuery]);

    const shopUnlock = unlockData?.['Shop'];

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-accent-primary to-accent-secondary p-0.5 shadow-lg shadow-accent-primary/20">
                        <div className="w-full h-full bg-bg-primary rounded-[14px] flex items-center justify-center">
                            <GameIcon name="ShopTabIcon" size={32} className="text-accent-primary" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-3xl font-black bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary bg-[length:200%_auto] animate-gradient-x bg-clip-text text-transparent uppercase tracking-tighter">
                            Game Shop
                        </h1>
                        <p className="text-[11px] text-text-muted flex items-center gap-1.5 font-bold uppercase tracking-wider opacity-80">
                            <Info size={12} />
                            Rewards, deals and visibility
                        </p>
                    </div>
                </div>

                <div className="relative w-full md:w-80 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-accent-primary transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="Search rewards or packs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-bg-secondary/50 border border-border rounded-xl py-3 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent-primary/20 focus:border-accent-primary outline-none transition-all placeholder:text-text-muted/50 shadow-inner"
                    />
                </div>
            </div>

            {/* Visibility Conditions */}
            {shopUnlock && (
                <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 -mr-4 -mt-4 transition-transform group-hover:scale-110">
                        <Lock size={120} />
                    </div>
                    <div className="flex items-center gap-6 relative z-10">
                        <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center ring-4 ring-bg-primary">
                            <Lock className="w-8 h-8 text-accent-primary" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white uppercase tracking-tight">Shop Availability</h3>
                            <p className="text-text-muted text-sm">Main shop features unlock milestones</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 relative z-10">
                        <div className="bg-bg-primary/50 backdrop-blur-md px-5 py-3 rounded-xl border border-white/5 shadow-xl">
                            <div className="text-[10px] uppercase font-black text-accent-primary tracking-widest mb-1">Age Required</div>
                            <div className="text-lg font-bold text-white">{AGES[shopUnlock.AgeIdx] || `Age ${shopUnlock.AgeIdx + 1}`}</div>
                        </div>
                        <div className="bg-bg-primary/50 backdrop-blur-md px-5 py-3 rounded-xl border border-white/5 shadow-xl">
                            <div className="text-[10px] uppercase font-black text-accent-secondary tracking-widest mb-1">Stage Required</div>
                            <div className="text-lg font-bold text-white">Stage {shopUnlock.AgeIdx + 1}-{shopUnlock.BattleIdx + 1}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex bg-bg-secondary/40 p-1 rounded-xl border border-border max-w-sm mx-auto backdrop-blur-sm">
                <button
                    onClick={() => setActiveTab('daily')}
                    className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                        activeTab === 'daily'
                            ? "bg-accent-primary text-black shadow-lg"
                            : "text-text-muted hover:text-text-primary hover:bg-white/5"
                    )}
                >
                    Daily Deals
                </button>
                <button
                    onClick={() => setActiveTab('iap')}
                    className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                        activeTab === 'iap'
                            ? "bg-accent-secondary text-black shadow-lg"
                            : "text-text-muted hover:text-text-primary hover:bg-white/5"
                    )}
                >
                    Currency
                </button>
                <button
                    onClick={() => setActiveTab('offers')}
                    className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300",
                        activeTab === 'offers'
                            ? "bg-accent-primary text-black shadow-lg"
                            : "text-text-muted hover:text-text-primary hover:bg-white/5"
                    )}
                >
                    Special
                </button>
            </div>

            {/* Content Rendering */}
            <div className="space-y-12">
                {activeTab === 'daily' && (
                    <div className="space-y-10">
                        {filteredDailyDeals.map((deal) => {
                            const categoryIcon = {
                                'Dungeon': 'Daily_Deal_0',
                                'Pet': 'Daily_Deal_1',
                                'Tech': 'Daily_Deal_2',
                                'Skill': 'Daily_Deal_3',
                                'Resource': 'Daily_Deal_4',
                                'Mount': 'Daily_Deal_5'
                            }[deal.type] || 'Package';

                            return (
                                <div className="bg-bg-secondary/10 border border-border/30 rounded-2xl p-5 space-y-4">
                                    <div className="flex items-center gap-6">
                                        <div className="w-24 h-24 rounded-2xl bg-bg-secondary border-2 border-border flex items-center justify-center shadow-inner overflow-hidden">      <GameIcon name={categoryIcon} className="w-full h-full" />
                                        </div>
                                        <h2 className="text-xl font-black uppercase tracking-tight text-white">{deal.type} Deals</h2>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {deal.Size.map((size) => {
                                            // Map to IAP Product to get price
                                            const iapProduct = iapProducts ? Object.values(iapProducts).find(p => p.ProductId === `DailyDeal${size.SizeId}`) : null;
                                            const price = iapProduct?.Price ?? 0;

                                            return (
                                                <Card key={size.SizeId} className="group hover:border-accent-primary/50 transition-all duration-300 bg-bg-primary/40">
                                                    <CardContent className="p-3.5 space-y-3">
                                                        <div className="flex justify-between items-start">
                                                            <div className="flex flex-col gap-1 items-start">
                                                                <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary">
                                                                    Size {size.SizeId}
                                                                </span>
                                                                <span className={cn(
                                                                    "text-[9px] font-black px-1.5 py-0.5 rounded border leading-none",
                                                                    price === 0
                                                                        ? "text-green-500 bg-green-500/10 border-green-500/20"
                                                                        : "text-accent-secondary bg-accent-secondary/10 border-accent-secondary/20 uppercase"
                                                                )}>
                                                                    {price === 0 ? "FREE" : `$${price.toFixed(2)}`}
                                                                </span>
                                                            </div>
                                                            <div className="flex -space-x-1">
                                                                {size.Rewards.slice(0, 3).map((r, i) => (
                                                                    <div key={i} className="w-6 h-6 rounded-full border border-bg-primary bg-bg-secondary flex items-center justify-center overflow-hidden shadow-md">
                                                                        <GameIcon name={getShopIcon(r, undefined, autoMapping)} className="w-full h-full p-1" />
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-1.5">
                                                            {size.Rewards.map((reward, i) => (
                                                                <div key={i} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0 group-hover:border-accent-primary/10 transition-colors">
                                                                    <div className="flex items-center gap-2 max-w-[70%]">
                                                                        <div className="w-5 h-5 flex-shrink-0">
                                                                            <GameIcon name={getShopIcon(reward, undefined, autoMapping)} className="w-full h-full opacity-80" />
                                                                        </div>
                                                                        <span className="text-text-secondary font-semibold truncate text-[10px] uppercase tracking-tighter">{reward.Type}</span>
                                                                    </div>
                                                                    <span className="font-mono font-black text-white text-[10px]">
                                                                        +{reward.Amount.toLocaleString()}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === 'iap' && (
                    <div className="space-y-12">
                        {/* Gem Packs */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-2.5 px-2">
                                <GameIcon name="GemIcon" size={20} />
                                <h2 className="text-xl font-black uppercase tracking-tight">Gem Packages</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {products.filter(p => p.ProductId.includes('GemPack')).map((p) => (
                                    <ProductCard key={p.ProductId} product={p} variant="secondary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} />
                                ))}
                            </div>
                        </div>

                        <hr className="border-border/40 mx-2" />

                        {/* Token Packs */}
                        <div className="space-y-6">
                            <div className="flex items-center gap-2.5 px-2">
                                <GameIcon name="SteppingStone" size={20} />
                                <h2 className="text-xl font-black uppercase tracking-tight">Token Packages</h2>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {products.filter(p => p.ProductId.includes('TokenPack')).map((p) => (
                                    <ProductCard key={p.ProductId} product={p} variant="primary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} />
                                ))}
                                {/* Add TokenPack0 from ShopResources if it exists and matches search */}
                                {shopResources?.TokenPack0 && isWarActive && shopResources.TokenPack0.Id.toLowerCase().includes(searchQuery.toLowerCase()) && (
                                    <ProductCard
                                        product={{
                                            ProductId: 'TokenPack0',
                                            Name: 'Daily Token Pack',
                                            Price: 0,
                                            Rewards: [shopResources.TokenPack0.Reward],
                                            Type: 'Free Daily'
                                        }}
                                        variant="primary"
                                        unlockData={unlockData}
                                        autoMapping={autoMapping}
                                        isWarActive={isWarActive}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'offers' && (
                    <div className="space-y-12">
                        {/* Starter Offers */}
                        <div className="p-6 rounded-2xl bg-bg-secondary/20 border border-border/50 relative overflow-hidden group/offer">
                            <div className="absolute top-0 right-0 -mr-16 -mt-16 opacity-[0.03] transition-transform group-hover/offer:scale-110 duration-700">
                                <Sparkles size={320} />
                            </div>
                            <h2 className="text-xl font-black uppercase tracking-tight px-1 flex items-center gap-3 mb-8 relative z-10">
                                <Sparkles className="text-yellow-400" size={20} />
                                Starter Packages
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                                {products.filter(p => p.ProductId.includes('StarterOffer')).map((p) => (
                                    <ProductCard key={p.ProductId} product={p} variant="primary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} />
                                ))}
                            </div>
                        </div>

                        <hr className="border-border/40" />

                        {/* Progress Passes */}
                        <div className="p-6 rounded-2xl bg-bg-secondary/20 border border-accent-secondary/30 relative overflow-hidden group/offer shadow-2xl shadow-accent-secondary/5">
                            <div className="absolute top-0 right-0 -mr-16 -mt-16 opacity-[0.05] transition-transform group-hover/offer:scale-110 duration-700 text-accent-secondary">
                                <TrendingUp size={320} />
                            </div>
                            <h2 className="text-xl font-black uppercase tracking-tight px-1 flex items-center gap-3 mb-8 relative z-10">
                                <TrendingUp className="text-accent-secondary" size={20} />
                                Progress Passes
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                                {products.filter(p => p.ProductId.includes('ProgressPass')).map((p) => (
                                    <ProductCard key={p.ProductId} product={p} variant="secondary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} />
                                ))}
                            </div>
                        </div>

                        {/* Other Proposals */}
                        {products.filter(p => !['GemPack', 'TokenPack', 'StarterOffer', 'ProgressPass', 'DailyDeal'].some(key => p.ProductId.includes(key))).length > 0 && (
                            <>
                                <hr className="border-border/40" />
                                <div className="p-6 rounded-2xl bg-bg-secondary/20 border border-border/50 relative overflow-hidden group/offer">
                                    <h2 className="text-xl font-black uppercase tracking-tight px-1 flex items-center gap-3 mb-8 relative z-10">
                                        <Package className="text-accent-primary" size={20} />
                                        Special Proposals
                                    </h2>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                                        {products.filter(p => !['GemPack', 'TokenPack', 'StarterOffer', 'ProgressPass', 'DailyDeal'].some(key => p.ProductId.includes(key))).map((p) => (
                                            <ProductCard key={p.ProductId} product={p} variant="primary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function ProductCard({ product, variant, unlockData, autoMapping, isWarActive }: {
    product: any;
    variant: 'primary' | 'secondary';
    unlockData?: Record<string, UnlockCondition> | null;
    autoMapping?: any;
    isWarActive?: boolean;
}) {
    // Safety check - if product is completely missing or malformed
    if (!product || !product.ProductId) return null;

    // Get unlock requirement
    const unlockInfo = useMemo(() => {
        if (!unlockData) return null;
        let featureId = product.ProductId;

        // Map common product IDs to features
        if (product.ProductId?.includes('StarterOffer')) featureId = 'StarterPackage';
        if (product.ProductId?.includes('TokenPack')) featureId = 'Guilds';
        if (product.ProductId?.includes('ProgressPass')) featureId = 'SwitchWorlds';

        return unlockData[featureId];
    }, [product.ProductId, unlockData]);

    const isTokenPack = product.ProductId?.includes('TokenPack');
    const isInactiveToken = isTokenPack && isWarActive === false;

    // Extract Starter Offer details
    const starterReward = useMemo(() => {
        return product.Rewards?.find((r: any) => r.$type === 'StarterPackageReward');
    }, [product.Rewards]);

    // Resolved Item Name
    const displayName = useMemo(() => {
        if (starterReward && starterReward.ItemId) {
            const ageName = AGES[starterReward.ItemId.Age];
            const name = getItemName(ageName, starterReward.ItemId.Type, starterReward.ItemId.Idx, autoMapping);
            return name || product.Name;
        }
        return product.Name;
    }, [starterReward, product.Name, autoMapping]);

    return (
        <Card className={cn(
            "group relative overflow-hidden h-full flex flex-col transition-all duration-500 hover:scale-[1.02]",
            variant === 'primary' ? "hover:border-accent-primary" : "hover:border-accent-secondary",
            isInactiveToken && "opacity-60 saturate-[0.5]"
        )}>
            <div className={cn(
                "absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 pointer-events-none",
                variant === 'primary' ? "bg-accent-primary" : "bg-accent-secondary"
            )} />
            <CardContent className="p-4.5 text-center space-y-4 flex-1 flex flex-col">
                <div className="relative mx-auto w-24 h-24 mb-1">
                    <div className={cn(
                        "absolute inset-0 rounded-[2rem] blur-xl group-hover:blur-2xl transition-all duration-500 opacity-20",
                        variant === 'primary' ? "bg-accent-primary" : "bg-accent-secondary"
                    )} />
                    <div className={cn(
                        "relative w-full h-full rounded-2xl bg-bg-primary border flex items-center justify-center p-4 shadow-xl transition-all duration-500 group-hover:scale-105 group-hover:-translate-y-1",
                        variant === 'primary' ? "border-accent-primary/20" : "border-accent-secondary/20"
                    )}>
                        <GameIcon
                            name={getShopIcon(product.Rewards?.[0], product, autoMapping)}
                            className="w-full h-full drop-shadow-lg"
                        />
                    </div>
                    {product.Rewards?.[0]?.Amount !== undefined && (
                        <div className={cn(
                            "absolute -bottom-1 -right-1 px-3 py-1.5 rounded-xl bg-bg-secondary border-2 shadow-2xl z-10 transition-transform group-hover:scale-110",
                            variant === 'primary' ? "border-accent-primary/40" : "border-accent-secondary/40"
                        )}>
                            <div className="text-sm font-mono font-black text-white">x{product.Rewards[0].Amount.toLocaleString()}</div>
                        </div>
                    )}
                </div>

                <div className="space-y-1 flex-1">
                    <h4 className="text-base font-black text-white uppercase tracking-tight group-hover:text-accent-primary transition-colors leading-tight line-clamp-2 break-words min-h-[2.5rem] flex items-center justify-center">
                        {displayName}
                    </h4>

                    {/* Unlock Info */}
                    {(unlockInfo || (starterReward && starterReward.ItemId)) && (
                        <div className="flex items-center justify-center gap-1.5 mt-2">
                            <Lock className="w-3 h-3 text-text-muted" />
                            <span className="text-[10px] font-bold text-text-muted uppercase">
                                {starterReward && starterReward.ItemId
                                    ? `Required Age ${starterReward.ItemId.Age}`
                                    : `Age ${unlockInfo?.AgeIdx} • Battle ${unlockInfo?.BattleIdx}`
                                }
                            </span>
                        </div>
                    )}

                    {/* Starter Offer Specifics */}
                    {starterReward && (
                        <div className="space-y-2 mt-3 p-3 rounded-xl bg-white/5 border border-white/5">
                            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-text-muted">
                                <span>Item Level</span>
                                <span className="text-white">Lvl {starterReward.ItemLevel + 1}</span>
                            </div>
                            <div className="flex justify-between items-center text-[11px] font-black uppercase text-accent-primary">
                                <span>{starterReward.SecondaryStatType}</span>
                                <span>+{Math.round(starterReward.SecondaryStatValue * 100)}%</span>
                            </div>
                        </div>
                    )}

                    {/* Starter Offer Duration */}
                    {product.ProductId?.includes('StarterOffer') && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent-primary/10 border border-accent-primary/20 mt-2">
                            <Clock className="w-3 h-3 text-accent-primary" />
                            <span className="text-[9px] font-black text-accent-primary uppercase tracking-wider">48h Duration</span>
                        </div>
                    )}

                    {/* Inactive Token Status */}
                    {isInactiveToken && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 mt-2">
                            <Lock className="w-3 h-3 text-red-500" />
                            <span className="text-[9px] font-black text-red-500 uppercase tracking-wider">War Season Ended</span>
                        </div>
                    )}

                    <p className="text-[9px] text-text-muted uppercase font-bold tracking-widest mt-2">{product.Type}</p>
                </div>

                {(product.Price !== null && product.Price !== undefined) && (
                    <div className={cn(
                        "inline-block px-4 py-1.5 rounded-lg border text-lg font-black tracking-tighter shadow-md transition-all duration-500 mt-1",
                        product.Price === 0
                            ? "bg-green-500/10 border-green-500/20 text-green-500"
                            : variant === 'primary'
                                ? "bg-accent-primary/10 border-accent-primary/20 text-accent-primary group-hover:bg-accent-primary group-hover:text-black border-accent-primary/50"
                                : "bg-accent-secondary/10 border-accent-secondary/20 text-accent-secondary group-hover:bg-accent-secondary group-hover:text-black border-accent-secondary/50"
                    )}>
                        {isInactiveToken ? "RESETS AT 00:00 UTC" : (product.Price === 0 ? "FREE" : `$${product.Price.toFixed(2)}`)}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
