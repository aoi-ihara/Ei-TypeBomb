type LogLevel = "INFO" | "ERROR";
type LogValue = string | number | boolean | null;
type LogMetadata = Record<string, unknown>;

type OtlpAttribute = {
    key: string;
    value: {
        stringValue?: string;
        intValue?: string;
        doubleValue?: number;
        boolValue?: boolean;
        nullValue?: number;
    };
};

const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(
    /\/$/,
    "",
);
const serviceName = "ei-typebomb-server";

const severity = {
    INFO: { number: 9, text: "INFO" },
    ERROR: { number: 17, text: "ERROR" },
} as const;

const toLogValue = (value: unknown): LogValue => {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return "[unserializable]";
    }
};

const toOtlpAttribute = (key: string, value: LogValue): OtlpAttribute => {
    if (value === null) {
        return { key, value: { nullValue: 0 } };
    }

    if (typeof value === "boolean") {
        return { key, value: { boolValue: value } };
    }

    if (typeof value === "number") {
        return Number.isInteger(value)
            ? { key, value: { intValue: String(value) } }
            : { key, value: { doubleValue: value } };
    }

    return { key, value: { stringValue: value } };
};

export const capturePostHogLog = (
    level: LogLevel,
    context: string,
    message: string,
    metadata: LogMetadata = {},
) => {
    if (!apiKey) return;

    const now = String(BigInt(Date.now()) * 1_000_000n);
    const logSeverity = severity[level];
    const attributes = [
        toOtlpAttribute("log.context", context),
        ...Object.entries(metadata).map(([key, value]) =>
            toOtlpAttribute(`log.${key}`, toLogValue(value)),
        ),
    ];

    void fetch(`${host}/i/v1/logs`, {
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
                            toOtlpAttribute("service.name", serviceName),
                            toOtlpAttribute("service.version", "1.0.0"),
                            toOtlpAttribute(
                                "deployment.environment",
                                process.env.NODE_ENV ?? "production",
                            ),
                        ],
                    },
                    scopeLogs: [
                        {
                            scope: { name: serviceName },
                            logRecords: [
                                {
                                    timeUnixNano: now,
                                    observedTimeUnixNano: now,
                                    severityNumber: logSeverity.number,
                                    severityText: logSeverity.text,
                                    body: { stringValue: message },
                                    attributes,
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    }).catch((error) => {
        console.error("[POSTHOG] failed to capture server log", error);
    });
};
