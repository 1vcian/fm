import { HashRouter, Routes, Route } from 'react-router-dom';
import { GameDataProvider } from './context/GameDataContext';
import { ProfileProvider } from './context/ProfileContext';
import { TreeModeProvider } from './context/TreeModeContext';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import AppShell from './components/Layout/AppShell';
import Home from './pages/Home';
import Configs from './pages/Configs';
import Mounts from './pages/Mounts';
import Items from './pages/Items';
import Pets from './pages/Pets';
import Skills from './pages/Skills';
import Eggs from './pages/Eggs';
import Dungeons from './pages/Dungeons';
import TechTree from './pages/TechTree';
import Arena from './pages/Arena';
import GuildWar from './pages/GuildWar';

import Unlocks from './pages/Unlocks';
import Offline from './pages/Offline';
import Colors from './pages/Colors';
import FAQ from './pages/FAQ';
import Profile from './pages/Profile';
import ProgressPrediction from './pages/ProgressPrediction';
import PvpArena from './pages/PvpArena';
import ForgeCalculator from './pages/Calculators/ForgeCalculator';
import MountCalculator from './pages/Calculators/MountCalculator';
import SkillCalculator from './pages/Calculators/SkillCalculator';
import TreeCalculator from './pages/Calculators/TreeCalculator';
import Verify from './pages/Verify';
import ForgeWiki from './pages/ForgeWiki';

function App() {
    return (
        <GameDataProvider>
            <ProfileProvider>
                <TreeModeProvider>
                    <HashRouter>
                        <Routes>
                            <Route path="/" element={<AppShell />}>
                                <Route index element={<Profile />} />
                                <Route path="progress-prediction" element={<ProgressPrediction />} />
                                <Route path="home" element={<Home />} />
                                <Route path="configs" element={<Configs />} />
                                <Route path="mounts" element={<Mounts />} />
                                <Route path="skills" element={<Skills />} />
                                <Route path="eggs" element={<Eggs />} />
                                <Route path="dungeons" element={<Dungeons />} />
                                <Route path="forge-calculator" element={<ForgeCalculator />} />
                                <Route path="items" element={<Items />} />
                                <Route path="pets" element={<Pets />} />

                                <Route path="tech-tree" element={<TechTree />} />
                                <Route path="arena" element={<Arena />} />
                                <Route path="guild-war" element={<GuildWar />} />
                                <Route path="verify" element={<Verify />} />

                                <Route path="unlocks" element={<Unlocks />} />
                                <Route path="offline" element={<Offline />} />
                                <Route path="colors" element={<Colors />} />
                                <Route path="faq" element={<FAQ />} />
                                <Route path="pvp-arena" element={<PvpArena />} />
                                <Route path="calculators/forge" element={<ForgeCalculator />} />
                                <Route path="calculators/mounts" element={<MountCalculator />} />
                                <Route path="calculators/skills" element={<SkillCalculator />} />
                                <Route path="calculators/tree" element={<TreeCalculator />} />
                                <Route path="wiki/forge" element={<ForgeWiki />} />
                                <Route path="*" element={<Home />} />
                            </Route>
                        </Routes>
                    </HashRouter>
                </TreeModeProvider>
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
