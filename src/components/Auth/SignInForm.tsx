/**
 * SignInForm — passwordless sign-in, in three states.
 *
 *   idle/error  the email field + "Send magic link"
 *   sending     the button spins
 *   sent        "check your inbox", with the address named and a way back
 *
 * WHY THE RATE LIMIT GETS ITS OWN TREATMENT
 * ----------------------------------------
 * A Supabase project on the free plan sends magic links through a shared SMTP sender: a handful
 * per hour *in total*, plus a ~60 s cooldown per address. Users hit this constantly, and a bare
 * "429" reads as "the app is broken". So the limit is explained in plain words, together with the
 * two things that actually help: wait, or reuse the link already in the inbox (valid for an hour).
 *
 * Nothing here is required to use the app. The panel that renders this always says so.
 */

import { useState } from 'react';
import { Mail, Loader2, AlertTriangle, Clock, MailCheck, ArrowLeft } from 'lucide-react';
import { Button } from '../UI/Button';
import { useAuth } from '../../context/AuthContext';

export function SignInForm() {
    const auth = useAuth();
    const [email, setEmail] = useState('');

    const sending = auth.magicLink === 'sending';

    if (auth.magicLink === 'sent') {
        return (
            <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <MailCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-1">
                        {/* "Check spam" is in the headline, not in a footnote underneath it. This is a
                            new sending domain, so a first message really does land in spam sometimes,
                            and somebody who does not find the mail concludes the sign-in is broken and
                            presses the button again. That second press is worse than useless: it burns
                            a slot against the hourly send limit and the retry is silently dropped. */}
                        <div className="font-bold text-emerald-300">Check your inbox, and your spam folder</div>
                        <p className="text-sm text-text-secondary break-words">
                            A sign-in link is on its way to{' '}
                            <span className="font-semibold text-text-primary">{auth.magicLinkEmail}</span>.
                            It often lands in <span className="font-semibold">spam</span> the first time, so
                            look there before asking for another one. Open it{' '}
                            <span className="font-semibold">in this browser</span>: the link is tied to it and
                            expires in an hour.
                        </p>
                        <p className="text-xs text-text-muted">
                            Marking it as not spam once teaches your mail provider, and the next ones arrive
                            normally. Asking again too soon will hit the send limit instead.
                        </p>
                    </div>
                </div>
                <button
                    onClick={auth.resetMagicLink}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-accent-primary transition"
                >
                    <ArrowLeft className="w-3.5 h-3.5" /> Use a different address
                </button>
            </div>
        );
    }

    return (
        <form
            className="space-y-3"
            onSubmit={e => {
                e.preventDefault();
                if (!sending) void auth.sendMagicLink(email);
            }}
        >
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    <input
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        disabled={sending}
                        className="w-full h-10 rounded-md border border-border bg-bg-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary disabled:opacity-50"
                    />
                </div>
                <Button type="submit" disabled={sending || !email.trim()} className="sm:w-auto">
                    {sending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending</>
                    ) : (
                        <>Send magic link</>
                    )}
                </Button>
            </div>

            <p className="text-xs text-text-muted">
                No password. We email you a one-time link; opening it signs you in on this device.
            </p>

            {auth.error && (
                <div
                    className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                        auth.rateLimited
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                            : 'border-accent-secondary/40 bg-accent-secondary/10 text-red-200'
                    }`}
                >
                    {auth.rateLimited
                        ? <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                        : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-accent-secondary" />}
                    <div className="min-w-0">
                        <p className="break-words">{auth.error}</p>
                        {auth.rateLimited && auth.retryAfterSeconds !== null && (
                            <p className="mt-1 text-xs opacity-80">
                                Try again in about {auth.retryAfterSeconds} seconds.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </form>
    );
}
