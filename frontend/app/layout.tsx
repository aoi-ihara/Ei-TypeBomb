import type { Metadata } from "next";
import { getEtbBaseUrl } from "@/lib/config/base-url";
import { Suspense } from "react";
import "./globals.css";
import Cursor from "@/components/ui/Cursor";
import { Footer } from "@/components/layout/Footer";
import NavigationProgress from "@/components/layout/NavigationProgress";
import Navigation from "@/components/layout/Navigation";
import {
    LINE_Seed_JP,
    JetBrains_Mono,
    Noto_Serif,
    Noto_Serif_JP,
} from "next/font/google";
import { PostHogProvider } from "./providers";
import { Analytics } from "@vercel/analytics/next";
import PopUp from "./PopUp";
import RouteEventTracker from "@/components/analytics/RouteEventTracker";

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

const notoSerif = Noto_Serif({
    subsets: ["latin"],
    variable: "--font-noto-serif",
    display: "swap",
});

const notoSerifJp = Noto_Serif_JP({
    subsets: ["latin"],
    variable: "--font-noto-serif-jp",
    display: "swap",
});

export const metadata: Metadata = {
    ...(process.env.NEXT_PUBLIC_BETA_ENVIRONMENT === "true"
        ? { robots: { index: false, follow: false } }
        : {}),
    metadataBase: new URL(getEtbBaseUrl()),
    title: "ETB",
    description:
        "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。",
    openGraph: {
        title: "ETB",
        description:
            "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。",
        url: getEtbBaseUrl(),
        siteName: "ETB",
        images: [
            {
                url: "/hero.png",
                width: 1280,
                height: 640,
                alt: "ETB",
            },
        ],
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "ETB",
        description:
            "好きな単語リストで、友達と一緒にタイピングゲームをプレイしながら単語を覚えられるオンラインゲーム。",
        images: ["/hero.png"],
    },
    icons: {
        icon: [
            {
                url: "/favicon.ico",
                type: "image/x-icon",
                media: "(prefers-color-scheme: light)",
            },
            {
                url: "/favicon-dark.ico",
                type: "image/x-icon",
                media: "(prefers-color-scheme: dark)",
            },
        ],
        apple: "/apple-touch-icon.png",
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
                className={`${lineSeedJp.variable} ${jetbrainsMono.variable} ${notoSerif.variable} ${notoSerifJp.variable} min-h-full flex flex-col`}
            >
                <PostHogProvider>
                    <Suspense fallback={null}>
                        <NavigationProgress />
                    </Suspense>
                    <RouteEventTracker />
                    <main className="flex flex-col h-dvh w-full items-center">
                        <Navigation root>{children}</Navigation>
                        <div className="text-xs w-full flex fixed opacity-50 justify-center md:justify-start bottom-3">
                            <Footer />
                        </div>
                    </main>

                    <Cursor />

                    <Analytics />

                    <PopUp />
                </PostHogProvider>
            </body>
        </html>
    );
}
