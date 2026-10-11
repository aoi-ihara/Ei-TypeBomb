"use client";

import { useState } from "react";

export const RetchedInput = ({
    value,
    onChange,
    placeholder,
    type,
    className,
    disabled,
    children,
    disableAnimation,
}: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    type?: "text" | "email" | "url" | "password";
    className?: string;
    disabled?: boolean;
    children?: React.ReactNode;
    disableAnimation?: boolean;
}) => {
    const [isFocused, setIsFocused] = useState(false);

    return (
        <div
            className={`relative transition-all duration-(--duration-etb) ease-etb`}
        >
            <input
                className={`w-full appearance-none outline-none px-5 py-4 rounded-lg shadow-[inset_0_0_0_1px_var(--color-border)] focus:shadow-[inset_0_0_0_2px_var(--color-foreground)] transition-shadow duration-(--duration-etb) ease-etb ${className ?? ""}`}
                value={value}
                onChange={onChange}
                type={type ?? "text"}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                disabled={disabled}
            />
            <span
                className={`absolute pointer-events-none text-foreground ${value || isFocused || disableAnimation ? "-top-3.5 bg-(--color-background) p-1 left-5 text-sm opacity-100" : "top-4 left-5 opacity-50"} transition-all duration-(--duration-etb) ease-etb`}
            >
                {placeholder}
            </span>
            {children}
        </div>
    );
};
