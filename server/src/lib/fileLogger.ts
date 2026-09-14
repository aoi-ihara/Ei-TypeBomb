import { appendFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

type LogLevel = "INFO" | "ERROR";

type LogMetadata = Record<string, unknown>;

const logPath = resolve(__dirname, "../../logs/server.log");

const ensureLogFile = () => {
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
};

const writeLog = (
    level: LogLevel,
    context: string,
    message: string,
    metadata?: LogMetadata,
) => {
    try {
        ensureLogFile();

        const entry = {
            timestamp: new Date().toISOString(),
            level,
            context,
            message,
            ...(metadata ? { metadata } : {}),
        };

        appendFileSync(logPath, `${JSON.stringify(entry)}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
    } catch (error) {
        console.error("[ERROR] failed to write persistent server log", error);
        console.error(error);
    }
};

export const logToFile = (
    context: string,
    message: string,
    metadata?: LogMetadata,
) => {
    writeLog("INFO", context, message, metadata);
};

export const logErrorToFile = (
    message: string,
    error?: unknown,
    metadata?: LogMetadata,
) => {
    const errorMetadata =
        error instanceof Error
            ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
              }
            : error === undefined
              ? undefined
              : { value: error };

    writeLog("ERROR", "ERROR", message, {
        ...(metadata ?? {}),
        ...(errorMetadata ? { error: errorMetadata } : {}),
    });
};
