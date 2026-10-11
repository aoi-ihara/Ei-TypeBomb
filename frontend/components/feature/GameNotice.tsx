import { Icon, type IconName } from "@/components/ui/Icon";

export type GameNoticeProps = {
    visible: boolean;
    iconName: IconName;
    title: string;
    description: string;
};

export default function GameNotice({
    visible,
    iconName,
    title,
    description,
}: Readonly<GameNoticeProps>) {
    return (
        <div
            className={`${!visible && "opacity-0 scale-95 blur-md"} transition-all duration-(--duration-etb) ease-etb fixed top-4 right-4 flex items-center gap-4 w-94 rounded-2xl bg-(--color-background-secondary) text-(--color-foreground) py-3 px-4`}
            role="status"
            aria-live="polite"
            aria-hidden={!visible}
        >
            <div className="shrink-0">
                <Icon name={iconName} />
            </div>
            <div
                className="flex flex-col"
                data-cursor={visible ? "text" : undefined}
            >
                <span className="font-bold">{title}</span>
                {description}
            </div>
        </div>
    );
}
