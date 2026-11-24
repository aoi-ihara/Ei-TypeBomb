export const SLIDE_CURSOR_CHANGE = "etbslidecursorchange";

type CursorTarget = { element: HTMLElement; rect: DOMRect };
const entrances = new Map<HTMLElement, Animation>();
let nativeSlide = false;
const morphElements = new Set<HTMLElement>();

export function isSlideCursorActive() {
    return nativeSlide || entrances.size > 0 || morphElements.size > 0;
}

function refresh() {
    window.dispatchEvent(new Event(SLIDE_CURSOR_CHANGE));
}

/** Track only the incoming content. Outgoing copies are inert. */
export function animateSlideEntrance(
    element: HTMLElement,
    frames: Keyframe[],
    timing: KeyframeAnimationOptions,
): Animation {
    const animation = element.animate(frames, timing);
    entrances.set(element, animation);
    const finish = () => {
        if (entrances.get(element) !== animation) return;
        entrances.delete(element);
        refresh();
    };
    void animation.finished.then(finish, finish);
    refresh();
    return animation;
}

/** Hit-test a live morph destination at its final, untransformed position. */
export function trackMorphCursorElement(element: HTMLElement) {
    morphElements.add(element);
    refresh();
    return () => {
        morphElements.delete(element);
        refresh();
    };
}

/** Called once the destination DOM has committed, before the native snapshot. */
export function beginNativeSlideCursor() {
    nativeSlide = true;
    refresh();
}

export function endNativeSlideCursor() {
    if (!nativeSlide) return;
    nativeSlide = false;
    refresh();
}

function cursorElement(hit: Element | null): HTMLElement | null {
    return hit?.closest<HTMLElement>('[data-cursor="button"]') ??
        hit?.closest<HTMLElement>('[data-cursor="text"]') ?? null;
}

/** Native view transitions suppress normal hit testing on captured elements.
 * Use the destination DOM's stationary rectangles instead of its moving image.
 * Only do this during a native slide; ordinary hover retains browser hit testing.
 */
function nativeTarget(x: number, y: number): CursorTarget | null {
    const elements = document.querySelectorAll<HTMLElement>('[data-cursor="button"], [data-cursor="text"]');
    for (const candidate of Array.from(elements).reverse()) {
        if (candidate.closest('[inert], [aria-hidden="true"]')) continue;
        const style = getComputedStyle(candidate);
        if (style.visibility !== "visible" || style.pointerEvents === "none" ||
            !candidate.getClientRects().length) continue;
        const element = cursorElement(candidate);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width && rect.height && x >= rect.left && x < rect.right &&
            y >= rect.top && y < rect.bottom) return { element, rect };
    }
    return null;
}

/** Temporarily remove just the entrance transforms for a synchronous
 * hit test. Restore them before returning, so no rendered frame jumps. */
export function getSlideCursorTarget(x: number, y: number): CursorTarget | null {
    if (!nativeSlide && !entrances.size && !morphElements.size) return null;
    const restore: (() => void)[] = [];
    try {
        const moving = new Set(morphElements);
        for (const [element, animation] of entrances) {
            if (animation.playState !== "idle" && animation.playState !== "finished") moving.add(element);
        }
        for (const element of moving) {
            if (!element.isConnected) continue;
            const style = element.style;
            const value = style.getPropertyValue("transform");
            const priority = style.getPropertyPriority("transform");
            style.setProperty("transform", "none", "important");
            restore.push(() => {
                if (value) style.setProperty("transform", value, priority);
                else style.removeProperty("transform");
            });
        }
        const element = cursorElement(document.elementFromPoint(x, y));
        if (element) return { element, rect: element.getBoundingClientRect() };
        return nativeSlide ? nativeTarget(x, y) : null;
    } finally {
        for (const reset of restore.reverse()) reset();
    }
}
