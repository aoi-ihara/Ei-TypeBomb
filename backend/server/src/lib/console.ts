import { capturePostHogEvent } from "./posthog";
import { capturePostHogLog } from "./posthogLogs";
import { logErrorToFile, logToFile } from "./fileLogger";
import { resolve } from "path";
import { renameSync, writeFileSync } from "fs";
import { ControlState, type ConsoleConfig } from "./controlState";
import { TerminalInput } from "./terminalInput";
import { layoutControlView, fitLine, logViewportSize, logHorizontalLimit, type HitTarget } from "./controlView";
import { LogReader } from "./logReader";

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
const consoleColumns = () => Math.max(1, Math.min(config.width, process.stdout.columns ?? 100));
const readPortOverride = () => {
    const env = process.env.PORT;
    if (env !== undefined && /^\d+$/.test(env) && Number(env) >= 1 && Number(env) <= 65535) return Number(env);
    return undefined;
};
export const getConfiguredPort = () => readPortOverride() ?? config.port;
let activePort = 3001;
const saveConfig = (next: ConsoleConfig) => {
    try {
        const temp = `${configPath}.tmp`;
        writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        renameSync(temp, configPath);
        config = next;
        return true;
    } catch { return false; }
};
const controls = new ControlState(() => config, saveConfig);
let lastFrame = "";
const writeFrame = (frame: string) => {
    if (frame === lastFrame) return;
    lastFrame = frame;
    // Clear each changed frame in the same write; never draw an empty frame.
    process.stdout.write(`\x1b[?25l\x1b[H${frame.split("\n").map(line => `\x1b[2K${line}`).join("\r\n")}\x1b[J`);
};
let controlTargets: HitTarget[] = [];
let targetScreen = controls.screen;
const logReader = new LogReader(logPath);
const controlColumns = () => controls.screen === "logs" ? consoleColumns() : Math.max(1, process.stdout.columns ?? 100);
let renderRevision = 0;
const drawControl = async (revision: number) => {
    if (!isInteractive || controls.screen === "dashboard") return;
    const rows = Math.max(1, (process.stdout.rows ?? 24) - 1);
    const columns = controlColumns();
    if (controls.screen === "logs" && targetScreen !== "logs") {
        const loading = layoutControlView({ ...controls, screen: "logs", ...config, activePort,
            envOverride: readPortOverride() !== undefined, logLines: [], logStatus: "Loading logs…" }, columns, rows);
        controlTargets = loading.targets;
        targetScreen = "logs";
        writeFrame(loading.frame);
    }
    const page = controls.screen === "logs"
        ? await logReader.read(controls.logOffset, logViewportSize(columns, rows), controls.followLogs) : undefined;
    if (revision !== renderRevision) return;
    if (page) {
        controls.logOffset = page.offset;
        controls.logHorizontal = Math.min(controls.logHorizontal, logHorizontalLimit(page.lines, columns));
    }
    const { frame, targets } = layoutControlView({
        ...controls, screen: controls.screen, ...config, activePort,
        envOverride: readPortOverride() !== undefined,
        logLines: page?.lines ?? [], logStatus: page?.status, terminalColumns: process.stdout.columns ?? 100,
    }, columns, rows);
    controlTargets = targets;
    targetScreen = controls.screen;
    writeFrame(frame);
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

    const revision = ++renderRevision;
    if (controls.screen !== "dashboard") { void drawControl(revision); return; }
    const rows = Math.max(1, (process.stdout.rows ?? 24) - 1);
    const dashboard = formatState().split("\n").slice(0, Math.max(0, rows - 1));
    dashboard.push("[ Control Menu ]  Enter / Tab / C");
    writeFrame(dashboard.map((line) => fitLine(line, consoleColumns())).join("\n"));
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
        const previousRaw = Boolean(process.stdin.isRaw);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdout.write("\x1b[?1049h\x1b[?25l");
        let mouseEnabled = false;
        const syncMouse = () => {
            const enabled = process.env.TERM !== "dumb";
            if (enabled === mouseEnabled) return;
            mouseEnabled = enabled;
            process.stdout.write(enabled ? "\x1b[?1000h\x1b[?1006h" : "\x1b[?1000l\x1b[?1006l");
        };
        let restored = false;
        const restoreTerminal = () => {
            if (restored) return;
            restored = true;
            decoder.dispose();
            if (animationTimer) clearInterval(animationTimer);
            try { process.stdin.setRawMode(previousRaw); } catch {
                // stdin may already be closed during exception/signal teardown.
            } finally {
                try { process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?1049l"); } catch {}
            }
        };
        const handleKey = (key: string) => {
            if (key === "\x03") { restoreTerminal(); process.exit(130); }
            const mouse = key.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
            if (mouse) {
                const x = Number(mouse[2]), y = Number(mouse[3]);
                if (mouse[4] === "M" && mouse[1] === "0") {
                    if (controls.screen === "dashboard") {
                        const footerRow = Math.min(formatState().split("\n").length + 1, Math.max(1, (process.stdout.rows ?? 24) - 1));
                        if (y === footerRow && x <= Math.min(consoleColumns(), 16)) controls.key("c", 1);
                    } else if (targetScreen === controls.screen) {
                        const action = controlTargets.find(target => target.row === y && x >= target.left && x <= target.right)?.action;
                        if (action === "port" || action === "logs" || action === "width") {
                            controls.selected = ["port", "logs", "width"].indexOf(action);
                            controls.openSelected();
                        } else if (action === "field") {
                            controls.focus = "field";
                            controls.selectAll = false;
                            controls.cursor = Math.max(0, Math.min(controls.editValue.length, x - 5));
                        } else if (action === "save" || action === "cancel") {
                            controls.focus = action;
                            controls.key("\r", 1);
                        } else if (action === "undo") controls.key("u", 1);
                        else if (action === "follow" || action === "back") {
                            controls.logFocus = action;
                            controls.key("\r", 1);
                        }
                    }
                } else if (controls.screen === "logs" && mouse[4] === "M" && (mouse[1] === "64" || mouse[1] === "65")) {
                    controls.key(mouse[1] === "64" ? "\x1b[A" : "\x1b[B", 1);
                }
            } else {
                controls.key(key, Math.max(1, logViewportSize(controlColumns(), Math.max(1, (process.stdout.rows ?? 24) - 1))));
            }
            syncMouse();
            renderState();
        };
        const decoder = new TerminalInput(handleKey);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (data: string) => decoder.push(data));
        process.on("exit", restoreTerminal);
        process.on("uncaughtExceptionMonitor", restoreTerminal);
        process.on("SIGINT", () => { restoreTerminal(); process.exit(130); });
        process.on("SIGTERM", () => { restoreTerminal(); process.exit(143); });
        process.stdout.on("resize", () => { lastFrame = ""; renderState(); });
        syncMouse();
        renderState();
    }
    logEvent("SERVER", `listening on :${port}`);
};
