import type { Metadata } from "next";
import "./globals.css";
import Cursor from "@/components/ui/Cursor";

export const metadata: Metadata = {
    title: "Ei-TypeBomb - vgnz93hs",
    icons: {
        icon: [
            {
                url: "/favicon.png",
                sizes: "any",
                type: "image/ico",
            },
        ],
        apple: "/apple-icon.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="min-h-full flex flex-col">
                <main className="flex flex-col h-dvh w-full items-center">
                    {children}
                    <div className="text-xs w-full pointer-events-none flex fixed left-4 opacity-25 justify-center md:justify-start bottom-3">
                        <div data-cursor="text" className="flex w-fit">
                            © 2026 vgnz93hs. All rights reserved.
                        </div>
                    </div>
                </main>

                <div className="hidden md:block">
                    <Cursor />
                </div>
            </body>
        </html>
    );
}
