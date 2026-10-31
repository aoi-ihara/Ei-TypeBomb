"use client";

import Shell from "@/components/layout/Shell";
import Button from "@/components/ui/Button";
import { useState } from "react";

export default function Page() {
    const [isPressed, setIsPressed] = useState(false);
    const [selection, setSelection] = useState(0);
    const items = ["公開", "限定公開", "非公開"];

    return (
        <Shell title="DEV / Selection">
            <div className="relative flex w-full rounded-2xl bg-(--color-background-secondary) p-2">
                <div
                    className={`absolute inset-y-2 rounded-lg bg-cyan-600 transition-all duration-(--duration-etb) ease-etb ${
                        isPressed ? "scale-95" : ""
                    }`}
                    style={{
                        left: `calc(0.5rem + ${selection} * ((100% - 1rem) / ${items.length}))`,
                        width: `calc((100% - 1rem) / ${items.length})`,
                    }}
                />

                {items.map((item, index) =>
                    selection === index ? (
                        <Button
                            className="z-10 w-full"
                            key={index}
                            variant="text"
                            cursor={"0"}
                            padding="small"
                            onPointerDown={() => setIsPressed(true)}
                            onPointerUp={() => setIsPressed(false)}
                            onPointerCancel={() => setIsPressed(false)}
                        >
                            {item}
                        </Button>
                    ) : (
                        <Button
                            onClick={() => setSelection(index)}
                            className="z-10 w-full"
                            key={index}
                            variant="text"
                            cursor={"1"}
                            padding="small"
                        >
                            {item}
                        </Button>
                    ),
                )}
            </div>
        </Shell>
    );
}
