/** Pure terminal view: the caller owns input, state, clearing and positioning. */
export interface ControlViewModel {
    screen: "menu" | "port" | "width" | "logs";
    selected: number;
    port: number;
    activePort: number;
    envOverride: boolean;
    width: number;
    editValue: string;
    cursor: number;
    selectAll: boolean;
    notice: string;
    logLines: string[];
    logOffset: number;
    followLogs: boolean;
    focus?: "field" | "save" | "cancel";
    logStatus?: string;
    logHorizontal?: number;
    terminalColumns?: number;
    undoConfig?: { port: number; width: number };
    logFocus?: "follow" | "back";
}

const reset = "\x1b[0m";
const cyan = (text: string) => `\x1b[1m${text}${reset}`;
const highlight = (text: string) => `\x1b[7m${text}${reset}`;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const sgr = /\x1b\[[0-9;]*m/g;
function guides(screen: ControlViewModel["screen"], columns: number, rows: number, cancel = false): string[] {
    const primary = screen === "menu" ? "Enter open · Esc back"
        : screen === "logs" ? "↑/↓ scroll · Esc back" : `Enter ${cancel ? "cancel" : "save"} · Esc cancel`;
    const secondary = screen === "menu" ? "↑/↓ or Tab move"
        : screen === "logs" ? "F latest · ←/→ pan" : "Tab focus · ←/→ edit";
    const extra = "Tab focus · Enter choose · PgUp/PgDn page · Home start";
    const available = Math.max(0, rows - (screen === "logs" ? 3 : 2));
    const lines = wrap(primary, columns);
    if (rows >= 7) lines.push(...wrap(secondary, columns));
    if (screen === "logs" && rows >= 12) lines.push(...wrap(extra, columns));
    return lines.slice(0, Math.min(available, Math.max(1, Math.floor(rows / 3))));
}

/** Only SGR styling is allowed through; terminal commands and controls are removed. */
function safe(text: string, styles = false): string {
    return text
        .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, "")
        .replace(/\x1b[P^_][\s\S]*?(?:\x1b\\|$)/g, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (code) =>
            styles && /^\x1b\[[0-9;]*m$/.test(code) ? code : "")
        .replace(/\x1b[ -/]*[@-Z\\-_]/g, "")
        .replace(/[\x00-\x1f\x7f-\x9f]/g, (char) =>
            styles && char === "\x1b" ? char : "")
        .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

function graphemeWidth(text: string): number {
    if (/^[\p{Mark}\u200d\u200b\ufe0e\ufe0f]+$/u.test(text)) return 0;
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return 2;
    const cp = text.codePointAt(0) ?? 0;
    return cp >= 0x1100 && (
        cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f) ||
        (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x20000 && cp <= 0x3fffd)
    ) ? 2 : 1;
}

export function displayWidth(str: string): number {
    return [...segmenter.segment(safe(str).replace(sgr, ""))]
        .reduce((sum, part) => sum + graphemeWidth(part.segment), 0);
}

/** Clip at grapheme boundaries, retain complete SGR sequences, close any styling. */
export function fitLine(str: string, width: number): string {
    const limit = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    let result = "";
    let used = 0;
    let styled = false;
    for (const token of safe(str, true).split(/(\x1b\[[0-9;]*m)/)) {
        if (/^\x1b\[[0-9;]*m$/.test(token)) {
            result += token;
            styled = true;
            continue;
        }
        for (const { segment } of segmenter.segment(token)) {
            const size = graphemeWidth(segment);
            if (used + size > limit) return result + (styled ? reset : "");
            result += segment;
            used += size;
        }
    }
    return result + (styled ? reset : "");
}

function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of safe(text).split(" ")) {
        if (line && displayWidth(`${line} ${word}`) > width) {
            lines.push(fitLine(line, width));
            line = "";
        }
        line += (line ? " " : "") + word;
    }
    if (line) lines.push(fitLine(line, width));
    return lines;
}

/** Fetching, page movement and rendering share this viewport calculation. */
export function logViewportSize(columns: number, rows: number): number {
    if (columns < 1 || rows < 1) return 0;
    const footerRows = guides("logs", columns, rows).length;
    return Math.max(0, rows - footerRows - 2);
}

function logText(raw: string): string {
    try {
        const entry: unknown = JSON.parse(raw);
        if (entry && typeof entry === "object" && "message" in entry) {
            const record = entry as Record<string, unknown>;
            const timestamp = typeof record.timestamp === "string"
                ? record.timestamp.replace(/^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/, "$1 $2Z")
                : "";
            const level = typeof record.level === "string" ? record.level.padEnd(5) : "";
            return safe([timestamp, level, typeof record.message === "string" ? record.message : ""]
                .filter(Boolean).join(" "));
        }
    } catch { /* Malformed / non-JSON lines remain readable. */ }
    return safe(raw);
}

export function logHorizontalLimit(lines: string[], columns: number): number {
    return Math.max(0, ...lines.map(line => displayWidth(logText(line)) - columns));
}

export type ControlAction = "port" | "logs" | "width" | "field" | "save" | "cancel" | "undo" | "follow" | "back";
export type HitTarget = { action: ControlAction; row: number; left: number; right: number };

/** Rendering and mouse input share the same clipped, one-based hit targets. */
export function layoutControlView(model: ControlViewModel, columns: number, rows: number): { frame: string; targets: HitTarget[] } {
    const width = Number.isFinite(columns) ? Math.max(0, Math.floor(columns)) : 0;
    const height = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
    if (!width || !height) return { frame: "", targets: [] };
    const contentWidth = Math.min(width, 54);
    const editing = model.screen === "port" || model.screen === "width";
    const footer = guides(model.screen, model.screen === "logs" ? width : contentWidth, height, model.focus === "cancel");
    const budget = height - footer.length;
    const body: string[] = [];
    const targets: HitTarget[] = [];
    const add = (text: string, action?: ControlAction, limit = contentWidth) => {
        if (body.length >= budget) return;
        const line = fitLine(text, limit);
        body.push(line);
        if (action && displayWidth(line)) targets.push({ action, row: body.length, left: 1, right: displayWidth(line) });
    };
    const paragraph = (text: string) => wrap(text, contentWidth).forEach(line => add(line));
    const button = (label: string, focused: boolean) => focused ? `> ${highlight(label)}` : `  ${label}`;
    if (model.screen === "menu") {
        const detailRows = (model.notice ? wrap(model.notice, contentWidth).length : 0) + (model.undoConfig ? 1 : 0);
        const compact = budget < 4 + detailRows;
        if (budget >= (compact ? 2 + detailRows : 4)) add(cyan("Control Menu"));
        const items = [["Port", String(model.port), "port"], ["Logs", "View", "logs"],
            ["Terminal Width", String(model.width), "width"]] as const;
        items.forEach(([name, value, action], index) => {
            if (compact && index !== model.selected) return;
            const label = contentWidth < 22 && name === "Terminal Width" ? "Width" : name;
            const text = contentWidth < 22 ? `${label}: ${value}` : `${label.padEnd(14)}  ${value}`;
            add(index === model.selected ? `> ${highlight(text)}` : `  ${text}`, action);
        });
        if (model.notice) {
            const notice = model.envOverride && /^Saved port \d+\./.test(model.notice)
                ? model.notice.replace(/Restart to apply\./, `PORT still uses ${model.activePort}.`)
                : model.notice;
            paragraph(notice);
        }
        if (model.undoConfig) add(button("Undo last change (U)", model.selected === 3), "undo");
        const portDetail = model.selected !== 0 ? "" : model.envOverride
            ? `PORT override: listening on ${model.activePort}; saved ${model.port}.`
            : model.activePort !== model.port ? /^Saved port/.test(model.notice)
                ? `Currently listening on ${model.activePort}.`
                : `Listening on ${model.activePort}. Restart to use ${model.port}.` : "";
        if (portDetail && wrap(portDetail, contentWidth).length <= budget - body.length) paragraph(portDetail);
    } else if (editing) {
        const port = model.screen === "port";
        const input = safe(model.editValue);
        const position = Math.max(0, Math.min(input.length, model.cursor));
        const caret = [...segmenter.segment(input)].find(part => position >= part.index && position < part.index + part.segment.length);
        const caretStart = caret?.index ?? input.length;
        const caretText = caret?.segment ?? " ";
        const focused = !model.focus || model.focus === "field";
        const field = !focused ? input : model.selectAll ? highlight(input || " ")
            : input.slice(0, caretStart) + highlight(caretText) + input.slice(caretStart + (caret?.segment.length ?? 0));
        const value = /^\d+$/.test(input) ? Number(input) : NaN;
        const minimum = port ? 1 : 40;
        const maximum = port ? 65535 : 1000;
        const valid = Number.isInteger(value) && value >= minimum && value <= maximum;
        add(cyan(port ? "Port" : "Terminal Width"));
        add(`${focused ? ">" : " "} [ ${field} ]${port ? "" : " characters"}`, "field");
        // Correction and persistence feedback take priority over optional detail.
        if (model.notice) paragraph(model.notice);
        else if (!valid) paragraph(`Use a whole number: ${minimum}–${maximum}.`);
        if (valid) paragraph(`${minimum}–${maximum}${port ? "" : " characters"}`);
        if (budget - body.length >= 2) {
            add(button("Save", model.focus === "save"), "save");
            add(button("Cancel", model.focus === "cancel"), "cancel");
        }
        if (port && model.envOverride) paragraph(`PORT override: listening on ${model.activePort}; saved ${model.port}.`);
        if (!port && valid && budget - body.length >= 2) {
            const effective = Math.max(1, Math.min(width, model.terminalColumns ?? width, value));
            paragraph(`Preview: ${effective} characters${effective < value ? " (terminal limit)" : ""}`);
            // A real sample reaches the requested physical width, independent of the old setting.
            const sample = "Rooms  2   Players  8   Server ready   ".repeat(Math.ceil(effective / 37));
            add(sample.slice(0, Math.max(0, effective - 1)) + "│", undefined, Math.min(width, effective));
        }
    } else {
        const total = model.logLines.length;
        const capacity = logViewportSize(width, height);
        const start = model.logStatus ? 0 : model.followLogs ? Math.max(0, total - capacity)
            : Math.max(0, Math.min(Math.floor(model.logOffset) || 0, Math.max(0, total - capacity)));
        const end = Math.min(total, start + capacity);
        const horizontal = model.logHorizontal ? ` · Col ${model.logHorizontal + 1}` : "";
        const followLabel = width < 40 ? "Follow" : "Follow latest";
        const title = `Logs  ${button(followLabel, (model.logFocus ?? "follow") === "follow")}   ${button("Back", model.logFocus === "back")}`;
        add(title, "follow", width);
        const backStart = 6 + displayWidth(button(followLabel, (model.logFocus ?? "follow") === "follow")) + 4;
        targets.splice(0, targets.length);
        if (width >= 7) targets.push({ action: "follow", row: 1, left: 7, right: Math.min(width, backStart - 4) });
        if (backStart <= width) targets.push({ action: "back", row: 1, left: backStart, right: Math.min(width, displayWidth(title)) });
        add(`${model.followLogs ? "LIVE" : "PAUSED"} · ${model.logStatus ?? `${total ? start + 1 : 0}–${end} of ${total}`}${horizontal}`, undefined, width);
        model.logLines.slice(start, end).forEach(raw => {
            const text = logText(raw);
            const offset = Math.max(0, model.logHorizontal ?? 0);
            let skipped = 0, used = 0, visible = "";
            let clipped = false;
            for (const { segment } of segmenter.segment(text)) {
                const size = graphemeWidth(segment);
                if (skipped < offset) { skipped += size; continue; }
                if (used + size > width) { clipped = true; break; }
                visible += segment;
                used += size;
            }
            if (clipped) visible = fitLine(visible, width - 1) + "…";
            add(visible.replace(/\b(ERROR|WARN)\b/g, level => `\x1b[${level === "ERROR" ? "31" : "33"}m${level}${reset}`), undefined, width);
        });
        if (!total) wrap(model.logStatus && !/^\d/.test(model.logStatus) ? model.logStatus : "No logs yet.", width)
            .forEach(line => add(line, undefined, width));
        while (body.length < budget) body.push("");
    }
    if (model.screen !== "logs" && body.length < budget) body.push("");
    return { frame: [...body, ...footer].join("\n"), targets };
}

export function renderControlView(model: ControlViewModel, columns: number, rows: number): string {
    return layoutControlView(model, columns, rows).frame;
}

export function menuItemRows(columns: number, rows: number, selected = 0): number[] {
    const { targets } = layoutControlView({ screen: "menu", selected, port: 3001, activePort: 3001,
        width: 200, envOverride: false, editValue: "", cursor: 0, selectAll: false, notice: "",
        logLines: [], logOffset: 0, followLogs: true }, columns, rows);
    return ["port", "logs", "width"].map(action => targets.find(target => target.action === action)?.row ?? -1);
}
