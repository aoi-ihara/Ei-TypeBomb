/** The interpolation and WAAPI clock shared by dialog and page morphs. */
export function morphLerp(from: number, to: number, progress: number) {
    return from + (to - from) * progress;
}

export function createMorphClock(element: HTMLElement, timing: KeyframeAnimationOptions) {
    const clock = new Animation(
        new KeyframeEffect(element, [], { ...timing, fill: "both" }),
        document.timeline,
    );
    clock.play();
    return clock;
}

export type MorphRect = { x: number; y: number; width: number; height: number };
export function interpolateMorphRect(from: MorphRect, to: MorphRect, progress: number): MorphRect {
    return {
        x: morphLerp(from.x, to.x, progress),
        y: morphLerp(from.y, to.y, progress),
        width: Math.max(1, morphLerp(from.width, to.width, progress)),
        height: Math.max(1, morphLerp(from.height, to.height, progress)),
    };
}

export function sameMorphRect(a: MorphRect, b: MorphRect) {
    return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** Spend only the newly elapsed fraction of the remaining eased motion.
 * For a static target this is exactly the original interpolation. For a
 * moving target it starts from the last painted rectangle without restarting
 * the clock or freezing opacity, even when the target changes every frame.
 */
export function advanceMorphRect(current: MorphRect, target: MorphRect, previous: number, progress: number) {
    const next = Math.min(1, Math.max(previous, progress));
    const fraction = previous >= 1 ? 1 : (next - previous) / (1 - previous);
    return {
        rect: interpolateMorphRect(current, target, fraction),
        progress: next,
    };
}

/** Intersect in viewport coordinates, without changing the element's layout. */
export function intersectMorphRect(rect: MorphRect, bounds: MorphRect): MorphRect {
    const x = Math.max(rect.x, bounds.x);
    const y = Math.max(rect.y, bounds.y);
    return {
        x, y,
        width: Math.max(0, Math.min(rect.x + rect.width, bounds.x + bounds.width) - x),
        height: Math.max(0, Math.min(rect.y + rect.height, bounds.y + bounds.height) - y),
    };
}

/** Map only the visible portion of the full DOM box to the animated rectangle. */
export function visibleMorphTransform(full: MorphRect, visible: MorphRect, current: MorphRect) {
    const sx = current.width / visible.width;
    const sy = current.height / visible.height;
    return {
        sx, sy,
        dx: current.x - full.x - (visible.x - full.x) * sx,
        dy: current.y - full.y - (visible.y - full.y) * sy,
    };
}

export function morphClipInsets(full: MorphRect, visible: MorphRect) {
    return [
        Math.max(0, visible.y - full.y),
        Math.max(0, full.x + full.width - visible.x - visible.width),
        Math.max(0, full.y + full.height - visible.y - visible.height),
        Math.max(0, visible.x - full.x),
    ];
}
