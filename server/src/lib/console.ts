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

const formatState = () =>
    [
        "Ei-TypeBomb Server",
        "",
        "● ONLINE",
        "",
        `Rooms      ${state.rooms}`,
        `Players    ${state.players}`,
        `Games      ${state.games}`,
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
    process.stdout.write("Recent\n");
    process.stdout.write(
        recentEvents.length > 0
            ? recentEvents.map((event) => `> ${event}`).join("\n")
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
    console.error(`[ERROR] ${message}`);
    if (error) console.error(error);
};

export const startConsole = (port: number) => {
    renderState();
    logEvent("SERVER", `listening on :${port}`);
};
