export function Keys({ keys }: { keys: string[] }) {
    return (
        <div className="flex gap-1">
            {keys.map((key) => (
                <div
                    key={key}
                    className="text-xs font-bold w-4 h-4 border rounded-sm border-(--color-border) bg-(--color-background) text-(--color-foreground) flex justify-center opacity-50 items-center ml-1"
                >
                    {key}
                </div>
            ))}
        </div>
    );
}
