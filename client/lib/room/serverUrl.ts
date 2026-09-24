const originOf = (url: string | undefined | null): string | null => {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
            return null;
        return parsed.origin;
    } catch {
        return null;
    }
};

const trustedOrigins = (selectedPrimary?: string): string[] =>
    [
        process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
        process.env.NEXT_PUBLIC_BACKUP_SERVER_URL,
        selectedPrimary,
    ]
        .map(originOf)
        .filter((origin): origin is string => origin !== null);

/**
 * Only the configured servers and the primary explicitly selected in this
 * browser may receive the game's authentication token.
 */
export const isTrustedServerUrl = (
    url: string | undefined | null,
    selectedPrimary?: string,
): boolean => {
    const origin = originOf(url);
    if (!origin) return false;

    return trustedOrigins(selectedPrimary).includes(origin);
};

export const getStoredServerUrl = (): string => {
    if (typeof window === "undefined") return "";
    try {
        return window.localStorage.getItem("server-url") ?? "";
    } catch {
        return "";
    }
};

/** Prefer the browser's explicit override; cookies are not used. */
export const resolveServerUrl = (
    override: string | undefined | null = getStoredServerUrl(),
): string | undefined => {
    const url = override?.trim();
    if (url && originOf(url)) return url;

    return process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
};
