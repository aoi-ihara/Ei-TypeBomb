import { createMorphClock, interpolateMorphRect, morphLerp, sameMorphRect, type MorphRect } from "./morph-motion";
import { getSlideMotion, prefersReducedMotion } from "./slide-motion";
import { trackMorphCursorElement } from "./slide-cursor";

export type PageMorph = {
    key?: string;
    source: HTMLElement;
    play: (destination: HTMLElement, onFinish: () => void) => void;
    dispose: () => void;
};

function rectOf(element: HTMLElement): MorphRect {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { x: left, y: top, width, height };
}

function place(element: HTMLElement, rect: MorphRect) {
    Object.assign(element.style, {
        position: "absolute", left: rect.x + "px", top: rect.y + "px",
        width: rect.width + "px", height: rect.height + "px",
        margin: "0", transformOrigin: "top left", transform: "none", transition: "none",
    });
}

function inertCopy(element: HTMLElement) {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.inert = true;
    copy.setAttribute("aria-hidden", "true");
    for (const node of [copy, ...Array.from(copy.querySelectorAll<HTMLElement>("[id], [data-cursor], [data-navigation-morph-target]"))]) {
        node.removeAttribute("id");
        node.removeAttribute("data-cursor");
        node.removeAttribute("data-navigation-morph-target");
    }
    return copy;
}

// Keep a non-interactive outgoing copy only during the visual handoff.
// The incoming element remains live, so asynchronous content is never
// replaced by a stale screenshot at the end of the animation.
export function capturePageMorph(viewport: HTMLElement, source: HTMLElement): PageMorph | null {
    const origin = rectOf(source);
    const pageRect = rectOf(viewport);
    if (!origin.width || !origin.height || !pageRect.width || !pageRect.height) return null;

    const indices: number[] = [];
    for (let node: HTMLElement | null = source; node !== viewport;) {
        const parent: HTMLElement | null = node?.parentElement ?? null;
        if (!parent || !node) return null;
        indices.unshift(Array.prototype.indexOf.call(parent.children, node));
        node = parent;
    }
    const oldPage = inertCopy(viewport);
    let oldTarget: Element = oldPage;
    for (const index of indices) {
        const child = oldTarget.children[index];
        if (!child) return null;
        oldTarget = child;
    }
    (oldTarget as HTMLElement).style.visibility = "hidden";
    const oldSource = inertCopy(source);
    const overlay = document.createElement("div");
    overlay.inert = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.dataset.navigationMorphOverlay = "";
    Object.assign(overlay.style, {
        position: "fixed", inset: "0", overflow: "hidden",
        pointerEvents: "none", zIndex: "80",
    });
    place(oldPage, pageRect);
    oldPage.style.backgroundColor = "var(--color-background)";
    place(oldSource, origin);
    overlay.append(oldPage, oldSource);

    let disposed = false;
    let frameId = 0;
    let clock: Animation | undefined;
    let observer: ResizeObserver | undefined;
    let restore: (() => void) | undefined;
    let untrack: (() => void) | undefined;
    let stopMotion: (() => void) | undefined;

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frameId);
        clock?.cancel();
        observer?.disconnect();
        stopMotion?.();
        restore?.();
        overlay.remove();
        untrack?.();
    };

    const play = (destination: HTMLElement, onFinish: () => void) => {
        if (disposed) return;
        const { timing } = getSlideMotion();
        const duration = Number(timing.duration);
        let target = rectOf(destination);
        if (prefersReducedMotion() || !target.width || !target.height || !Number.isFinite(duration) || duration <= 0 ||
            getComputedStyle(destination).transform !== "none") {
            dispose();
            onFinish();
            return;
        }

        const properties = ["transform", "transform-origin", "transition", "opacity", "will-change"] as const;
        const previous = properties.map(name => [name, destination.style.getPropertyValue(name), destination.style.getPropertyPriority(name)] as const);
        restore = () => {
            for (const [name, value, priority] of previous) {
                if (value) destination.style.setProperty(name, value, priority);
                else destination.style.removeProperty(name);
            }
        };
        Object.assign(destination.style, {
            transformOrigin: "top left", transition: "none", willChange: "transform, opacity",
        });

        let current = origin;
        let mix = 0;
        let from = current;
        let fromMix = mix;
        let applied = { dx: 0, dy: 0, sx: 1, sy: 1 };
        let segmentDuration = duration;
        let geometryDirty = true;
        let lastPaintedTarget = target;

        const paint = () => {
            const sx = current.width / target.width;
            const sy = current.height / target.height;
            applied = { dx: current.x - target.x, dy: current.y - target.y, sx, sy };
            destination.style.transform = "translate(" + applied.dx + "px, " + applied.dy + "px) scale(" + sx + ", " + sy + ")";
            destination.style.opacity = String(mix);
            oldSource.style.transform = "translate(" + (current.x - origin.x) + "px, " + (current.y - origin.y) + "px) scale(" + (current.width / origin.width) + ", " + (current.height / origin.height) + ")";
            oldSource.style.opacity = String(1 - mix);
            oldPage.style.opacity = String(1 - mix);
            lastPaintedTarget = target;
        };

        // Undo only our known transform mathematically. This reads the live
        // layout without removing/reapplying styles or forcing an extra paint.
        const measure = (): MorphRect => {
            const visual = rectOf(destination);
            return {
                x: visual.x - applied.dx, y: visual.y - applied.dy,
                width: visual.width / applied.sx, height: visual.height / applied.sy,
            };
        };
        const restart = (remaining: number) => {
            clock?.cancel();
            from = current;
            fromMix = mix;
            segmentDuration = remaining;
            clock = createMorphClock(overlay, { ...timing, duration: remaining });
        };
        const finish = () => {
            dispose();
            onFinish();
        };

        document.body.append(overlay);
        paint();
        untrack = trackMorphCursorElement(destination);
        observer = new ResizeObserver(() => { geometryDirty = true; });
        observer.observe(destination);
        observer.observe(viewport);
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMotion = () => { if (motion.matches) finish(); };
        motion.addEventListener("change", onMotion);
        stopMotion = () => motion.removeEventListener("change", onMotion);
        restart(duration);

        const tick = () => {
            if (disposed) return;
            if (!destination.isConnected || !clock) { finish(); return; }
            const next = measure();
            if (!next.width || !next.height) { finish(); return; }
            // Check coordinates too: a layout shift can move an element
            // without resizing it (e.g. the header or document scroll).
            if (geometryDirty || !sameMorphRect(next, lastPaintedTarget)) {
                geometryDirty = false;
                if (!sameMorphRect(next, target)) {
                    const remaining = Math.max(120, segmentDuration - Number(clock.currentTime ?? 0));
                    target = next;
                    // Retarget from the last rendered frame, not the origin.
                    restart(remaining);
                    paint();
                    frameId = requestAnimationFrame(tick);
                    return;
                }
            }
            const progress = clock.effect?.getComputedTiming().progress ?? 0;
            const done = Number(clock.currentTime ?? 0) >= segmentDuration;
            current = interpolateMorphRect(from, target, done ? 1 : progress);
            mix = Math.min(1, Math.max(0, morphLerp(fromMix, 1, done ? 1 : progress)));
            paint();
            if (done) finish();
            else frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
    };

    return { key: source.dataset.navigationMorphTarget, source, play, dispose };
}
