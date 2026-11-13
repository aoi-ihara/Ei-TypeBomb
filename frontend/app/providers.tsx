"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

if (
    typeof window !== "undefined" &&
    !posthog.__loaded &&
    process.env.NODE_ENV === "production"
) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        capture_pageview: false,
        // Delay the costly replay recorder until the visitor interacts.
        // Product events, feature flags and pageviews remain enabled.
        disable_session_recording: true,
        api_host:
            process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    });
    posthog.register({ app: "ei-typebomb" });
}

function StartReplayOnInteraction() {
    useEffect(() => {
        if (!posthog.__loaded || process.env.NODE_ENV !== "production") return;

        const start = () => {
            posthog.startSessionRecording();
            window.removeEventListener("pointerdown", start);
            window.removeEventListener("keydown", start);
        };
        window.addEventListener("pointerdown", start, { passive: true });
        window.addEventListener("keydown", start);
        return () => {
            window.removeEventListener("pointerdown", start);
            window.removeEventListener("keydown", start);
        };
    }, []);
    return null;
}

function PostHogPageView() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    useEffect(() => {
        if (pathname) {
            let url = window.origin + pathname;
            if (searchParams?.toString()) {
                url += "?" + searchParams.toString();
            }
            posthog.capture("$pageview", { $current_url: url });
        }
    }, [pathname, searchParams]);

    return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
    return (
        <PHProvider client={posthog}>
            <StartReplayOnInteraction />
            <Suspense fallback={null}>
                <PostHogPageView />
            </Suspense>
            {children}
        </PHProvider>
    );
}
