/**
 * The animated item-card backgrounds of the game's ages, drawn with the game's own shaders.
 *
 * AgeVisualConfig.ItemBackground is an ItemBackgroundView prefab; ForgeUpgradeEntry.SetAge
 * (0x406B388) instantiates it, tints its BaseImage with AgeVisualConfig.Color and hides its
 * Outline. Its shaded Image runs one of three UI shaders, ported here line for line from the GLSL
 * the APK ships (UI/ScrollingPattern, UI/ScrollingPatternTiledAndRandomized, UI/Circles), with the
 * material numbers the extractor exports (BattleVisuals.json ages[i].itemBackground).
 *
 *   UV2       StandardMappingAsUV2.ModifyMesh (0x405B9B4): position in the rect (0..1) times the
 *             rect size / ReferenceWidth 1080. RaysCoordinatesToUV2 (0x405B370): 0..1 + _offset,
 *             and the rect size (pixels) in UV2.zw, which UI/Circles divides by 170.
 *   aspect    Quantum's circles Image carries an AspectRatioFitter (WidthControlsHeight, ratio 1):
 *             it is a square as wide as the card, centred (pivot 0.5) and clipped by the card's Mask.
 *   filter    the pattern texture's m_FilterMode: Multiverse's 32x32 texture is point-sampled.
 *   time      _Time: x = s / 20, y = s. The pattern shaders use fract(_Time.x * 0.001) * 1000.
 *
 * The rect size is in the game's canvas pixels. A site element is converted with
 * GAME_PX_PER_CSS_PX: the game lays its UI out on a 1080-wide reference canvas, here taken as a
 * phone screen 390 CSS pixels wide. That ratio is the one assumption; everything else is the game's.
 *
 * One WebGL2 context renders every background into its own 2D canvas, so any number of them can
 * run on a page without hitting the browser's limit on live WebGL contexts.
 */

export const GAME_PX_PER_CSS_PX = 1080 / 390;

