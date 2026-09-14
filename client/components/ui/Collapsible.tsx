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
            }, 200);

            return () => window.clearTimeout(timeout);
        }

        setHeight(element.scrollHeight);

        requestAnimationFrame(() => {
            setHeight(0);
        });
    }, [open]);

    return (
        <div
            className={`overflow-hidden transition-[height] duration-200 ease-out ${className}`}
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
