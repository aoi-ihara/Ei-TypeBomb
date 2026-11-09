export function safeReturnPath(value: string | null): string {
    if (
        !value ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(value)
    )
        return "/";
    return value;
}
