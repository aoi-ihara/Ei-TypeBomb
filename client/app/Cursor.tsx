"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { usePathname } from "next/navigation";

type Button = {
    x: number;
    y: number;
    width: number;
    height: number;
    shape: number;
    borderRadius: number;
};

type Text = {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
};

export function Cursor() {
    const pathname = usePathname();

    const buttons = useRef<Button[]>([]);
    const texts = useRef<Text[]>([]);

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

    const getElements = useCallback(() => {
        const buttonElements = document.querySelectorAll(
            '[data-cursor="button"]',
        );

        const textElements = document.querySelectorAll('[data-cursor="text"]');

        buttons.current = Array.from(buttonElements).map((element) => {
            const htmlElement = element as HTMLElement;

            const rect = htmlElement.getBoundingClientRect();

            const style = window.getComputedStyle(htmlElement);

            return {
                x: rect.left,
                y: rect.top,

                width: rect.width,
                height: rect.height,

                borderRadius: parseFloat(style.borderRadius),

                shape: Number(htmlElement.dataset.cursorShape ?? 0),
            };
        });

        texts.current = Array.from(textElements).map((element) => {
            const htmlElement = element as HTMLElement;

            const rect = htmlElement.getBoundingClientRect();

            const style = window.getComputedStyle(htmlElement);

            return {
                x: rect.left,
                y: rect.top,

                width: rect.width,
                height: rect.height,

                fontSize: parseFloat(style.fontSize),
            };
        });
    }, []);

    const handleMouseMove = useCallback(
        (x: number, y: number) => {
            mouse.current.x = x;
            mouse.current.y = y;

            const selectedButtons = buttons.current.filter((element) => {
                return (
                    x >= element.x &&
                    x <= element.x + element.width &&
                    y >= element.y &&
                    y <= element.y + element.height
                );
            });

            const selectedTexts = texts.current.filter((element) => {
                return (
                    x >= element.x &&
                    x <= element.x + element.width &&
                    y >= element.y &&
                    y <= element.y + element.height
                );
            });

            if (selectedButtons.length > 0) {
                if (selectedButtons[0].shape == 0) {
                    target.current = {
                        x: selectedButtons[0].x + selectedButtons[0].width / 2,

                        y: selectedButtons[0].y + selectedButtons[0].height / 2,

                        width: selectedButtons[0].width + 16,
                        height: selectedButtons[0].height + 16,

                        weight: 4,
                        opacity: 0.25,

                        borderRadius: selectedButtons[0].borderRadius + 8,
                    };
                } else if (selectedButtons[0].shape == 1) {
                    target.current = {
                        x: selectedButtons[0].x + selectedButtons[0].width / 2,

                        y: selectedButtons[0].y + selectedButtons[0].height / 2,

                        width: selectedButtons[0].width,
                        height: selectedButtons[0].height,

                        weight: 1000,
                        opacity: 0.15,

                        borderRadius: selectedButtons[0].borderRadius,
                    };
                } else if (selectedButtons[0].shape == 2) {
                    target.current = {
                        x,
                        y,

                        width: 25,
                        height: 25,

                        weight: isMouseDownRef.current ? 8 : 4,

                        opacity: 1,
                        borderRadius: 12.5,
                    };
                }
            } else if (selectedTexts.length > 0) {
                target.current = {
                    x,
                    y,

                    width: 3,
                    height: selectedTexts[0].fontSize + 10,

                    weight: 2,
                    opacity: 0.5,

                    borderRadius: 12.5,
                };
            } else {
                target.current = {
                    x,
                    y,

                    width: 20,
                    height: 20,

                    weight: 1000,
                    opacity: 1,

                    borderRadius: 10,
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

        const onMouseDown = () => {
            getElements();

            setIsMouseDown(true);
            isMouseDownRef.current = true;

            handleMouseMove(mouse.current.x, mouse.current.y);
        };

        const onMouseUp = () => {
            setIsMouseDown(false);
            isMouseDownRef.current = false;

            handleMouseMove(mouse.current.x, mouse.current.y);
        };

        getElements();

        window.addEventListener("mousemove", onMouseMove);

        window.addEventListener("mousedown", onMouseDown);

        window.addEventListener("mouseup", onMouseUp);

        window.addEventListener("resize", getElements);

        window.addEventListener("scroll", getElements);

        return () => {
            window.removeEventListener("mousemove", onMouseMove);

            window.removeEventListener("mousedown", onMouseDown);

            window.removeEventListener("mouseup", onMouseUp);

            window.removeEventListener("resize", getElements);

            window.removeEventListener("scroll", getElements);
        };
    }, [getElements, handleMouseMove]);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            getElements();
            handleMouseMove(mouse.current.x, mouse.current.y);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        return () => observer.disconnect();
    }, [getElements, handleMouseMove]);

    return (
        <motion.div
            className={`
                ${isMouseDown && "scale-95"}

                transition-transform
                duration-200
                ease-out

                pointer-events-none

                fixed
                rounded-full
            `}
            style={{
                opacity: cursorOpacity,

                left: cursorX,
                top: cursorY,

                width: cursorW,
                height: cursorH,

                boxShadow,

                borderRadius: cursorBorderRadius,
            }}
        />
    );
}
