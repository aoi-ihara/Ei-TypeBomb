import type { Metadata } from "next";
import "./globals.css";
import { Cursor } from "@/components/ui/Cursor";

export const metadata: Metadata = {
    title: "Ei-Typing",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="min-h-full flex flex-col">
                <main className="flex flex-col h-screen w-full items-center">
                    {children}
                    <div className="text-xs w-full pointer-events-none text-center flex justify-center fixed left-0 opacity-25 bottom-4">
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
