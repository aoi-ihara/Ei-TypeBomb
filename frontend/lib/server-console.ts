type Context = "REQ" | "AUTH" | "DB" | "POSTHOG" | "SERVER";

const ansi = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
};

const isInteractive = Boolean(process.stdout.isTTY);

const colors: Record<Context, string> = {
    REQ: ansi.cyan,
    AUTH: ansi.green,
    DB: ansi.blue,
    POSTHOG: ansi.yellow,
    SERVER: ansi.green,
};

const label = (context: Context) => {
    const value = `[${context}]`;
    return isInteractive ? `${colors[context]}${value}${ansi.reset}` : value;
};

export const serverLog = (
    context: Context,
    message: string,
    meta?: Record<string, string | number | boolean>,
) => {
    const suffix = meta
        ? ` ${Object.entries(meta)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}`
        : "";

    console.log(`${label(context)} ${message}${suffix}`);
};

export const serverError = (
    message: string,
    error?: unknown,
    context: Context = "SERVER",
) => {
    const errorLabel = isInteractive
        ? `${ansi.red}[ERROR]${ansi.reset}`
        : "[ERROR]";

    console.error(`${errorLabel} ${label(context)} ${message}`);

    if (error instanceof Error) {
        console.error(error.message);
        if (process.env.NODE_ENV !== "production" && error.stack) {
            console.error(error.stack);
        }
    } else if (error !== undefined && process.env.NODE_ENV !== "production") {
        console.error(error);
    }
};
