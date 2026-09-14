"use client";

import { notFound } from "next/navigation";
import { useFeatureFlagEnabled } from "posthog-js/react";

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const showDevelopmentSettings = useFeatureFlagEnabled(
        "showDevelopmentSettings",
    );

    if (!showDevelopmentSettings) {
        notFound();
    }

    return children;
}
