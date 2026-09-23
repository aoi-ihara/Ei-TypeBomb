"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "./Button";
import { Icon } from "./Icon";
import Morph from "./Morph";

export type PickerProps = {
    name: string;
    items: string[];
    onSelected: (index: number) => void;
    itemIcons: (string | null)[];
};

export default function Picker({
    name,
    items,
    onSelected,
    itemIcons,
}: PickerProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        if (!open) {
            if (wasOpen.current)
                triggerRef.current?.querySelector("button")?.focus();
            wasOpen.current = false;
            return;
        }
        wasOpen.current = true;
        const menu = menuRef.current;
        (
            menu?.querySelector<HTMLButtonElement>("[role=menuitem]") ?? menu
        )?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
            }
            if (
                !["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(
                    event.key,
                )
            )
                return;
            const buttons = Array.from(
                menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ??
                    [],
            );
            event.preventDefault();
            if (!buttons.length) return;
            const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
            );
            const next =
                event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index +
                            (event.key === "ArrowUp" ||
                            (event.key === "Tab" && event.shiftKey)
                                ? -1
                                : 1) +
                            buttons.length) %
                        buttons.length;
            buttons[next].focus();
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    return (
        <div
            className="relative inline-block shrink-0 align-middle"
            data-picker
        >
            {/* Only the trigger's natural size occupies document flow. */}
            <div className="invisible" aria-hidden="true" inert>
                <Button iconName="chevronsUpDown">
                    <span>{name}</span>
                </Button>
            </div>
            <button
                type="button"
                aria-label="ピッカーを閉じる"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-1 cursor-default bg-(--color-background-secondary)/50 motion-reduce:transition-none!"
                style={{
                    visibility: open ? "visible" : "hidden",
                    opacity: open ? 1 : 0,
                    transition: `opacity var(--duration-etb, 400ms) var(--ease-etb, ease), visibility 0s ${open ? "0s" : "var(--duration-etb, 400ms)"}`,
                }}
            />
            <div
                className="pointer-events-none absolute left-0 top-0 motion-reduce:transition-none!"
                style={{
                    zIndex: open ? 50 : 0,
                    transition: `z-1 0s ${open ? "0s" : "var(--duration-etb, 400ms)"}`,
                }}
            >
                <Morph
                    state={open}
                    first={
                        <div ref={triggerRef}>
                            <Button
                                iconName="chevronsUpDown"
                                onClick={() => setOpen(true)}
                                aria-haspopup="menu"
                                aria-expanded={open}
                                aria-controls={menuId}
                            >
                                <span>{name}</span>
                            </Button>
                        </div>
                    }
                    last={
                        <div
                            ref={menuRef}
                            id={menuId}
                            role="menu"
                            aria-label={name}
                            tabIndex={-1}
                            className="flex max-h-[min(24rem,80dvh)] w-max max-w-[calc(100vw-2rem)] flex-col gap-1 overflow-y-auto rounded-2xl bg-(--color-background) p-2"
                        >
                            {items.length === 0 && (
                                <div className="px-3 py-2 text-sm opacity-60">
                                    項目がありません
                                </div>
                            )}
                            {items.map((item, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    role="menuitem"
                                    tabIndex={-1}
                                    onClick={() => {
                                        setOpen(false);
                                        onSelected(index);
                                    }}
                                    className="flex items-center gap-3 rounded-lg px-4 py-3 text-left font-bold hover:bg-(--color-background-secondary) focus-visible:bg-(--color-background-secondary) focus-visible:outline-none"
                                >
                                    {itemIcons[index] && (
                                        <Icon
                                            name={itemIcons[index]}
                                            className="shrink-0"
                                        />
                                    )}
                                    <span className="min-w-0">{item}</span>
                                </button>
                            ))}
                        </div>
                    }
                />
            </div>
        </div>
    );
}
