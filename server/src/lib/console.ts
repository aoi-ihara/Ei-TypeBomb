import { capturePostHogEvent } from "./posthog";
import { logErrorToFile, logToFile } from "./fileLogger";

type ServerState = {
    rooms: number;
    players: number;
    games: number;
};

type EventContext = "ROOM" | "GAME" | "SERVER";
type ConsoleEvent = { context: EventContext; message: string };
type LogMetadata = Record<string, unknown>;

const isInteractive = Boolean(process.stdout.isTTY);
const recentEvents: ConsoleEvent[] = [];

let state: ServerState = {
    rooms: 0,
    players: 0,
    games: 0,
};

let renderScheduled = false;

const ansi = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
};

const colorize = (text: string, color: string) =>
    isInteractive ? `${color}${text}${ansi.reset}` : text;

const contextColor = (context: EventContext) => {
    if (context === "ROOM") return ansi.cyan;
    if (context === "GAME") return ansi.blue;
    return ansi.green;
};

const formatEvent = ({ context, message }: ConsoleEvent) =>
    `${colorize(`[${context}]`, contextColor(context))} ${message}`;

const bar = (value: number, width = 13) => {
    const filled = Math.min(value, width);
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};

const formatState = () =>
    [
        "",
        "   +------------------------+",
        "   | Ei-TypeBomb Server     |",
        "   +------------------------+",
        "",
        `          ${colorize("[ ONLINE ]", ansi.green)}`,
        "",
        `   Rooms    ${bar(state.rooms)} ${state.rooms}`,
        `   Players  ${bar(state.players)} ${state.players}`,
        `   Games    ${bar(state.games)} ${state.games}`,
        "",
        "   +------------------------+",
        `   | ${colorize("RECENT", ansi.blue)}                 |`,
        "   +------------------------+",
    ].join("\n");

const renderState = () => {
    renderScheduled = false;

    if (!isInteractive) {
        console.log(
            `[STATE] rooms=${state.rooms} players=${state.players} games=${state.games}`,
        );
        return;
    }

    process.stdout.write("\x1b[H\x1b[0J");
    process.stdout.write(`${formatState()}\n`);
    process.stdout.write(
        recentEvents.length > 0
            ? recentEvents
                  .map((event) => `   > ${formatEvent(event)}`)
                  .join("\n")
            : "       > Server ready",
    );
    process.stdout.write("\n");
};

const scheduleRender = () => {
    if (renderScheduled) return;

    renderScheduled = true;
    setImmediate(renderState);
};

export const setServerState = (nextState: ServerState) => {
    state = nextState;
    if (isInteractive) scheduleRender();
    else renderState();
};

export const logEvent = (
    context: EventContext,
    message: string,
    metadata?: LogMetadata,
) => {
    logToFile(context, message, metadata);

    if (
        (context === "SERVER" &&
            (message === "client connected" ||
                message === "client disconnected")) ||
        (context === "ROOM" && message.startsWith("authenticated "))
    ) {
        return;
    }

    recentEvents.push({ context, message });
    if (recentEvents.length > 8) recentEvents.shift();

    if (isInteractive) scheduleRender();
    else console.log(`> [${context}] ${message}`);
};

export const logError = (
    message: string,
    error?: unknown,
    metadata?: LogMetadata,
) => {
    logErrorToFile(message, error, metadata);
    capturePostHogEvent("server_error", {
        error_name: error instanceof Error ? error.name : "UnknownError",
    });
    console.error(`${colorize("[ERROR]", ansi.red)} ${message}`);
    if (error) console.error(error);
};

export const startConsole = (port: number) => {
    renderState();
    logEvent("SERVER", `listening on :${port}`);
};
