export function getAscensionTexturePath(baseTexture: 'Pets' | 'MountIcons' | 'SkillIcons' | 'Eggs', ascensionLevel: number): string {
    const baseUrl = import.meta.env.BASE_URL;
    if (ascensionLevel === 1) return `${baseUrl}Texture2D/Mega${baseTexture}.png`;
    if (ascensionLevel === 2) return `${baseUrl}Texture2D/Ultra${baseTexture}.png`;
    if (ascensionLevel === 3) return `${baseUrl}Texture2D/Apex${baseTexture}.png`;
    
    // Eggs has a different base path than others
    if (baseTexture === 'Eggs') return `${baseUrl}Texture2D/Eggs.png`;
    
    return `${baseUrl}icons/game/${baseTexture}.png`;
}

export function getAnvilTexturePath(ascensionLevel: number): string {
    const baseUrl = import.meta.env.BASE_URL;
    if (ascensionLevel === 1) return `${baseUrl}Texture2D/Anvil _.png`;
    if (ascensionLevel === 2) return `${baseUrl}Texture2D/Anvil __.png`;
    if (ascensionLevel === 3) return `${baseUrl}Texture2D/Anvil ___.png`;
    
    return `${baseUrl}Texture2D/Anvil.png`;
}
