const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_FILE = path.join(__dirname, '../src/data/contributors_stats.json');
const GITHUB_REPO = '1vcian/fm';

// Manual mapping from git email/name to GitHub login
const MANUAL_MAPPING = {
    'medrihanlucian@gmail.com': '1vcian',
    'Lucian': '1vcian',
    'simon.mignot.dev@gmail.com': 'Simon-Mignot',
    'simon-m': 'Simon-Mignot',
    'murky.knight@gmail.com': 'murkyknight'
};

async function getContributorStats() {
    console.log('Fetching git history...');
    
    const gitCmd = 'git log --numstat --pretty="FORMAT:%aN|%aE" --all';
    const output = execSync(gitCmd).toString();

    const stats = {};
    let currentAuthor = null;

    output.split('\n').forEach(line => {
        if (!line.trim()) return;

        if (line.startsWith('FORMAT:')) {
            const [name, email] = line.replace('FORMAT:', '').split('|');
            currentAuthor = email || name; // Use name if email is missing
            if (!stats[currentAuthor]) {
                const login = MANUAL_MAPPING[email] || MANUAL_MAPPING[name] || null;
                stats[currentAuthor] = {
                    name,
                    email,
                    login,
                    additions: 0,
                    deletions: 0,
                    commits: 0
                };
            }
            stats[currentAuthor].commits++;
        } else if (currentAuthor) {
            const [add, del] = line.split('\t');
            if (add !== '-' && del !== '-') {
                stats[currentAuthor].additions += parseInt(add) || 0;
                stats[currentAuthor].deletions += parseInt(del) || 0;
            }
        }
    });

    const contributors = Object.values(stats);
    
    console.log(`Found ${contributors.length} contributors. Augmenting with GitHub data...`);

    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contributors`);
        if (response.ok) {
            const ghContributors = await response.json();
            
            contributors.forEach(c => {
                if (c.login) {
                    const match = ghContributors.find(gc => gc.login.toLowerCase() === c.login.toLowerCase());
                    if (match) {
                        c.avatar_url = match.avatar_url;
                        c.html_url = match.html_url;
                        return;
                    }
                }

                // Fallback fuzzy matching
                const match = ghContributors.find(gc => 
                    gc.login.toLowerCase() === c.name?.toLowerCase() ||
                    gc.login.toLowerCase() === c.email?.split('@')[0].toLowerCase()
                );
                
                if (match) {
                    c.login = match.login;
                    c.avatar_url = match.avatar_url;
                    c.html_url = match.html_url;
                }
            });
        }
    } catch (e) {
        console.warn('Could not fetch GitHub data, relying on git info.');
    }

    // Sort by additions
    contributors.sort((a, b) => b.additions - a.additions);

    // Ensure directory exists
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(contributors, null, 2));
    console.log(`Stats saved to ${OUTPUT_FILE}`);
}

getContributorStats();
