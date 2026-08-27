
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PUBLIC_DIR = path.resolve(__dirname, '../public/parsed_configs');
const VERSIONS_FILE = path.join(PUBLIC_DIR, 'versions.json');
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'config_manifest.json');


/* ------------------------------------------------------------------------------------------ *
 * What changed in the newest game data, worked out here rather than in the browser.
 *
 * The update popup used to say only WHEN the data was refreshed. A reader cannot act on a date:
 * what they want to know is which numbers moved. Diffing 73 files twice is cheap at build time and
 * absurd at page load, so the answer is baked into one small file the popup fetches.
 *
 * Version folder names are zero padded timestamps, so sorting them as strings sorts them by date.
 * ------------------------------------------------------------------------------------------ */

const DELTA_FILE = path.join(PUBLIC_DIR, 'version_delta.json');
/** Beyond this many lines the popup would be a wall of text, so the rest is reported as a count. */
const MAX_DELTA_LINES = 24;

function readJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return undefined;
    }
}

function short(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
    if (typeof value === 'object') return Array.isArray(value) ? `[${(value as unknown[]).length} items]` : '{object}';
    return String(value);
}

/** Every leaf that differs, as `path: old -> new`. Depth capped: these configs nest deeply. */
function deepDiff(a: unknown, b: unknown, at = '', depth = 0, out: string[] = []): string[] {
    if (out.length > MAX_DELTA_LINES * 4 || depth > 8) return out;
    if (a === b) return out;

    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object';
    if (!bothObjects) {
        out.push(`${at || 'value'}: ${short(a)} -> ${short(b)}`);
        return out;
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        out.push(`${at || 'value'}: shape changed`);
        return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) out.push(`${at}: ${a.length} -> ${b.length} entries`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) deepDiff(a[i], b[i], `${at}[${i}]`, depth + 1, out);
        return out;
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
        const path_ = at ? `${at}.${key}` : key;
        if (!(key in ao)) out.push(`${path_}: added`);
        else if (!(key in bo)) out.push(`${path_}: removed`);
        else deepDiff(ao[key], bo[key], path_, depth + 1, out);
    }
    return out;
}

function generateDelta(versions: string[]): void {
    const sorted = [...versions].sort();
    const version = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    if (!version) return;

    const changes: { file: string; kind: 'added' | 'removed' | 'changed'; lines: string[] }[] = [];

    if (previous) {
        const dirNew = path.join(PUBLIC_DIR, version);
        const dirOld = path.join(PUBLIC_DIR, previous);
        const listing = (dir: string) => new Set(
            fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []
        );
        const filesNew = listing(dirNew);
        const filesOld = listing(dirOld);

        for (const file of [...filesNew].sort()) {
            const name = file.replace(/\.json$/, '');
            if (!filesOld.has(file)) { changes.push({ file: name, kind: 'added', lines: [] }); continue; }
            const before = readJson(path.join(dirOld, file));
            const after = readJson(path.join(dirNew, file));
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            const all = deepDiff(before, after);
            // Say what was dropped. A silently truncated list reads as "that was everything".
            const lines = all.length > MAX_DELTA_LINES
                ? [...all.slice(0, MAX_DELTA_LINES), `and ${all.length - MAX_DELTA_LINES} more changes in this file`]
                : all;
            changes.push({ file: name, kind: 'changed', lines });
        }
        for (const file of [...filesOld].sort()) {
            if (!filesNew.has(file)) changes.push({ file: file.replace(/\.json$/, ''), kind: 'removed', lines: [] });
        }
    }

    const payload = { version, previous: previous ?? null, changes };
    fs.writeFileSync(DELTA_FILE, JSON.stringify(payload, null, 2));
    console.log(`Version delta generated: ${changes.length} file(s) changed between ${previous ?? 'nothing'} and ${version}`);
}