export interface ItemBackgroundDef {
    shader: string;
    keywords: string[];
    floats: Record<string, number>;
    colors: Record<string, number[]>;
    tex: Record<string, { name: string; filter?: number; scale: [number, number]; offset: [number, number] }>;
    uv2: { kind: string; _offset?: { x: number; y: number }; _fitWidth?: boolean; _fitHeight?: boolean } | null;
    /** AspectRatioFitter on the shaded Image (mode 1 WidthControlsHeight), if any. */
    aspect?: { mode: number; ratio: number } | null;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const PATTERN = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform vec2 uGame; uniform float uTime; uniform vec4 uBase;
uniform vec4 uPatternColor; uniform vec2 uSpacing; uniform float uOddOffset; uniform int uOdd; uniform int uTiled;
uniform vec4 uST; uniform float uAngle; uniform float uScrollAngle; uniform float uSpeed;
uniform sampler2D uTex;
out vec4 o;
vec4 flags(vec4 c) {
    c = fract(c * vec4(10.9899998, 10.3100004, 9.7300005, 10.3000002));
    vec4 u1 = c.xzyw + vec4(33.3300018);
    float d = dot(c.ywzx, u1);
    c = c + vec4(d);
    u1 = c.zxwz + c.wzyy;
    c = fract(c * u1);
    return vec4(c.x >= 0.5 ? 1.0 : 0.0, c.y >= 0.5 ? 1.0 : 0.0, c.z >= 0.5 ? 0.5 : 0.0, c.w >= 0.5 ? 0.5 : 0.0);
}
void main() {
    // Vertex stage of both pattern shaders (UV2 from StandardMappingAsUV2).
    vec2 uv2 = (gl_FragCoord.xy / uSize) * (uGame / 1080.0);
    float t = fract(uTime / 20.0 * 0.001) * 1000.0;
    float sa = radians(uScrollAngle), pa = radians(uAngle);
    vec2 u0 = t * uSpeed * vec2(sin(sa), cos(sa)) + vec2(uv2.y * uST.y + uST.w, uv2.x * uST.x + uST.z);
    vec2 T = vec2(cos(pa) * u0.y + sin(pa) * u0.x, cos(pa) * u0.x - sin(pa) * u0.y);
    vec3 base = uBase.rgb;
    vec2 local;
    if (uTiled == 0) {
        if (uOdd == 1) {
            float r = T.y / uSpacing.y;
            float odd = trunc(r - floor(r * 0.5) * 2.0);
            local.y = clamp(T.y - uSpacing.y * floor(r), 0.0, 1.0);
            float x = odd * (uOddOffset * uSpacing.x) + T.x;
            local.x = clamp(x - uSpacing.x * floor(x / uSpacing.x), 0.0, 1.0);
        } else {
            local = clamp(T - uSpacing * floor(T / uSpacing), 0.0, 1.0);
        }
        vec4 p = texture(uTex, local);
        o = vec4((p.rgb * uPatternColor.rgb - base) * (p.a * uPatternColor.a) + base, uBase.a);
    } else {
        vec4 f;
        if (uOdd == 2) {
            float c = T.x / uSpacing.x;
            float odd = trunc(c - floor(c * 0.5) * 2.0);
            local.x = clamp(T.x - uSpacing.x * floor(c), 0.0, 1.0);
            float y = odd * (uOddOffset * uSpacing.y) + T.y;
            f = flags(vec4(ceil(y), ceil(T.x), ceil(T.x), ceil(y)));
            local.y = clamp(y - uSpacing.y * floor(y / uSpacing.y), 0.0, 1.0);
        } else {
            f = flags(ceil(T.yxxy));
            local = clamp(T - uSpacing * floor(T / uSpacing), 0.0, 1.0);
        }
        vec2 uv = local * 0.5 + (vec2(1.0) - local) * f.xy + f.zw;
        float p = texture(uTex, uv).x;
        o = vec4(vec3(p) * (uPatternColor.rgb - base) + base, uBase.a);
    }
}`;

const CIRCLES = `#version 300 es
precision highp float;
uniform vec2 uSize; uniform vec2 uGame; uniform float uTime; uniform vec4 uBase;
uniform vec2 uOffset; uniform float uDistanceFactor; uniform float uTimeFactor; uniform float uCircleWidth;
uniform float uBrightness; uniform float uFallOff; uniform float uAspect;
out vec4 o;
void main() {
    // RaysCoordinatesToUV2 on the Image's own rect: 0..1 + _offset, zw = its size (game px). With
    // the AspectRatioFitter (WidthControlsHeight) that rect is as wide as the card, width / ratio
    // tall, centred.
    vec2 rect = uAspect > 0.0 ? vec2(uSize.x, uSize.x / uAspect) : uSize;
    vec2 game = uAspect > 0.0 ? vec2(uGame.x, uGame.x / uAspect) : uGame;
    vec2 uv = (gl_FragCoord.xy - (uSize - rect) * 0.5) / rect + uOffset;
    float d = length(uv - 0.5);
    float s = max(game.x, game.y) * 0.00588235306;
    float ring = (uCircleWidth >= sin(d * s * uDistanceFactor + uTime * uTimeFactor) ? 1.0 : 0.0) * uBrightness;
    float fall = clamp(1.0 - d / (uFallOff / s), 0.0, 1.0);
    // The circles Image (white) blended over the BaseImage in the age colour.
    vec3 rgb = min(vec3(ring * fall) + vec3(1.0), vec3(1.0));
    float a = ring * fall;
    o = vec4(uBase.rgb * (1.0 - a) + rgb * a, uBase.a);
}`;

type Prog = { prog: WebGLProgram; loc: (n: string) => WebGLUniformLocation | null };

class Renderer {
    readonly canvas = document.createElement('canvas');
    readonly gl: WebGL2RenderingContext;
    private readonly progs = new Map<string, Prog>();
    private readonly textures = new Map<string, WebGLTexture | 'loading'>();

    constructor() {
        const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error('WebGL2 unavailable');
        this.gl = gl;
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    }

    private program(key: string, frag: string): Prog {
        let p = this.progs.get(key);
        if (p) return p;
        const gl = this.gl;
        const sh = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
            return s;
        };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.linkProgram(prog);
        const cache = new Map<string, WebGLUniformLocation | null>();
        p = { prog, loc: n => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n)); return cache.get(n)!; } };
        this.progs.set(key, p);
        return p;
    }

    /** The pattern texture, loaded once (Unity's v-up orientation, repeat wrap). null while loading. */
    private texture(url: string, point: boolean): WebGLTexture | null {
        const t = this.textures.get(url);
        if (t && t !== 'loading') return t;
        if (!t) {
            this.textures.set(url, 'loading');
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const gl = this.gl;
                const tex = gl.createTexture()!;
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                // No mipmaps (m_MipCount 1), filter as the Texture2D's m_FilterMode (0 point).
                const filter = point ? gl.NEAREST : gl.LINEAR;
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                this.textures.set(url, tex);
            };
            img.src = url;
        }
        return null;
    }

    /** Draws one background (w x h device pixels) and copies it into `target`. */
    draw(target: CanvasRenderingContext2D, w: number, h: number, cssW: number, cssH: number, def: ItemBackgroundDef, color: number[], time: number, textureBase: string): void {
        const gl = this.gl;
        if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
        gl.viewport(0, 0, w, h);
        const circles = def.shader === 'UI/Circles';
        const p = this.program(circles ? 'circles' : 'pattern', circles ? CIRCLES : PATTERN);
        gl.useProgram(p.prog);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const f = (n: string, d = 0) => def.floats[n] ?? d;
        gl.uniform2f(p.loc('uSize'), w, h);
        gl.uniform2f(p.loc('uGame'), cssW * GAME_PX_PER_CSS_PX, cssH * GAME_PX_PER_CSS_PX);
        gl.uniform1f(p.loc('uTime'), time);
        gl.uniform4f(p.loc('uBase'), color[0], color[1], color[2], color[3] ?? 1);
        if (circles) {
            gl.uniform2f(p.loc('uOffset'), def.uv2?._offset?.x ?? 0, def.uv2?._offset?.y ?? 0);
            gl.uniform1f(p.loc('uDistanceFactor'), f('_DistanceFactor'));
            gl.uniform1f(p.loc('uTimeFactor'), f('_TimeFactor'));
            gl.uniform1f(p.loc('uCircleWidth'), f('_CircleWidth'));
            gl.uniform1f(p.loc('uBrightness'), f('_Brightness'));
            gl.uniform1f(p.loc('uFallOff'), f('_FallOff', 1));
            gl.uniform1f(p.loc('uAspect'), def.aspect?.mode === 1 ? def.aspect.ratio : 0);
        } else {
            const tex = def.tex._PatternTex;
            const texture = tex ? this.texture(`${textureBase}${tex.name}.png`, tex.filter === 0) : null;
            if (!texture) {
                target.fillStyle = `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
                target.fillRect(0, 0, w, h);
                return;
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(p.loc('uTex'), 0);
            const pc = def.colors._PatternColor ?? [1, 1, 1, 1];
            const sp = def.colors._PatternSpacing ?? [1, 1];
            gl.uniform4f(p.loc('uPatternColor'), pc[0], pc[1], pc[2], pc[3] ?? 1);
            gl.uniform2f(p.loc('uSpacing'), sp[0], sp[1]);
            gl.uniform1f(p.loc('uOddOffset'), f('_PatternOddOffset'));
            gl.uniform1i(p.loc('uOdd'), def.keywords.includes('OFFSET_ODD_ROW') ? 1 : def.keywords.includes('OFFSET_ODD_COLUMN') ? 2 : 0);
            gl.uniform1i(p.loc('uTiled'), def.shader === 'UI/ScrollingPatternTiledAndRandomized' ? 1 : 0);
            gl.uniform4f(p.loc('uST'), tex.scale[0], tex.scale[1], tex.offset[0], tex.offset[1]);
            gl.uniform1f(p.loc('uAngle'), f('_PatternAngle'));
            gl.uniform1f(p.loc('uScrollAngle'), f('_PatternScrollAngle'));
            gl.uniform1f(p.loc('uSpeed'), f('_PatternScrollSpeed'));
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        target.clearRect(0, 0, w, h);
        target.drawImage(this.canvas, 0, 0);
    }
}

let shared: Renderer | null | undefined;
/** The one renderer of the page, or null where WebGL2 is unavailable (backgrounds stay plain). */
export function ageBackgroundRenderer(): Renderer | null {
    if (shared === undefined) {
        try { shared = new Renderer(); } catch { shared = null; }
    }
    return shared;
}
