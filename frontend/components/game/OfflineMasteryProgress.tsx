import { type MasteryProgress } from "@/lib/playground/memory";

export default function OfflineMasteryProgress({
    progress,
}: Readonly<{ progress: MasteryProgress }>) {
    const { total, masteredNow, masteredAfter3Hours, masteredAfter24Hours } = progress;
    const currentPercent = total ? (masteredNow / total) * 100 : 0;
    const threeHourPercent = total ? (masteredAfter3Hours / total) * 100 : 0;
    const retainedPercent = total ? (masteredAfter24Hours / total) * 100 : 0;

    return (
        <div
            className="flex w-full h-2.5 overflow-hidden rounded-full bg-(--color-background-secondary)"
            role="progressbar"
            aria-label="記憶率が閾値以上の単語の割合"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(currentPercent)}
            aria-valuetext={`${masteredNow} / ${total} 語を現在習得。3時間後も ${masteredAfter3Hours} 語、24時間後も ${masteredAfter24Hours} 語は維持する予測`}
        >
            <div
                className="bg-cyan-600 h-full transition-[width] duration-300"
                style={{ width: `${retainedPercent}%` }}
            />
            <div
                className="bg-(--color-foreground) h-full transition-[width] duration-300"
                style={{
                    width: `${Math.max(0, threeHourPercent - retainedPercent)}%`,
                }}
            />
            <div
                className="bg-(--color-border) h-full transition-[width] duration-300"
                style={{
                    width: `${Math.max(0, currentPercent - threeHourPercent)}%`,
                }}
            />
        </div>
    );
}
