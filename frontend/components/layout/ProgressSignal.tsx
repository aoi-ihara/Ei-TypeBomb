"use client";

import { useEffect, useId } from "react";
import {
    startNavigationProgress,
    stopNavigationProgress,
} from "@/lib/navigation-progress";

export default function ProgressSignal() {
    const source = `page-loading:${useId()}`;

    useEffect(() => {
        startNavigationProgress(source);

        return () => {
            stopNavigationProgress(source);
        };
    }, [source]);

    return null;
}
