type Props = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
};

export default function Toggle({ checked, onChange, className = "" }: Props) {
    return (
        <div
            data-cursor="button"
            className={`rounded-full flex ${className}`}
        >
            <button
                type="button"
                aria-pressed={checked}
                className={`w-16 ${checked ? "bg-cyan-600" : "bg-(--color-background-secondary)"} h-8 rounded-full p-1 transition-all duration-200 ease-out active:scale-95 cursor-pointer`}
                onClick={() => onChange(!checked)}
            >
                <div
                    className={`h-6 w-8 rounded-full bg-(--color-foreground) ${checked ? "ml-6" : ""} transition-all duration-200 ease-out`}
                />
            </button>
        </div>
    );
}
