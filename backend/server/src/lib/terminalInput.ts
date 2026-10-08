/**
 * Decode stream chunks, not individual data events. A standalone Escape needs
 * a brief timeout because it is also the prefix of every terminal key.
 */
export class TerminalInput {
    private pending = "";
    private timer: NodeJS.Timeout | undefined;
    constructor(private readonly emit: (key: string) => void) {}

    push(chunk: string) {
        this.pending += chunk;
        if (this.timer) clearTimeout(this.timer);
        while (this.pending) {
            if (this.pending[0] !== "\x1b") {
                const char = [...this.pending][0];
                this.pending = this.pending.slice(char.length);
                this.emit(char);
                continue;
            }
            if (/^\x1b[\]P^_]/.test(this.pending)) {
                const terminator = this.pending.match(/\x07|\x1b\\/);
                if (!terminator) { this.deferEscape(); break; }
                this.pending = this.pending.slice(terminator.index! + terminator[0].length);
                continue;
            }
            // Legacy mouse responses contain three trailing coordinate bytes.
            if (this.pending.startsWith("\x1b[M")) {
                if (this.pending.length < 6) { this.deferEscape(); break; }
                this.pending = this.pending.slice(6);
                continue;
            }
            // CSI (including SGR mouse), SS3 (application cursor keys).
            const sequence = this.pending.match(/^\x1b(?:\[[0-?]*[ -/]*[@-~]|O[@-~])/);
            if (sequence) {
                const key = sequence[0];
                this.pending = this.pending.slice(key.length);
                this.emit(key.replace(/^\x1bO([ABCDHF])$/, "\x1b[$1")
                    .replace(/^\x1b\[(?:1|7)~$/, "\x1b[H")
                    .replace(/^\x1b\[(?:4|8)~$/, "\x1b[F"));
                continue;
            }
            if (this.pending.length > 1 && !/^\x1b(?:\[[0-?]*[ -/]*|O)?$/.test(this.pending)) {
                // Unbound Alt keys are ignored as a unit, not ordinary commands.
                const suffix = [...this.pending.slice(1)][0];
                this.pending = this.pending.slice(1 + suffix.length);
                continue;
            }
            this.deferEscape();
            break;
        }
    }

    private deferEscape() {
        this.timer = setTimeout(() => {
            const escapeOnly = this.pending === "\x1b";
            this.pending = "";
            if (escapeOnly) this.emit("\x1b");
        }, 80);
    }

    dispose() {
        if (this.timer) clearTimeout(this.timer);
        this.pending = "";
    }
}
