import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '../components/UI/Card';
import { GameIcon } from '../components/UI/GameIcon';
import { useGameData } from '../hooks/useGameData';
import { useFeatureUnlocks, type FeatureUnlock } from '../hooks/useFeatureUnlocks';
import { cn } from '../lib/utils';
import { getItemImage, getItemName } from '../utils/itemAssets';
import { useGameDataContext } from '../context/GameDataContext';
import type { DailyDealRow } from '../utils/dailyDeals';

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

const AGES = ['Primitive', 'Medieval', 'Early-Modern', 'Modern', 'Space', 'Interstellar', 'Multiverse', 'Quantum', 'Underworld', 'Divine'];

/**
 * Maps game reward data to the correct icon name in Texture2D or IconsMap
 */
function getShopIcon(reward: Reward, product?: IAPProduct, autoMapping?: any, version?: string): string {
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
            const spritePath = getItemImage(ageName, itemId.Type, itemId.Idx, autoMapping, version);
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
    if (type === 'GuildPotions') return 'GuildPotions';

    return type;
}

import { usePersistentState } from '../hooks/usePersistentState';
import { GameAssetIcon } from '../components/UI/GameAssetIcon';
import { DailyDealsTab } from '../components/Shop/DailyDealsTab';
import { EggIcon } from '../components/UI/EggIcon';
import { CurrencyTab, SpecialTab } from '../components/Shop/ShopValueTabs';
import { bestDailyRates, type Reward as ValueReward } from '../components/Shop/shopValue';

