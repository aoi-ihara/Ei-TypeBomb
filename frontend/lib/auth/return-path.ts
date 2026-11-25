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

/** Resolve the browser query without making the public sign-in page dynamic. */
export function getSignInReturnPath(search: string): string {
    const values = new URLSearchParams(search).getAll("next");
    if (values.length > 1) return "/";
    return values[0] ? safeReturnPath(values[0]) : "/mine";
}
