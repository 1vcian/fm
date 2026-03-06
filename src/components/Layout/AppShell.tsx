import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Coffee, ExternalLink, Github } from 'lucide-react';
import { useGameDataContext } from '../../context/GameDataContext';

export default function AppShell() {
    const { versions, selectedVersion, setSelectedVersion } = useGameDataContext();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="flex h-screen bg-bg-primary text-text-primary overflow-hidden font-sans">
            {/* Sidebar Navigation */}
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative lg:ml-64 text-left">
                {/* Header */}
                <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} />

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar pb-20">
                    <Outlet />

                    {/* Footer */}
                    <footer className="mt-12 py-6 border-t border-border text-center text-text-muted text-sm">
                        <div className="flex flex-col gap-2 items-center justify-center">
                            <p>Forge Master Calculator &copy; {new Date().getFullYear()}</p>
                            <div className="flex items-center justify-center gap-4">
                                <a
                                    href="https://1vcian.me"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-accent-primary hover:text-accent-secondary transition-colors"
                                >
                                    Visit My Website <ExternalLink className="w-3 h-3" />
                                </a>
                                <span className="text-border">|</span>
                                <a
                                    href="https://github.com/1vcian/fm"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-text-secondary hover:text-white transition-colors"
                                >
                                    GitHub <Github className="w-3 h-3" />
                                </a>
                            </div>
                            {versions.length > 0 && (
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                    <span className="opacity-70">Data Version:</span>
                                    <select
                                        value={selectedVersion}
                                        onChange={(e) => setSelectedVersion(e.target.value)}
                                        className="bg-bg-input border border-border rounded px-2 py-0.5 text-text-primary text-xs outline-none focus:border-accent-primary cursor-pointer"
                                    >
                                        {versions.map(v => (
                                            <option key={v} value={v}>{v}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </footer>
                </main>



                {/* Buy Me A Coffee - Fixed Floating Button */}
                <a
                    href="https://www.buymeacoffee.com/1vcian"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fixed bottom-8 right-8 z-50 group flex items-center gap-3 overflow-hidden px-5 md:px-7 py-3 md:py-4 rounded-full bg-[#FFDD00] text-black font-extrabold shadow-[0_8px_25px_-5px_rgba(255,221,0,0.4)] hover:shadow-[0_12px_35px_-5px_rgba(255,221,0,0.6)] transition-all duration-300 hover:-translate-y-1.5 active:scale-95 animate-float coffee-btn-glow"
                >
                    {/* Shimmer Effect Layer */}
                    <div className="absolute inset-0 animate-shimmer pointer-events-none opacity-30" />

                    <div className="relative flex items-center gap-2.5">
                        <Coffee className="w-6 h-6 group-hover:rotate-[15deg] transition-transform duration-300" />
                        <span className="text-base md:text-lg tracking-tight">Buy me a coffee</span>
                    </div>
                </a>
            </div>
        </div>
    );
}
