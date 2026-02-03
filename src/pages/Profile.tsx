import { useProfile } from '../context/ProfileContext';
import { useComparison } from '../context/ComparisonContext';
import { Download, Upload, Trash2, Copy, Clipboard, X, Check, ArrowRight } from 'lucide-react';
import { Button } from '../components/UI/Button';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EquipmentPanel } from '../components/Profile/EquipmentPanel';
import { PetPanel } from '../components/Profile/PetPanel';
import { SkillPanel } from '../components/Profile/SkillPanel';
import { MiscPanel } from '../components/Profile/MiscPanel';
import { TechTreePanel } from '../components/Profile/TechTreePanel';
import { StatsSummaryPanel } from '../components/Profile/StatsSummaryPanel';
import { ProfileHeaderPanel } from '../components/Profile/ProfileHeaderPanel';
import { SkillsPassivesPanel } from '../components/Profile/SkillsPassivesPanel';

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
        exitCompareMode,
        keepOriginal,
        applyTestBuild,
    } = useComparison();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [considerAnimation, setConsiderAnimation] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <MiscPanel />

                    {isComparing ? (
                        <div className="space-y-6">
                            {/* Comparison Equipment Panels */}
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                <EquipmentPanel
                                    variant="original"
                                    title="Equipped"
                                    showCompareButton={false}
                                />
                                <EquipmentPanel
                                    variant="test"
                                    title="Test Build"
                                    showCompareButton={false}
                                    compareItems={originalItems}
                                />
                            </div>

                            {/* Comparison Action Buttons */}
                            <div className="flex flex-wrap items-center justify-center gap-3 p-4 bg-bg-secondary rounded-xl border border-border">
                                <Button variant="ghost" onClick={exitCompareMode}>
                                    <X className="w-4 h-4 mr-2" />
                                    Exit Compare
                                </Button>
                                <Button variant="secondary" onClick={keepOriginal}>
                                    <Check className="w-4 h-4 mr-2" />
                                    Keep Equipped
                                </Button>
                                <Button variant="primary" onClick={applyTestBuild}>
                                    <ArrowRight className="w-4 h-4 mr-2" />
                                    Apply Test Build
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <EquipmentPanel />
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <PetPanel />
                        <SkillPanel considerAnimation={considerAnimation} setConsiderAnimation={setConsiderAnimation} />
                    </div>

                    <SkillsPassivesPanel considerAnimation={considerAnimation} />

                    <TechTreePanel />
                </div>

                <div className="space-y-6">
                    <div className="sticky top-6">
                        <StatsSummaryPanel />
                    </div>
                </div>
            </div>

            {/* Import JSON Modal */}
            {showImportModal && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
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
