// Keep the production Socket.IO/auth/game adapter intact; only PostgreSQL is fake.
const Module = require("node:module");
const originalLoad = Module._load;
Math.random = () => 0.5;
Module._load = function (name, parent, isMain) {
    if (name === "pg") {
        return {
            Pool: class {
                on() {}
                async query(_sql, parameters) {
                    await new Promise((resolve) => setTimeout(resolve, parameters?.[0] === "slow-auth" ? 250 : 100));
                    return { rows: [{
                        id: parameters?.[0] ?? "health",
                        max_players: 8,
                        game_duration: 1,
                        password: "never-broadcast",
                        items: [{ id: "item", type: "typed_recall", prompt: "猫", answer: "cat" }],
                    }] };
                }
            },
        };
    }
    return originalLoad.call(this, name, parent, isMain);
};
