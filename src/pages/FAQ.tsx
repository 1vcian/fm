import { useState, useEffect } from 'react';
import { Card } from '../components/UI/Card';
import { HelpCircle, Heart, Zap, Coffee, Globe, ExternalLink, MessageCircle, Star, Quote, Users, Github, PlusCircle, MinusCircle } from 'lucide-react';
import contributorsStats from '../data/contributors_stats.json';

export default function FAQ() {
    const [supporters, setSupporters] = useState<any[]>([]);
    const [contributors, setContributors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingContributors, setLoadingContributors] = useState(true);

    useEffect(() => {
        fetch(`${import.meta.env.BASE_URL}supporters.json`)
            .then(res => res.json())
            .then(data => {
                setSupporters(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));

        fetch('https://api.github.com/repos/1vcian/fm/contributors')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    // Merge with local stats
                    const merged = data.map(gh => {
                        const stats = contributorsStats.find(s => 
                            s.name.toLowerCase() === gh.login.toLowerCase() ||
                            gh.login.toLowerCase() === s.email?.split('@')[0].toLowerCase()
                        );
                        return { 
                            ...gh, 
                            additions: stats?.additions || 0,
                            deletions: stats?.deletions || 0,
                            commits: stats?.commits || gh.contributions
                        };
                    });
                    setContributors(merged);
                }
                setLoadingContributors(false);
            })
            .catch(() => setLoadingContributors(false));
    }, []);

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
                                        href="https://discord.gg/forgemaster"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-bg-input border border-border hover:border-accent-primary transition-all text-xs font-bold text-indigo-400 hover:text-indigo-300"
                                    >
                                        <MessageCircle className="w-4 h-4" /> DISCORD
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
                                        <Github className="w-4 h-4" /> GITHUB REPO
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
                                className="group relative flex items-center gap-2 px-8 py-3 rounded-full bg-[#FFDD00] text-black font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-[0_5px_15px_-3px_rgba(255,221,0,0.4)] overflow-hidden coffee-btn-glow"
                            >
                                <div className="absolute inset-0 animate-shimmer pointer-events-none opacity-20" />
                                <Coffee className="w-5 h-5 fill-current group-hover:rotate-12 transition-transform" />
                                <span className="relative z-10">BUY ME A COFFEE</span>
                                <ExternalLink className="w-4 h-4 opacity-50 relative z-10" />
                            </a>
                        </div>
                    </div>
                </Card>

                {/* Contributors Section */}
                {!loadingContributors && contributors.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-2">
                                <Users className="w-6 h-6 text-accent-primary" />
                                GitHub Contributors
                            </h2>
                            <span className="text-[10px] font-bold bg-accent-primary/10 text-accent-primary px-3 py-1 rounded-full border border-accent-primary/20 uppercase tracking-widest">
                                {contributors.length} Developers
                            </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {contributors.map((c: any, idx: number) => (
                                <a
                                    key={idx}
                                    href={c.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 rounded-2xl bg-bg-secondary/30 border border-border/50 hover:border-accent-primary hover:bg-accent-primary/5 transition-all group flex items-center gap-3"
                                >
                                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-border group-hover:border-accent-primary/50 transition-colors">
                                        <img src={c.avatar_url} alt={c.login} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-xs truncate text-text-primary group-hover:text-accent-primary transition-colors">
                                            {c.login}
                                        </div>
                                        <div className="flex flex-col gap-0.5 mt-1">
                                            <div className="flex items-center gap-1.5 text-[9px] font-bold">
                                                <span className="text-text-muted">{c.commits} patches</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="flex items-center gap-0.5 text-green-400 text-[9px] font-mono">
                                                    <PlusCircle size={8} />
                                                    {c.additions.toLocaleString()}
                                                </div>
                                                <div className="flex items-center gap-0.5 text-red-400 text-[9px] font-mono">
                                                    <MinusCircle size={8} />
                                                    {c.deletions.toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Supporters Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-black italic uppercase tracking-tighter flex items-center gap-2">
                            <Star className="w-6 h-6 text-yellow-500 fill-current" />
                            Supporters Hall of Fame
                        </h2>
                        {!loading && supporters.length > 0 && (
                            <span className="text-[10px] font-bold bg-yellow-500/10 text-yellow-500 px-3 py-1 rounded-full border border-yellow-500/20 uppercase tracking-widest">
                                {supporters.length} Heroes
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {[1, 2, 3, 4].map(idx => (
                                <div key={idx} className="h-32 bg-bg-secondary/20 rounded-2xl animate-pulse border border-border/50" />
                            ))}
                        </div>
                    ) : supporters.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {supporters.map((item, idx) => {
                                const s = item.supporter;
                                const msg = item.supporter_message?.note;
                                
                                return (
                                    <Card key={idx} className="p-4 relative group overflow-hidden border-accent-primary/5 hover:border-accent-primary/30 transition-all flex flex-col">
                                        <div className="absolute -top-6 -right-6 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
                                            <Quote className="w-24 h-24" />
                                        </div>
                                        
                                        <div className="flex items-start justify-between mb-3 relative z-10">
                                            <div className="flex items-center gap-3">
                                                {s.dp ? (
                                                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-border bg-bg-secondary">
                                                        <img src={s.dp} alt={s.name} className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 flex items-center justify-center font-black text-yellow-500 shadow-inner">
                                                        {s.name[0]}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-black text-text-primary text-sm uppercase tracking-tight">{s.name}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {msg ? (
                                            <p className="text-sm text-text-secondary leading-relaxed italic relative z-10 pl-4 border-l-2 border-accent-primary/20 mt-auto">
                                                "{msg}"
                                            </p>
                                        ) : (
                                            <p className="text-xs text-text-muted italic opacity-50 mt-auto">
                                                Supported with a gift!
                                            </p>
                                        )}
                                    </Card>
                                );
                            })}
                        </div>
                    ) : (
                        <Card className="p-12 text-center bg-bg-secondary/10 border-dashed border-2 border-border/50">
                            <Coffee className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-20" />
                            <p className="font-bold text-text-muted uppercase tracking-widest text-sm">Be the first to appear in the Hall of Fame!</p>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
