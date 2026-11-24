export type SlidePhase = "push-in" | "pop-out" | "under-in" | "under-out";

export function slideFrames(phase: SlidePhase, width: number, offset = 0.5): Keyframe[] {
    const center = { transform: "translateX(0)", opacity: 1 };
    const front = { transform: `translateX(${width}px)`, opacity: 0 };
    const back = { transform: `translateX(${-width * offset}px)`, opacity: 0 };
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

// Read the same design tokens used by the native view-transition stylesheet.
export function getSlideMotion(): { timing: KeyframeAnimationOptions; offset: number } {
    const style = getComputedStyle(document.documentElement);
    const rawDuration = style.getPropertyValue("--etb-slide-duration").trim();
    const match = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/.exec(rawDuration);
    const duration = match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : 200;
    const rawOffset = style.getPropertyValue("--etb-slide-offset").trim();
    const offset = rawOffset === "" ? NaN : Number(rawOffset);

    return {
        timing: {
            duration: Number.isFinite(duration) ? duration : 200,
            easing: style.getPropertyValue("--etb-slide-easing").trim() ||
                "cubic-bezier(0.25, 0.8, 0.25, 1)",
        },
        offset: Number.isFinite(offset) && offset >= 0 ? offset : 0.5,
    };
}

export function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
