export function getActiveElapsedMs(
    now,
    startedAt,
    totalPausedMs = 0,
    pausedAt = null,
) {
    const currentPauseMs =
        pausedAt === null ? 0 : Math.max(0, now - pausedAt);

    return Math.max(0, now - startedAt - totalPausedMs - currentPauseMs);
}
