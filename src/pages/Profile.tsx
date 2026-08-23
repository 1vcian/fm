import { useProfile } from '../context/ProfileContext';
import { useComparison } from '../context/ComparisonContext';
import { Download, Upload, Trash2, Copy, Clipboard, ScanSearch, Swords } from 'lucide-react';
import { Button } from '../components/UI/Button';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EquipmentPanel } from '../components/Profile/EquipmentPanel';
import { PetPanel } from '../components/Profile/PetPanel';
import { SkillPanel } from '../components/Profile/SkillPanel';
import { MiscPanel } from '../components/Profile/MiscPanel';
import { StatsSummaryPanel } from '../components/Profile/StatsSummaryPanel';
import { ProfileHeaderPanel } from '../components/Profile/ProfileHeaderPanel';
import { SkillsPassivesPanel } from '../components/Profile/SkillsPassivesPanel';
import { SkinSetPanel } from '../components/Profile/SkinSetPanel';
import { AutoSyncModal } from '../components/Profile/AutoSyncModal';
import { PvpModal } from '../components/Profile/PvpModal';


export default function Profile() {
    const {
        resetProfile,
        exportProfile,
        importProfile,
        cloneProfile,
        importProfileFromJsonString
    } = useProfile();

    const {
        isComparing,
        originalItems,
        originalPets,
        originalSkills
    } = useComparison();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showAutoSync, setShowAutoSync] = useState(false);
    const [showPvp, setShowPvp] = useState(false);
    const SHOW_PVP = false; // Simplified PvP hidden until the enemy-panel reader is ready
    const [jsonToImport, setJsonToImport] = useState('');

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await importProfile(file);
        }
        // Reset input so same file can be imported again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="max-w-[100rem] mx-auto space-y-8 animate-fade-in pb-12 px-4 xl:px-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-6">
                <ProfileHeaderPanel />

                <div className="flex flex-wrap gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept=".json"
                        className="hidden"
                    />
                    <Button variant="ghost" size="sm" onClick={handleImportClick} title="Import Config from File">
                        <Upload className="w-4 h-4 mr-2" /> Import File
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowImportModal(true)} title="Import Config from Text">
                        <Clipboard className="w-4 h-4 mr-2" /> Paste JSON
                    </Button>
                    <Button variant="ghost" size="sm" onClick={exportProfile} title="Export Config">
                        <Download className="w-4 h-4 mr-2" /> Export
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cloneProfile} title="Clone Profile">
                        <Copy className="w-4 h-4 mr-2" /> Clone
                    </Button>
                    <Button variant="ghost" size="sm" onClick={resetProfile} title="Reset Profile" className="text-red-400 hover:text-red-300">
                        <Trash2 className="w-4 h-4 mr-2" /> Reset
                    </Button>


                </div>
            </div>

            {/* Content */}
            <div className="space-y-6">
                {/* AutoSync — read your profile from screenshots */}
                <button
                    onClick={() => setShowAutoSync(true)}
                    className="w-full group relative overflow-hidden rounded-2xl border border-accent-primary/40 bg-gradient-to-r from-accent-primary/20 via-accent-primary/10 to-accent-secondary/15 p-5 flex items-center gap-4 hover:border-accent-primary/70 transition active:scale-[0.99]"
                >
                    <div className="w-14 h-14 rounded-2xl bg-accent-primary/25 flex items-center justify-center shrink-0 group-hover:scale-110 transition">
                        <ScanSearch className="w-8 h-8 text-accent-primary" />
                    </div>
                    <div className="text-left min-w-0">
                        <div className="text-xl font-black text-white flex items-center gap-2">
                            AutoSync <span className="text-[9px] uppercase tracking-widest bg-accent-primary/30 text-accent-primary px-1.5 py-0.5 rounded">beta</span>
                        </div>
                        <div className="text-sm text-text-secondary">Upload your in-game screenshots — it reads gear, pets, mount &amp; resources and lets you review every change.</div>
                    </div>
                    <div className="ml-auto hidden sm:flex items-center text-accent-primary font-bold gap-1 pr-2 group-hover:translate-x-1 transition-transform">Scan →</div>
                </button>
                {showAutoSync && <AutoSyncModal onClose={() => setShowAutoSync(false)} />}

                {/* Simplified PvP — duel your build vs an opponent screenshot (hidden for now) */}
                {SHOW_PVP && (<>
                <button
                    onClick={() => setShowPvp(true)}
                    className="w-full group relative overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/20 via-red-500/10 to-accent-primary/10 p-4 flex items-center gap-4 hover:border-red-500/70 transition active:scale-[0.99]"
                >
                    <div className="w-12 h-12 rounded-2xl bg-red-500/25 flex items-center justify-center shrink-0 group-hover:scale-110 transition">
                        <Swords className="w-7 h-7 text-red-400" />
                    </div>
                    <div className="text-left min-w-0">
                        <div className="text-lg font-black text-white flex items-center gap-2">
                            Simplified PvP <span className="text-[9px] uppercase tracking-widest bg-red-500/30 text-red-300 px-1.5 py-0.5 rounded">beta</span>
                        </div>
                        <div className="text-sm text-text-secondary">Upload an opponent's profile screenshot and duel it against your build.</div>
                    </div>
                    <div className="ml-auto hidden sm:flex items-center text-red-400 font-bold gap-1 pr-2 group-hover:translate-x-1 transition-transform">Fight →</div>
                </button>
                {showPvp && <PvpModal onClose={() => setShowPvp(false)} />}
                </>)}

                <MiscPanel />
                
                <SkinSetPanel />

                {isComparing ? (
                    <div className="space-y-6">
                        {/* Comparison Controls & Stats Strip - Sticky Header */}
                        <div className="sticky top-0 z-40 py-2 -mx-4 px-4 bg-bg-primary/80 backdrop-blur-md border-b border-border shadow-lg space-y-2">

                            <StatsSummaryPanel variant="horizontal-strip" />
                        </div>

                        {/* Comparison Equipment Panels */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <EquipmentPanel
                                variant="original"
                                title="Equipped Items"
                                showCompareButton={false}
                            />
                            <EquipmentPanel
                                variant="test"
                                title="Test Build Items"
                                showCompareButton={false}
                                compareItems={originalItems}
                            />
                        </div>

                        {/* Comparison Pet Panels */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <PetPanel
                                variant="original"
                                title="Equipped Pets"
                            />
                            <PetPanel
                               variant="test"
                               title="Test Build Pets"
                               comparePets={originalPets}
                            />
                        </div>

                        {/* Comparison Skill Panels */}
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            <SkillPanel
                                variant="original"
                                title="Equipped Skills"
                            />
                            <SkillPanel
                                variant="test"
                                title="Test Build Skills"
                                compareSkills={originalSkills}
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <EquipmentPanel />
                        <PetPanel />
                        <SkillPanel />
                    </>
                )}

                <SkillsPassivesPanel />
            </div>

            {/* Import JSON Modal */}
            {showImportModal && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}>
                    <div className="bg-bg-primary w-full max-w-2xl rounded-2xl border border-border shadow-2xl p-6 space-y-4">
                        <h3 className="text-xl font-bold">Import Profile JSON</h3>
                        <p className="text-sm text-text-muted">Paste your profile JSON string below.</p>
                        <textarea
                            className="w-full h-64 bg-bg-input border border-border rounded-lg p-3 text-xs font-mono focus:border-accent-primary outline-none resize-none"
                            placeholder='{"id":"...", "items":...}'
                            value={jsonToImport}
                            onChange={(e) => setJsonToImport(e.target.value)}
                        />
                        <div className="flex justify-end gap-3">
                            <Button variant="outline" onClick={() => setShowImportModal(false)}>Cancel</Button>
                            <Button onClick={() => {
                                if (jsonToImport.trim()) {
                                    importProfileFromJsonString(jsonToImport);
                                    setShowImportModal(false);
                                    setJsonToImport('');
                                }
                            }}>Import</Button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
