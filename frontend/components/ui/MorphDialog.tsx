"use client";

import {
    type ReactNode,
    useCallback,
    useEffect,
    useEffectEvent,
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
    const anchorRef = useRef<HTMLDivElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const id = useId();
    const closeFromKeyboard = useEffectEvent(() => onClose());
    const attachAnchor = useCallback((element: HTMLDivElement | null) => {
        anchorRef.current = element;
        setAnchor(element);
    }, []);

    useLayoutEffect(() => {
        if (!anchor || !dockRef.current) return;
        const element = anchorRef.current!;
        const dock = dockRef.current;
        let animation: Animation | undefined;
        let disposed = false;
        let focusFrame = 0;
        const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const syncWidth = () => {
            const rect = anchor.getBoundingClientRect();
            if (triggerRef.current)
                triggerRef.current.style.width = `${rect.width}px`;
            return {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            };
        };
        const showAnchor = () => {
            element.style.opacity = "1";
            element.inert = false;
            element.removeAttribute("aria-hidden");
            dock.style.opacity = "0";
            dock.inert = true;
        };
        const showMorph = () => {
            element.style.opacity = "0";
            element.inert = true;
            element.setAttribute("aria-hidden", "true");
            dock.style.opacity = "1";
            dock.inert = false;
        };
        const origin = syncWidth();
        const hadPosition = dock.style.left !== "";
        const from =
            dock.style.opacity === "0" || !hadPosition
                ? origin
                : {
                      x: parseFloat(getComputedStyle(dock).left),
                      y: parseFloat(getComputedStyle(dock).top),
                  };
        const to = open
            ? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
            : origin;
        dock.dataset.morphCursorX = String(to.x);
        dock.dataset.morphCursorY = String(to.y);
        dock.style.transition = "none";
        dock.style.left = `${to.x}px`;
        dock.style.top = `${to.y}px`;
        const finish = () => {
            if (disposed) return;
            animation = undefined;
            if (!open) {
                showAnchor();
                if (hadPosition) {
                    focusFrame = window.setTimeout(() => {
                        if (!disposed)
                            element
                                .querySelector<HTMLElement>(
                                    "button, a[href], [tabindex]",
                                )
                                ?.focus({ preventScroll: true });
                    }, 0);
                }
            }
            window.dispatchEvent(new Event("morphcursorchange"));
        };
        if (!open && !hadPosition) {
            showAnchor();
        } else {
            showMorph();
            const css = getComputedStyle(dock);
            const token =
                css.getPropertyValue("--duration-etb").trim() || "400ms";
            const duration =
                parseFloat(token) * (token.endsWith("ms") ? 1 : 1000);
            if (motion.matches || !Number.isFinite(duration) || duration <= 0)
                finish();
            else {
                animation = dock.animate(
                    [
                        { left: `${from.x}px`, top: `${from.y}px` },
                        { left: `${to.x}px`, top: `${to.y}px` },
                    ],
                    {
                        duration,
                        easing:
                            css.getPropertyValue("--ease-etb").trim() || "ease",
                    },
                );
                animation.onfinish = finish;
            }
        }
        window.dispatchEvent(new Event("morphcursorchange"));
        const resize = () => {
            syncWidth();
            if (open && !animation) {
                dock.style.left = `${window.innerWidth / 2}px`;
                dock.style.top = `${window.innerHeight / 2}px`;
                dock.dataset.morphCursorX = String(window.innerWidth / 2);
                dock.dataset.morphCursorY = String(window.innerHeight / 2);
                window.dispatchEvent(new Event("morphcursorchange"));
            }
        };
        const observer = new ResizeObserver(resize);
        observer.observe(anchor);
        window.addEventListener("resize", resize);
        return () => {
            disposed = true;
            window.clearTimeout(focusFrame);
            if (animation) {
                const css = getComputedStyle(dock);
                const left = css.left;
                const top = css.top;
                animation.cancel();
                dock.style.left = left;
                dock.style.top = top;
            }
            observer.disconnect();
            window.removeEventListener("resize", resize);
        };
    }, [anchor, open]);

    useEffect(() => {
        if (!anchor) return;
        if (!open) {
            return;
        }
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
                closeFromKeyboard();
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
    }, [anchor, open]);

    return (
        <>
            <div
                ref={attachAnchor}
                className="inline-block w-full shrink-0 align-middle :w-full"
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
