"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

type Button = {
    x: number;
    y: number;
    width: number;
    height: number;
    isFixed: boolean;
    borderRadius: number;
};

export function Cursor() {
    const buttons = useRef<Button[]>([]);

    const target = useRef({
        x: 0,
        y: 0,
        width: 25,
        height: 25,
        weight: 4,
    });
    const [isMouseDown, setIsMouseDown] = useState<boolean>(false);

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

    const boxShadow = useTransform(
        cursorWeight,
        (latestWeight) =>
            `0 0 0 ${latestWeight}px inset var(--color-foreground)`,
    );

    useEffect(() => {
        const getElements = () => {
            const elements = document.querySelectorAll(
                '[data-cursor="button"]',
            );

            buttons.current = Array.from(elements).map((element) => {
                const htmlElement = element as HTMLElement;

                const rect = htmlElement.getBoundingClientRect();

                const style = window.getComputedStyle(htmlElement);

                return {
                    x: rect.left,
                    y: rect.top,

                    width: rect.width,
                    height: rect.height,

                    borderRadius: parseFloat(style.borderRadius),

                    isFixed: style.position === "fixed",
                };
            });
        };

        window.addEventListener("mousedown", () => {
            setIsMouseDown(true);
        });

        window.addEventListener("mouseup", () => {
            setIsMouseDown(false);
        });

        getElements();

        window.addEventListener("resize", getElements);
        window.addEventListener("scroll", getElements);

        return () => {
            window.removeEventListener("resize", getElements);

            window.removeEventListener("scroll", getElements);
        };
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            const selectedButtons: Button[] = buttons.current.filter(
                (button) => {
                    return (
                        mouseX >= button.x &&
                        mouseX <= button.x + button.width &&
                        mouseY >= button.y &&
                        mouseY <= button.y + button.height
                    );
                },
            );

            target.current = {
                x: e.clientX,
                y: e.clientY,
                width: 25,
                height: 25,
                weight: selectedButtons.length == 0 ? 4 : 25,
            };

            cursorX.set(target.current.x - target.current.width / 2);

            cursorY.set(target.current.y - target.current.height / 2);

            cursorW.set(target.current.width);
            cursorH.set(target.current.height);

            const minimumWeight =
                Math.min(target.current.width, target.current.height) / 2;

            cursorWeight.set(Math.min(target.current.weight, minimumWeight));
        };

        window.addEventListener("mousemove", handleMouseMove);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
        };
    }, []);

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
                left: cursorX,
                top: cursorY,
                width: cursorW,
                height: cursorH,
                boxShadow,
            }}
        />
    );
}
