"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Button from "./Button";
import { Icon } from "./Icon";
import Morph from "./Morph";

export type PickerProps = {
    name: string;
    items: string[];
    selection: number;
    onSelected: (index: number) => void;
    itemIcons: (string | null)[];
};

export default function Picker({
    name,
    items,
    selection,
    onSelected,
    itemIcons,
}: PickerProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const sizeRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const wasOpen = useRef(false);

    useLayoutEffect(() => {
        const element = sizeRef.current;
        if (!element) return;

        // Morph measures max-content layers, so both states need an explicit
        // width from the untransformed copy that follows the parent's width.
        const syncWidth = () => {
            const width = `${element.getBoundingClientRect().width}px`;
            for (const target of [triggerRef.current, menuRef.current]) {
                if (target) target.style.width = width;
            }
        };
        syncWidth();
        const observer = new ResizeObserver(syncWidth);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

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

    const label = items[selection] ?? name;
    const showIcon = !itemIcons.every((item) => item === null || item === "");

    return (
        <div
            className="relative inline-block shrink-0 w-full align-middle"
            data-picker
        >
            <div
                ref={sizeRef}
                className="invisible w-full"
                aria-hidden="true"
                inert
            >
                <Button
                    iconName="chevronsUpDown"
                    padding="large"
                    className="w-full"
                >
                    <span>{label}</span>
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
                className="pointer-events-none absolute left-0 top-0 w-full motion-reduce:transition-none!"
                style={{
                    zIndex: 4,
                    transition: `z-1 0s ${open ? "0s" : "var(--duration-etb, 400ms)"}`,
                }}
            >
                <Morph
                    state={open}
                    first={
                        <div ref={triggerRef} className="w-full">
                            <Button
                                iconName="chevronsUpDown"
                                className="w-full"
                                onClick={() => setOpen(true)}
                                aria-haspopup="menu"
                                padding="large"
                                alignment="left"
                                aria-expanded={open}
                                aria-controls={menuId}
                            >
                                <span>{label}</span>
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
                            className="flex h-fit flex-col overflow-y-auto rounded-2xl bg-(--color-background) p-1"
                        >
                            {items.map((item, index) => (
                                <div
                                    key={index}
                                    data-cursor="button"
                                    data-cursor-shape="1"
                                    className="rounded-xl"
                                >
                                    <button
                                        type="button"
                                        role="menuitem"
                                        tabIndex={-1}
                                        onClick={() => {
                                            setOpen(false);
                                            onSelected(index);
                                        }}
                                        className="ease-etb duration-(--duration-etb) active:scale-95 text-left font-bold cursor-pointer flex w-full min-w-0 gap-2 py-2 px-3"
                                    >
                                        {showIcon && (
                                            <div className="w-6 h-6 shrink-0">
                                                {itemIcons[index] && (
                                                    <Icon
                                                        name={itemIcons[index]}
                                                    />
                                                )}
                                            </div>
                                        )}
                                        <span className="min-w-0 wrap-any">
                                            {item}
                                        </span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    }
                />
            </div>
        </div>
    );
}
