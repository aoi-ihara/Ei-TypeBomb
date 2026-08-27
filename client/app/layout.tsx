import type { Metadata } from "next";
import "./globals.css";
import Cursor from "@/components/ui/Cursor";
import { Footer } from "@/components/layout/Footer";
import { LINE_Seed_JP, JetBrains_Mono } from "next/font/google";
import { PostHogProvider } from "./providers";
import { Analytics } from "@vercel/analytics/next";
import PopUp from "./PopUp";

const lineSeedJp = LINE_Seed_JP({
    subsets: ["latin"],
    weight: ["400", "700", "800"],
    variable: "--font-line-seed-jp",
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    weight: ["400", "700"],
    variable: "--jetbrains-mono",
});

export const metadata: Metadata = {
    title: "Ei-TypeBomb",
    description:
        "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。",
    openGraph: {
        title: "Ei-TypeBomb",
        description:
            "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。",
        url: "ei-typebomb.vgnz93hs.com",
        siteName: "Ei-TypeBomb",
    },
    icons: {
        apple: "/apple-icon.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ja">
            <body
                className={`${lineSeedJp.variable} ${jetbrainsMono.variable} min-h-full flex flex-col`}
            >
                <PostHogProvider>
                    <main className="flex flex-col h-dvh w-full items-center">
                        {children}
                        <div className="text-xs w-full flex fixed opacity-50 justify-center md:justify-start bottom-3">
                            <Footer />
                        </div>
                    </main>

                    <div className="hidden md:block">
                        <Cursor />
                    </div>

                    <Analytics />

                    <PopUp />
                </PostHogProvider>
            </body>
        </html>
    );
}
