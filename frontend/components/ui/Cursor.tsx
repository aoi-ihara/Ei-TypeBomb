"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useFeatureFlagEnabled } from "posthog-js/react";

function getMorphCursorTarget(x: number, y: number) {
    const roots = document.querySelectorAll<HTMLElement>(
        '[data-picker] [data-morph-animating="true"], [data-morph-dialog] [data-morph-animating="true"]',
    );
    for (const root of Array.from(roots).reverse()) {
        const layer = root.querySelector<HTMLElement>(
            `[data-morph-layer="${root.dataset.morph}"]`,
        );
        if (!layer) continue;
        const bounds = layer.getBoundingClientRect();
        const css = getComputedStyle(layer);
        const width = parseFloat(css.width);
        const height = parseFloat(css.height);
        if (!bounds.width || !bounds.height || !width || !height) continue;
        const center = root.getBoundingClientRect();
        const destination = root.closest<HTMLElement>("[data-morph-cursor-x]");
        const centerX = destination
            ? Number(destination.dataset.morphCursorX)
            : center.left + center.width / 2;
        const centerY = destination
            ? Number(destination.dataset.morphCursorY)
            : center.top + center.height / 2;
        const left = centerX - width / 2;
        const top = centerY - height / 2;
        if (x < left || x > left + width || y < top || y > top + height)
            continue;

        const candidates = layer.querySelectorAll<HTMLElement>("[data-cursor]");
        for (const element of Array.from(candidates).reverse()) {
            const rect = element.getBoundingClientRect();
            const natural = new DOMRect(
                left + ((rect.left - bounds.left) * width) / bounds.width,
                top + ((rect.top - bounds.top) * height) / bounds.height,
                (rect.width * width) / bounds.width,
                (rect.height * height) / bounds.height,
            );
            if (
                x >= natural.left &&
                x <= natural.right &&
                y >= natural.top &&
                y <= natural.bottom
            ) {
                return { element, rect: natural };
            }
        }
        return { element: layer, rect: new DOMRect(left, top, width, height) };
    }
    return null;
}

// Reuse the exact CSS easing curve rather than maintaining a second spring curve.
function getEtbTransition() {
    const css = getComputedStyle(document.documentElement);
    const duration = (parseFloat(css.getPropertyValue("--duration-etb")) || 400) / 1000;
    const definition = css.getPropertyValue("--ease-etb").trim();
    const stops = definition.startsWith("linear(")
        ? definition.slice(7, -1).split(",").map((entry) => {
              const [value, position] = entry.trim().split(/\s+/);
              return { value: Number(value), position: position ? parseFloat(position) / 100 : NaN };
          })
        : [];
    if (stops.length < 2 || stops.some((stop) => !Number.isFinite(stop.value))) {
        return { duration, ease: (t: number) => 1 - Math.pow(1 - t, 3) };
    }
    stops[0].position = 0;
    stops[stops.length - 1].position = 1;
    // Distribute missing CSS linear() stop positions.
    for (let i = 1; i < stops.length - 1; i++) {
        if (Number.isFinite(stops[i].position)) continue;
        let end = i + 1;
        while (end < stops.length - 1 && !Number.isFinite(stops[end].position)) end++;
        const start = i - 1;
        for (let j = i; j < end; j++) {
            stops[j].position = stops[start].position +
                ((stops[end].position - stops[start].position) * (j - start)) / (end - start);
        }
        i = end - 1;
    }
    return {
        duration,
        ease: (t: number) => {
            const index = stops.findIndex((stop) => stop.position >= t);
            if (index <= 0) return index === 0 ? stops[0].value : stops[stops.length - 1].value;
            const a = stops[index - 1], b = stops[index];
            return a.value + (b.value - a.value) * ((t - a.position) / (b.position - a.position || 1));
        },
    };
}

