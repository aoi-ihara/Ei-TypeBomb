"use client";

import Shell from "@/components/layout/Shell";
import { useEffect, useState } from "react";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => clearInterval(intervalId);
    }, []);

    return <Shell loading={true} />;
}
