import React, { useId, useState } from "react";

type InputType = "text" | "email" | "url" | "password" | "number";

type InputProps = {
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    label?: string;
    type?: InputType;
    disabled?: boolean;
    className?: string;
    inputClassName?: string;
    children?: React.ReactNode;
    alwaysFloatLabel?: boolean;
    name?: string;
    id?: string;
    autoComplete?: string;
    font?: "default" | "mono";
    disableLabelAnimation?: boolean;
    max?: number;
    min?: number;
};

export default function Input({
    value,
    onChange,
    label,
    type = "text",
    disabled = false,
    className = "w-full",
    inputClassName = "",
    children,
    alwaysFloatLabel = false,
    name,
    id,
    autoComplete,
    font,
    disableLabelAnimation,
    max,
    min,
}: InputProps) {
    const [isFocused, setIsFocused] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    const shouldFloat = alwaysFloatLabel || isFocused || value.length > 0;

    return (
        <div
            className={`relative transition-all duration-200 ease-out ${className}`}
        >
            <input
                id={inputId}
                name={name}
                type={type}
                value={value}
                onChange={onChange}
                max={max}
                min={min}
                data-cursor="text"
                disabled={disabled}
                autoComplete={autoComplete}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className={`w-full appearance-none rounded-lg px-5 py-4 outline-none shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow duration-200 ease-out focus:shadow-[inset_0_0_0_2px_var(--color-foreground)] ${font == "mono" && "font-mono"} ${inputClassName}`}
            />

            {label && (
                <label
                    htmlFor={inputId}
                    className={`pointer-events-none absolute text-(--color-foreground) transition-all duration-200 ease-out ${
                        shouldFloat || disableLabelAnimation
                            ? "-top-3.5 left-5 bg-(--color-background) p-1 text-sm opacity-100"
                            : "top-4 left-5 opacity-50"
                    }`}
                >
                    {label}
                </label>
            )}

            {children}
        </div>
    );
}