function CustomCursor() {
    const rootRef = useRef<HTMLDivElement>(null);

    const mouse = useRef({
        x: 0,
        y: 0,
    });

    const target = useRef({
        x: 0,
        y: 0,
        width: 25,
        height: 25,
        weight: 4,
        opacity: 0,
        borderRadius: 12.5,
    });

    const [isMouseDown, setIsMouseDown] = useState(false);
    const isMouseDownRef = useRef(false);

    const cursorX = useMotionValue(0);
    const cursorY = useMotionValue(0);
    const cursorW = useMotionValue(25);
    const cursorH = useMotionValue(25);
    const cursorWeight = useMotionValue(3);
    const cursorOpacity = useMotionValue(0);
    const cursorBorderRadius = useMotionValue(12.5);
    const animations = useRef<Partial<Record<string, ReturnType<typeof animate>>>>({});
    const destinations = useRef<Record<string, number>>({});
    const previousButtonTarget = useRef(false);
    const etbTransition = useRef<ReturnType<typeof getEtbTransition> | null>(null);

    const boxShadow = useTransform(
        cursorWeight,
        (latestWeight) =>
            `0 0 0 ${latestWeight}px inset var(--color-foreground)`,
    );

    const handleMouseMove = useCallback(
        (x: number, y: number) => {
            mouse.current.x = x;
            mouse.current.y = y;

            const destination = getMorphCursorTarget(x, y);
            let hit: Element | null =
                destination?.element ?? document.elementFromPoint(x, y);

            if (hit && rootRef.current?.contains(hit)) {
                hit = null;
            }

            const buttonEl = hit?.closest<HTMLElement>(
                '[data-cursor="button"]',
            );
            const textEl = hit?.closest<HTMLElement>('[data-cursor="text"]');

            if (buttonEl) {
                const rect =
                    destination?.element === buttonEl
                        ? destination.rect
                        : buttonEl.getBoundingClientRect();
                const style = window.getComputedStyle(buttonEl);
                const shape = Number(buttonEl.dataset.cursorShape ?? 0);
                const borderRadius = parseFloat(style.borderRadius) || 0;

                if (shape === 0) {
                    target.current = {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,

                        width: rect.width + 16,
                        height: rect.height + 16,

                        weight: 4,
                        opacity: 0.25,

                        borderRadius: borderRadius + 8,
                    };
                } else if (shape === 1) {
                    target.current = {
                        x: rect.left + rect.width / 2,
                        y: rect.top + rect.height / 2,

                        width: rect.width,
                        height: rect.height,

                        weight: 1000,
                        opacity: 0.15,

                        borderRadius: borderRadius,
                    };
                } else if (shape === 2) {
                    target.current = {
                        x,
                        y,

                        width: 30,
                        height: 30,

                        weight: 15,

                        opacity: 0.5,
                        borderRadius: 15,
                    };
                }
            } else if (textEl) {
                const style = window.getComputedStyle(textEl);
                const fontSize = parseFloat(style.fontSize) || 16;

                target.current = {
                    x,
                    y,

                    width: 3 * (isMouseDownRef.current ? 2 : 1),
                    height:
                        (fontSize + 10) * (isMouseDownRef.current ? 0.9 : 1),

                    weight: 2 * (isMouseDownRef.current ? 2 : 1),
                    opacity: 0.5,

                    borderRadius: 12.5,
                };
            } else {
                target.current = {
                    x,
                    y,

                    width: 24,
                    height: 24,

                    weight: isMouseDownRef.current ? 8 : 4,
                    opacity: 1,

                    borderRadius: 12,
                };
            }

            const isButtonTarget = !!buttonEl && Number(buttonEl.dataset.cursorShape ?? 0) !== 2;
            const justLeftButton = previousButtonTarget.current && !isButtonTarget;
            previousButtonTarget.current = isButtonTarget;
            const transition = etbTransition.current ?? (etbTransition.current = getEtbTransition());
            const minimumWeight = Math.min(target.current.width, target.current.height);

            const update = (key: string, value: typeof cursorX, next: number, position = false) => {
                if (destinations.current[key] === next) return;
                destinations.current[key] = next;
                animations.current[key]?.stop();
                // Follow the pointer with the original responsive spring; use
                // the UI curve when snapping onto/leaving an interactive shape.
                animations.current[key] = animate(value, next,
                    position && !isButtonTarget && !justLeftButton
                        ? { type: "spring", stiffness: 1000, damping: 50, mass: 1 }
                        : { type: "tween", ...transition },
                );
            };

            update("x", cursorX, target.current.x - target.current.width / 2, true);
            update("y", cursorY, target.current.y - target.current.height / 2, true);
            update("width", cursorW, target.current.width);
            update("height", cursorH, target.current.height);
            update("opacity", cursorOpacity, target.current.opacity);
            update("weight", cursorWeight, Math.min(target.current.weight, minimumWeight));
            update("radius", cursorBorderRadius, Math.min(target.current.borderRadius, minimumWeight));
        },
        [
            cursorX,
            cursorY,
            cursorW,
            cursorH,
            cursorOpacity,
            cursorWeight,
            cursorBorderRadius,
        ],
    );

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            handleMouseMove(e.clientX, e.clientY);
        };

        const refresh = () => handleMouseMove(mouse.current.x, mouse.current.y);

        const onMouseDown = () => {
            setIsMouseDown(true);
            isMouseDownRef.current = true;

            refresh();
        };

        const onMouseUp = () => {
            setIsMouseDown(false);
            isMouseDownRef.current = false;

            refresh();
        };

        window.addEventListener("mousemove", onMouseMove);

        window.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);

        window.addEventListener("morphcursorchange", refresh);
        window.addEventListener("resize", refresh);
        window.addEventListener("scroll", refresh, true);
        window.addEventListener("animationend", refresh, true);
        window.addEventListener("transitionend", refresh, true);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);

            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);

            window.removeEventListener("morphcursorchange", refresh);
            window.removeEventListener("resize", refresh);
            window.removeEventListener("scroll", refresh, true);
            window.removeEventListener("animationend", refresh, true);
            window.removeEventListener("transitionend", refresh, true);
        };
    }, [handleMouseMove]);

    useEffect(() => {
        let timeoutId: number;

        const observer = new MutationObserver(() => {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(() => {
                handleMouseMove(mouse.current.x, mouse.current.y);
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => {
            window.clearTimeout(timeoutId);
            observer.disconnect();
        };
    }, [handleMouseMove]);

    useEffect(() => () => {
        Object.values(animations.current).forEach((animation) => animation?.stop());
    }, []);

    useEffect(() => {
        document.documentElement.classList.add("custom-cursor-active");

        return () => {
            document.documentElement.classList.remove("custom-cursor-active");
        };
    }, []);

    return (
        <motion.div
            ref={rootRef}
            // Keep the cursor's stacking context above picker menus (z-index: 50).
            className="z-[100] pointer-events-none fixed"
            style={{
                opacity: cursorOpacity,
            }}
        >
            <motion.div
                className={`${isMouseDown && "scale-95"} transition-transform z-25 duration-(--duration-etb) ease-etb fixed`}
                style={{
                    left: cursorX,
                    top: cursorY,

                    width: cursorW,
                    height: cursorH,

                    boxShadow,

                    borderRadius: cursorBorderRadius,
                }}
            />
        </motion.div>
    );
}

export default function Cursor() {
    const customCursorEnabled = useFeatureFlagEnabled("customCursor") !== false;

    return customCursorEnabled ? <CustomCursor /> : null;
}
