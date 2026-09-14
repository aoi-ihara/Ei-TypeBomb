const originOf = (url: string | undefined | null): string | null => {
    if (!url) return null;

    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
};

const trustedOrigins = (): string[] =>
    [
        process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
        process.env.NEXT_PUBLIC_BACKUP_SERVER_URL,
    ]
        .map(originOf)
        .filter((origin): origin is string => origin !== null);

/**
 * A server URL is trusted only when its origin matches one of the configured
 * primary or backup servers. The game sends the authentication token to the
 * server, so it must never connect to an origin the visitor controls.
 */
export const isTrustedServerUrl = (
    url: string | undefined | null,
): boolean => {
    const origin = originOf(url);
    if (!origin) return false;

    return trustedOrigins().includes(origin);
};

/**
 * Returns the server URL the game must use. A visitor can override the URL
 * through the `server-url` cookie, so the override is honored only when it
 * points to a trusted origin. Any other value falls back to the primary server.
 */
export const resolveServerUrl = (
    override: string | undefined | null,
): string | undefined => {
    if (override && isTrustedServerUrl(override)) return override;

    return process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
};
