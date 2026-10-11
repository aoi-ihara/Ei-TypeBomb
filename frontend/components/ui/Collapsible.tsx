"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

type CollapsibleProps = {
    open: boolean;
    children: ReactNode;
    className?: string;
    childrenClassName?: string;
};

export default function Collapsible({
    open,
    children,
    className = "",
    childrenClassName = "flex flex-col gap-4",
}: CollapsibleProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);

    useLayoutEffect(() => {
        const element = contentRef.current;

        if (!element) return;

        if (open) {
            setHeight(element.scrollHeight);

            const timeout = window.setTimeout(() => {
                setHeight(-1);
            }, 400);

            return () => window.clearTimeout(timeout);
        }

        setHeight(element.scrollHeight);

        const frame = requestAnimationFrame(() => {
            setHeight(0);
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    useLayoutEffect(() => {
        window.dispatchEvent(new Event("morphcursorchange"));
    }, [open]);

    return (
        <div
            inert={!open}
            className={`overflow-hidden transition-[height] duration-(--duration-etb) ease-etb ${className}`}
            style={{
                height: height === -1 ? "auto" : `${height}px`,
            }}
        >
            <div ref={contentRef} className={childrenClassName}>
                {children}
            </div>
        </div>
    );
}
