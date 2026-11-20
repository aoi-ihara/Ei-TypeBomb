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

// Never treat time alone as a key release: some accessibility bridges omit
// KeyboardEvent.repeat even for delayed keydowns from a held Space key.
export const canCountSelectionSpaceKeyDown = (
    repeat: boolean,
    spaceStillDown: boolean,
): boolean => !repeat && !spaceStillDown;

// A dual-role Space/Shift mapper may finish a short Space tap with Shift keyup
// instead of Space keyup. Callers must also verify that no intervening keydown
// has cancelled the pending Space press.
export const isDualRoleSpaceRelease = (
    event: Pick<KeyboardEvent, "code" | "key">,
): boolean =>
    event.key === "Shift" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight";
