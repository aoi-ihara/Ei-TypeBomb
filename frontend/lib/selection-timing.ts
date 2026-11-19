/**
 * Monotonic elapsed-time clock for multiple-choice answers.
 * Only foreground, unpaused time counts; a background tab or paused game
 * cannot make a learner look slower merely because they stepped away.
 */
export type ActiveResponseClock = {
    elapsedMs: number;
    activeSince: number | null;
};

export const createActiveResponseClock = (): ActiveResponseClock => ({
    elapsedMs: 0,
    activeSince: null,
});

export const setResponseClockActive = (
    clock: ActiveResponseClock,
    active: boolean,
    now: number,
): void => {
    if (clock.activeSince !== null) {
        clock.elapsedMs += Math.max(0, now - clock.activeSince);
        clock.activeSince = null;
    }
    if (active) clock.activeSince = now;
};

export const readActiveResponseMs = (
    clock: ActiveResponseClock,
    now: number,
): number | null =>
    clock.activeSince === null && clock.elapsedMs === 0
        ? null
        : clock.elapsedMs +
          (clock.activeSince === null
              ? 0
              : Math.max(0, now - clock.activeSince));
