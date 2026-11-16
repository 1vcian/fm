/**
 * The skill views of build 2026_11_16_09_55 (game 2.12.1). Unlike the older views, which tween
 * their own transforms, most of these play an Animator clip and react to its events; one
 * (WeaponBarrageView, FiringSquad) flies a weapon in, aims and shoots it. Everything here reads the
 * prefab, its clips and its serialized fields from BattleVisuals.json; the logic is the view
 * classes' own (RVAs below, build 2026_11_16_09_55).
 *
 * Clip views (DeathStarBeamView, StompSkillView, GhostRushSkillView, RisingBladesSkillView,
 * GiantForgeSkillView, EternalLeavesSkillView, RollingBarrelView), Init (0x41CE344, 0x41D3E30,
 * 0x41D0A74, 0x41D2E5C, 0x41D0F48, 0x41CEFDC, 0x41CCB58):
 *   - the view moves to the area's Position and its localScale.x becomes |x|, negated for an enemy
 *     area (IsAlly false);
 *   - the Animator is disabled and Visual is deactivated;
 *   - Play() runs after DelayedCall(max(0, -Timer)) (Stomp: max(0, (ShotIndex > 0 ? Duration : 0)
 *     - Timer)), or at once: Visual.SetActive(true), Animator enabled, Animator.Play(state, 0, 0).
 *   The clip's events then drive it: OnImpact plays every ImpactParticles system (with children),
 *   OnAnimationComplete destroys the view (sounds and the camera shake are not drawn).
 */
import type { BattleVisualData, Clip } from './visualData';
import type { VisualEffect, VisualUnit } from '../../../engine/visualSnapshot';
import { RigInstance, IDENTITY, type Mat } from './rig';

/** The view classes driven by an Animator clip, as named in the prefab's scripts. */
export const CLIP_VIEW_SCRIPTS = [
    'DeathStarBeamView', 'StompSkillView', 'GhostRushSkillView', 'RisingBladesSkillView',
    'GiantForgeSkillView', 'EternalLeavesSkillView', 'RollingBarrelView',
] as const;

/** Math.Round (MidpointRounding.ToEven), as the views call it on doubles. */
function roundEven(v: number): number {
    const f = Math.floor(v);
    const d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
}

/** System.Random with a seed (the subtractive generator of the IL2CPP class library). */
class NetRandom {
    private seeds = new Array<number>(56).fill(0);
    private inext = 0;
    private inextp = 21;

    constructor(seed: number) {
        const MBIG = 2147483647;
        const sub = seed === -2147483648 ? MBIG : Math.abs(seed);
        let mj = 161803398 - sub;
        this.seeds[55] = mj;
        let mk = 1;
        for (let i = 1; i < 55; i++) {
            const ii = (21 * i) % 55;
            this.seeds[ii] = mk;
            mk = mj - mk;
            if (mk < 0) mk += MBIG;
            mj = this.seeds[ii];
        }
        for (let k = 1; k < 5; k++) {
            for (let i = 1; i < 56; i++) {
                this.seeds[i] -= this.seeds[1 + ((i + 30) % 55)];
                if (this.seeds[i] < 0) this.seeds[i] += MBIG;
            }
        }
    }

    private sample(): number {
        const MBIG = 2147483647;
        let a = this.inext + 1;
        if (a >= 56) a = 1;
        let b = this.inextp + 1;
        if (b >= 56) b = 1;
        let r = this.seeds[a] - this.seeds[b];
        if (r === MBIG) r--;
        if (r < 0) r += MBIG;
        this.seeds[a] = r;
        this.inext = a;
        this.inextp = b;
        return r * (1 / MBIG);
    }

    /** Next(min, max): min <= r < max. */
    next(min: number, max: number): number {
        return Math.trunc(this.sample() * (max - min)) + min;
    }
}

/**
 * RollingBarrelView.RandomBarrel (0x41CD114): the identity permutation of the barrel sprites,
 * shuffled by new System.Random(waveId) for i = 0..lane (swap i with Next(i, count)); the lane's slot.
 */
