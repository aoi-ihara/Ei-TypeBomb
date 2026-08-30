import { cookieTools } from "@/lib/analytics/flags";
import { notFound } from "next/navigation";

export default async function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    const showCookieSettings = await cookieTools();

    if (!showCookieSettings) {
        notFound();
    }

    return children;
}
