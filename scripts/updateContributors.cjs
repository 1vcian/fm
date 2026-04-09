const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_FILE = path.join(__dirname, '../src/data/contributors_stats.json');
const GITHUB_REPO = '1vcian/fm';

async function getContributorStats() {
    console.log('Fetching git history...');
    
    // Command to get numstat and author info
    // Format: additions deletions authorName|authorEmail
    const gitCmd = 'git log --numstat --pretty="FORMAT:%aN|%aE" --all';
    const output = execSync(gitCmd).toString();

    const stats = {};
    let currentAuthor = null;

    output.split('\n').forEach(line => {
        if (!line.trim()) return;

        if (line.startsWith('FORMAT:')) {
            const [name, email] = line.replace('FORMAT:', '').split('|');
            currentAuthor = email;
            if (!stats[currentAuthor]) {
                stats[currentAuthor] = {
                    name,
                    email,
                    additions: 0,
                    deletions: 0,
                    commits: 0
                };
            }
            stats[currentAuthor].commits++;
        } else if (currentAuthor) {
            const [add, del] = line.split('\t');
            if (add !== '-' && del !== '-') { // Handle binary files
                stats[currentAuthor].additions += parseInt(add) || 0;
                stats[currentAuthor].deletions += parseInt(del) || 0;
            }
        }
    });

    // Try to fetch GitHub login from API for each contributor
    const contributors = Object.values(stats);
    
    console.log(`Found ${contributors.length} contributors. Augmenting with GitHub data...`);

    // In a real environment, we'd fetch from api.github.com/repos/1vcian/fm/contributors
    // and match by name/email or use the contributors list as the base.
    // For now, let's fetch the contributors list to get avatars and logins.
    
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contributors`);
        if (response.ok) {
            const ghContributors = await response.json();
            
            contributors.forEach(c => {
                // Try to match by name (case insensitive)
                const match = ghContributors.find(gc => 
                    gc.login.toLowerCase() === c.name.toLowerCase() ||
                    gc.login.toLowerCase() === c.email.split('@')[0].toLowerCase()
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
