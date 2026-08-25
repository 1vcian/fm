import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
/**
 * The PWA shell has one failure mode that produces NO error anywhere: the service worker or the
 * manifest quietly not shipping. Push would simply never work, on every device, and the build would
 * be green. So the build asserts the shell instead of assuming it.
 *
 * Both files live in `public/`, which Vite copies verbatim to the deploy root — and the deploy root
 * IS `/fm/`, which is the only reason the worker's scope is `/fm/` (a worker's scope cannot be wider
 * than the directory its script is served from, and GitHub Pages gives us no way to send
 * `Service-Worker-Allowed`). Anything that moves `sw.js` — an import that drags it into the module
 * graph, a stray `assetFileNames` rule — caps its scope at `/fm/assets/` and makes it useless.
 */
function pwaShellGuard() {
    var REQUIRED = [
        'sw.js',
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
    ];
    var resolved;
    return {
        name: 'fm-pwa-shell-guard',
        apply: 'build',
        configResolved: function (config) {
            resolved = config;
        },
        closeBundle: function () {
            var outDir = path.resolve(resolved.root, resolved.build.outDir);
            var missing = REQUIRED.filter(function (file) { return !fs.existsSync(path.join(outDir, file)); });
            if (missing.length > 0) {
                throw new Error("[fm-pwa-shell-guard] these files are missing from ".concat(resolved.build.outDir, "/: ") +
                    "".concat(missing.join(', '), ". They are the PWA shell; without them web push cannot ") +
                    "register on any platform and nothing in the app reports an error. They are " +
                    "expected to be copied straight out of public/.");
            }
            // The worker must sit at the deploy root, not inside assets/, or its scope shrinks.
            var assets = path.join(outDir, 'assets');
            if (fs.existsSync(assets) && fs.readdirSync(assets).some(function (f) { return /^sw\..*\.js$/.test(f); })) {
                throw new Error('[fm-pwa-shell-guard] a hashed copy of sw.js was emitted into assets/. The ' +
                    'worker has been pulled into the module graph, which caps its scope at ' +
                    "".concat(resolved.base, "assets/ \u2014 it can no longer control the app. Keep public/sw.js ") +
                    'out of every import.');
            }
            // THE CACHING DECISION, ENFORCED. This app serves 23 versions of parsed_configs/ and
            // every calculator is a pure function of them, so a worker that answered a config
            // request from a cache would not break the site, it would make it quietly wrong. The
            // worker therefore registers NO fetch listener at all — which also means the browser
            // skips it entirely for navigations, so the app loads exactly as it did before push
            // existed. If you are here to add caching: exclude parsed_configs/ and Texture2D/
            // explicitly, prove the exclusion with a test, and only then relax this check.
            var worker = fs.readFileSync(path.join(outDir, 'sw.js'), 'utf8');
            if (/addEventListener\s*\(\s*['"`]fetch['"`]/.test(worker)) {
                throw new Error('[fm-pwa-shell-guard] public/sw.js has grown a `fetch` listener. Read the ' +
                    'caching note in this plugin and in the worker before removing this check.');
            }
            var html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
            if (!/rel="manifest"/.test(html)) {
                throw new Error('[fm-pwa-shell-guard] index.html no longer links the manifest. iOS refuses to ' +
                    'install a site without one, and push on iOS needs the install.');
            }
        },
    };
}
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), pwaShellGuard()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 3000,
        allowedHosts: true,
    },
    base: process.env.NODE_ENV === 'production' ? '/fm/' : '/',
    build: {
        rollupOptions: {
            output: {
                entryFileNames: "assets/[name].[hash].js",
                chunkFileNames: "assets/[name].[hash].js",
                assetFileNames: "assets/[name].[hash].[ext]"
            }
        }
    }
});
