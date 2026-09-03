import React, { useId, useState } from "react";

type InputType = "text" | "email" | "url" | "password" | "number";

type BaseProps = {
    value: string;
    label?: string;
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

type TextInputProps = BaseProps & {
    variant?: "input";
    type?: InputType;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

type TextareaProps = BaseProps & {
    variant: "textarea";
    type?: never;
    onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
};

type InputProps = TextInputProps | TextareaProps;

export default function Input(props: InputProps) {
    const {
        value,
        label,
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
    } = props;

    const [isFocused, setIsFocused] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    const shouldFloat = alwaysFloatLabel || isFocused || value.length > 0;

    return (
        <div
            className={`relative flex flex-col transition-all duration-200 ease-out ${className} ${
                disabled ? "opacity-50" : ""
            }`}
        >
            {props.variant === "textarea" ? (
                <textarea
                    id={inputId}
                    name={name}
                    value={value}
                    onChange={props.onChange}
                    maxLength={max}
                    minLength={min}
                    disabled={disabled}
                    data-cursor={disabled ? "button" : "text"}
                    data-cursor-shape="2"
                    autoComplete={autoComplete}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    className={`w-full appearance-none rounded-lg px-5 py-4 outline-none shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow duration-200 ease-out focus:shadow-[inset_0_0_0_2px_var(--color-foreground)] ${font === "mono" ? "font-mono" : ""} ${inputClassName}`}
                />
            ) : (
                <input
                    id={inputId}
                    name={name}
                    type={props.type ?? "text"}
                    value={value}
                    onChange={props.onChange}
                    max={max}
                    min={min}
                    disabled={disabled}
                    data-cursor={disabled ? "button" : "text"}
                    data-cursor-shape="2"
                    autoComplete={autoComplete}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    className={`w-full appearance-none rounded-lg px-5 py-4 outline-none shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow duration-200 ease-out focus:shadow-[inset_0_0_0_2px_var(--color-foreground)] ${font === "mono" ? "font-mono" : ""} ${inputClassName}`}
                />
            )}

            {label && (
                <label
                    htmlFor={inputId}
                    className={`pointer-events-none whitespace-nowrap absolute text-(--color-foreground) transition-all duration-200 ease-out ${
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
