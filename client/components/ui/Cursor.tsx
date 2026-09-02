"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

export default function Cursor() {
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
        (x: number, y: number) => {
            mouse.current.x = x;
            mouse.current.y = y;

            let hit = document.elementFromPoint(x, y);

            if (hit && rootRef.current?.contains(hit)) {
                hit = null;
            }

            const buttonEl = hit?.closest<HTMLElement>(
                '[data-cursor="button"]',
            );
            const textEl = hit?.closest<HTMLElement>('[data-cursor="text"]');

            if (buttonEl) {
                const rect = buttonEl.getBoundingClientRect();
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

            cursorX.set(target.current.x - target.current.width / 2);
            cursorY.set(target.current.y - target.current.height / 2);
            cursorW.set(target.current.width);
            cursorH.set(target.current.height);
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

        window.addEventListener("resize", refresh);
        window.addEventListener("scroll", refresh, true);
        window.addEventListener("animationend", refresh, true);
        window.addEventListener("transitionend", refresh, true);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);

            window.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);

            window.removeEventListener("resize", refresh);
            window.removeEventListener("scroll", refresh, true);
            window.removeEventListener("animationend", refresh, true);
            window.removeEventListener("transitionend", refresh, true);
        };
    }, [handleMouseMove]);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            handleMouseMove(mouse.current.x, mouse.current.y);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [handleMouseMove]);

    return (
        <motion.div
            ref={rootRef}
            className={`z-10 pointer-events-none fixed`}
            style={{
                opacity: cursorOpacity,
            }}
        >
            <motion.div
                className={`${isMouseDown && "scale-95"} transition-transform z-10 duration-200 ease-out fixed`}
                style={{
                    left: cursorX,
                    top: cursorY,

                    width: cursorW,
                    height: cursorH,

                    boxShadow,

                    borderRadius: cursorBorderRadius,
                }}
            />
            <motion.div
                className={`${isMouseDown && "scale-95"} transition-transform z-10 duration-200 ease-out fixed`}
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
