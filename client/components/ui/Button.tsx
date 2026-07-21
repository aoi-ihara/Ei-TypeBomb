import React from "react";

type ButtonVariant = "default" | "primary" | "text";

type ButtonProps = {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    loading?: boolean;
    loadingText?: string;
    className?: string;
    type?: "button" | "submit" | "reset";
    variant?: ButtonVariant;
    padding?: "small" | "middle" | "large";
};

const baseStyles =
    "font-bold transition-all duration-200 ease-out cursor-pointer";

const variantStyles = (
    variant: ButtonVariant,
    loading: boolean,
    disabled: boolean,
    className: string,
) => {
    return variant == "text"
        ? `${!loading && "underline"} w-fit px-1 rounded-md active:no-underline active:scale-95 ${className ?? ""}`
        : variant == "default" || loading
          ? `bg-(--color-background-secondary) text-(--color-foreground) flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all duration-200 ease-out font-bold ${className ?? ""}`
          : `bg-cyan-600 text-(--color-background) flex justify-center transform ${!(loading || disabled) && "active:scale-95"} transition-all duration-200 ease-out font-bold ${className ?? ""}`;
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
}: ButtonProps) {
    const isDisabled = disabled || loading;

    const currentVariantStyle = variantStyles(
        variant,
        loading,
        disabled,
        className,
    );
    const paddingStyle =
        variant == "text"
            ? ""
            : padding == "small"
              ? "rounded-lg px-2 py-1"
              : padding == "middle"
                ? "rounded-lg px-4 py-3"
                : "rounded-lg px-5 py-4";

    return (
        <div
            className="rounded-lg"
            data-cursor="button"
            data-cursor-shape={disabled ? "2" : variant == "text" ? "1" : "0"}
        >
            <button
                type={type}
                onClick={onClick}
                className={`${baseStyles} ${currentVariantStyle} ${paddingStyle} ${disabled && "opacity-50 pointer-events-none"}`}
            >
                <div
                    className={`transition-all duration-200 ease-out ${
                        loading ? "gradient-text w-fit" : ""
                    }`}
                >
                    {loading ? loadingText : children}
                </div>
            </button>
        </div>
    );
}
