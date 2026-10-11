// Progress is a fraction of a stage, so changing duration preserves elapsed work.
export const advanceBombClock = (
    progress: number,
    elapsedMs: number,
    durationMs: number,
    paused: boolean,
) =>
    paused
        ? progress
        : progress + Math.max(0, elapsedMs) / Math.max(1, durationMs);
