"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const PostHogEventTracker = dynamic(() => import("./PostHogEventTracker"), {
    ssr: false,
});

/** Only load the DOM-observing tracker where its events can occur. */
export default function RouteEventTracker() {
    const pathname = usePathname() ?? "";
    const isEditor = /^\/[^/]+\/edit$/.test(pathname);
    const isGame = /^\/[^/]+\/(offline|online)$/.test(pathname);
    if (!isEditor && !isGame) return null;
    return <PostHogEventTracker key={pathname} />;
}
