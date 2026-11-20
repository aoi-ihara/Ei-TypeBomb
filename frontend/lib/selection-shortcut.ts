/**
 * A selection question owns Space for the double-Space hint, including when
 * one of its answer buttons has focus. Other focused controls must retain
 * their native keyboard actions (for example, the game's pause button).
 */
export const canHandleSelectionSpace = (
    isEditable: boolean,
    isInteractive: boolean,
    isInsideQuestion: boolean,
): boolean => !isEditable && (!isInteractive || isInsideQuestion);

/** Only separate key presses count; key-repeat events are filtered by the caller. */
export const nextSelectionSpacePress = (
    previousWasSpace: boolean,
    isSpace: boolean,
): { armed: boolean; reveal: boolean } => ({
    armed: isSpace && !previousWasSpace,
    reveal: isSpace && previousWasSpace,
});
