"use client";

// Pace viewport-triggered navigation prefetches so a grid of visible cards
// does not create a burst of RSC requests on the first render.
const queue = new Map<string, () => void>();
let timeout: ReturnType<typeof setTimeout> | null = null;

function drain() {
    timeout = null;
    const first = queue.entries().next().value as
        [string, () => void] | undefined;
    if (!first) return;

    const [url, prefetch] = first;
    queue.delete(url);
    prefetch();
    if (queue.size > 0) timeout = setTimeout(drain, 220);
}

/** Returns a cancellation function for unmounted or scrolled-away cards. */
export function scheduleRoomPrefetch(url: string, prefetch: () => void) {
    if (!queue.has(url)) queue.set(url, prefetch);
    if (timeout === null) timeout = setTimeout(drain, 80);

    return () => {
        if (queue.get(url) === prefetch) queue.delete(url);
        if (queue.size === 0 && timeout !== null) {
            clearTimeout(timeout);
            timeout = null;
        }
    };
}
