import { open, type FileHandle } from "node:fs/promises";

export type LogPage = { lines: string[]; offset: number; total: number; status: string };

/** Index byte boundaries instead of retaining log contents. Paused reads keep a snapshot. */
export class LogReader {
    private identity = "";
    private scanned = 0;
    private starts = [0];
    private endedWithNewline = true;

    private pending: Promise<unknown> = Promise.resolve();

    constructor(private readonly path: string) {}

    read(offset: number, count: number, follow: boolean): Promise<LogPage> {
        const result = this.pending.then(() => this.readPage(offset, count, follow));
        this.pending = result.catch(() => undefined);
        return result;
    }

    private async readPage(offset: number, count: number, follow: boolean): Promise<LogPage> {
        let fd: FileHandle | undefined;
        try {
            fd = await open(this.path, "r");
            const stat = await fd.stat();
            const identity = `${stat.dev}:${stat.ino}`;
            if (identity !== this.identity || stat.size < this.scanned) {
                this.identity = identity;
                this.scanned = 0;
                this.starts = [0];
                this.endedWithNewline = true;
            }
            if (follow || this.scanned === 0) await this.index(fd, stat.size);
            const total = this.starts.length - (this.endedWithNewline ? 1 : 0);
            const capacity = Math.max(0, Math.floor(count));
            const start = follow ? Math.max(0, total - capacity)
                : Math.max(0, Math.min(offset, Math.max(0, total - capacity)));
            const end = Math.min(total, start + capacity);
            const lines: string[] = [];
            for (let index = start; index < end; index++) {
                const from = this.starts[index];
                const to = this.starts[index + 1] ?? this.scanned;
                const length = Math.min(to - from, 256 * 1024);
                const buffer = Buffer.alloc(length);
                const { bytesRead: read } = await fd.read(buffer, 0, length, from);
                const text = buffer.subarray(0, read).toString("utf8").replace(/\r?\n$/, "");
                lines.push(text + (to - from > length ? " … [record truncated at 256 KiB]" : ""));
            }
            return { lines, offset: start, total, status: `${total ? start + 1 : 0}–${end} / ${total}` };
        } catch (error) {
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
            return { lines: [], offset: 0, total: 0,
                status: missing ? "No log file yet" : "Cannot read logs; check file permissions" };
        } finally { if (fd !== undefined) await fd.close(); }
    }

    private async index(fd: FileHandle, size: number) {
        const buffer = Buffer.alloc(64 * 1024);
        while (this.scanned < size) {
            const { bytesRead: read } = await fd.read(buffer, 0, Math.min(buffer.length, size - this.scanned), this.scanned);
            if (!read) break;
            for (let index = 0; index < read; index++) {
                if (buffer[index] === 10) this.starts.push(this.scanned + index + 1);
            }
            this.endedWithNewline = buffer[read - 1] === 10;
            this.scanned += read;
        }
    }
}
