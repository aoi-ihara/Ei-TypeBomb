import { capturePostHogEvent } from "./posthog";
import { capturePostHogLog } from "./posthogLogs";
import { logErrorToFile, logToFile } from "./fileLogger";
import { existsSync, openSync, closeSync, fstatSync, readSync } from "fs";
import { resolve } from "path";
import { renameSync, writeFileSync } from "fs";

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

const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
const configPath = resolve(__dirname, "../../console.config.json");
const logPath = resolve(__dirname, "../../logs/server.log");
const defaultConfig = { port: 3001, width: 120 };
let config = { ...defaultConfig };
try {
    const value = JSON.parse(require("fs").readFileSync(configPath, "utf8"));
    if (Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535) config.port = value.port;
    if (Number.isInteger(value.width) && value.width >= 40 && value.width <= 1000) config.width = value.width;
} catch {}
const consoleColumns = () => Math.max(40, Math.min(config.width, process.stdout.columns ?? 100));
export const getConfiguredPort = () => {
    const env = process.env.PORT;
    if (env !== undefined && /^\d+$/.test(env) && Number(env) >= 1 && Number(env) <= 65535) return Number(env);
    return config.port;
};
let activePort = 3001;
let screen: "dashboard" | "menu" | "port" | "width" | "logs" = "dashboard";
let selected = 0;
let editValue = "";
let notice = "";
let logOffset = 0;
let followLogs = true;
const saveConfig = () => {
    try {
        const temp = `${configPath}.tmp`;
        writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
        renameSync(temp, configPath);
        return true;
    } catch { return false; }
};
const drawControl = () => {
    if (!isInteractive) return;
    process.stdout.write("\x1b[H\x1b[J");
    const width = Math.max(40, Math.min(config.width, process.stdout.columns ?? 100));
    const title = screen === "menu" ? "CONTROL MENU" : screen === "logs" ? "VIEW LOGS" : `EDIT ${screen.toUpperCase()}`;
    const lines = [colorize(title, ansi.cyan600)];
    if (screen === "menu") {
        const envPort = process.env.PORT !== undefined;
        const items = [`Port: ${activePort}${envPort ? ` (PORT override; saved ${config.port})` : ""}`, "View Logs", `Terminal Width: ${config.width}`];
        lines.push("", ...items.map((item, i) => `${i === selected ? "> " : "  "}${item}`), "", notice || "↑/↓ select  Enter open/edit  Esc back");
    } else if (screen === "port" || screen === "width") {
        lines.push("", `Value: ${editValue}`, "", notice || "Enter save  Esc cancel");
    } else {
        const tail = readLogTail(Math.max(1, process.stdout.rows - 4));
        lines.push("", ...tail, "", `${followLogs ? "Following" : "Paused"}  ↑/↓ scroll  PgUp/PgDn  Home/End  Q/Esc back`);
    }
    process.stdout.write(lines.map((line) => line.length > width ? `${line.slice(0, width)}` : line).join("\n") + "\n");
};
const readLogTail = (count: number) => {
    try {
        if (!existsSync(logPath)) return ["No log file found."];
        const fd = openSync(logPath, "r");
        try {
            const size = fstatSync(fd).size;
            const bytes = Math.min(size, 128 * 1024);
            const buffer = Buffer.alloc(bytes);
            readSync(fd, buffer, 0, bytes, size - bytes);
            const lines = buffer.toString("utf8").split("\n").filter(Boolean);
            if (followLogs) logOffset = Math.max(0, lines.length - count);
            return lines.slice(logOffset, logOffset + count).map((line) => line.length > 300 ? `${line.slice(0, 300)}…` : line);
        } finally { closeSync(fd); }
    } catch { return ["Unable to read log file safely."]; }
};
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
    return { symbol: "•", color: ansi.white };
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
    const columns = consoleColumns();
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
            `ROOMS ${"─".repeat(Math.min(consoleColumns(), 67))}`,
            ansi.sage500,
        ),
        "",
        renderRooms(),
        "",
        colorize(
            `ACTIVITY ${"─".repeat(Math.min(consoleColumns(), 64))}`,
            ansi.sage500,
        ),
        "",
        renderActivity(),
    ].join("\n");
};

