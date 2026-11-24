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
