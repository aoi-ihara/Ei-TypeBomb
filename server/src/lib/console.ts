type ServerState = {
    rooms: number;
    players: number;
    games: number;
};

const isInteractive = Boolean(process.stdout.isTTY);

let state: ServerState = {
    rooms: 0,
    players: 0,
    games: 0,
};

const formatState = () =>
    [
        "",
        "Ei-TypeBomb Server",
        "",
        "● ONLINE",
        "",
        `Rooms      ${state.rooms}`,
        `Players    ${state.players}`,
        `Games      ${state.games}`,
        "",
    ].join("\n");

const renderState = () => {
    if (isInteractive) {
        process.stdout.write("\x1b[2J\x1b[H");
    }

    process.stdout.write(`${formatState()}[0m\n`);
};

export const setServerState = (nextState: ServerState) => {
    state = nextState;
    renderState();
};

export const logEvent = (context: "ROOM" | "GAME" | "SERVER", message: string) => {
    console.log(`> [${context}] ${message}`);
};

export const logError = (message: string, error?: unknown) => {
    console.error(`[ERROR] ${message}`);
    if (error) console.error(error);
};

export const startConsole = (port: number) => {
    renderState();
    logEvent("SERVER", `listening on :${port}`);
};
