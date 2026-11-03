"use client";

import { useEffect, useRef, useState } from "react";

export type SelectionProps = {
    items: string[];
    selection: number;
    onSelected: (index: number) => void;
    width?: "fit" | "full";
};

export default function Selection({
    items,
    selection,
    onSelected,
    width = "full",
}: SelectionProps) {
    const [isPressed, setIsPressed] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [indicator, setIndicator] = useState<{
        left: number;
        width: number;
    } | null>(null);

    useEffect(() => {
        if (width !== "fit") return;

        const updateIndicator = () => {
            const selectedItem = itemRefs.current[selection];

            if (!selectedItem) {
                setIndicator((current) => (current === null ? current : null));
                return;
            }

            const nextIndicator = {
                left: selectedItem.offsetLeft,
                width: selectedItem.offsetWidth,
            };

            setIndicator((current) =>
                current !== null &&
                current.left === nextIndicator.left &&
                current.width === nextIndicator.width
                    ? current
                    : nextIndicator,
            );
        };

        updateIndicator();

        if (typeof ResizeObserver === "undefined") return;

        const observer = new ResizeObserver(updateIndicator);
        if (containerRef.current) observer.observe(containerRef.current);
        itemRefs.current.forEach((item) => {
            if (item) observer.observe(item);
        });

        return () => observer.disconnect();
    }, [items, selection, width]);

    return (
        <div
            ref={containerRef}
            className={[
                "relative flex rounded-2xl bg-(--color-background-secondary) p-2",
                width === "full" ? "w-full" : "w-fit",
            ].join(" ")}
        >
            <div
                className={[
                    "pointer-events-none absolute inset-y-2 rounded-lg bg-cyan-600 transition-all duration-(--duration-etb) ease-etb",
                    isPressed ? "scale-95" : "",
                    width === "fit" && !indicator ? "opacity-0" : "",
                ]
                    .filter(Boolean)
                    .join(" ")}
                style={{
                    left:
                        width === "full"
                            ? "calc(0.5rem + " +
                              selection +
                              " * ((100% - 1rem) / " +
                              items.length +
                              "))"
                            : (indicator?.left ?? 0) + "px",
                    width:
                        width === "full"
                            ? "calc((100% - 1rem) / " + items.length + ")"
                            : (indicator?.width ?? 0) + "px",
                }}
            />

            {items.map((item, index) => (
                <div
                    key={item}
                    ref={(element) => {
                        itemRefs.current[index] = element;
                    }}
                    className={[
                        "z-10 rounded-lg",
                        width === "full" ? "w-full" : "w-fit shrink-0",
                    ].join(" ")}
                    data-cursor="button"
                    data-cursor-shape={index === selection ? "0" : "1"}
                >
                    <button
                        className={[
                            width === "full"
                                ? "w-full"
                                : "w-auto whitespace-nowrap",
                            "p-1.5 font-bold rounded-lg transition-all duration-(--duration-etb) ease-etb active:scale-95",
                            index === selection ? "text-white" : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                        onClick={() => onSelected(index)}
                        onPointerDown={() => {
                            if (index === selection) setIsPressed(true);
                        }}
                        onPointerUp={() => setIsPressed(false)}
                        onPointerCancel={() => setIsPressed(false)}
                    >
                        {item}
                    </button>
                </div>
            ))}
        </div>
    );
}
