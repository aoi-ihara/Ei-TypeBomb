export type ConsoleConfig = { port: number; width: number };
export type Screen = "dashboard" | "menu" | "port" | "width" | "logs";

/** Presentation state only: no sockets, server lifecycle or terminal I/O. */
export class ControlState {
    screen: Screen = "dashboard";
    selected = 0;
    editValue = "";
    cursor = 0;
    selectAll = false;
    focus: "field" | "save" | "cancel" = "field";
    notice = "";
    logOffset = 0;
    logHorizontal = 0;
    followLogs = true;
    logFocus: "follow" | "back" = "follow";
    undoConfig: ConsoleConfig | undefined;

    constructor(
        private readonly currentConfig: () => ConsoleConfig,
        private readonly save: (next: ConsoleConfig) => boolean,
    ) {}

    openSelected() {
        if (this.selected === 3) { this.undo(); return; }
        this.notice = "";
        if (this.selected === 1) {
            this.screen = "logs";
            this.followLogs = true;
            this.logHorizontal = 0;
            this.logFocus = "follow";
            return;
        }
        this.screen = this.selected === 0 ? "port" : "width";
        const config = this.currentConfig();
        this.editValue = String(this.selected === 0 ? config.port : config.width);
        this.cursor = this.editValue.length;
        this.selectAll = true;
        this.focus = "field";
    }

    private undo() {
        if (!this.undoConfig) return;
        if (this.save(this.undoConfig)) {
            this.undoConfig = undefined;
            if (this.selected === 3) this.selected = 0;
            this.notice = "Change undone. Previous settings restored.";
        } else this.notice = "Not undone. Check file permissions; press U to retry.";
    }

    key(key: string, pageSize: number) {
        const enter = key === "\r" || key === "\n";
        if (this.screen === "dashboard") {
            if (key.toLowerCase() === "c" || enter || key === "\t") this.screen = "menu";
            return;
        }
        if (this.screen === "menu") {
            const count = this.undoConfig ? 4 : 3;
            if (key === "\x1b[A" || key === "\x1b[Z") this.selected = (this.selected + count - 1) % count;
            else if (key === "\x1b[B" || key === "\t") this.selected = (this.selected + 1) % count;
            else if (key === "\x1b") this.screen = "dashboard";
            else if (enter) this.openSelected();
            else if (key.toLowerCase() === "u") this.undo();
            return;
        }
        if (this.screen === "logs") {
            if (key === "\t" || key === "\x1b[Z") {
                this.logFocus = this.logFocus === "follow" ? "back" : "follow";
                return;
            }
            if (key.toLowerCase() === "q" || key === "\x1b" || (enter && this.logFocus === "back")) { this.screen = "menu"; return; }
            if (enter) { this.followLogs = true; return; }
            if (key === "\x1b[F" || key.toLowerCase() === "f") this.followLogs = true;
            else if (key === "\x1b[H") { this.followLogs = false; this.logOffset = 0; }
            else if (key === "\x1b[A" || key === "\x1b[5~") {
                this.followLogs = false;
                this.logOffset = Math.max(0, this.logOffset - (key === "\x1b[A" ? 1 : pageSize));
            } else if (key === "\x1b[B" || key === "\x1b[6~") {
                this.followLogs = false;
                this.logOffset += key === "\x1b[B" ? 1 : pageSize;
            } else if (key === "\x1b[D") this.logHorizontal = Math.max(0, this.logHorizontal - 8);
            else if (key === "\x1b[C") this.logHorizontal += 8;
            return;
        }
        if (key === "\x1b" || (enter && this.focus === "cancel")) {
            this.screen = "menu"; this.notice = ""; return;
        }
        if (key === "\t" || key === "\x1b[Z" || key === "\x1b[A" || key === "\x1b[B") {
            const focuses = ["field", "save", "cancel"] as const;
            this.focus = focuses[(focuses.indexOf(this.focus) + (key === "\t" || key === "\x1b[B" ? 1 : 2)) % 3];
            return;
        }
        if (enter) {
            const isPort = this.screen === "port";
            const value = Number(this.editValue);
            const [min, max] = isPort ? [1, 65535] : [40, 1000];
            if (!/^\d+$/.test(this.editValue) || value < min || value > max) {
                this.notice = `Enter a whole number from ${min} to ${max}.`;
                this.focus = "field"; this.selectAll = true; return;
            }
            const config = this.currentConfig();
            const next = { ...config, [isPort ? "port" : "width"]: value };
            if (!this.save(next)) {
                this.notice = "Not saved. Check file permissions and try again.";
                return;
            }
            if (value !== (isPort ? config.port : config.width)) this.undoConfig = { ...config };
            this.screen = "menu";
            this.notice = isPort ? `Saved port ${value}. Restart to apply.` : `Saved width ${value}. Applied now.`;
            return;
        }
        if (this.focus !== "field") return;
        if (key === "\x1b[D" || key === "\x1b[C" || key === "\x1b[H" || key === "\x1b[F") {
            const selected = this.selectAll;
            this.selectAll = false;
            if (key === "\x1b[D") this.cursor = selected ? 0 : Math.max(0, this.cursor - 1);
            if (key === "\x1b[C") this.cursor = selected ? this.editValue.length : Math.min(this.editValue.length, this.cursor + 1);
            if (key === "\x1b[H") this.cursor = 0;
            if (key === "\x1b[F") this.cursor = this.editValue.length;
            return;
        }
        const backspace = key === "\x7f" || key === "\b";
        const deletion = key === "\x1b[3~";
        if (!backspace && !deletion && !/^[\x20-\x7e]$/.test(key)) return;
        if (this.selectAll) { this.editValue = ""; this.cursor = 0; this.selectAll = false; }
        if (backspace && this.cursor > 0) {
            this.editValue = this.editValue.slice(0, this.cursor - 1) + this.editValue.slice(this.cursor);
            this.cursor--;
        } else if (deletion) {
            this.editValue = this.editValue.slice(0, this.cursor) + this.editValue.slice(this.cursor + 1);
        } else if (!backspace && this.editValue.length < 12) {
            this.editValue = this.editValue.slice(0, this.cursor) + key + this.editValue.slice(this.cursor);
            this.cursor++;
        }
        this.notice = "";
    }
}
