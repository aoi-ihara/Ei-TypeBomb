import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
    // Bound browser RSC reuse, including fully prefetched dynamic rooms.
    experimental: { staleTimes: { dynamic: 30, static: 30 } },
    outputFileTracingIncludes: {
        "/api/mcp": ["./lib/room/ipadic/COPYING"],
        "/*/edit": ["./lib/room/ipadic/COPYING"],
    },
    serverExternalPackages: ["oidc-provider", "pg"],
    // Runtime-neutral backend/shared modules are also bundled by the browser.
    turbopack: { root: resolve(__dirname, "..") },
    // Consent must be protected on the React document, not only the OAuth API.
    async headers() {
        return [
            ...(process.env.NEXT_PUBLIC_BETA_ENVIRONMENT === "true"
                ? [
                      {
                          source: "/:path*",
                          headers: [
                              {
                                  key: "X-Robots-Tag",
                                  value: "noindex, nofollow, noarchive",
                              },
                          ],
                      },
                  ]
                : []),
            {
                source: "/oauth/consent",
                headers: [
                    { key: "X-Frame-Options", value: "DENY" },
                    {
                        key: "Content-Security-Policy",
                        value: "frame-ancestors 'none'",
                    },
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
    async redirects() {
        // These legacy query links were previously handled by the dynamic
        // home page. Handle them before resolving the shared ISR page.
        return [
            {
                source: "/",
                has: [{ type: "query", key: "filter", value: "mine" }],
                destination: "/mine",
                permanent: false,
            },
            {
                source: "/",
                has: [{ type: "query", key: "owner", value: "me" }],
                destination: "/mine",
                permanent: false,
            },
            {
                source: "/",
                has: [{ type: "query", key: "filter", value: "saved" }],
                destination: "/saved",
                permanent: false,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
