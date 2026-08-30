type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

type AnalyticsEvent =
    | "room_authenticated"
    | "player_joined"
    | "player_left"
    | "game_started"
    | "game_finished"
    | "game_cancelled"
    | "server_error";

const apiKey = process.env.POSTHOG_API_KEY;
const host = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(
    /\/$/,
    "",
);

let missingKeyWarningShown = false;

export const capturePostHogEvent = (
    event: AnalyticsEvent,
    properties: AnalyticsProperties = {},
    distinctId = "server",
) => {
    if (!apiKey) {
        if (!missingKeyWarningShown) {
            missingKeyWarningShown = true;
            console.warn(
                "[POSTHOG] POSTHOG_API_KEY is not configured; analytics events are disabled",
            );
        }
        return;
    }

    void fetch(`${host}/capture/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            api_key: apiKey,
            event,
            distinct_id: distinctId,
            properties: {
                ...properties,
                $lib: "ei-typebomb-server",
                $lib_version: "1.0.0",
                $process_person_profile: false,
            },
        }),
    }).then((response) => {
        if (!response.ok) {
            throw new Error(`PostHog responded with HTTP ${response.status}`);
        }
    }).catch((error) => {
        console.error("[POSTHOG] failed to capture analytics event", error);
    });
};
