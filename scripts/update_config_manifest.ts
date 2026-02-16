
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PUBLIC_DIR = path.resolve(__dirname, '../public/parsed_configs');
const VERSIONS_FILE = path.join(PUBLIC_DIR, 'versions.json');
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'config_manifest.json');

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

    } catch (error) {
        console.error('Error generating manifest:', error);
        process.exit(1);
    }
}

main();
