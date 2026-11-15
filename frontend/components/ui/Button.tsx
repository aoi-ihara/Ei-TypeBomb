"use client";

import React from "react";
import { IconName } from "./Icon";
import { Icon } from "./Icon";
import Link from "next/link";

type ButtonVariant = "default" | "primary" | "text" | "danger";

type ButtonProps = Pick<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-haspopup" | "aria-expanded" | "aria-controls" | "aria-label"
> & {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    onPointerDown?: React.MouseEventHandler<HTMLButtonElement>;
    onPointerUp?: React.MouseEventHandler<HTMLButtonElement>;
    onPointerCancel?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    loading?: boolean;
    loadingText?: string;
    className?: string;
    type?: "button" | "submit" | "reset";
    variant?: ButtonVariant;
    padding?: "xsmall" | "small" | "middle" | "large";
    iconName?: IconName;
    alignment?: "left" | "center";
    value?: string;
    name?: string;
    cursor?: "0" | "1" | "2";
    href?: string;
    prefetch?: boolean;
};

const baseStyles =
    "font-bold transition-all duration-(--duration-etb) ease-etb cursor-pointer";

const variantStyles = (
    variant: ButtonVariant,
    loading: boolean,
    disabled: boolean,
) => {
    return variant === "text"
        ? `w-full flex rounded-md active:scale-95`
        : variant === "default" || loading
          ? `w-full bg-(--color-background-secondary) text-(--color-foreground) flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all font-bold`
          : variant === "danger"
            ? `w-full bg-red-500/25 text-red-500 flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all font-bold`
            : `w-full bg-cyan-600 text-white flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all font-bold`;
};

export default function Button({
    children,
    onClick,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    disabled = false,
    loading = false,
    loadingText = "読み込み中…",
    className = "w-fit",
    type = "button",
    variant = "default",
    padding = variant === "text" ? "small" : "middle",
    iconName,
    alignment = "center",
    value,
    name,
    cursor = disabled || loading ? "2" : variant === "text" ? "1" : "0",
    href,
    prefetch,
    ...ariaProps
}: ButtonProps) {
    const currentVariantStyle = variantStyles(variant, loading, disabled);
    const paddingStyle =
        variant === "text" && padding === "xsmall"
            ? `gap-1 py-0.5 ${iconName && !loading ? "pl-0.5" : "pl-1.5"} ${children ? "pr-1.5" : "pr-0.5"}`
            : padding === "small"
              ? `rounded-lg ${iconName && !loading ? "pl-1.5" : "pl-2"} ${children ? "pr-2" : "pr-1.5"} py-1.5 gap-1`
              : padding === "middle"
                ? `rounded-lg ${iconName && !loading ? "pl-3" : "pl-4"} ${children ? "pr-4" : "pr-3"} py-3 gap-2`
                : `rounded-lg ${iconName && !loading ? "pl-4.5" : "pl-5"} ${children ? "pr-5" : "pr-4.5"} py-4.5 gap-2`;

    if (href) {
        return (
            <div
                className={`rounded-lg ${className}`}
                data-cursor="button"
                data-cursor-shape={cursor}
            >
                <Link
                    href={href}
                    prefetch={prefetch}
                    {...ariaProps}
                    type={type}
                    className={`${baseStyles} ${currentVariantStyle} ${paddingStyle} ${disabled && "opacity-50 pointer-events-none"} ${alignment === "left" ? "justify-start" : "justify-center"}`}
                >
                    {iconName && (!loading || !children) && (
                        <Icon
                            name={
                                loading && !children ? "loaderCircle" : iconName
                            }
                            className={
                                loading && !children
                                    ? "animate-spin"
                                    : undefined
                            }
                            size={24}
                        />
                    )}
                    {children && (
                        <div
                            className={`transition-all duration-(--duration-etb) ease-etb ${
                                loading ? "gradient-text w-fit" : ""
                            }`}
                        >
                            {loading ? loadingText : children}
                        </div>
                    )}
                </Link>
            </div>
        );
    }

    return (
        <div
            className={`rounded-lg ${className}`}
            data-cursor="button"
            data-cursor-shape={cursor}
        >
            <button
                {...ariaProps}
                type={type}
                onClick={onClick}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                disabled={disabled}
                value={value}
                name={name}
                className={`${baseStyles} ${currentVariantStyle} ${paddingStyle} ${disabled && "opacity-50 pointer-events-none"} ${alignment === "left" ? "justify-start" : "justify-center"}`}
            >
                {iconName && (!loading || !children) && (
                    <Icon
                        name={loading && !children ? "loaderCircle" : iconName}
                        className={
                            loading && !children ? "animate-spin" : undefined
                        }
                        size={24}
                    />
                )}
                {children && (
                    <div
                        className={`transition-all duration-(--duration-etb) ease-etb ${
                            loading ? "gradient-text w-fit" : ""
                        }`}
                    >
                        {loading ? loadingText : children}
                    </div>
                )}
            </button>
        </div>
    );
}
