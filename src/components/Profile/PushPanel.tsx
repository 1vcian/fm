/**
 * PushPanel — the only place in the app that asks for notification permission.
 *
 * WHAT IT REFUSES TO DO
 * ---------------------
 * It never prompts on load. Not once, not "just to see the state". Chrome and Firefox would refuse
 * the call anyway (no user gesture), but the real reason is iOS: a denial there is effectively
 * permanent, and the only documented way to be asked again is deleting the Home Screen icon and
 * re-adding it — which ALSO wipes site storage, and this app keeps every profile in site storage.
 * So a prompt the user did not understand can cost them their data to undo. The prompt therefore
 * fires from the second tap of a two-step explainer, and from nowhere else.
 *
 * IT RENDERS NOTHING when the build has no `VITE_SUPABASE_*` (no accounts exist, so there is nobody
 * to notify) and nothing when signed out (the owner's decision: push is sign-in-only). Same rule,
 * and the same reasoning, as `AccountPanel` and `ClanSyncPanel`: a feature that cannot exist here is
 * not a feature that is switched off.
 *
 * THE iOS-NOT-INSTALLED STATE IS NOT AN ERROR STATE. On iPhone and iPad `PushManager` is simply
 * absent from a Safari tab, so a button there could only ever fail. The panel detects it and
 * explains what to do instead — which is the one instruction in this whole file that the user
 * cannot possibly guess.
 *
 * `data-push-panel` carries the state for `reverseForge/scratch/pwa_shots.mjs`: one attribute, not a
 * class name that layout is free to move.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, BellRing, AlertTriangle, Check, Loader2, Share } from 'lucide-react';
import { Card } from '../UI/Card';
import { Button } from '../UI/Button';
import { useAuth } from '../../context/AuthContext';
import {
    describeBlocker,
    describeDenied,
    disablePush,
    enablePush,
    readPushEnvironment,
    readSubscriptionState,
    sendTestPush,
    syncPushSubscription,
    type PushEnvironment,
    type PushSubscriptionState,
} from '../../services/pushClient';
import { cn } from '../../lib/utils';

type Phase = 'idle' | 'explainer' | 'working';

export function PushPanel() {
    const { status } = useAuth();

    const [environment, setEnvironment] = useState<PushEnvironment>(() => readPushEnvironment());
    const [subscription, setSubscription] = useState<PushSubscriptionState | null>(null);
    const [phase, setPhase] = useState<Phase>('idle');
    const [failure, setFailure] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

    const signedIn = status === 'signed-in';
    const refreshEnvironment = useCallback(() => setEnvironment(readPushEnvironment()), []);

    /**
     * BOOT RECONCILIATION, and only for somebody who has already said yes.
     *
     * `syncPushSubscription()` re-registers the endpoint (0009 §3.1 is idempotent by endpoint exactly
     * so this is safe every time), drains whatever the worker recorded from a
     * `pushsubscriptionchange`, and silently replaces a subscription minted with a rotated VAPID key.
     * None of it touches the network — or the service worker — unless permission is already granted,
     * so a visitor who never enabled notifications pays nothing for this panel existing.
     */
    useEffect(() => {
        if (!signedIn || !environment.supported) return;
        let alive = true;
        if (environment.permission === 'granted') {
            void syncPushSubscription().then((state) => { if (alive) setSubscription(state); });
        } else {
            void readSubscriptionState().then((state) => { if (alive) setSubscription(state); });
        }
        return () => { alive = false; };
    }, [signedIn, environment.supported, environment.permission]);

    // No accounts in this build, or nobody signed in: nothing to render at all.
    if (status === 'unconfigured' || !signedIn) return null;

    const run = async (action: () => Promise<void>) => {
        setPhase('working');
        setFailure(null);
        setTestResult(null);
        try {
            await action();
        } finally {
            refreshEnvironment();
            setPhase('idle');
        }
    };

    const onEnable = () => run(async () => {
        const result = await enablePush();
        if (result.ok) setSubscription(result.state);
        else setFailure(result.message);
    });

    const onDisable = () => run(async () => {
        const result = await disablePush();
        if (result.ok) {
            setSubscription(result.state);
            if (result.note) setFailure(result.note);
        } else {
            setFailure(result.message);
        }
    });

    const onTest = () => run(async () => {
        setTestResult(await sendTestPush());
    });

    const busy = phase === 'working';
    const on = !!subscription?.subscribed && environment.permission === 'granted';
    const state = on
        ? 'on'
        : environment.permission === 'denied'
            ? 'denied'
            : environment.blocker
                ? environment.blocker
                : phase === 'explainer'
                    ? 'explainer'
                    : 'idle';

    /** `https://fcm.googleapis.com/fcm/send/` -> `fcm.googleapis.com`. */
    const pushService = (() => {
        if (!subscription?.endpoint) return null;
        try { return new URL(subscription.endpoint).host; } catch { return null; }
    })();

    return (
        <Card className="p-4 bg-bg-secondary/40 border-border/50" data-push-panel={state}>
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-bg-input flex items-center justify-center shrink-0">
                    {on
                        ? <BellRing className="w-5 h-5 text-accent-primary" />
                        : environment.permission === 'denied'
                            ? <BellOff className="w-5 h-5 text-text-secondary" />
                            : <Bell className="w-5 h-5 text-text-secondary" />}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="font-bold">Notifications</div>
                            {/* `text-text-secondary` and not `text-text-muted`: muted measures under
                                4.5:1 on this card (see the same note in ClanSyncPanel), and this line
                                is the only place the panel says what it is for. */}
                            {/* ONLY the planner alarm is promised. 0009 ships a clan war-plan
                                broadcast (`broadcast_clan_notification`, `publish_clan_war_plan`),
                                but nothing in this client calls either. The only RPCs the app
                                makes are arm/cancel_plan_alarms, register/unregister_push_
                                subscription and send_test_notification. Promising a war-plan push
                                would promise a notification that cannot be enqueued by this build.
                                Put the sentence back when a war-plan publisher ships. */}
                            <div className="text-xs text-text-secondary">
                                A push two minutes before a planner step finishes
                            </div>
                        </div>
                        {busy && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-text-muted" />}
                    </div>

                    {/* ------------------------------------------------------------------ *
                     * The states, in the order a user meets them
                     * ------------------------------------------------------------------ */}

                    {/* 1. This browser, this build or this connection cannot do it at all. No
                           button: there is nothing here for the reader to press. */}
                    {!on && environment.blocker && environment.blocker !== 'ios-not-installed' && (
                        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                            <span className="font-bold text-amber-400">Unavailable.</span>{' '}
                            {describeBlocker(environment.blocker, environment)}
                        </p>
                    )}

                    {/* 2. iOS/iPadOS in a tab. The one state whose fix the user cannot guess. */}
                    {!on && environment.blocker === 'ios-not-installed' && (
                        <div className="mt-2 rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-3">
                            <p className="flex items-start gap-2 text-xs font-bold text-text-primary">
                                <Share className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-primary" />
                                Add ForgeMaster to your Home Screen first
                            </p>
                            <p className="mt-1.5 text-xs text-text-secondary leading-relaxed">
                                On iPhone and iPad, notifications only work from an app icon. Safari cannot even ask
                                for permission in a tab, which is why there is no button here yet.
                            </p>
                            <ol className="mt-2 space-y-1 text-xs text-text-secondary list-decimal list-inside">
                                <li>Tap the Share button in Safari&apos;s toolbar.</li>
                                <li>Choose &ldquo;Add to Home Screen&rdquo;.</li>
                                <li>Open ForgeMaster from the new icon and come back to this panel.</li>
                            </ol>
                            <p className="mt-2 text-[11px] text-amber-400 leading-relaxed">
                                Keep the icon once you have it. Deleting it removes the notification permission and
                                everything this site has stored on your phone, saved profiles included.
                            </p>
                        </div>
                    )}

                    {/* 3. Blocked. Say who can undo it and where. And on iOS, what it costs. */}
                    {!on && !environment.blocker && environment.permission === 'denied' && (
                        <p className="mt-2 text-xs text-text-secondary leading-relaxed">
                            <span className="font-bold text-amber-400">Blocked.</span> {describeDenied(environment)}
                        </p>
                    )}

                    {/* 4. Step one of two: the resting state. One sentence and one button. */}
                    {!on && !environment.blocker && environment.permission !== 'denied' && phase !== 'explainer' && (
                        <div className="mt-2">
                            <p className="text-xs text-text-secondary leading-relaxed">
                                <span className="font-bold text-amber-400">Off.</span>{' '}
                                Nothing is sent to this device. Notifications have to be turned on separately in every
                                browser and on every phone you use.
                            </p>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="mt-2"
                                disabled={busy}
                                onClick={() => { setFailure(null); setTestResult(null); setPhase('explainer'); }}
                            >
                                Set up notifications
                            </Button>
                        </div>
                    )}

                    {/* 5. Step two of two: what it is, what leaves the browser, and what happens on the
                           NEXT tap. The permission prompt fires from the button below and nowhere
                           else in the app. */}
                    {!on && !environment.blocker && environment.permission !== 'denied' && phase === 'explainer' && (
                        <div className="mt-2 rounded-lg border border-border bg-bg-input/60 p-3">
                            <p className="text-xs font-bold text-text-primary">Before your browser asks</p>
                            <ul className="mt-2 space-y-2 text-xs text-text-secondary leading-relaxed">
                                <li>
                                    <span className="font-semibold text-text-primary">What you get.</span> A push two
                                    minutes before the tech tree or egg planner finishes a step, saying what to start
                                    next. Nothing else. And if you change the plan after an alarm is queued, the
                                    push still tells you the time but drops the advice, because it would be advice
                                    for a plan you no longer have.
                                </li>
                                <li>
                                    <span className="font-semibold text-text-primary">What leaves this browser.</span>{' '}
                                    The delivery address your browser&apos;s push service hands out, two encryption keys
                                    and the name of this browser. The text of every notification is written here, on
                                    this device, before it is queued. The server is never told your profile, your
                                    plans or your game data.
                                </li>
                                <li>
                                    <span className="font-semibold text-text-primary">The next tap.</span> Your browser
                                    asks for permission itself. Choose Allow. If you block it, the browser will not ask
                                    again and you have to undo it in this site&apos;s settings.
                                    {environment.applePlatform && ' On iPhone and iPad there is no undo at all short of deleting the Home Screen icon, which erases your saved profiles with it.'}
                                </li>
                            </ul>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button variant="primary" size="sm" disabled={busy} onClick={onEnable}>
                                    Allow notifications
                                </Button>
                                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPhase('idle')}>
                                    Not now
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* 6. On. State the two things that are actually verifiable: this device is
                           registered, and which push service the last leg goes through. */}
                    {on && (
                        <div className="mt-2">
                            <p className="text-xs text-text-secondary leading-relaxed">
                                <span className="font-bold text-accent-primary">On for this browser.</span>{' '}
                                Your planner alarms and your clan&apos;s war-plan changes are delivered here.
                                {pushService && (
                                    <> The last leg goes through <span className="font-mono text-text-primary">{pushService}</span>, which your browser chose, not us.</>
                                )}
                            </p>
                            {subscription?.registered === false && (
                                <p className="mt-1.5 flex items-start gap-2 text-[11px] text-amber-400 leading-relaxed">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    This browser is subscribed but the server has not confirmed it. Nothing will arrive
                                    until it does; it is retried every time you open the app.
                                </p>
                            )}
                            {subscription?.keyMismatch && (
                                <p className="mt-1.5 flex items-start gap-2 text-[11px] text-amber-400 leading-relaxed">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    This device was registered against an older signing key and can no longer receive
                                    anything. Turn notifications off and on again to fix it.
                                </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Button variant="secondary" size="sm" disabled={busy} onClick={onTest}>
                                    Send a test
                                </Button>
                                <Button variant="ghost" size="sm" disabled={busy} onClick={onDisable}>
                                    Turn off
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* The test only reaches Postgres. Five hand-installed pieces sit between the row
                        and the phone, so the copy promises a queue, not a buzz. */}
                    {testResult && (
                        <p
                            role="status"
                            className={cn(
                                'mt-2 flex items-start gap-2 rounded-lg border p-2 text-[11px] leading-relaxed',
                                testResult.ok
                                    ? 'border-accent-primary/40 bg-accent-primary/5 text-text-secondary'
                                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200',
                            )}
                        >
                            {testResult.ok
                                ? <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-primary" />
                                : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                            <span>{testResult.message}</span>
                        </p>
                    )}

                    {failure && (
                        <p
                            role="status"
                            className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200 leading-relaxed"
                        >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{failure}</span>
                        </p>
                    )}
                </div>
            </div>
        </Card>
    );
}
