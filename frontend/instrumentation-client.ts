import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const token = projectToken || process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (!token && process.env.NODE_ENV !== "production") {
    console.error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
    );
}

if (token && process.env.NODE_ENV === "production") {
    posthog.init(token, {
        api_host: projectToken ? "/ingest" : process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_pageview: "history_change",
        autocapture: false,
        disable_session_recording: true,
        capture_exceptions: false,
        ip: false,
        save_campaign_params: false,
        save_referrer: false,
        capture_heatmaps: false,
        enable_heatmaps: false,
        property_denylist: [
            "$current_url", "$referrer", "$initial_referrer", "$initial_current_url",
            "$prev_pageview_pathname", "$pathname", "$set_once",
        ],
    });
    posthog.register({ app: "ei-typebomb" });
}

let gameNumber = 0;
const originalCapture = posthog.capture.bind(posthog);

posthog.capture = ((eventName, properties, options) => {
    if (eventName === "game_started") {
        gameNumber += 1;
    }

    if (eventName === "game_won" || eventName === "game_lost") {
        properties = {
            ...properties,
            game_number: gameNumber,
        };
    }

    return originalCapture(eventName, properties, options);
}) as typeof posthog.capture;

document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest("button");
    if (button?.textContent?.trim() !== "Play Again") return;

    posthog.capture("game_play_again_clicked");
});