export default function Shop() {
    const { selectedVersion } = useGameDataContext();
    const { data: dailyDeals } = useGameData<Record<string, DailyDealRow>>('DailyDealLibrary.json');
    const { data: iapProducts } = useGameData<Record<string, IAPProduct>>('InAppProducts.json');
    // Feature gates come through this hook rather than straight from a config file: the game moved
    // the table from UnlockConditions.json into PlayerSegments.json, and reading the retired name
    // here is what silently emptied every unlock caption on this page. See useFeatureUnlocks.
    const { byId: unlockData } = useFeatureUnlocks();
    const { data: shopResources } = useGameData<any>('ShopResourcesLibrary.json');
    const { data: guildWarConfig } = useGameData<any>('GuildWarDayConfigLibrary.json');
    const { data: autoMapping } = useGameData<any>('AutoItemMapping.json');
    const { data: passLibrary } = useGameData<Record<string, any>>('MainGameProgressPassLibrary.json');

    // Per resource, the most a dollar buys of it in any daily deal (the yardstick of every tab).
    const bestDaily = useMemo(() => bestDailyRates(dailyDeals, iapProducts ? Object.values(iapProducts) : []), [dailyDeals, iapProducts]);
    // The Progress Pass's premium track (Rewards[1]) over every difficulty, summed by resource.
    const passPremium = useMemo(() => {
        const m = new Map<string, ValueReward>();
        for (const tier of Object.values(passLibrary ?? {})) {
            for (const r of tier.Rewards?.[1]?.Rewards ?? []) {
                const k = `${r.$type}:${r.Type}`;
                m.set(k, { ...r, Amount: (m.get(k)?.Amount ?? 0) + r.Amount });
            }
        }
        return [...m.values()];
    }, [passLibrary]);

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


    const products = useMemo(() => {
        if (!iapProducts) return [];
        return Object.values(iapProducts).filter(p => {
            return p.Name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.Rewards.some(r => (r.Type ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
        });
    }, [iapProducts, searchQuery]);

    // ageIdx is null for a feature gated on something other than story progress, and this
    // block only knows how to say "age and stage", so it stands down rather than print a blank.
    const shopFeature = unlockData['Shop'];
    const shopUnlock = shopFeature && shopFeature.ageIdx !== null ? shopFeature : null;

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
                            <GameAssetIcon asset={{ icon: 'InfoIcon' }} size={12} />
                            Rewards, deals and visibility
                        </p>
                    </div>
                </div>

                <div className="relative w-full md:w-80 group">
                    <GameAssetIcon asset={{ icon: 'SearchIcon' }} size={18} className="absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search rewards or packs"
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
                        <GameAssetIcon asset={{ icon: 'Solid Lock Icon' }} size={120} />
                    </div>
                    <div className="flex items-center gap-6 relative z-10">
                        <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center ring-4 ring-bg-primary">
                            <GameAssetIcon asset={{ icon: 'Solid Lock Icon' }} size={32} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white uppercase tracking-tight">Shop Availability</h3>
                            <p className="text-text-muted text-sm">Main shop features unlock milestones</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 relative z-10">
                        {/* A battle as the game names it: numbers only (FormatBattleNumber). */}
                        <div className="bg-bg-primary/50 backdrop-blur-md px-5 py-3 rounded-xl border border-white/5 shadow-xl">
                            <div className="text-[10px] uppercase font-black text-accent-primary tracking-widest mb-1">Unlocks after battle</div>
                            <div className="text-lg font-bold text-white">{shopUnlock.ageIdx! + 1}-{(shopUnlock.battleIdx ?? 0) + 1}</div>
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
                {activeTab === 'daily' && dailyDeals && (
                    <DailyDealsTab library={dailyDeals} products={iapProducts ? Object.values(iapProducts) : []} />
                )}

                {activeTab === 'iap' && (
                    <CurrencyTab products={products} bestDaily={bestDaily}
                        freeTokens={shopResources?.TokenPack0?.Reward ?? null}
                        unlockLabel={unlockData['SteppingStones'] && unlockData['SteppingStones'].ageIdx !== null
                            ? `${unlockData['SteppingStones'].ageIdx + 1}-${(unlockData['SteppingStones'].battleIdx ?? 0) + 1}` : null} />
                )}

                {activeTab === 'offers' && (
                    <SpecialTab products={products} bestDaily={bestDaily} passPremium={passPremium}
                        renderProduct={p => <ProductCard key={p.ProductId} product={p} variant="primary" unlockData={unlockData} autoMapping={autoMapping} isWarActive={isWarActive} version={selectedVersion} />} />
                )}
            </div>
        </div>
    );
}

function ProductCard({ product, variant, unlockData, autoMapping, isWarActive, version }: {
    product: any;
    variant: 'primary' | 'secondary';
    unlockData?: Record<string, FeatureUnlock> | null;
    autoMapping?: any;
    isWarActive?: boolean;
    version?: string;
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
    const eggReward = product.Rewards?.find((r: any) => r.$type === 'EggStarterOfferPackageReward');
    const displayName = useMemo(() => {
        if (eggReward) return `${eggReward.Amount} ${eggReward.Rarity} Eggs`;
        if (starterReward && starterReward.ItemId) {
            const ageName = AGES[starterReward.ItemId.Age];
            const name = getItemName(ageName, starterReward.ItemId.Type, starterReward.ItemId.Idx, autoMapping);
            return name || product.Name;
        }
        return product.Name;
    }, [starterReward, eggReward, product.Name, autoMapping]);

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
                        {/* EggStarterOfferPackageReward: Amount eggs of a Rarity, drawn as that egg. */}
                        {product.Rewards?.[0]?.$type === 'EggStarterOfferPackageReward'
                            ? <EggIcon rarity={product.Rewards[0].Rarity} size={64} className="drop-shadow-lg" />
                            : <GameIcon
                                name={getShopIcon(product.Rewards?.[0], product, autoMapping, version)}
                                className="w-full h-full drop-shadow-lg"
                            />}
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
                            <GameAssetIcon asset={{ icon: 'Solid Lock Icon' }} size={12} />
                            <span className="text-[10px] font-bold text-text-muted uppercase">
                                {starterReward && starterReward.ItemId
                                    ? `Required Age ${starterReward.ItemId.Age}`
                                    : unlockInfo && unlockInfo.ageIdx !== null
                                        ? `Stage ${unlockInfo.ageIdx + 1}-${(unlockInfo.battleIdx ?? 0) + 1}`
                                        : unlockInfo?.extraRequirements[0] ?? ''
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
                            <GameAssetIcon asset={{ icon: 'Timer' }} size={12} />
                            <span className="text-[9px] font-black text-accent-primary uppercase tracking-wider">48h Duration</span>
                        </div>
                    )}

                    {/* Inactive Token Status */}
                    {isInactiveToken && (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 mt-2">
                            <GameAssetIcon asset={{ icon: 'Solid Lock Icon' }} size={12} />
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
