import { capturePostHogEvent } from "./posthog";
import { capturePostHogLog } from "./posthogLogs";
import { logErrorToFile, logToFile } from "./fileLogger";

type ConsolePlayer = {
    id: string;
    displayName?: string;
};

type ConsoleRoom = {
    id: string;
    players: ConsolePlayer[];
    isStart: boolean;
    bombHolder?: number;
    bombHolders?: number[];
};

type ServerState = {
    rooms: ConsoleRoom[];
};

type EventContext = "ROOM" | "GAME" | "SERVER" | "ERROR";
type ConsoleEvent = {
    context: EventContext;
    message: string;
    at: number;
};
type LogMetadata = Record<string, unknown>;
type LatencySample = { at: number; value: number };

const isInteractive = Boolean(process.stdout.isTTY);
const recentEvents: ConsoleEvent[] = [];
const latencySamples: LatencySample[] = [];
const roomIssues = new Map<string, number>();
const MAX_ACTIVITY = 12;

let state: ServerState = { rooms: [] };
let renderScheduled = false;
let animationTimer: NodeJS.Timeout | undefined;

const ansi = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    white: "\x1b[97m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan600: "\x1b[38;2;8;145;178m",
    cyan700: "\x1b[38;2;14;116;144m",
    cyan800: "\x1b[38;2;21;94;117m",
    cyan900: "\x1b[38;2;22;78;99m",
    slate300: "\x1b[38;2;203;213;225m",
    slate500: "\x1b[38;2;100;116;139m",
    slate700: "\x1b[38;2;51;65;85m",
    sage400: "\x1b[38;2;126;170;149m",
    sage500: "\x1b[38;2;95;146;122m",
    sage600: "\x1b[38;2;85;127;109m",
    sage700: "\x1b[38;2;62;98;82m",
};

const colorize = (text: string, color: string) =>
    isInteractive ? `${color}${text}${ansi.reset}` : text;

const padVisible = (text: string, width: number) =>
    text + " ".repeat(Math.max(0, width - text.length));

