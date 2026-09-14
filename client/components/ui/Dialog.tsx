import React, { useEffect } from "react";

type DialogProps = {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children?: React.ReactNode;
    className?: string;
    alignment?: "horizontal" | "vertical";
    size?: "large" | "small" | "middle";
};

export default function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    className = "",
    alignment = "horizontal",
    size = "small",
}: DialogProps) {
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, onClose]);

    useEffect(() => {
        if (!open) return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [open]);

    return (
        <div
            className={`fixed inset-0 z-4 flex items-center justify-center ${!open && "opacity-0 pointer-events-none scale-105"} transition-all duration-200 ease-out`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-describedby={description ? "dialog-description" : undefined}
        >
            <button
                type="button"
                aria-label="Close dialog"
                onClick={onClose}
                className={`absolute inset-0 cursor-default ${open && "bg-(--color-background-secondary)/50"} transition-all duration-200 ease-out`}
            />

            <div className="max-w-full w-full flex justify-center max-h-dvh p-4 overflow-scroll">
                <div
                    className={`relative z-8 w-full ${size === "middle" ? "max-w-md" : size === "large" ? "max-w-2xl" : "max-w-xs"} rounded-3xl bg-(--color-background) p-4 ${className}`}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex flex-col gap-2 pt-1 px-3">
                        <div
                            id="dialog-title"
                            className="text-lg font-bold text-(--color-foreground)"
                        >
                            {title}
                        </div>

                        {description && (
                            <div id="dialog-description">{description}</div>
                        )}
                    </div>

                    {children && (
                        <div
                            className={`mt-4 flex items-center justify-end gap-4 ${alignment === "vertical" && "flex-col"}`}
                        >
                            {children}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
