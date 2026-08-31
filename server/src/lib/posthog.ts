type AnalyticsProperties = Record<
    string,
    string | number | boolean | null | undefined
>;

type AnalyticsEvent =
    | "room_authenticated"
    | "player_joined"
    | "player_left"
    | "game_started"
    | "game_finished"
    | "game_cancelled"
    | "server_error";

type PostHogLogLevel = "debug" | "info" | "warn" | "error";
type LogAttributes = Record<string, string | number | boolean | null | undefined>;

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(
    /\/$/,
    "",
);
const logsEndpoint = `${host}/i/v1/logs`;

let missingKeyWarningShown = false;

const warnMissingApiKey = () => {
    if (missingKeyWarningShown) return;

    missingKeyWarningShown = true;
    console.warn(
        "[POSTHOG] NEXT_PUBLIC_POSTHOG_KEY is not configured; PostHog telemetry is disabled",
    );
};

const toOtlpAttribute = (key: string, value: LogAttributes[string]) => {
    if (value === null || value === undefined) return null;

    if (typeof value === "string") {
        return { key, value: { stringValue: value } };
    }

    if (typeof value === "boolean") {
        return { key, value: { boolValue: value } };
    }

    return { key, value: { doubleValue: value } };
};

export const capturePostHogLog = (
    level: PostHogLogLevel,
    message: string,
    attributes: LogAttributes = {},
) => {
    if (!apiKey) {
        warnMissingApiKey();
        return;
    }

    const severity =
        level === "debug"
            ? { severityNumber: 5, severityText: "DEBUG" }
            : level === "info"
              ? { severityNumber: 9, severityText: "INFO" }
              : level === "warn"
                ? { severityNumber: 13, severityText: "WARN" }
                : { severityNumber: 17, severityText: "ERROR" };

    const otlpAttributes = Object.entries(attributes)
        .map(([key, value]) => toOtlpAttribute(key, value))
        .filter((attribute): attribute is NonNullable<typeof attribute> =>
            Boolean(attribute),
        );

    void fetch(logsEndpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            resourceLogs: [
                {
                    resource: {
                        attributes: [
                            {
                                key: "service.name",
                                value: { stringValue: "ei-typebomb-server" },
                            },
                            {
                                key: "service.version",
                                value: { stringValue: "1.0.0" },
                            },
                        ],
                    },
                    scopeLogs: [
                        {
                            scope: {
                                name: "ei-typebomb",
                            },
                            logRecords: [
                                {
                                    timeUnixNano: String(Date.now() * 1_000_000),
                                    ...severity,
                                    body: { stringValue: message },
                                    attributes: otlpAttributes,
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    })
        .then((response) => {
            if (!response.ok) {
                throw new Error(
                    `PostHog Logs responded with HTTP ${response.status}`,
                );
            }
        })
        .catch((error) => {
            console.error("[POSTHOG] failed to capture server log", error);
        });
};

export const capturePostHogEvent = (
    event: AnalyticsEvent,
    properties: AnalyticsProperties = {},
    distinctId = "server",
) => {
    if (!apiKey) {
        warnMissingApiKey();
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
    })
        .then((response) => {
            if (!response.ok) {
                throw new Error(
                    `PostHog responded with HTTP ${response.status}`,
                );
            }
        })
        .catch((error) => {
            console.error("[POSTHOG] failed to capture analytics event", error);
        });
};
