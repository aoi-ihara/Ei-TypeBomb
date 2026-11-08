/** Canonical public origin for this deployment (not a request Host header). */
export function getEtbBaseUrl(): string {
    const configured = process.env.ETB_BASE_URL;
    if (!configured) throw new Error("ETB_BASE_URL is required");
    const url = new URL(configured);
    if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        throw new Error("ETB_BASE_URL must be an HTTPS origin without a path");
    }
    return url.origin;
}

export function getEtbUrl(path: `/${string}`): string {
    return new URL(path, getEtbBaseUrl()).href;
}
