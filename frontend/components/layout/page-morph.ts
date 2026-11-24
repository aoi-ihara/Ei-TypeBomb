import { createMorphClock, advanceMorphRect, intersectMorphRect, visibleMorphTransform, morphClipInsets, type MorphRect } from "./morph-motion";
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

// Use the browser's visible content area, not the scrollable document height.
function screenRect(): MorphRect {
    const visual = window.visualViewport;
    return visual
        ? { x: visual.offsetLeft, y: visual.offsetTop, width: visual.width, height: visual.height }
        : { x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
}

function clipToVisible(element: HTMLElement, full: MorphRect, visible: MorphRect) {
    const insets = morphClipInsets(full, visible);
    element.style.clipPath = insets.some(value => value > 0)
        ? "inset(" + insets.map(value => value + "px").join(" ") + ")"
        : "none";
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
    const fullOrigin = rectOf(source);
    const origin = intersectMorphRect(fullOrigin, screenRect());
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
    // Preserve the original layout and crop before scaling; shrinking the
    // full Shell would otherwise bring offscreen words into view.
    const oldLayer = document.createElement("div");
    place(oldLayer, origin);
    place(oldSource, {
        ...fullOrigin,
        x: fullOrigin.x - origin.x,
        y: fullOrigin.y - origin.y,
    });
    clipToVisible(oldSource, fullOrigin, origin);
    oldLayer.append(oldSource);
    overlay.append(oldPage, oldLayer);

    let disposed = false;
    let frameId = 0;
    let clock: Animation | undefined;
    let restore: (() => void) | undefined;
    let untrack: (() => void) | undefined;
    let stopMotion: (() => void) | undefined;

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        cancelAnimationFrame(frameId);
        clock?.cancel();
        stopMotion?.();
        restore?.();
        overlay.remove();
        untrack?.();
    };

    const play = (destination: HTMLElement, onFinish: () => void) => {
        if (disposed) return;
        const { timing } = getSlideMotion();
        const duration = Number(timing.duration);
        let fullTarget = rectOf(destination);
        let target = intersectMorphRect(fullTarget, screenRect());
        if (prefersReducedMotion() || !target.width || !target.height || !Number.isFinite(duration) || duration <= 0 ||
            getComputedStyle(destination).transform !== "none") {
            dispose();
            onFinish();
            return;
        }

        const properties = ["transform", "transform-origin", "transition", "opacity", "will-change", "clip-path"] as const;
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
        let applied = { dx: 0, dy: 0, sx: 1, sy: 1 };

        const paint = () => {
            applied = visibleMorphTransform(fullTarget, target, current);
            clipToVisible(destination, fullTarget, target);
            destination.style.transform = "translate(" + applied.dx + "px, " + applied.dy + "px) scale(" + applied.sx + ", " + applied.sy + ")";
            destination.style.opacity = String(mix);
            oldLayer.style.transform = "translate(" + (current.x - origin.x) + "px, " + (current.y - origin.y) + "px) scale(" + (current.width / origin.width) + ", " + (current.height / origin.height) + ")";
            oldLayer.style.opacity = String(1 - mix);
            oldPage.style.opacity = String(1 - mix);
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
        const finish = () => {
            dispose();
            onFinish();
        };

        document.body.append(overlay);
        paint();
        untrack = trackMorphCursorElement(destination);
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const onMotion = () => { if (motion.matches) finish(); };
        motion.addEventListener("change", onMotion);
        stopMotion = () => motion.removeEventListener("change", onMotion);
        clock = createMorphClock(overlay, timing);

        const tick = () => {
            if (disposed) return;
            if (!destination.isConnected || !clock) { finish(); return; }
            const next = measure();
            const visible = intersectMorphRect(next, screenRect());
            if (!visible.width || !visible.height) { finish(); return; }
            // Measure every frame, including position-only shifts. Retargeting
            // must not reset the clock or skip this frame's elapsed progress.
            fullTarget = next;
            target = visible;
            const done = Number(clock.currentTime ?? 0) >= duration;
            const progress = done ? 1 : clock.effect?.getComputedTiming().progress ?? mix;
            const advanced = advanceMorphRect(current, target, mix, progress);
            current = advanced.rect;
            mix = advanced.progress;
            paint();
            if (done) finish();
            else frameId = requestAnimationFrame(tick);
        };
        frameId = requestAnimationFrame(tick);
    };

    return { key: source.dataset.navigationMorphTarget, source, play, dispose };
}