const renderState = () => {
    renderScheduled = false;

    if (!isInteractive) return;

    if (screen !== "dashboard") { drawControl(); return; }
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
    activePort = port;
    if (isInteractive && !animationTimer) {
        animationTimer = setInterval(() => {
            for (const [roomId, expiresAt] of roomIssues) {
                if (expiresAt <= Date.now()) roomIssues.delete(roomId);
            }
            scheduleRender();
        }, 240);
        animationTimer.unref();
    }

    if (isInteractive) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        let inputBuffer = "";
        let escapeTimer: NodeJS.Timeout | undefined;
        const handleKey = (key: string) => {
            if (key === "\u0003") { process.stdin.setRawMode(false); process.exit(130); }
            if (screen === "dashboard") { if (key.toLowerCase() === "c") { screen = "menu"; drawControl(); } return; }
            if (screen === "menu") {
                if (key === "\u001b[A") selected = (selected + 2) % 3;
                else if (key === "\u001b[B") selected = (selected + 1) % 3;
                else if (key === "\u001b") { screen = "dashboard"; renderState(); return; }
                else if (key === "\r") {
                    if (selected === 1) { screen = "logs"; followLogs = true; }
                    else { screen = selected === 0 ? "port" : "width"; editValue = String(selected === 0 ? config.port : config.width); notice = ""; }
                }
                drawControl(); return;
            }
            if (screen === "port" || screen === "width") {
                if (key === "\u001b") { screen = "menu"; notice = ""; }
                else if (key === "\r") {
                    const n = Number(editValue);
                    const valid = Number.isInteger(n) && (screen === "port" ? n >= 1 && n <= 65535 : n >= 40 && n <= 1000);
                    if (!valid) notice = "Invalid value.";
                    else {
                        if (screen === "port") config.port = n; else config.width = n;
                        notice = saveConfig() ? (screen === "port" ? "Saved. Restart required." : "Saved.") : "Could not save setting.";
                        screen = "menu";
                    }
                } else if (key === "\u007f") editValue = editValue.slice(0, -1);
                else if (/^[0-9]$/.test(key)) editValue += key;
                drawControl(); return;
            }
            if (screen === "logs") {
                if (key.toLowerCase() === "q" || key === "\u001b") { screen = "dashboard"; renderState(); return; }
                if (key === "\u001b[A") { followLogs = false; logOffset = Math.max(0, logOffset - 1); }
                else if (key === "\u001b[B") { followLogs = false; logOffset += 1; }
                else if (key === "\u001b[5~") { followLogs = false; logOffset = Math.max(0, logOffset - 15); }
                else if (key === "\u001b[6~") { followLogs = false; logOffset += 15; }
                else if (key === "\u001b[H") { followLogs = false; logOffset = 0; }
                else if (key === "\u001b[F") followLogs = true;
                drawControl();
            }
        };
        process.stdin.on("data", (data: Buffer) => {
            inputBuffer += data.toString();
            // Escape sequences can arrive in separate chunks. Delay a lone ESC
            // so arrows and other terminal keys are not mistaken for "back".
            if (inputBuffer === "\u001b") {
                if (escapeTimer) clearTimeout(escapeTimer);
                escapeTimer = setTimeout(() => {
                    if (inputBuffer === "\u001b") {
                        inputBuffer = "";
                        handleKey("\u001b");
                    }
                }, 35);
                return;
            }
            if (escapeTimer) clearTimeout(escapeTimer);
            const sequences = [
                "\u001b[A", "\u001b[B", "\u001b[5~", "\u001b[6~",
                "\u001b[H", "\u001b[F", "\u001bOH", "\u001bOF",
            ];
            while (inputBuffer) {
                const sequence = sequences.find((candidate) => inputBuffer.startsWith(candidate));
                if (sequence) {
                    inputBuffer = inputBuffer.slice(sequence.length);
                    handleKey(sequence === "\u001bOH" ? "\u001b[H" : sequence === "\u001bOF" ? "\u001b[F" : sequence);
                    continue;
                }
                if (inputBuffer.startsWith("\u001b") && inputBuffer.length > 1) {
                    if (sequences.some((candidate) => candidate.startsWith(inputBuffer))) break;
                    // Unknown escape sequence: discard it rather than treating
                    // its trailing bytes as menu commands.
                    inputBuffer = inputBuffer.slice(1);
                    continue;
                }
                const char = String.fromCodePoint(inputBuffer.codePointAt(0)!);
                if (char.length > 1 && inputBuffer.length === 1) break;
                inputBuffer = inputBuffer.slice(char.length);
                handleKey(char);
            }
        });
        const restoreTerminal = () => {
            if (escapeTimer) clearTimeout(escapeTimer);
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
        };
        process.on("exit", restoreTerminal);
        process.on("SIGINT", () => { restoreTerminal(); process.exit(130); });
        process.on("SIGTERM", () => { restoreTerminal(); process.exit(143); });
        process.stdout.on("resize", () => screen === "dashboard" ? renderState() : drawControl());
        renderState();
    }
    logEvent("SERVER", `listening on :${port}`);
};