function randomBarrel(waveId: number, lane: number, count: number): number {
    const perm = Array.from({ length: count }, (_, i) => i);
    const rng = new NetRandom(waveId);
    for (let i = 0; i <= lane; i++) {
        const j = rng.next(i, count);
        [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    return perm[lane] ?? 0;
}

/**
 * RollingBarrelView's statics (.cctor 0x41CD4A8), per barrel sprite: the lid root's local
 * position and scale (index 3, the drum, has no lid sprite: Vector3.zero and Vector3.one).
 */
const LID_POSITIONS: [number, number][] = [[0, 0.47], [0, 0.485], [0, 0.425], [0, 0], [-0.0045, 0.577]];
const LID_SCALES: [number, number][] = [[0.98, 0.86], [1, 0.88], [1, 0.88], [1, 1], [1.45, 1.4]];
/** RollingBarrelView.Init 0x41CCB58: a float[3] { 0, 0.55, -0.4 } per lane, for the sorting order. */
const LANE_Y = [0, 0.55, -0.4];

export interface ClipView {
    script: string;
    /** Battle time Play() runs. */
    playAt: number;
    clip: Clip | null;
    /** Seconds from Play() to OnAnimationComplete (the clip's end without that event). */
    completeAt: number;
    /** Clip events already handled. */
    fired: number;
    /** The view's position (Init; DeathStarBeamView follows the area, see tick). */
    x: number;
    y: number;
    flip: number;
    smooth: number | null;
    visual: number;
    impact: number[];
    done: boolean;
}

/** Init of a clip view: the state its Init leaves (see the header). */
export function initClipView(data: BattleVisualData, rig: RigInstance, e: VisualEffect, now: number): ClipView | null {
    const root = rig.nodes[0];
    const script = CLIP_VIEW_SCRIPTS.find(s => root.scripts?.includes(s));
    if (!script) return null;
    const mb = root.mb?.[script] ?? {};
    rig.setAnimRoot(0);
    rig.sized = true;
    const clips = root.anim ? data.controllers[root.anim]?.clips ?? {} : {};
    // Init runs when the area is created (AreaProjectileCreatedMessage): its Timer and time then.
    const timer0 = e.timer0 ?? e.timer;
    const born = e.spawnTime ?? now;
    let delay = Math.max(0, -timer0);
    let state = 'Cast';
    let x = e.x;
    if (script === 'StompSkillView') {
        // Init 0x41D3E30: _followUp = ShotIndex > 0; Play (0x41D4034) runs "FollowUp" or "Cast".
        const followUp = (e.shotIndex ?? 0) > 0;
        delay = Math.max(0, (followUp ? e.duration : 0) - timer0);
        state = followUp ? 'FollowUp' : 'Cast';
    } else if (script === 'RisingBladesSkillView') {
        // Init 0x41D2E5C: _bladeIndex = Clamp(Round(Timer / -0.2), 0, 2) (0 when not finite), the
        // view at Position.x + (_bladeIndex - 1) * -0.5; Play (0x41D3150) runs "Blade" + _bladeIndex.
        const q = timer0 / -0.2;
        const idx = Number.isFinite(q) ? Math.max(0, Math.min(2, roundEven(q))) : 0;
        x = e.x + (idx - 1) * -0.5;
        state = `Blade${idx}`;
    } else if (script === 'RollingBarrelView') {
        // Init 0x41CCB58: _lane = ShotIndex % 3; Play (0x41CD260) runs "Lane" + _lane.
        const lane = (e.shotIndex ?? 0) % 3;
        state = `Lane${lane}`;
        setupBarrel(rig, mb, e.id - lane, lane);
    }
    const clip = clips[state] ? data.clips[clips[state]] ?? null : null;
    const complete = clip?.events?.find(ev => ev.fn === 'OnAnimationComplete')?.t ?? clip?.length ?? 0;
    const visual = mb.Visual?.node ?? rig.find('Visual');
    return {
        script, playAt: born + delay, clip, completeAt: complete, fired: 0,
        x, y: e.y, flip: e.isAllied ? 1 : -1,
        // DeathStarBeamView.PositionSmoothTime ([Min(0.001)]).
        smooth: script === 'DeathStarBeamView' ? Number(mb.PositionSmoothTime ?? 0.05) : null,
        visual,
        impact: (mb.ImpactParticles ?? []).map((r: { node?: number } | null) => r?.node).filter((n: unknown): n is number => typeof n === 'number'),
        done: false,
    };
}

/**
 * RollingBarrelView.Init 0x41CCB58: the barrel is BarrelSprites[b] (b = RandomBarrel(Id - lane,
 * lane)), its lid LidSprites[b] with the lid root at LidPositions[b] / LidScales[b]; the body's
 * sorting order is 22 - Round(laneY x 10) and every other renderer under the barrel root one more.
 */
function setupBarrel(rig: RigInstance, mb: any, waveId: number, lane: number): void {
    const sprites: ({ sprite?: string } | null)[] = mb.BarrelSprites ?? [];
    const lids: ({ sprite?: string } | null)[] = mb.LidSprites ?? [];
    const barrel = mb.Barrels?.[0];
    if (!barrel || !sprites.length) return;
    const b = randomBarrel(waveId, lane, sprites.length);
    const body = barrel.Body?.node as number | undefined;
    const lid = barrel.Lid?.node as number | undefined;
    const rootNode = barrel.Root?.node as number | undefined;
    if (body !== undefined && rig.nodes[body]) rig.nodes[body].s = sprites[b]?.sprite ?? null;
    if (lid !== undefined && rig.nodes[lid]) {
        rig.nodes[lid].s = lids[b]?.sprite ?? null;
        const lr = rig.nodes[lid].p;
        const nd = rig.nodes[lr];
        if (nd) {
            const [px, py] = LID_POSITIONS[b] ?? [0, 0];
            const [sx, sy] = LID_SCALES[b] ?? [1, 1];
            const r = (nd.base.rot * Math.PI) / 180;
            nd.base = { ...nd.base, x: px, y: py, sx, sy };
            nd.m = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, px, py];
        }
    }
    const order = 22 - roundEven(Math.fround(Math.fround(LANE_Y[lane] ?? 0) * 10));
    if (body !== undefined && rig.nodes[body]) rig.nodes[body].o = order;
    if (rootNode !== undefined) {
        const under = (i: number) => { for (let k = i; k >= 0; k = rig.nodes[k].p) if (k === rootNode) return true; return false; };
        rig.nodes.forEach((nd, i) => { if (i !== body && nd.s !== undefined && under(i)) nd.o = order + 1; });
    }
}

/**
 * One frame of a clip view at battle time `now`: DeathStarBeamView.Tick (0x41CE5D4) first eases
 * the view toward the area's Position by 1 - exp(-dt / max(PositionSmoothTime, 0.001)); then the
 * clip plays from Play(). Returns the view's world matrix and the clip events reached this frame.
 */
export function stepClipView(rig: RigInstance, cv: ClipView, e: VisualEffect, now: number, dt: number): { root: Mat; events: string[] } {
    if (cv.smooth !== null && dt > 0) {
        const k = Math.max(0, Math.min(1, 1 - Math.exp(-dt / Math.max(cv.smooth, 0.001))));
        cv.x += (e.x - cv.x) * k;
        cv.y += (e.y - cv.y) * k;
    }
    rig.clearAnimation();
    const events: string[] = [];
    const t = now - cv.playAt;
    if (t >= 0 && cv.clip) {
        rig.applyClip(cv.clip, t, false, true);
        if (cv.visual >= 0) rig.setActive(cv.visual, true);
        const evs = cv.clip.events ?? [];
        while (cv.fired < evs.length && evs[cv.fired].t <= t) events.push(evs[cv.fired++].fn);
        if (t >= cv.completeAt) cv.done = true;
    }
    return { root: [cv.flip, 0, 0, 1, cv.x, cv.y], events };
}

// ------------------------------------------------------------------ FiringSquad

/**
 * WeaponBarrageView (FiringSquad), one per shot. Init(shot) 0x41CF4B0 / Init(shot, choices, source,
 * flipped) 0x41CF568 and Tick 0x41D015C:
 *   - the weapon is Weapons[ShotIndex % count] (a WeaponItemVisualConfig), instantiated under the
 *     view, scaled by min(1, 1.3 / max(bounds size, 0.01)), every renderer at sorting order
 *     ShotIndex + 15, its particle systems stopped;
 *   - its slot: r = sqrt((i + 0.5) / n), a = i x 2.39996: (cos a x r x 2.2 - 2.5, negated for an enemy
 *     shot; sin a x r x 1.5 + 3.3), relative to the source unit's position;
 *   - its entry, on the camera's viewport: lane i % 3 = 0 at (-0.15, Random(0.35, 0.9)), 1 at (1.15,
 *     Random(0.35, 0.9)), 2 at (Random(0.1, 0.9), 1.15);
 *   - from ArrivalInterval x i it flies entry -> slot over FlightDuration (OutCubic), aiming at
 *     WeaponBarrage.FindTarget's Position + CenterOfMass (else 6 ahead and 0.5 up): rotation
 *     LookRotation(forward, dir), localScale.x by the sign of dir.x (or the side's direction);
 *   - when the elapsed time reaches the shot's Duration it fires: the weapon's particle systems
 *     play and its ProjectilePrefab runs from weapon + 0.65 dir to the aim point in 0.1 s;
 *   - it then stays at the slot, and after ArrivalInterval x i + ShotInterval x (n - 1 - i) + 0.1
 *     flies back to the entry over FlightDuration (InCubic) and is destroyed.
 */
export interface Barrage {
    i: number;
    n: number;
    born: number;
    timer0: number;
    shotTime: number;
    arrival: number;
    flight: number;
    departure: number;
    dir: number;
    slot: { x: number; y: number };
    origin: { x: number; y: number };
    entry: { x: number; y: number } | null;
    lane: number;
    weapon: RigInstance | null;
    weaponScale: number;
    projPrefab: string | null;
    proj: RigInstance | null;
    resolved: boolean;
    departing: boolean;
    pos: { x: number; y: number };
    rot: number;
    sx: number;
    shotStart: { x: number; y: number };
    shotEnd: { x: number; y: number };
    exitStart: { x: number; y: number };
    fired: boolean;
    done: boolean;
}

/** The 2D bounds of every drawn sprite of a rig at its current matrices. */
function spriteBounds(data: BattleVisualData, rig: RigInstance): { w: number; h: number } {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rig.nodes.forEach((nd, i) => {
        if (!nd.s || nd.srOff || !rig.isVisible(i)) return;
        const d = data.sprites[nd.s];
        const m = rig.world[i];
        if (!d || !m) return;
        const L = (-d.px * d.ow) / d.ppu, R = ((1 - d.px) * d.ow) / d.ppu;
        const B = (-d.py * d.oh) / d.ppu, T = ((1 - d.py) * d.oh) / d.ppu;
        for (const [u, v] of [[L, B], [R, B], [L, T], [R, T]]) {
            const X = m[0] * u + m[2] * v + m[4], Y = m[1] * u + m[3] * v + m[5];
            x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
        }
    });
    return Number.isFinite(x0) ? { w: x1 - x0, h: y1 - y0 } : { w: 0, h: 0 };
}

export function initBarrage(data: BattleVisualData, rig: RigInstance, e: VisualEffect, now: number, shotCount: number): Barrage | null {
    const mb = rig.nodes[0].mb?.WeaponBarrageView;
    if (!mb) return null;
    const weapons: ({ visual?: string } | null)[] = mb.Weapons ?? [];
    const i = e.shotIndex ?? 0;
    const n = Math.max(1, shotCount);
    const arrivalInterval = Number(mb.ArrivalInterval ?? 0.05);
    const flight = Number(mb.FlightDuration ?? 0.25);
    const shotInterval = Number(mb.ShotInterval ?? 0.12);
    const cfg = weapons.length ? data.visuals[weapons[i % weapons.length]?.visual ?? ''] : undefined;
    let weapon: RigInstance | null = null;
    let weaponScale = 1;
    if (cfg?.prefab && data.prefabs[cfg.prefab]) {
        weapon = new RigInstance(data, cfg.prefab);
        weapon.update(IDENTITY);
        const b = spriteBounds(data, weapon);
        // Init 0x41CF568: Renderer bounds over every SpriteRenderer, the larger side, at least 0.01.
        weaponScale = Math.min(1, 1.3 / Math.max(Math.max(b.w, b.h), 0.01));
        for (const nd of weapon.nodes) if (nd.s !== undefined) nd.o = i + 15;
    }
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.399962902069092;
    const sx = Math.cos(a) * r * 2.2 - 2.5;
    return {
        i, n, born: e.spawnTime ?? now, timer0: e.timer0 ?? e.timer, shotTime: e.duration,
        arrival: arrivalInterval * i, flight,
        departure: arrivalInterval * i + (shotInterval * (n - 1 - i) + 0.1),
        dir: e.isAllied ? 1 : -1,
        slot: { x: e.isAllied ? sx : -sx, y: Math.sin(a) * r * 1.5 + 3.3 },
        origin: { x: e.x, y: e.y }, entry: null, lane: i % 3,
        weapon, weaponScale, projPrefab: cfg?.projectile ?? null, proj: null,
        resolved: false, departing: false, pos: { x: e.x, y: e.y }, rot: 0, sx: e.isAllied ? 1 : -1,
        shotStart: { x: 0, y: 0 }, shotEnd: { x: 0, y: 0 }, exitStart: { x: 0, y: 0 }, fired: false, done: false,
    };
}

/** Seconds a barrage view lives from its spawn. */
export function barrageSeconds(b: Barrage): number {
    return b.shotTime - b.timer0 + b.departure + b.flight;
}

/**
 * The game camera's view (orthographic size, reference aspect) around the viewer's camera centre:
 * where ViewportToWorldPoint puts a viewport point.
 */
export interface GameViewport { cx: number; cy: number; w: number; h: number }

/**
 * One frame of a barrage view. `source` is the caster as drawn (null once gone: the view keeps its
 * origin), `units` the snapshot's units for the aim. Returns what to draw: the weapon's world matrix
 * (null while it waits) and the projectile's (null when none).
 */
export function stepBarrage(
    data: BattleVisualData, b: Barrage, e: VisualEffect, now: number, source: { x: number; y: number } | null,
    units: VisualUnit[], vp: GameViewport, seed: number,
): { weapon: Mat | null; proj: Mat | null; fire: boolean } {
    if (!b.entry) {
        // Init 0x41CF568 (UnityEngine.Random.Range; a hash stands in for Unity's random state).
        const r = (k: number) => hashUnit(seed * 131 + b.i * 17 + k);
        const v = b.lane === 0 ? [-0.15, 0.35 + 0.55 * r(1)] : b.lane === 1 ? [1.15, 0.35 + 0.55 * r(1)] : [0.1 + 0.8 * r(2), 1.15];
        b.entry = { x: vp.cx + (v[0] - 0.5) * vp.w, y: vp.cy + (v[1] - 0.5) * vp.h };
    }
    const base = source ?? b.origin;
    const elapsed = b.timer0 + (now - b.born);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    let fire = false;
    if (!b.resolved) {
        const t = elapsed - b.arrival;
        if (t < 0) return { weapon: null, proj: null, fire };
        const k = t / b.flight;
        const ease = clamp01(1 - Math.pow(k < 0 ? 1 : 1 - Math.min(k, 1), 3));
        const sx = base.x + b.slot.x, sy = base.y + b.slot.y;
        b.pos = { x: b.entry.x + (sx - b.entry.x) * ease, y: b.entry.y + (sy - b.entry.y) * ease };
        // Tick 0x41D015C: aim at WeaponBarrage.FindTarget (0x7C87D7C) of the caster: its current
        // target if alive, else the nearest alive enemy; Position + CenterOfMass. The snapshot has
        // no current target, so the nearest alive enemy stands in for it.
        let aim = { x: base.x + b.dir * 6, y: base.y + 0.5 };
        let best = Infinity;
        for (const u of units) {
            if (u.isAlly === e.isAllied || u.killed || u.hp <= 0) continue;
            const d = Math.hypot(u.x - base.x, u.y - base.y);
            if (d < best) { best = d; aim = { x: u.x, y: u.y + 0.45 }; }
        }
        const dx = aim.x - b.pos.x, dy = aim.y - b.pos.y;
        const len = Math.hypot(dx, dy);
        const nx = len > 1e-5 ? dx / len : 0, ny = len > 1e-5 ? dy / len : 0;
        // LookRotation(Vector3.forward, dir): the weapon's up axis along dir.
        b.rot = len > 1e-5 ? (Math.atan2(ny, nx) * 180) / Math.PI - 90 : 0;
        b.sx = Math.abs(nx) > 0.01 ? (nx < 0 ? -1 : 1) : b.dir;
        if (b.shotTime <= elapsed) {
            b.resolved = true;
            fire = true;
            b.shotStart = { x: b.pos.x + nx * 0.65, y: b.pos.y + ny * 0.65 };
            b.shotEnd = aim;
            if (b.projPrefab && data.prefabs[b.projPrefab]) b.proj = new RigInstance(data, b.projPrefab);
        }
    }
    let proj: Mat | null = null;
    if (b.resolved) {
        const since = elapsed - b.shotTime;
        const k = clamp01(since / 0.1);
        if (b.proj && k < 1) {
            const r = (b.rot * Math.PI) / 180;
            proj = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r),
                b.shotStart.x + (b.shotEnd.x - b.shotStart.x) * k, b.shotStart.y + (b.shotEnd.y - b.shotStart.y) * k];
        }
        if (!b.departing) b.pos = { x: base.x + b.slot.x, y: base.y + b.slot.y };
        if (since >= b.departure) {
            if (!b.departing) { b.exitStart = { ...b.pos }; b.departing = true; }
            const k2 = clamp01((since - b.departure) / b.flight);
            const ease = clamp01(k2 * k2 * k2);
            b.pos = { x: b.exitStart.x + (b.entry.x - b.exitStart.x) * ease, y: b.exitStart.y + (b.entry.y - b.exitStart.y) * ease };
            if (k2 >= 1) { b.done = true; return { weapon: null, proj, fire }; }
        }
    }
    const r = (b.rot * Math.PI) / 180;
    const s = b.weaponScale;
    const weapon: Mat = [Math.cos(r) * s * b.sx, Math.sin(r) * s * b.sx, -Math.sin(r) * s, Math.cos(r) * s, b.pos.x, b.pos.y];
    return { weapon, proj, fire };
}

function hashUnit(n: number): number {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
