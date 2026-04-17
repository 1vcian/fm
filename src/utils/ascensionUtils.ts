export function getAscensionTexturePath(baseTexture: 'Pets' | 'MountIcons' | 'SkillIcons' | 'Eggs' | 'Icons', ascensionLevel: number): string {
    const baseUrl = import.meta.env.BASE_URL;
    
    // Icons sheet doesn't have ascended versions, always return standard
    if (baseTexture === 'Icons') return `${baseUrl}Texture2D/Icons.png`;

    if (ascensionLevel === 1) return `${baseUrl}Texture2D/Mega${baseTexture}.png`;
    if (ascensionLevel === 2) return `${baseUrl}Texture2D/Ultra${baseTexture}.png`;
    if (ascensionLevel === 3) return `${baseUrl}Texture2D/Apex${baseTexture}.png`;
    
    // Fallback for level 0 or other base textures
    if (baseTexture === 'Eggs') return `${baseUrl}Texture2D/Eggs.png`;
    if (baseTexture === 'Pets') return `${baseUrl}Texture2D/Pets.png`;
    if (baseTexture === 'MountIcons') return `${baseUrl}Texture2D/MountIcons.png`;
    if (baseTexture === 'SkillIcons') return `${baseUrl}Texture2D/SkillIcons.png`;
    
    return `${baseUrl}Texture2D/${baseTexture}.png`;
}

export function getAnvilTexturePath(ascensionLevel: number): string {
    const baseUrl = import.meta.env.BASE_URL;
    if (ascensionLevel === 1) return `${baseUrl}Texture2D/Anvil _.png`;
    if (ascensionLevel === 2) return `${baseUrl}Texture2D/Anvil __.png`;
    if (ascensionLevel === 3) return `${baseUrl}Texture2D/Anvil ___.png`;
    
    return `${baseUrl}Texture2D/Anvil.png`;
}
