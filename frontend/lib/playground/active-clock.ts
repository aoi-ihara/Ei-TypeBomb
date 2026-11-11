export function getActiveElapsedMs(
    now: number,
    startedAt: number,
    totalPausedMs = 0,
    pausedAt: number | null = null,
) {
    const currentPauseMs =
        pausedAt === null ? 0 : Math.max(0, now - pausedAt);

    return Math.max(0, now - startedAt - totalPausedMs - currentPauseMs);
}
