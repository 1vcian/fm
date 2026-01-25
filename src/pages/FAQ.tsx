import { Card } from '../components/UI/Card';
import { HelpCircle, Heart, Zap, Coffee, Globe, ExternalLink } from 'lucide-react';

export default function FAQ() {
    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
            {/* Header */}
            <div className="flex items-center gap-4 border-b border-border pb-6">
                <HelpCircle className="w-10 h-10 text-accent-primary" />
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                        Project Information
                    </h1>
                    <p className="text-text-muted">Credits, Support & Feedback</p>
                </div>
            </div>

            <div className="space-y-6">
                {/* Project Info Section */}
                <Card className="border-accent-primary/20 bg-accent-primary/5">
                    <h2 className="font-bold text-xl flex items-center gap-2 mb-4 text-accent-primary">
                        <Heart className="w-5 h-5 fill-current" /> Project Credits
                    </h2>
                    <div className="space-y-6">
                        <div className="flex flex-col md:flex-row gap-6">
                            <div className="flex-1 space-y-3">
                                <p className="text-sm text-text-primary leading-relaxed">
                                    This is a <strong>100% Fanmade tool</strong> created to assist the Forge Master community.
                                    The project was entirely developed by <span className="text-accent-secondary font-bold italic">1vcian</span>.
                                </p>
                                <div className="flex flex-wrap gap-3">
                                    <a
                                        href="https://1vcian.me"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-input border border-border hover:border-accent-primary transition-all text-xs font-bold"
                                    >
                                        <Globe className="w-4 h-4" /> 1vcian.me
                                    </a>
                                    <a
                                        href="mailto:medrihanlucian@gmail.com"
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-input border border-border hover:border-accent-primary transition-all text-xs font-bold"
                                    >
                                        <HelpCircle className="w-4 h-4" /> BUG & FEEDBACK
                                    </a>
                                    <a
                                        href="https://github.com/1vcian/fm"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-input border border-border hover:border-accent-primary transition-all text-xs font-bold text-text-muted hover:text-text-primary"
                                    >
                                        <ExternalLink className="w-4 h-4" /> GITHUB REPO
                                    </a>
                                </div>
                            </div>

                            <div className="flex-1 p-4 bg-bg-secondary/40 rounded-2xl border border-border/50">
                                <h3 className="text-xs font-black uppercase tracking-widest text-text-muted mb-3">Special Thanks</h3>
                                <p className="text-sm text-text-secondary italic leading-relaxed">
                                    "A huge thank you to the entire community for the constant support. In particular, special thanks to <strong className="text-text-primary">Timbo</strong>, whose contribution to debugging, development, and improvement of this tool has been fundamental."
                                </p>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm font-medium text-text-muted">
                                <Zap className="w-4 h-4 text-yellow-500" />
                                Like the tool? Consider supporting the project!
                            </div>
                            <a
                                href="https://www.buymeacoffee.com/1vcian"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#FFDD00] text-black font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-lg"
                            >
                                <Coffee className="w-5 h-5 fill-current" />
                                BUY ME A COFFEE
                                <ExternalLink className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
