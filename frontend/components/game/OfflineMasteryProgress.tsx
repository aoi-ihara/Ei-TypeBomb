import {
    MASTERY_RETRIEVABILITY_THRESHOLD,
    type MasteryProgress,
} from "@/lib/playground/memory";

export default function OfflineMasteryProgress({
    progress,
}: Readonly<{ progress: MasteryProgress }>) {
    const { total, masteredNow, masteredAfter24Hours } = progress;
    const currentPercent = total ? (masteredNow / total) * 100 : 0;
    const retainedPercent = total ? (masteredAfter24Hours / total) * 100 : 0;
    const thresholdPercent = Math.round(MASTERY_RETRIEVABILITY_THRESHOLD * 100);

    return (
        <div
            className="w-full min-w-60 max-w-lg px-1 flex flex-col gap-2"
            role="group"
            aria-label="オフライン学習の習得率"
        >
            <div className="flex justify-between items-baseline gap-4 text-sm">
                <span className="font-semibold">習得率</span>
                <span className="font-mono tabular-nums font-semibold">
                    {Math.round(currentPercent)}%
                </span>
            </div>
            <div
                className="flex w-full h-2.5 overflow-hidden rounded-full bg-(--color-border)"
                role="progressbar"
                aria-label="記憶率が閾値以上の単語の割合"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(currentPercent)}
                aria-valuetext={`${masteredNow} / ${total} 語を習得。うち ${masteredAfter24Hours} 語は24時間後も維持する予測`}
            >
                <div
                    className="bg-cyan-800 h-full transition-[width] duration-300"
                    style={{ width: `${retainedPercent}%` }}
                />
                <div
                    className="bg-cyan-400 h-full transition-[width] duration-300"
                    style={{ width: `${Math.max(0, currentPercent - retainedPercent)}%` }}
                />
            </div>
            <div className="flex justify-between gap-3 flex-wrap text-xs opacity-70">
                <span>
                    <span className="inline-block size-2 rounded-sm bg-cyan-400 mr-1" aria-hidden="true" />
                    現在 {thresholdPercent}%以上：{masteredNow}/{total}語
                </span>
                <span>
                    <span className="inline-block size-2 rounded-sm bg-cyan-800 mr-1" aria-hidden="true" />
                    24時間後も維持：{masteredAfter24Hours}語
                </span>
            </div>
        </div>
    );
}
