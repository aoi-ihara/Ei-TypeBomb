import React, { useEffect, useRef } from "react";
import { IconName } from "./Icon";
import { Icon } from "./Icon";

type ButtonVariant = "default" | "primary" | "text" | "danger";

type ButtonProps = {
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    loading?: boolean;
    loadingText?: string;
    className?: string;
    type?: "button" | "submit" | "reset";
    variant?: ButtonVariant;
    padding?: "small" | "middle" | "large";
    iconName?: IconName;
    alignment?: "left" | "center";
};

const PLAY_AGAIN_AUTO_CLICK_DELAY_MS = 7_000;

const baseStyles =
    "font-bold transition-all duration-200 ease-out cursor-pointer";

const variantStyles = (
    variant: ButtonVariant,
    loading: boolean,
    disabled: boolean,
) => {
    return variant === "text"
        ? `${!loading && "underline"} w-fit flex rounded-md active:no-underline active:scale-95`
        : variant === "default" || loading
          ? `w-full bg-(--color-background-secondary) text-(--color-foreground) flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all duration-200 ease-out font-bold`
          : variant === "danger"
            ? `w-full bg-red-500/25 text-red-500 flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all duration-200 ease-out font-bold`
            : `w-full bg-cyan-600 text-white flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all duration-200 ease-out font-bold`;
};

export default function Button({
    children,
    onClick,
    disabled = false,
    loading = false,
    loadingText = "Loading…",
    className = "w-fit",
    type = "button",
    variant = "default",
    padding = "middle",
    iconName,
    alignment = "center",
}: ButtonProps) {
    const currentVariantStyle = variantStyles(variant, loading, disabled);
    const paddingStyle =
        variant === "text"
            ? `gap-1 ${iconName ? "pl-0 pr-1" : "px-1"}`
            : padding === "small"
              ? `rounded-lg ${iconName ? "pl-1.5" : "pl-2"} ${children ? "pr-2" : "pr-1.5"} py-1 gap-1`
              : padding === "middle"
                ? `rounded-lg ${iconName ? "pl-3.5" : "pl-4"} ${children ? "pr-4" : "pr-3.5"} py-3 gap-2`
                : `rounded-lg ${iconName ? "pl-4.5" : "pl-5"} ${children ? "pr-5" : "pr-4.5"} py-4 gap-3`;

    const autoPlayAgain = children === "Play Again";
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const autoPlayAgainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    useEffect(() => {
        if (!autoPlayAgain || disabled || loading) return;

        autoPlayAgainTimerRef.current = setTimeout(() => {
            autoPlayAgainTimerRef.current = null;

            if (!disabled && !loading) {
                buttonRef.current?.click();
            }
        }, PLAY_AGAIN_AUTO_CLICK_DELAY_MS);

        return () => {
            if (autoPlayAgainTimerRef.current) {
                clearTimeout(autoPlayAgainTimerRef.current);
                autoPlayAgainTimerRef.current = null;
            }
        };
    }, [autoPlayAgain, disabled, loading]);

    const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
        if (autoPlayAgainTimerRef.current) {
            clearTimeout(autoPlayAgainTimerRef.current);
            autoPlayAgainTimerRef.current = null;
        }

        onClick?.(event);
    };

    return (
        <div
            className={`rounded-lg ${className}`}
            data-cursor="button"
            data-cursor-shape={
                disabled || loading ? "2" : variant === "text" ? "1" : "0"
            }
        >
            <button
                ref={buttonRef}
                type={type}
                onClick={handleClick}
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
                        className={`transition-all duration-200 ease-out ${
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
