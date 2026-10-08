import assert from "node:assert/strict";
import test from "node:test";
import { displayWidth, fitLine, menuItemRows, logViewportSize, renderControlView, layoutControlView, logHorizontalLimit, type ControlViewModel } from "../src/lib/controlView";

const model: ControlViewModel = {
    screen: "menu", selected: 0, port: 3001, activePort: 9000, envOverride: false,
    width: 120, editValue: "3001", cursor: 2, selectAll: false, notice: "",
    logLines: [], logOffset: 0, followLogs: true,
};
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

test("grapheme and ANSI clipping preserves whole characters and styles", () => {
    assert.equal(displayWidth("\x1b[36mA界e\u0301👩‍💻🇯🇵\x1b[0m"), 8);
    assert.equal(plain(fitLine("\x1b[36mA界e\u0301👩‍💻", 4)), "A界e\u0301");
    assert.equal(fitLine("界", 1), "");
    assert.equal(displayWidth("\u0301"), 0);
    assert.equal(fitLine("abc", 0), "");
    assert.equal(plain(fitLine("a\x1b[2Jb", 10)), "ab");
});

test("all screens fit terminal bounds, including tiny drawable heights", () => {
    for (const [columns, rows] of [[24, 10], [40, 12], [80, 24], [1, 1], [8, 2], [24, 4], [40, 6]]) {
        for (const screen of ["menu", "port", "width", "logs"] as const) {
            for (const selected of [0, 1, 2]) {
                for (const notice of ["", "Saved. Restart to apply the port.", "Enter a whole number from 1 to 65535."]) {
                    const frame = renderControlView({
                        ...model, screen, selected, notice, envOverride: true,
                        editValue: "999999", selectAll: selected === 1,
                        logLines: Array.from({ length: 30 }, (_, i) => `${i} 界e\u0301👩‍💻 `.repeat(20)),
                    }, columns, rows);
                    assert.ok(frame.split("\n").length <= rows);
                    for (const line of frame.split("\n")) assert.ok(displayWidth(line) <= columns);
                    assert.doesNotMatch(frame, /\x1b\[[0-9]*[HJ]/);
                }
            }
        }
    }
    assert.equal(renderControlView(model, 0, 10), "");
    assert.equal(renderControlView(model, 20, 0), "");
});

test("menu keeps aligned values and selected-only override detail", () => {
    const frame = plain(renderControlView({ ...model, envOverride: true }, 80, 24));
    assert.match(frame, /> Port {12}3001/);
    assert.match(frame, /PORT override: listening on 9000/);
    assert.doesNotMatch(frame, /CONFIGURATION|INPUT|Effect|Restart/);
    assert.doesNotMatch(plain(renderControlView({ ...model, envOverride: true, selected: 2 }, 80, 24)), /override/);
});

test("forms retain guides, validation, selection and width preview", () => {
    const frame = renderControlView({ ...model, screen: "width", editValue: "oops", selectAll: true }, 24, 10);
    assert.match(frame, /\x1b\[7moops/);
    assert.match(plain(frame), /whole number/);
    assert.match(plain(frame), /40–1000/);
    assert.doesNotMatch(plain(frame), /Preview:/);
    assert.match(plain(renderControlView({ ...model, screen: "width", editValue: "100" }, 24, 10)), /Preview: 24 characters/);
    assert.match(plain(frame), /Enter save · Esc cancel/);
    const port = plain(renderControlView({ ...model, screen: "port" }, 40, 12));
    assert.doesNotMatch(port, /Restart/);
    assert.match(plain(renderControlView({ ...model, screen: "port", notice: "Saved. Restart to apply." }, 40, 12)), /Saved. Restart/);
});

test("logs sanitize terminal commands and omit JSON metadata", () => {
    const logLines = [
        JSON.stringify({ timestamp: "12:00", level: "INFO", message: "hello", metadata: "secret" }),
        "broken \x1b[2J\x1b]0;bad title\x07text\r\x08",
        "before \x1b]0;hidden\x1b\\after",
    ];
    const frame = plain(renderControlView({ ...model, screen: "logs", logLines }, 80, 10));
    assert.match(frame, /12:00 INFO\s+hello/);
    assert.match(frame, /broken text/);
    assert.match(frame, /before after/);
    assert.doesNotMatch(frame, /secret|bad title|[\x00-\x09\x0b-\x1f]/);
    assert.match(frame, /LIVE · 1–3 of 3/);
    assert.match(plain(renderControlView({ ...model, screen: "logs", logLines, followLogs: false }, 40, 12)), /PAUSED/);
});

test("focus, horizontal logs and mouse rows reflect the rendered view", () => {
    const form = renderControlView({ ...model, screen: "port", focus: "cancel" }, 80, 24);
    assert.match(form, /> \x1b\[7mCancel/);
    assert.match(plain(form), /Enter cancel · Esc cancel/);
    assert.deepEqual(menuItemRows(80, 24), [2, 3, 4]);
    assert.deepEqual(menuItemRows(24, 4), [2, -1, -1]);
    const logs = plain(renderControlView({
        ...model, screen: "logs", logLines: ["界abcdef"], logHorizontal: 2,
        logStatus: "recent 128 KiB",
    }, 40, 12));
    assert.match(logs, /abcdef/);
    assert.doesNotMatch(logs, /界/);
    assert.match(logs, /recent 128 KiB/);
});

test("narrow menu preserves complete values and notices do not replace controls", () => {
    const frame = plain(renderControlView({
        ...model, selected: 2, notice: "Saved width 120. Applied now.",
    }, 24, 10));
    assert.match(frame, /Terminal Width\s+120/);
    assert.match(frame, /Saved width 120/);
    assert.match(frame, /Esc back/);
    const short = plain(renderControlView({ ...model, selected: 2 }, 24, 4));
    assert.match(short, /> Terminal Width\s+120/);
    assert.deepEqual(menuItemRows(24, 4, 2), [-1, -1, 2]);
});

test("width preview uses physical columns even when the saved maximum is smaller", () => {
    const frame = plain(renderControlView({
        ...model, screen: "width", width: 40, editValue: "100", terminalColumns: 80,
    }, 80, 12));
    assert.match(frame, /Preview: 80 characters/);
    assert.equal(displayWidth(frame.split("\n").find(line => line.endsWith("│"))!), 80);
});

test("logs retain supplied window positions and highlight severity without dropping records", () => {
    const frame = renderControlView({
        ...model, screen: "logs", followLogs: false, logOffset: 500,
        logStatus: "501–502 / 900", logLines: [
            JSON.stringify({ timestamp: "2026-10-08T12:00:00Z", level: "ERROR", message: "first" }),
            "second",
        ],
    }, 54, 12);
    assert.match(frame, /\x1b\[31mERROR/);
    assert.match(plain(frame), /10-08 12:00:00Z ERROR first/);
    assert.match(plain(frame), /PAUSED · 501–502 \/ 900/);
    assert.match(plain(frame), /second/);
});

test("shared log capacity preserves the newest record and every page at narrow widths", () => {
    const logs = Array.from({ length: 50 }, (_, i) => `record-${i}`);
    for (const [width, height] of [[16, 12], [24, 10], [40, 12], [80, 24]]) {
        const size = logViewportSize(width, height);
        assert.ok(size > 0);
        const tail = plain(renderControlView({ ...model, screen: "logs", logLines: logs }, width, height));
        assert.match(tail, /record-49/);
        for (let offset = 0; offset < logs.length; offset += size) {
            const window = logs.slice(offset, offset + size);
            const frame = plain(renderControlView({
                ...model, screen: "logs", logLines: window, logStatus: `${offset}`, followLogs: false,
            }, width, height));
            for (const record of window) assert.ok(frame.includes(record));
        }
    }
});

test("form focus shows exactly one highlighted target", () => {
    for (const focus of ["field", "save", "cancel"] as const) {
        const frame = renderControlView({ ...model, screen: "port", focus, selectAll: true }, 54, 12);
        assert.equal(frame.match(/\x1b\[7m/g)?.length, 1);
    }
});

test("saving at short heights preserves full feedback and undo before optional items", () => {
    const frame = plain(renderControlView({ ...model, notice: "Saved port 4000. Restart to apply.",
        port: 4000, undoConfig: { port: 3001, width: 200 } }, 24, 8));
    assert.match(frame, /Saved port 4000\./);
    assert.match(frame, /Restart\s+to apply\./);
    assert.match(frame, /Undo last change \(U\)/);
    assert.match(frame, /Esc back/);
});

test("mouse targets cover only visible controls, including forms, undo and log actions", () => {
    for (const screen of ["menu", "port", "width", "logs"] as const) {
        for (const [width, height] of [[24, 8], [80, 24], [8, 2]]) {
            const { frame, targets } = layoutControlView({ ...model, screen, undoConfig: { port: 1, width: 40 } }, width, height);
            const lines = frame.split("\n");
            for (const target of targets) {
                assert.ok(target.row >= 1 && target.row <= height);
                assert.ok(target.left >= 1 && target.right <= displayWidth(lines[target.row - 1]));
                assert.ok(target.left <= target.right);
            }
        }
    }
    const { targets } = layoutControlView({ ...model, screen: "port" }, 40, 12);
    assert.deepEqual(targets.map(target => target.action), ["field", "save", "cancel"]);
    const logs = layoutControlView({ ...model, screen: "logs", logFocus: "back" }, 24, 12);
    assert.deepEqual(logs.targets.map(target => target.action), ["follow", "back"]);
    assert.match(plain(logs.frame), /> Back/);
});


test("PORT overrides never claim a restart will apply the saved port", () => {
    const frame = plain(renderControlView({ ...model, envOverride: true, notice: "Saved port 4000. Restart to apply." }, 40, 12));
    assert.match(frame, /PORT still uses 9000/);
    assert.doesNotMatch(frame, /Restart to apply/);
});


test("log read errors explain recovery in the content area and horizontal movement is bounded", () => {
    const frame = plain(renderControlView({ ...model, screen: "logs", logStatus: "Cannot read logs; check file permissions" }, 24, 10));
    assert.match(frame, /check\s+file\s+permissions/);
    assert.equal(logHorizontalLimit(["short", "界".repeat(20)], 24), 16);
    assert.equal(logHorizontalLimit([], 24), 0);
});
