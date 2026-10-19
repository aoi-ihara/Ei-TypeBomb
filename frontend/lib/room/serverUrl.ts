import { parseETBClusterConfig } from "./clusterConfig";

export const SERVER_CONFIG_STORAGE_KEY = "server-config";
export const SERVER_CONFIG_CHANGE_EVENT = "server-config-change";

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

const trustedOrigins = (selectedPrimary?: string, clusterServers: string[] = []): string[] =>
    [
        process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
        process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL,
        process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL,
        selectedPrimary,
        ...clusterServers,
    ]
        .map(originOf)
        .filter((origin): origin is string => origin !== null);

/**
 * Only servers that were configured by the deployment or explicitly selected
 * in this browser may receive the game's authentication token.
 */
export const isTrustedServerUrl = (
    url: string | undefined | null,
    selectedPrimary?: string,
    clusterServers: string[] = [],
): boolean => {
    const origin = originOf(url);
    if (!origin) return false;

    return trustedOrigins(selectedPrimary, clusterServers).includes(origin);
};

/** The developer-only override is browser-local and is never sent to the API. */
export const getStoredServerConfig = (): string => {
    if (typeof window === "undefined") return "";
    try {
        return window.localStorage.getItem(SERVER_CONFIG_STORAGE_KEY) ?? "";
    } catch {
        return "";
    }
};

/** Null means no valid override; the deployment's config stays in force. */
export const parseStoredServerConfig = (raw: string): string[] | null => {
    if (!raw.trim()) return null;
    try {
        return parseETBClusterConfig(raw).map((server) => server.endpoint);
    } catch {
        return null;
    }
};

export const getStoredClusterServers = (): string[] | null =>
    parseStoredServerConfig(getStoredServerConfig());

export const getEffectiveClusterServers = (defaults: string[]): string[] =>
    getStoredClusterServers() ?? defaults;

export const resolveServerUrl = (): string | undefined =>
    process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
