type ServerState = {
    rooms: number;
    players: number;
    games: number;
};

const isInteractive = Boolean(process.stdout.isTTY);
const recentEvents: string[] = [];

let state: ServerState = {
    rooms: 0,
    players: 0,
    games: 0,
};

const ansi = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
};

const colorize = (text: string, color: string) =>
    isInteractive ? `${color}${text}${ansi.reset}` : text;

const colorEvent = (event: string) => {
    if (!isInteractive) return event;

    if (event.startsWith("[ROOM]")) return colorize(event, ansi.cyan);
    if (event.startsWith("[GAME]")) return colorize(event, ansi.blue);
    if (event.startsWith("[SERVER]")) return colorize(event, ansi.green);
    return event;
};

const formatState = () =>
    [
        "Ei-TypeBomb Server",
        "",
        colorize("● ONLINE", ansi.green),
        "",
        `${colorize("Rooms", ansi.cyan)}      ${state.rooms}`,
        `${colorize("Players", ansi.cyan)}    ${state.players}`,
        `${colorize("Games", ansi.cyan)}      ${state.games}`,
    ].join("\n");

const renderState = () => {
    if (!isInteractive) {
        console.log(
            `[STATE] rooms=${state.rooms} players=${state.players} games=${state.games}`,
        );
        return;
    }

    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(`${formatState()}\n\n`);
    process.stdout.write(`${colorize("Recent", ansi.blue)}\n`);
    process.stdout.write(
        recentEvents.length > 0
            ? recentEvents.map((event) => `> ${colorEvent(event)}`).join("\n")
            : "> Server ready",
    );
    process.stdout.write("\n");
};

export const setServerState = (nextState: ServerState) => {
    state = nextState;
    renderState();
};

export const logEvent = (
    context: "ROOM" | "GAME" | "SERVER",
    message: string,
) => {
    const event = `[${context}] ${message}`;
    recentEvents.push(event);
    if (recentEvents.length > 8) recentEvents.shift();

    if (isInteractive) {
        renderState();
        return;
    }

    console.log(`> ${event}`);
};

export const logError = (message: string, error?: unknown) => {
    console.error(`${colorize("[ERROR]", ansi.red)} ${message}`);
    if (error) console.error(error);
};

export const startConsole = (port: number) => {
    renderState();
    logEvent("SERVER", `listening on :${port}`);
};
