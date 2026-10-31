"use client";

import { useState } from "react";
import Button from "./Button";

export type SelectionProps = {
    items: string[];
    selection: number;
    onSelected: (index: number) => void;
};

export default function Selection({
    items,
    selection,
    onSelected,
}: SelectionProps) {
    const [isPressed, setIsPressed] = useState(false);

    return (
        <div className="relative flex w-full rounded-2xl bg-(--color-background-secondary) p-2">
            <div
                className={`pointer-events-none absolute inset-y-2 rounded-lg bg-cyan-600 transition-all duration-(--duration-etb) ease-etb ${
                    isPressed ? "scale-95" : ""
                }`}
                style={{
                    left: `calc(0.5rem + ${selection} * ((100% - 1rem) / ${items.length}))`,
                    width: `calc((100% - 1rem) / ${items.length})`,
                }}
            />

            {items.map((item, index) => (
                <Button
                    key={item}
                    className="z-10 w-full"
                    variant="text"
                    cursor={index === selection ? "0" : "1"}
                    padding="small"
                    onClick={() => onSelected(index)}
                    onPointerDown={() => {
                        if (index === selection) setIsPressed(true);
                    }}
                    onPointerUp={() => setIsPressed(false)}
                    onPointerCancel={() => setIsPressed(false)}
                >
                    {item}
                </Button>
            ))}
        </div>
    );
}
