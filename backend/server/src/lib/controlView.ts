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
}

const reset = "\x1b[0m";
const cyan = (text: string) => `\x1b[38;2;8;145;178m${text}${reset}`;
const highlight = (text: string) => `\x1b[48;5;238m\x1b[97m${text}${reset}`;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const sgr = /\x1b\[[0-9;]*m/g;
const logGuide = "↑/↓ scroll · PgUp/PgDn page · ←/→ pan · Home start · End/F follow · Esc/Q back";

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
    const footerRows = Math.min(rows, wrap(logGuide, columns).length);
    return Math.max(0, rows - footerRows - 2);
}

function logText(raw: string): string {
    try {
        const entry: unknown = JSON.parse(raw);
        if (entry && typeof entry === "object" && "message" in entry) {
            const record = entry as Record<string, unknown>;
            const timestamp = typeof record.timestamp === "string"
                ? record.timestamp.replace(/^\d{4}-(\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}).*$/, "$1 $2")
                : "";
            const level = typeof record.level === "string" ? record.level.padEnd(5) : "";
            return safe([timestamp, level, typeof record.message === "string" ? record.message : ""]
                .filter(Boolean).join(" "));
        }
    } catch { /* Malformed / non-JSON lines remain readable. */ }
    return safe(raw);
}

/** One-based menu hit targets; clipped rows are omitted. */
export function menuItemRows(columns: number, rows: number, selected = 0): number[] {
    if (columns < 1 || rows < 1) return [];
    const budget = Math.floor(rows) - wrap("↑/↓ or Tab move · Enter open · Esc back", Math.floor(columns)).length;
    if (budget < 4) return [0, 1, 2].map((index) => index === selected && budget > 0 ? Math.min(budget, 2) : -1);
    return [2, 3, 4];
}

export function renderControlView(model: ControlViewModel, columns: number, rows: number): string {
    const width = Number.isFinite(columns) ? Math.max(0, Math.floor(columns)) : 0;
    const height = Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 0;
    if (!width || !height) return "";
    const contentWidth = Math.min(width, 54);
    const editing = model.screen === "port" || model.screen === "width";
    const guide = editing ? `${model.focus === "cancel" ? "Enter cancel" : "Enter save"} · Esc cancel · Tab move`
        : model.screen === "logs" ? logGuide
        : "↑/↓ or Tab move · Enter open · Esc back";
    const footer = wrap(guide, width).slice(0, height);
    const budget = Math.max(0, height - footer.length);
    let body: string[] = [];
    if (model.screen === "menu") {
        const itemLines = [
            ["Port", String(model.port)],
            ["Logs", "View"],
            ["Terminal Width", String(model.width)],
        ].map(([name, value], index) => {
            const label = contentWidth < 22 && name === "Terminal Width" ? "Width" : name;
            const text = contentWidth < 22 ? `${label}: ${value}` : `${label.padEnd(14)}  ${value}`;
            return `${index === model.selected ? ">" : " "} ${index === model.selected ? highlight(text) : text}`;
        });
        body = budget < 4
            ? (budget > 1 ? [cyan("ETB Console · Controls"), itemLines[model.selected]] : [itemLines[model.selected]])
            : [cyan("ETB Console · Controls"), ...itemLines];
        if (model.selected === 0 && model.envOverride) {
            body.push(...wrap(`PORT override: listening on ${model.activePort}; saved ${model.port}.`, contentWidth));
        } else if (model.selected === 0 && model.activePort !== model.port) {
            body.push(...wrap(`Listening on ${model.activePort}. Restart to use ${model.port}.`, contentWidth));
        }
        if (model.notice) body.push(...wrap(model.notice, contentWidth));
    } else if (editing) {
        const port = model.screen === "port";
        const input = safe(model.editValue);
        const position = Math.max(0, Math.min(input.length, model.cursor));
        const caret = [...segmenter.segment(input)].find((part) =>
            position >= part.index && position < part.index + part.segment.length);
        const caretStart = caret?.index ?? input.length;
        const caretText = caret?.segment ?? " ";
        const field = model.focus && model.focus !== "field" ? input
            : model.selectAll ? highlight(input || " ")
            : input.slice(0, caretStart) + highlight(caretText) + input.slice(caretStart + (caret?.segment.length ?? 0));
        const value = /^\d+$/.test(input) ? Number(input) : NaN;
        const minimum = port ? 1 : 40;
        const maximum = port ? 65535 : 1000;
        const valid = Number.isInteger(value) && value >= minimum && value <= maximum;
        body = [cyan(port ? "Port" : "Terminal Width"), `  [ ${field} ]`];
        if (model.notice) body.push(...wrap(model.notice, contentWidth));
        else if (!valid) body.push(...wrap(`Enter a whole number from ${minimum} to ${maximum}.`, contentWidth));
        body.push(`Range: ${minimum}–${maximum}${port ? "" : " columns"}`);
        if (port && model.envOverride) {
            body.push(...wrap(`PORT override: listening on ${model.activePort}; saved ${model.port}.`, contentWidth));
        }
        if (!port && valid) {
            const effective = Math.min(model.terminalColumns ?? width, valid ? value : model.width);
            body.push(`Preview: ${effective} columns`,
                "─".repeat(Math.min(contentWidth, effective)));
        }
        body.push(["save", "cancel"].map((action) => {
            const label = action === "save" ? "Save" : "Cancel";
            return model.focus === action ? `> ${highlight(label)}` : `  ${label}`;
        }).join("    "));
    } else {
        const total = model.logLines.length;
        const capacity = logViewportSize(width, height);
        const start = model.logStatus ? 0 : model.followLogs ? Math.max(0, total - capacity)
            : Math.max(0, Math.min(Math.floor(model.logOffset) || 0, Math.max(0, total - capacity)));
        const end = Math.min(total, start + capacity);
        body = [cyan("ETB Console · Logs"),
            model.logStatus ? `${safe(model.logStatus)} · ${model.followLogs ? "Following" : "Paused"}` : `${total ? start + 1 : 0}–${end} of ${total} · ${model.followLogs ? "Following" : "Paused"}`,
            ...model.logLines.slice(start, end).map((raw) => {
                const text = logText(raw);
                const offset = Math.max(0, model.logHorizontal ?? 0);
                let skipped = 0;
                let used = 0;
                let visible = "";
                for (const { segment } of segmenter.segment(text)) {
                    const size = graphemeWidth(segment);
                    if (skipped < offset) { skipped += size; continue; }
                    if (used + size > width) break;
                    visible += segment;
                    used += size;
                }
                return visible.replace(/\b(ERROR|WARN)\b/g, (level) =>
                    `\x1b[${level === "ERROR" ? "31" : "33"}m${level}${reset}`);
            })];
        if (!total) body.push("No logs yet.");
    }
    const visible = body.slice(0, budget).map((line) => fitLine(line, model.screen === "logs" ? width : contentWidth));
    while (visible.length < budget) visible.push("");
    return [...visible, ...footer].map((line) => fitLine(line, width)).join("\n");
}
