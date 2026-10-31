import type { ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { GameDataProvider, useGameDataContext } from './context/GameDataContext';
import { ProfileProvider } from './context/ProfileContext';
import { ClanProvider } from './context/ClanContext';
import { TreeModeProvider } from './context/TreeModeContext';
import { ComparisonProvider } from './context/ComparisonContext';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import AppShell from './components/Layout/AppShell';
import Configs from './pages/Configs';
import PresetBuilds from './pages/PresetBuilds';
import Mounts from './pages/Mounts';
import Items from './pages/Items';
import Pets from './pages/Pets';
import Skills from './pages/Skills';
import Eggs from './pages/Eggs';
import Dungeons from './pages/Dungeons';
import TechTree from './pages/TechTree';
import Arena from './pages/Arena';
import GuildWar from './pages/GuildWar';
import Clan from './pages/Clan';

import Unlocks from './pages/Unlocks';
import Offline from './pages/Offline';
import Colors from './pages/Colors';
import ImagesMaker from './pages/ImagesMaker';
import FAQ from './pages/FAQ';
import Profile from './pages/Profile';
import ProgressPrediction from './pages/ProgressPrediction';
import UpgradeRanking from './pages/UpgradeRanking';
import LoadoutSearch from './pages/LoadoutSearch';
import PvpArena from './pages/PvpArena';
import SubstatsCalculator from './pages/Calculators/SubstatsCalculator';
import ForgeCalculator from './pages/Calculators/ForgeCalculator';
import SummonsCalculator from './pages/Calculators/SummonsCalculator';
import TreeCalculator from './pages/Calculators/TreeCalculator';
import WarPrizesCalculator from './pages/Calculators/WarPrizesCalculator';
import Verify from './pages/Verify';
import ForgeWiki from './pages/ForgeWiki';
import SkinsPage from './pages/Skins';
import BaseDrops from './pages/BaseDrops';
import Shop from './pages/Shop';
import ProgressPassWiki from './pages/ProgressPassWiki';
import Gallery from './pages/Gallery';
import FairiesWiki from './pages/FairiesWiki';
import AchievementsWiki from './pages/AchievementsWiki';
import Settings from './pages/Settings';
import SecondaryStatsWiki from './pages/SecondaryStatsWiki';
import MissionsWiki from './pages/MissionsWiki';
import MissionSolo from './pages/MissionSolo';

/** Developer pages (Configs, Verify) exist only with ?debug=true; anyone else lands on the profile. */
function DebugOnly({ children }: { children: ReactNode }) {
    const { isDebug } = useGameDataContext();
    return isDebug ? <>{children}</> : <Navigate to="/" replace />;
}

function App() {
    return (
        <GameDataProvider>
            <ProfileProvider>
                {/* ClanProvider is keyed on the ACTIVE PROFILE and reads the war configs, so it
                    belongs inside ProfileProvider and GameDataProvider. And outside the router, so
                    every clan surface (the Clan page and the header's clan chip) sits under it.
                    Auth needs no provider: AuthContext is an external store. With no
                    VITE_SUPABASE_* it settles on 'unconfigured' without a single fetch. */}
                <ClanProvider>
                    <ComparisonProvider>
                        <TreeModeProvider>
                            <HashRouter>
                            <Routes>
                                <Route path="/" element={<AppShell />}>
                                    <Route index element={<Profile />} />
                                    <Route path="progress-prediction" element={<ProgressPrediction />} />
                                    <Route path="upgrades" element={<UpgradeRanking />} />
                                    <Route path="loadout-search" element={<LoadoutSearch />} />
                                    {/* pages/Home.tsx was a legacy copy of the forge calculator: send its old URL there. */}
                                    <Route path="home" element={<Navigate to="/calculators/forge" replace />} />
                                    <Route path="configs" element={<Configs />} />
                                    <Route path="presets" element={<PresetBuilds />} />
                                    <Route path="mounts" element={<Mounts />} />
                                    <Route path="skills" element={<Skills />} />
                                    <Route path="eggs" element={<Eggs />} />
                                    <Route path="dungeons" element={<Dungeons />} />
                                    <Route path="forge-calculator" element={<Navigate to="/calculators/forge" replace />} />
                                    <Route path="items" element={<Items />} />
                                    <Route path="pets" element={<Pets />} />

                                    <Route path="tech-tree" element={<TechTree />} />
                                    <Route path="arena" element={<Arena />} />
                                    <Route path="guild-war" element={<GuildWar />} />
                                    <Route path="clan" element={<Clan />} />
                                    <Route path="verify" element={<DebugOnly><Verify /></DebugOnly>} />

                                    <Route path="unlocks" element={<Unlocks />} />
                                    <Route path="offline" element={<Offline />} />
                                    <Route path="colors" element={<Colors />} />
                                    <Route path="images" element={<ImagesMaker />} />
                                    <Route path="emblems" element={<ImagesMaker initialTab="emblem" />} />
                                    <Route path="faq" element={<FAQ />} />
                                    <Route path="pvp-arena" element={<PvpArena />} />
                                    <Route path="calculators/forge" element={<ForgeCalculator />} />
                                    <Route path="calculators/summons" element={<SummonsCalculator />} />
                                    {/* The mount and skill calculators are tabs of the Summons calculator now. */}
                                    <Route path="calculators/mounts" element={<Navigate to="/calculators/summons?tab=mounts" replace />} />
                                    <Route path="calculators/skills" element={<Navigate to="/calculators/summons?tab=skills" replace />} />
                                    <Route path="calculators/tree" element={<TreeCalculator />} />
                                    <Route path="calculators/substats" element={<SubstatsCalculator />} />
                                    <Route path="calculators/war-prizes" element={<WarPrizesCalculator />} />
                                    <Route path="solo-mission" element={<MissionSolo />} />
                                    <Route path="wiki/forge" element={<ForgeWiki />} />
                                    <Route path="wiki/base-drops" element={<BaseDrops />} />
                                    <Route path="wiki/shop" element={<Shop />} />
                                    <Route path="wiki/progress-pass" element={<ProgressPassWiki />} />
                                    <Route path="wiki/secondary-stats" element={<SecondaryStatsWiki />} />
                                    <Route path="wiki/fairies" element={<FairiesWiki />} />
                                    <Route path="wiki/achievements" element={<AchievementsWiki />} />
                                    <Route path="wiki/missions" element={<MissionsWiki />} />
                                    <Route path="skins" element={<SkinsPage />} />
                                    <Route path="gallery" element={<Gallery />} />
                                    <Route path="settings" element={<Settings />} />
                                    <Route path="*" element={<Navigate to="/" replace />} />
                                </Route>
                            </Routes>
                            </HashRouter>
                        </TreeModeProvider>
                    </ComparisonProvider>
                </ClanProvider>
            </ProfileProvider>
            <ToastContainer
                position="top-center"
                autoClose={2000}
                hideProgressBar
                newestOnTop
                closeOnClick
                rtl={false}
                pauseOnFocusLoss={false}
                draggable={false}
                pauseOnHover={false}
                theme="dark"
            />
        </GameDataProvider>
    );
}

export default App;
