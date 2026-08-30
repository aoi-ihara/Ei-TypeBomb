"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConsole = exports.logError = exports.logEvent = exports.setServerState = void 0;
const isInteractive = Boolean(process.stdout.isTTY);
const recentEvents = [];
let state = {
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
const colorize = (text, color) => isInteractive ? `${color}${text}${ansi.reset}` : text;
const contextColor = (context) => {
    if (context === "ROOM")
        return ansi.cyan;
    if (context === "GAME")
        return ansi.blue;
    return ansi.green;
};
const formatEvent = ({ context, message }) => `${colorize(`[${context}]`, contextColor(context))} ${message}`;
const bar = (value, width = 13) => {
    const filled = Math.min(value, width);
    return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};
const formatState = () => [
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
        console.log(`[STATE] rooms=${state.rooms} players=${state.players} games=${state.games}`);
        return;
    }
    process.stdout.write("\x1b[H\x1b[0J");
    process.stdout.write(`${formatState()}\n`);
    process.stdout.write(recentEvents.length > 0
        ? recentEvents
            .map((event) => `   > ${formatEvent(event)}`)
            .join("\n")
        : "       > Server ready");
    process.stdout.write("\n");
};
const scheduleRender = () => {
    if (renderScheduled)
        return;
    renderScheduled = true;
    setImmediate(renderState);
};
const setServerState = (nextState) => {
    state = nextState;
    if (isInteractive)
        scheduleRender();
    else
        renderState();
};
exports.setServerState = setServerState;
const logEvent = (context, message) => {
    if ((context === "SERVER" &&
        (message === "client connected" ||
            message === "client disconnected")) ||
        (context === "ROOM" && message.startsWith("authenticated "))) {
        return;
    }
    recentEvents.push({ context, message });
    if (recentEvents.length > 8)
        recentEvents.shift();
    if (isInteractive)
        scheduleRender();
    else
        console.log(`> [${context}] ${message}`);
};
exports.logEvent = logEvent;
const logError = (message, error) => {
    console.error(`${colorize("[ERROR]", ansi.red)} ${message}`);
    if (error)
        console.error(error);
};
exports.logError = logError;
const startConsole = (port) => {
    renderState();
    (0, exports.logEvent)("SERVER", `listening on :${port}`);
};
exports.startConsole = startConsole;
