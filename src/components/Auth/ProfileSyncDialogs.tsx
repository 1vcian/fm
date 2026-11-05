import { useProfile } from '../../context/ProfileContext';
import { MergeDialog } from './MergeDialog';
import { ConflictDialog } from './ConflictDialog';

/**
 * The account sync's two dialogs, mounted once for the whole app: the review (first-login merge,
 * "Review differences", and a profile changed on another device found by the periodic check) and
 * a live push conflict. They used to live in the account panel, so they only showed with the
 * settings open.
 */
export function ProfileSyncDialogs() {
    const { sync } = useProfile();
    return (
        <>
            {sync.reviewOpen && sync.review && sync.review.length > 0 && (
                <MergeDialog
                    rows={sync.review}
                    busy={sync.busy}
                    firstLogin={sync.mergePending}
                    onChoose={sync.setReviewChoice}
                    onApply={() => void sync.applyReview()}
                    onClose={sync.closeReview}
                />
            )}
            {sync.conflict && (
                <ConflictDialog
                    conflict={sync.conflict}
                    busy={sync.busy}
                    onResolve={resolution => void sync.resolveConflict(resolution)}
                />
            )}
        </>
    );
}
