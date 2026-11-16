import { cn } from '../../lib/utils';
import { SpriteSheetIcon } from './SpriteSheetIcon';
import { unitIcon, type UnitSection } from '../../utils/unitIcons';

/**
 * A pet, mount or skill icon: the unit under `unitKey` in a ManualSpriteMapping section, drawn the
 * way the game draws it at `ascensionLevel` (see src/utils/unitIcons.ts). Renders an empty box of
 * the same size when the unit has no icon.
 */
export function UnitSpriteIcon({ section, unitKey, ascensionLevel, version, className, smooth }: {
    section: UnitSection | null | undefined;
    unitKey: string | number | null | undefined;
    ascensionLevel: number;
    version?: string | null;
    className?: string;
    smooth?: boolean;
}) {
    const icon = unitIcon(section, unitKey, ascensionLevel, version);
    if (!icon) return <div className={cn('inline-block shrink-0', className)} />;
    return <SpriteSheetIcon {...icon} className={className} smooth={smooth} />;
}
