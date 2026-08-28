type ServerState = {
    rooms: number;
    players: number;
    games: number;
};

type EventContext = "ROOM" | "GAME" | "SERVER";

const isInteractive = Boolean(process.stdout.isTTY);
const recentEvents: { context: EventContext; message: string }[] = [];

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

const contextColor = (context: EventContext) => {
    if (context === "ROOM") return ansi.cyan;
    if (context === "GAME") return ansi.blue;
    return ansi.green;
};

const formatEvent = ({ context, message }: (typeof recentEvents)[number]) =>
    `${colorize(`[${context}]`, contextColor(context))} ${message}`;

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

    process.stdout.write("\x1b[H\x1b[0J");
    process.stdout.write(`${formatState()}\n\n`);
    process.stdout.write(`${colorize("Recent", ansi.blue)}\n`);
    process.stdout.write(
        recentEvents.length > 0
            ? recentEvents.map((event) => `> ${formatEvent(event)}`).join("\n")
            : "> Server ready",
    );
    process.stdout.write("\n");
};

export const setServerState = (nextState: ServerState) => {
    state = nextState;
    renderState();
};

export const logEvent = (context: EventContext, message: string) => {
    recentEvents.push({ context, message });
    if (recentEvents.length > 8) recentEvents.shift();

    if (isInteractive) {
        renderState();
        return;
    }

    console.log(`> [${context}] ${message}`);
};

export const logError = (message: string, error?: unknown) => {
    console.error(`${colorize("[ERROR]", ansi.red)} ${message}`);
    if (error) console.error(error);
};

export const startConsole = (port: number) => {
    renderState();
    logEvent("SERVER", `listening on :${port}`);
};
