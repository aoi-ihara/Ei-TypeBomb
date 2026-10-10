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

const logo = () => {
    const etb = [
        "███████  ████████  ██████   ",
        "██          ██     ██    ██ ",
        "██████      ██     ██████   ",
        "██          ██     ██    ██ ",
        "███████     ██     ██████   ",
    ];
    const consoleWord = [
        " ██████    ███████    ███    ██    ███████    ███████    ██       ███████",
        "██        ██     ██   ████   ██   ██         ██     ██   ██       ██",
        "██        ██     ██   ██ ██  ██    ███████   ██     ██   ██       █████",
        "██        ██     ██   ██  ██ ██          ██  ██     ██   ██       ██",
        " ██████    ███████    ██   ████    ███████    ███████    ███████  ███████",
    ];

    return etb
        .map(
            (line, index) =>
                `${colorize(line, ansi.cyan600)}   ${colorize(
                    consoleWord[index],
                    ansi.slate500,
                )}`,
        )
        .join("\n");
};

const pulseIndicator = () => {
    const players = state.rooms.reduce(
        (total, room) => total + room.players.length,
        0,
    );

    if (players === 0) {
        return `${colorize("░", ansi.slate700)} ${colorize(
            "Idle",
            ansi.slate500,
        )}`;
    }

    const frames = [ansi.sage400, ansi.sage500, ansi.sage600, ansi.sage700];
    const phase = Math.floor(Date.now() / 60) % 6;
    const frameIndex = phase <= 3 ? phase : 6 - phase;
    return `${colorize("██", frames[frameIndex])}   ${colorize(
        `${ansi.bold}Used`,
        ansi.sage600,
    )}`;
};

const latencyQuality = (latencyMs: number) =>
    Math.max(0.08, Math.min(1, 1 - latencyMs / 500));

const latencyColor = (latencyMs: number) => {
    if (latencyMs <= 100) return ansi.cyan600;
    if (latencyMs <= 250) return ansi.yellow;
    return ansi.red;
};

const renderLatency = () => {
    const now = Date.now();
    const freshSamples = latencySamples.filter(
        (sample) => now - sample.at <= 60_000,
    );
    const latest = freshSamples.at(-1)?.value;
    if (latest === undefined) {
        return [
            `${colorize("Latency", ansi.slate500)}   ${colorize(
                "█".repeat(24),
                ansi.slate500,
            )}   ${colorize("— ms", ansi.slate500)}`,
        ].join("\n");
    }

    const width = 24;
    const filled = Math.max(1, Math.round(latencyQuality(latest) * width));
    const gauge =
        colorize("█".repeat(filled), ansi.cyan600) +
        colorize("█".repeat(width - filled), ansi.slate300);

    const sparkChars = "▁▂▃▄▅▆▇█";
    const spark = freshSamples
        .slice(-30)
        .map((sample) => {
            const level = Math.min(
                sparkChars.length - 1,
                Math.floor(sample.value / 50),
            );
            return sparkChars[level];
        })
        .join("");

    return [
        `LATENCY   ${gauge}   ${colorize(
            `${Math.round(latest)} ms`,
            latencyColor(latest),
        )}`,
        `          ${colorize(spark, ansi.slate500)}`,
    ].join("\n");
};

const ROOM_WIDTH = 30;
const ROOM_INNER_WIDTH = ROOM_WIDTH - 2;
const PLAYER_POSITIONS = [
    [0, 13],
    [1, 6],
    [1, 20],
    [2, 13],
    [2, 2],
    [2, 24],
    [3, 8],
    [3, 18],
] as const;

const renderRoomCard = (room: ConsoleRoom) => {
    const hasIssue = (roomIssues.get(room.id) ?? 0) > Date.now();
    const frameColor = hasIssue ? ansi.red : ansi.slate500;
    const border = (value: string) => colorize(value, frameColor);
    const top = border(`╭${"─".repeat(ROOM_INNER_WIDTH)}╮`);
    const bottom = border(`╰${"─".repeat(ROOM_INNER_WIDTH)}╯`);

    const roomLabel =
        room.id.length > 18 ? `${room.id.slice(0, 17)}…` : room.id;
    const title = ` ${roomLabel}`;
    const titleLine =
        border("│") + padVisible(title, ROOM_INNER_WIDTH) + border("│");

    const rows = Array.from({ length: 4 }, () =>
        Array.from({ length: ROOM_INNER_WIDTH }, () => " "),
    );

    room.players.slice(0, PLAYER_POSITIONS.length).forEach((player, index) => {
        const [row, column] = PLAYER_POSITIONS[index];
        const isHolder =
            room.isStart &&
            room.bombHolder !== undefined &&
            room.bombHolder === index;
        rows[row][column] = isHolder
            ? colorize("■", ansi.cyan600)
            : colorize("■", ansi.slate300);
    });

    const playerRows = rows.map(
        (row) => border("│") + row.join("") + border("│"),
    );

    const status =
        room.players.length === 0
            ? "empty"
            : room.isStart
              ? `${room.players.length} players Playing`
              : `${room.players.length} players`;
    const statusLine =
        border("│") +
        colorize(
            padVisible(` ${status}`, ROOM_INNER_WIDTH),
            hasIssue ? ansi.red : ansi.slate500,
        ) +
        border("│");

    return [top, titleLine, ...playerRows, statusLine, bottom];
};

const renderRooms = () => {
    if (state.rooms.length === 0) {
        return colorize("No active rooms", ansi.slate500);
    }

    const gap = 3;
    const columns = process.stdout.columns ?? 100;
    const perRow = Math.max(
        1,
        Math.floor((columns + gap) / (ROOM_WIDTH + gap)),
    );
    const cards = state.rooms.map(renderRoomCard);
    const lines: string[] = [];

    for (let index = 0; index < cards.length; index += perRow) {
        const rowCards = cards.slice(index, index + perRow);
        for (let line = 0; line < rowCards[0].length; line += 1) {
            lines.push(
                rowCards.map((card) => card[line]).join(" ".repeat(gap)),
            );
        }
        if (index + perRow < cards.length) lines.push("");
    }

    return lines.join("\n");
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
                padVisible(relativeTime(event.at), 9),
                ansi.slate500,
            )} ${colorize(`${symbol} ${event.message}`, color)}`;
        })
        .join("\n");
};

const formatState = () => {
    const players = state.rooms.reduce(
        (total, room) => total + room.players.length,
        0,
    );
    const activeGames = state.rooms.filter((room) => room.isStart).length;

    return [
        logo(),
        "",
        `${pulseIndicator()}    ${colorize(
            `${players} player${players === 1 ? "" : "s"}   ${state.rooms.length} room${state.rooms.length === 1 ? "" : "s"}   ${activeGames} game${activeGames === 1 ? "" : "s"}`,
            ansi.cyan600,
        )}`,
        "",
        renderLatency(),
        "",
        colorize(
            `ROOMS ${"─".repeat(Math.min(process.stdout.columns ?? 67, 67))}`,
            ansi.sage500,
        ),
        "",
        renderRooms(),
        "",
        colorize(
            `ACTIVITY ${"─".repeat(Math.min(process.stdout.columns ?? 64, 64))}`,
            ansi.sage500,
        ),
        "",
        renderActivity(),
    ].join("\n");
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
        }, 240);
        animationTimer.unref();
    }

    if (isInteractive) renderState();
    logEvent("SERVER", `listening on :${port}`);
};
