const activeSources = new Set<string>();
const listeners = new Set<() => void>();

function notifyListeners() {
    for (const listener of listeners) {
        listener();
    }
}

export function startNavigationProgress(source = "navigation") {
    if (typeof window === "undefined") return;

    const wasActive = activeSources.size > 0;
    activeSources.add(source);

    if (!wasActive && activeSources.size > 0) {
        notifyListeners();
    }
}

export function stopNavigationProgress(source = "navigation") {
    if (typeof window === "undefined") return;

    const wasActive = activeSources.size > 0;
    activeSources.delete(source);

    if (wasActive && activeSources.size === 0) {
        notifyListeners();
    }
}

export function isNavigationProgressActive() {
    return typeof window !== "undefined" && activeSources.size > 0;
}

export function subscribeNavigationProgress(listener: () => void) {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