const relativeTime = (at: number) => {
    const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

const eventSymbol = (context: EventContext) => {
    if (context === "GAME") return { symbol: "→", color: ansi.cyan600 };
    if (context === "ROOM") return { symbol: "◇", color: ansi.yellow };
    if (context === "ERROR") return { symbol: "!", color: ansi.red };
    return { symbol: "•", color: ansi.slate500 };
};

const header = () => {
    const width = process.stdout.columns ?? 100;
    const name = colorize("ETB", ansi.cyan600) + " " + colorize("Console", ansi.slate300);
    return width < 52 ? name : name + colorize("   •   Backend dashboard", ansi.slate500);
};

const activityIndicator = (players: number) =>
    players === 0
        ? colorize("○ Idle", ansi.slate500)
        : colorize("● Active", ansi.sage500);

const section = (title: string) => {
    const width = Math.max(0, Math.min(48, (process.stdout.columns ?? 80) - title.length - 2));
    return colorize(title + " " + "─".repeat(width), ansi.sage500);
};

const compact = (value: string, width: number) =>
    value.length > width ? value.slice(0, Math.max(0, width - 1)) + "…" : value;

const latencyColor = (latencyMs: number) => {
    if (latencyMs <= 100) return ansi.cyan600;
    if (latencyMs <= 250) return ansi.yellow;
    return ansi.red;
};

const renderLatency = () => {
    const now = Date.now();
    const fresh = latencySamples.filter((sample) => now - sample.at <= 60_000);
    if (fresh.length === 0) return colorize("No recent latency samples", ansi.slate500);

    const latest = fresh[fresh.length - 1].value;
    const sorted = fresh.map((sample) => sample.value).sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const chars = "▁▂▃▄▅▆▇█";
    const max = Math.max(1, ...fresh.map((sample) => sample.value));
    const spark = fresh.slice(-Math.max(1, Math.min(30, (process.stdout.columns ?? 80) - 3)))
        .map((sample) => chars[Math.min(7, Math.floor(sample.value / max * 7))]).join("");
    const values = `Latest ${Math.round(latest)} ms   P95 ${Math.round(p95)} ms   (60s)`;
    return [
        colorize(values, latencyColor(latest)),
        colorize(spark, ansi.cyan600),
    ].join("\n");
};

const renderRooms = () => {
    if (state.rooms.length === 0) return colorize("No active rooms", ansi.slate500);

    const width = Math.max(12, (process.stdout.columns ?? 80) - 3);
    return state.rooms.map((room) => {
        const hasRecentError = (roomIssues.get(room.id) ?? 0) > Date.now();
        const status = room.isStart ? "Playing" : "Waiting";
        const holders = room.isStart
            ? (room.bombHolders ?? (room.bombHolder === undefined ? [] : [room.bombHolder])).length
            : 0;
        const label = compact(room.id, Math.max(8, width - 31));
        const details = `${room.players.length} players · ${status}${holders ? ` · ${holders} bomb${holders === 1 ? "" : "s"}` : ""}`;
        return colorize(hasRecentError ? "! " : "• ", hasRecentError ? ansi.red : ansi.cyan600) +
            colorize(label, ansi.slate300) + "\n  " +
            colorize(compact(details, width), hasRecentError ? ansi.red : ansi.slate500);
    }).join("\n\n");
};

const renderActivity = () => {
    if (recentEvents.length === 0) {
        return colorize("Server ready", ansi.slate500);
    }

    return recentEvents
        .slice(-8)
        .reverse()
        .map((event) => {
            const { symbol, color } = eventSymbol(event.context);
            return `${colorize(
                padVisible(new Date(event.at).toLocaleTimeString("en-GB", { hour12: false }), 8),
                ansi.slate500,
            )} ${colorize(`${symbol} ${event.message}`, color)}`;
        })
        .join("\n");
};

const formatState = () => {
    const players = state.rooms.reduce((total, room) => total + room.players.length, 0);
    const activeGames = state.rooms.filter((room) => room.isStart).length;
    const width = process.stdout.columns ?? 80;
    const summary = width < 48
        ? `${state.rooms.length} rooms · ${players} players · ${activeGames} games`
        : `ROOMS ${state.rooms.length}    PLAYERS ${players}    GAMES ${activeGames}`;
    const lastError = [...recentEvents].reverse().find((event) => event.context === "ERROR");
    return [
        header(),
        colorize("────────────────────────", ansi.slate700),
        activityIndicator(players),
        colorize(summary, ansi.cyan600),
        lastError ? colorize("! Recent error · see activity", ansi.yellow) : "",
        "",
        section("LATENCY"),
        renderLatency(),
        "",
        section("ROOMS"),
        renderRooms(),
        "",
        section("ACTIVITY"),
        renderActivity(),
    ].filter((line) => line !== undefined).join("\n");
};

const renderState = () => {
    renderScheduled = false;

    if (!isInteractive) return;

    process.stdout.write("\x1b[H\x1b[J");
    process.stdout.write(`${formatState()}\n`);
};

const scheduleRender = () => {
    if (!isInteractive || renderScheduled) return;
    renderScheduled = true;
    setImmediate(renderState);
};

export const setServerState = (nextState: ServerState) => {
    state = nextState;

    if (isInteractive) {
        scheduleRender();
        return;
    }

    const players = state.rooms.reduce(
        (total, room) => total + room.players.length,
        0,
    );
    const games = state.rooms.filter((room) => room.isStart).length;
    console.log(
        `[STATE] rooms=${state.rooms.length} players=${players} games=${games}`,
    );
};

export const recordLatencySample = (latencyMs: number) => {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    latencySamples.push({ at: Date.now(), value: latencyMs });
    if (latencySamples.length > 30) latencySamples.shift();
    scheduleRender();
};

export const logEvent = (
    context: Exclude<EventContext, "ERROR">,
    message: string,
    metadata?: LogMetadata,
) => {
    logToFile(context, message, metadata);
    capturePostHogLog("INFO", context, message, metadata);

    if (
        (context === "SERVER" &&
            (message === "client connected" ||
                message === "client disconnected")) ||
        (context === "ROOM" && message.startsWith("authenticated "))
    ) {
        return;
    }

    recentEvents.push({ context, message, at: Date.now() });
    if (recentEvents.length > MAX_ACTIVITY) recentEvents.shift();

    if (isInteractive) scheduleRender();
    else console.log(`> [${context}] ${message}`);
};

export const logError = (
    message: string,
    error?: unknown,
    metadata?: LogMetadata,
) => {
    logErrorToFile(message, error, metadata);
    capturePostHogLog("ERROR", "ERROR", message, {
        ...(metadata ?? {}),
        ...(error instanceof Error
            ? {
                  error_name: error.name,
                  error_message: error.message,
                  error_stack: error.stack,
              }
            : error !== undefined
              ? { error_value: error }
              : {}),
    });
    capturePostHogEvent("server_error", {
        error_name: error instanceof Error ? error.name : "UnknownError",
    });

    const roomId = metadata?.roomId;
    if (isInteractive && typeof roomId === "string" && roomId.length > 0) {
        roomIssues.set(roomId, Date.now() + 60_000);
    }

    recentEvents.push({ context: "ERROR", message, at: Date.now() });
    if (recentEvents.length > 8) recentEvents.shift();

    if (isInteractive) {
        scheduleRender();
    } else {
        console.error(`[ERROR] ${message}`);
        if (error) console.error(error);
    }
};

export const startConsole = (port: number) => {
    if (isInteractive && !animationTimer) {
        animationTimer = setInterval(() => {
            for (const [roomId, expiresAt] of roomIssues) {
                if (expiresAt <= Date.now()) roomIssues.delete(roomId);
            }
            scheduleRender();
        }, 1000);
        animationTimer.unref();
    }

    if (isInteractive) renderState();
    logEvent("SERVER", `listening on :${port}`);
};
