import { RoutedSocket } from "../../../frontend/lib/room/routedSocket.ts";
import { io } from "../../server/node_modules/socket.io-client/build/esm/index.js";
window.boot = (config) => {
    const open = (target) => {
        if (!target.endsWith("/ws"))
            return io(target, {
                transports: ["websocket"],
                reconnection: false,
            });
        const handlers = new Map();
        const ws = new WebSocket(
            target.replace("http", "ws") + "/" + config.roomId,
        );
        const transport = {
            connected: false,
            on(event, fn) {
                const set = handlers.get(event) ?? [];
                set.push(fn);
                handlers.set(event, set);
                return this;
            },
            emit(event, data) {
                if (ws.readyState === 1)
                    ws.send(JSON.stringify({ event, data }));
                return this;
            },
            disconnect() {
                ws.close();
                this.connected = false;
            },
        };
        const dispatch = (event, data) =>
            (handlers.get(event) ?? []).forEach((fn) => fn(data));
        ws.onmessage = (message) => {
            const packet = JSON.parse(message.data);
            if (packet.event === "connect") {
                transport.connected = true;
                transport.id = packet.data.id;
            }
            dispatch(packet.event, packet.data);
        };
        ws.onclose = () => {
            transport.connected = false;
            dispatch("disconnect");
        };
        ws.onerror = () => dispatch("connect_error");
        return transport;
    };
    const socket = new RoutedSocket(
        config.urls,
        open,
        async () => config.jwtToken,
        () => true,
        async () => config.sessionToken,
    );
    window.gameSocket = socket;
    window.errors = [];
    window.authentications = 0;
    socket.on("auth:session", () => window.authentications++);
    socket.on("error", (error) => window.errors.push(error));
    socket.on("auth:request", () =>
        socket.emit("auth:response", {
            jwtToken: config.jwtToken,
            sessionToken: config.sessionToken,
            displayName: config.name,
        }),
    );
    socket.on("room:broadcast", (room) => {
        window.room = room;
        document.getElementById("state").textContent = JSON.stringify(room);
    });
};
