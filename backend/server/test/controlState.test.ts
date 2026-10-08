import { test } from "node:test";
import assert from "node:assert/strict";
import { ControlState } from "../src/lib/controlState";
import { TerminalInput } from "../src/lib/terminalInput";

const setup = (fail = false) => {
    let config = { port: 3001, width: 200 };
    const controls = new ControlState(() => config, next => {
        if (fail) return false;
        config = next;
        return true;
    });
    const keys = (...values: string[]) => values.forEach(key => controls.key(key, 10));
    return { controls, keys, config: () => config };
};

test("Port can be replaced directly, saved and cancelled without changing the running port", () => {
    const { controls, keys, config } = setup();
    keys("c", "\r", ..."4000", "\r");
    assert.equal(config().port, 4000);
    assert.equal(controls.screen, "menu");
    assert.match(controls.notice, /Restart/);
    keys("\r", ..."9999", "\x1b");
    assert.equal(config().port, 4000);
    assert.equal(controls.screen, "menu");
    keys("\x1b");
    assert.equal(controls.screen, "dashboard");
});

test("Tab, Shift-Tab, form actions, cursor and delete follow consistent focus rules", () => {
    const { controls, keys, config } = setup();
    keys("C", "\t", "\t", "\r");
    assert.equal(controls.screen, "width");
    keys("\x1b[H", "\x1b[3~", "1");
    assert.equal(controls.editValue, "100");
    keys("\t");
    assert.equal(controls.focus, "save");
    keys("\r");
    assert.equal(config().width, 100);
    keys("\r", "\x1b[Z", "\r");
    assert.equal(controls.screen, "menu");
});

test("Validation and failed persistence keep the editor and preserve saved settings", () => {
    const { controls, keys, config } = setup(true);
    keys("c", "\r", ..."abc", "\r");
    assert.equal(controls.screen, "port");
    assert.match(controls.notice, /1 to 65535/);
    keys(..."5000", "\r");
    assert.equal(controls.editValue, "5000");
    assert.match(controls.notice, /Not saved/);
    assert.equal(config().port, 3001);
    keys("\x1b");
    assert.equal(controls.screen, "menu");
});

test("Logs pause, scroll, resume and return to the menu instead of unexpectedly leaving it", () => {
    const { controls, keys } = setup();
    keys("c", "\t", "\r", "\x1b[A");
    assert.equal(controls.screen, "logs");
    assert.equal(controls.followLogs, false);
    keys("\x1b[6~", "\x1b[C");
    assert.equal(controls.logOffset, 10);
    assert.equal(controls.logHorizontal, 8);
    keys("f", "q");
    assert.equal(controls.followLogs, true);
    assert.equal(controls.screen, "menu");
    assert.equal(controls.selected, 1);
});

test("Input decodes split arrows, batched keys, application keys and SGR mouse", () => {
    const result: string[] = [];
    const decoder = new TerminalInput(key => result.push(key));
    decoder.push("c\x1b");
    decoder.push("[");
    decoder.push("B\t\r\x1bOD\x1b[<0;10;");
    decoder.push("4M");
    assert.deepEqual(result, ["c", "\x1b[B", "\t", "\r", "\x1b[D", "\x1b[<0;10;4M"]);
    decoder.dispose();
});

test("Unbound Alt keys, OSC replies and legacy mouse payloads never execute text commands", () => {
    const result: string[] = [];
    const decoder = new TerminalInput(key => result.push(key));
    decoder.push("\x1bc\x1bq\x1b]title;");
    decoder.push("c\r\x1b\\\x1b[M");
    decoder.push("cqrc");
    assert.deepEqual(result, ["c"]);
    decoder.dispose();
});

test("Standalone Escape resolves but truncated unknown keys do not navigate", async () => {
    const result: string[] = [];
    const decoder = new TerminalInput(key => result.push(key));
    decoder.push("\x1b");
    await new Promise(resolve => setTimeout(resolve, 110));
    assert.deepEqual(result, ["\x1b"]);
    decoder.push("\x1b[");
    await new Promise(resolve => setTimeout(resolve, 110));
    assert.deepEqual(result, ["\x1b"]);
    decoder.dispose();
});
