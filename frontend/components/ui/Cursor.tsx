"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { useFeatureFlagEnabled } from "posthog-js/react";

// During a morph, pointer events are disabled on both layers. Hit-test their
// *rendered* rectangles instead of reversing the scale: the picker dock can be
// translating at the same time, so unscaled coordinates drift away from it.
const morphSelector =
    '[data-picker] [data-morph], [data-morph-dialog] [data-morph]';

function getMorphCursorTarget(x: number, y: number) {
    const roots = document.querySelectorAll<HTMLElement>(
        '[data-picker] [data-morph-animating="true"], [data-morph-dialog] [data-morph-animating="true"]',
    );
    const contains = (rect: DOMRect) =>
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;

    for (const root of Array.from(roots).reverse()) {
        const layer = root.querySelector<HTMLElement>(
            `[data-morph-layer="${root.dataset.morph}"]`,
        );
        if (!layer) continue;
        const bounds = layer.getBoundingClientRect();
        if (!bounds.width || !bounds.height || !contains(bounds)) continue;

        const candidates = layer.querySelectorAll<HTMLElement>("[data-cursor]");
        for (const element of Array.from(candidates).reverse()) {
            const rect = element.getBoundingClientRect();
            if (contains(rect)) return { element, rect };
        }
        return { element: layer, rect: bounds };
    }
    return null;
}

// Morph updates its own geometry frame by frame, while the picker dock can
// also move via a CSS transition. Refresh the cursor until both have settled,
// even when the mouse itself is stationary.
function isMorphCursorMoving() {
    return Array.from(
        document.querySelectorAll<HTMLElement>(morphSelector),
    ).some(
        (root) =>
            root.dataset.morphAnimating === "true" ||
            root.parentElement
                ?.getAnimations()
                .some((animation) => animation.playState === "running"),
    );
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

    const springConfig = {
        stiffness: 1000,
        damping: 50,
        mass: 1,
    };

    const cursorX = useSpring(0, springConfig);
    const cursorY = useSpring(0, springConfig);

    const cursorW = useSpring(25, springConfig);
    const cursorH = useSpring(25, springConfig);

    const cursorWeight = useSpring(3, springConfig);

    const cursorOpacity = useSpring(0, springConfig);

    const cursorBorderRadius = useSpring(12.5, springConfig);

    const boxShadow = useTransform(
        cursorWeight,
        (latestWeight) =>
            `0 0 0 ${latestWeight}px inset var(--color-foreground)`,
    );

    const handleMouseMove = useCallback(
        (x: number, y: number, followMorph = false) => {
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

            // The regular cursor uses springs for hover transitions. While the
            // menu itself is animating, springs would lag behind its DOM rect.
            const setPosition = followMorph && buttonEl ? "jump" : "set";
            cursorX[setPosition](target.current.x - target.current.width / 2);
            cursorY[setPosition](target.current.y - target.current.height / 2);
            cursorW[setPosition](target.current.width);
            cursorH[setPosition](target.current.height);
            cursorOpacity.set(target.current.opacity);

            const minimumWeight = Math.min(
                target.current.width,
                target.current.height,
            );

            cursorWeight.set(Math.min(target.current.weight, minimumWeight));

            cursorBorderRadius.set(
                Math.min(target.current.borderRadius, minimumWeight),
            );
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

        let frameId = 0;
        const followAnimation = () => {
            refresh();
            if (frameId) return;
            const tick = () => {
                handleMouseMove(mouse.current.x, mouse.current.y, true);
                frameId = isMorphCursorMoving()
                    ? requestAnimationFrame(tick)
                    : 0;
            };
            frameId = requestAnimationFrame(tick);
        };
        const onTransitionRun = (event: TransitionEvent) => {
            const element = event.target;
            if (
                event.propertyName === "transform" &&
                element instanceof HTMLElement &&
                element.closest("[data-picker], [data-morph-dialog]") &&
                element.querySelector("[data-morph]")
            ) {
                followAnimation();
            }
        };

        window.addEventListener("morphcursorchange", followAnimation);
        window.addEventListener("transitionrun", onTransitionRun, true);
        window.addEventListener("resize", refresh);
        window.addEventListener("scroll", refresh, true);
        window.addEventListener("animationend", refresh, true);
        window.addEventListener("transitionend", refresh, true);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);

            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);

            cancelAnimationFrame(frameId);
            window.removeEventListener("morphcursorchange", followAnimation);
            window.removeEventListener("transitionrun", onTransitionRun, true);
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
