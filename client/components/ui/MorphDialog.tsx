"use client";

import {
    type ReactNode,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import Morph from "./Morph";

export type MorphDialogProps = {
    open: boolean;
    onClose: () => void;
    title: string;
    button: ReactNode;
    description?: string;
    children?: ReactNode;
    className?: string;
    alignment?: "horizontal" | "vertical";
    size?: "large" | "small" | "middle";
};

export default function MorphDialog({
    open,
    onClose,
    title,
    button,
    description,
    children,
    className = "",
    alignment = "horizontal",
    size = "small",
}: MorphDialogProps) {
    const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(false);
    const id = useId();

    useLayoutEffect(() => {
        if (!anchor || !dockRef.current) return;
        const dock = dockRef.current;
        const place = () => {
            const rect = anchor.getBoundingClientRect();
            if (triggerRef.current) {
                triggerRef.current.style.width = `${rect.width}px`;
            }
            dock.style.left = `${open ? window.innerWidth / 2 : rect.left + rect.width / 2}px`;
            dock.style.top = `${open ? window.innerHeight / 2 : rect.top + rect.height / 2}px`;
        };
        place();
        dock.getBoundingClientRect();
        dock.style.transition =
            "left var(--duration-etb, 400ms) var(--ease-etb, ease), top var(--duration-etb, 400ms) var(--ease-etb, ease)";
        const observer = new ResizeObserver(place);
        observer.observe(anchor);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [anchor, open]);

    useEffect(() => {
        if (!anchor) return;
        if (!open) {
            if (wasOpen.current) {
                triggerRef.current
                    ?.querySelector<HTMLElement>("button, a[href], [tabindex]")
                    ?.focus({ preventScroll: true });
            }
            wasOpen.current = false;
            return;
        }
        wasOpen.current = true;
        const dialog = dialogRef.current;
        const focusable = () =>
            Array.from(
                dialog?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
                ) ?? [],
            ).filter(
                (element) =>
                    !element.closest("[inert]") &&
                    element.getClientRects().length > 0,
            );
        (focusable()[0] ?? dialog)?.focus({ preventScroll: true });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
            if (event.key === "Tab") {
                const elements = focusable();
                const index = elements.indexOf(
                    document.activeElement as HTMLElement,
                );
                if (!elements.length) {
                    event.preventDefault();
                    dialog?.focus();
                } else if (
                    event.shiftKey
                        ? index <= 0
                        : index === elements.length - 1 || index === -1
                ) {
                    event.preventDefault();
                    elements[event.shiftKey ? elements.length - 1 : 0].focus();
                }
            }
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [anchor, open, onClose]);

    return (
        <>
            <div
                ref={setAnchor}
                className="inline-block w-full shrink-0 align-middle :w-full"
                style={{ visibility: anchor ? "hidden" : "visible" }}
                aria-hidden={anchor ? true : undefined}
                inert={!!anchor}
            >
                {button}
            </div>
            {anchor &&
                createPortal(
                    <div
                        className="pointer-events-none fixed inset-0 z-50"
                        data-morph-dialog
                    >
                        <button
                            type="button"
                            aria-label="ダイアログを閉じる"
                            tabIndex={-1}
                            aria-hidden="true"
                            onClick={onClose}
                            className="pointer-events-auto absolute inset-0 cursor-default bg-(--color-background-secondary)/50 motion-reduce:transition-none!"
                            style={{
                                opacity: open ? 1 : 0,
                                visibility: open ? "visible" : "hidden",
                                transition: `opacity var(--duration-etb, 400ms) var(--ease-etb, ease), visibility 0s ${open ? "0s" : "var(--duration-etb, 400ms)"}`,
                            }}
                        />
                        <div
                            ref={dockRef}
                            className="absolute flex h-0 w-0 items-center justify-center motion-reduce:transition-none!"
                        >
                            <Morph
                                state={open}
                                first={
                                    <div
                                        ref={triggerRef}
                                        className=":w-full"
                                        style={{
                                            width: anchor.getBoundingClientRect()
                                                .width,
                                        }}
                                    >
                                        {button}
                                    </div>
                                }
                                last={
                                    <div
                                        ref={dialogRef}
                                        role="dialog"
                                        aria-modal="true"
                                        aria-labelledby={`${id}-title`}
                                        aria-describedby={
                                            description
                                                ? `${id}-description`
                                                : undefined
                                        }
                                        tabIndex={-1}
                                        className={`max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-3xl bg-(--color-background) p-4 outline-none ${size === "middle" ? "w-md" : size === "large" ? "w-2xl" : "w-xs"} ${className}`}
                                    >
                                        <div className="flex flex-col gap-2 px-3 pt-1">
                                            <div
                                                id={`${id}-title`}
                                                className="text-lg font-bold text-(--color-foreground)"
                                                data-cursor="text"
                                            >
                                                {title}
                                            </div>
                                            {description && (
                                                <div id={`${id}-description`}>
                                                    {description}
                                                </div>
                                            )}
                                        </div>
                                        {children && (
                                            <div
                                                className={`mt-4 flex items-center justify-end gap-4 ${alignment === "vertical" ? "flex-col" : ""}`}
                                            >
                                                {children}
                                            </div>
                                        )}
                                    </div>
                                }
                            />
                        </div>
                    </div>,
                    anchor.ownerDocument.body,
                )}
        </>
    );
}
