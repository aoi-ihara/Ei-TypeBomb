export type SlidePhase = "push-in" | "pop-out" | "under-in" | "under-out";

export function slideFrames(phase: SlidePhase, width: number): Keyframe[] {
    const center = { transform: "translateX(0)", opacity: 1 };
    const front = { transform: `translateX(${width}px)`, opacity: 0 };
    const back = { transform: `translateX(${-width / 2}px)`, opacity: 0 };
    switch (phase) {
        case "push-in":
            return [front, center];
        case "pop-out":
            return [center, front];
        case "under-in":
            return [back, center];
        case "under-out":
            return [center, back];
    }
}

export function slideTiming(duration: number): KeyframeAnimationOptions {
    return {
        duration,
        easing: getComputedStyle(document.documentElement)
            .getPropertyValue("--etb-slide-easing").trim() || "cubic-bezier(0.25, 0.8, 0.25, 1)",
    };
}

export function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
