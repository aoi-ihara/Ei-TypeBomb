import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
    // Bound browser RSC reuse, including fully prefetched dynamic rooms.
    experimental: { staleTimes: { dynamic: 30, static: 30 } },
    serverExternalPackages: ["oidc-provider", "pg"],
    // Runtime-neutral backend/shared modules are also bundled by the browser.
    turbopack: { root: resolve(__dirname, "..") },
    // Consent must be protected on the React document, not only the OAuth API.
    async headers() {
        return [
            {
                source: "/oauth/consent",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
                ],
            },
        ];
    },
    async rewrites() {
        return [
            {
                source: "/ingest/static/:path*",
                destination: "https://us-assets.i.posthog.com/static/:path*",
            },
            {
                source: "/ingest/array/:path*",
                destination: "https://us-assets.i.posthog.com/array/:path*",
            },
            {
                source: "/ingest/:path*",
                destination: "https://us.i.posthog.com/:path*",
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
