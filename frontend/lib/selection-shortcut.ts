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

/** Use the same keydown detection for starting a game and revealing a choice. */
export const isSpaceKey = (event: Pick<KeyboardEvent, "code" | "key">): boolean =>
    event.code === "Space" || event.key === " " || event.key === "Spacebar";

export const isGameSpaceKeyDown = (
    event: Pick<KeyboardEvent, "code" | "key" | "repeat" | "isComposing">,
): boolean => isSpaceKey(event) && !event.repeat && !event.isComposing;

// A dual-role Space/Shift remapper can dispatch a Space keydown without a
// matching Space keyup. Allow a distinct non-repeat keydown in that case,
// while ignoring duplicate keydowns generated in the same short burst.
export const canCountSelectionSpaceKeyDown = (
    repeat: boolean,
    spaceStillDown: boolean,
    elapsedSinceLastDownMs: number,
): boolean => !repeat && (!spaceStillDown || elapsedSinceLastDownMs >= 60);