async function main() {
    try {
        // 1. Read versions.json
        if (!fs.existsSync(VERSIONS_FILE)) {
            console.error(`Versions file not found at ${VERSIONS_FILE}`);
            process.exit(1);
        }

        const versionsRaw = fs.readFileSync(VERSIONS_FILE, 'utf-8');
        const versions: string[] = JSON.parse(versionsRaw);

        if (!Array.isArray(versions) || versions.length === 0) {
            console.error('Versions file is empty or invalid');
            process.exit(1);
        }

        console.log(`Found ${versions.length} versions to process.`);

        const manifest: Record<string, string[]> = {};

        // 2. Scan directory for each version
        for (const version of versions) {
            const versionDir = path.join(PUBLIC_DIR, version);
            if (!fs.existsSync(versionDir)) {
                console.warn(`Directory for version ${version} not found at ${versionDir}, skipping.`);
                continue;
            }

            const files = fs.readdirSync(versionDir);
            const jsonFiles = files.filter(file => file.endsWith('.json'));

            // Sort files for consistent order
            jsonFiles.sort();

            manifest[version] = jsonFiles;
            console.log(`Version ${version}: ${jsonFiles.length} files`);
        }

        // 3. Generate config_manifest.json
        fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
        console.log(`Manifest generated successfully at ${MANIFEST_FILE}`);

        // 4. Generate TextureManifest.json
        const TEXTURE_DIR = path.resolve(__dirname, '../public/Texture2D');
        const TEXTURE_MANIFEST_FILE = path.join(PUBLIC_DIR, 'TextureManifest.json');

        if (fs.existsSync(TEXTURE_DIR)) {
            const uniqueTextures = new Set<string>();

            // Get all subdirectories (version folders) inside Texture2D
            const versionFolders = fs.readdirSync(TEXTURE_DIR, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            // Iterate through each version folder and collect .png files
            for (const folder of versionFolders) {
                const folderPath = path.join(TEXTURE_DIR, folder);
                const files = fs.readdirSync(folderPath)
                    .filter(file => file.toLowerCase().endsWith('.png'));

                // Add to our Set to ensure no duplicates across versions
                for (const file of files) {
                    uniqueTextures.add(file);
                }
            }

            // Convert the Set back to a sorted array
            const textureFiles = Array.from(uniqueTextures).sort();

            fs.writeFileSync(TEXTURE_MANIFEST_FILE, JSON.stringify(textureFiles, null, 2));
            console.log(`Texture manifest generated: ${textureFiles.length} files at ${TEXTURE_MANIFEST_FILE}`);

        } else {
            console.warn(`Texture directory not found at ${TEXTURE_DIR}`);
        }

        // 5. Generate TextureMD5Manifest.json
        const TEXTURE_MD5_MANIFEST_FILE = path.join(PUBLIC_DIR, 'TextureMD5Manifest.json');
        const md5Manifest: Record<string, Record<string, string>> = {};

        if (fs.existsSync(TEXTURE_DIR)) {
            const versionFolders = fs.readdirSync(TEXTURE_DIR, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            for (const folder of versionFolders) {
                const folderPath = path.join(TEXTURE_DIR, folder);
                const files = fs.readdirSync(folderPath)
                    .filter(file => file.toLowerCase().endsWith('.png'));

                md5Manifest[folder] = {};

                for (const file of files) {
                    const filePath = path.join(folderPath, file);
                    const fileBuffer = fs.readFileSync(filePath);
                    // Calcola l'MD5 del file
                    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                    md5Manifest[folder][file] = hash;
                }
            }

            fs.writeFileSync(TEXTURE_MD5_MANIFEST_FILE, JSON.stringify(md5Manifest, null, 2));
            console.log(`Texture MD5 manifest generated successfully at ${TEXTURE_MD5_MANIFEST_FILE}`);
        }

        generateDelta(versions);

    } catch (error) {
        console.error('Error generating manifest:', error);
        process.exit(1);
    }
}

main();
