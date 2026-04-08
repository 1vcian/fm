import { useSearchParams } from 'react-router-dom';
import { EnemyBuilder } from '../components/Pvp/EnemyBuilder';

export default function PvpArena() {
    const [searchParams] = useSearchParams();
    const isDev = searchParams.get('dev') === 'true';

    if (!isDev) {
        return (
            <div className="relative space-y-6 max-w-5xl mx-auto pb-12">
                {/* Maintenance Overlay - Now relative to the content area */}
                <div className="absolute inset-x-0 top-0 bottom-0 z-[10] bg-black/60 flex flex-col items-center justify-start text-white p-12 text-center backdrop-blur-sm rounded-2xl border border-white/5 mt-20">
                    <div className="max-w-md space-y-6">
                        <div className="relative">
                            <img 
                                src="https://media1.tenor.com/m/2kjf1AcPOPgAAAAC/tobey-maguire-sad.gif" 
                                alt="Sad Tobey" 
                                className="w-64 h-auto mx-auto rounded-lg shadow-2xl border-4 border-white/10" 
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <h1 className="text-3xl font-black tracking-tighter text-white uppercase">
                                Not ready yet...
                            </h1>
                            <p className="text-lg font-medium text-gray-300">
                                We are working hard to finish the simulator.
                            </p>
                        </div>

                        <div className="h-px w-24 bg-gray-700 mx-auto" />

                        <p className="text-sm text-gray-400 leading-relaxed italic">
                            Come back later, we are still synchronizing the calculations.
                        </p>

                        <div className="pt-4 flex flex-col items-center gap-3">
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 text-[10px] text-gray-500 uppercase tracking-widest">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                                Work in Progress
                            </div>
                            
                            <a 
                                href="https://github.com/1vcian/fm" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-accent-primary hover:underline flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity"
                            >
                                <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" className="w-4 h-4 invert" alt="" />
                                View progress on GitHub
                            </a>
                        </div>
                    </div>
                </div>

                {/* Underlying page preview (blurred) */}
                <div className="opacity-20 pointer-events-none blur-sm select-none">
                    <header>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-orange-600 bg-clip-text text-transparent flex items-center gap-3">
                            <img src={`${import.meta.env.BASE_URL}Texture2D/TechTreePower.png`} alt="Arena" className="w-10 h-10 object-contain" />
                            PVP Simulator
                        </h1>
                        <p className="text-text-secondary mt-2">
                            Build an opponent and simulate a battle against them.
                        </p>
                    </header>
                    <EnemyBuilder />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto animate-fade-in pb-12">
            <header>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-red-400 to-orange-600 bg-clip-text text-transparent flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}Texture2D/TechTreePower.png`} alt="Arena" className="w-10 h-10 object-contain" />
                    PVP Simulator
                </h1>
                <p className="text-text-secondary mt-2">
                    Build an opponent and simulate a battle against them.
                </p>
                <p className="text-text-muted text-xs mt-1 italic">
                    Empirical tool based on observations and uncertain deductions. Predictions may not be 100% accurate.
                </p>
            </header>


            <EnemyBuilder />

            {/* Background Decoration */}
            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none overflow-hidden">
                <img src={`${import.meta.env.BASE_URL}Texture2D/TechTreePower.png`} alt="" className="w-64 h-64 object-contain grayscale" />
            </div>
        </div >
    );
}
