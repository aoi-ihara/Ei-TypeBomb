"use client";

import { notFound } from "next/navigation";

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    if (
        !process.env.NEXT_PUBLIC_DEVELOPER_MODE ||
        "true" !== (process.env.NEXT_PUBLIC_DEVELOPER_MODE ?? "")
    ) {
        notFound();
    }

    return children;
}
