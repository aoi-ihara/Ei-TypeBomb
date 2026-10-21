import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
    // Runtime-neutral backend/shared modules are also bundled by the browser.
    turbopack: { root: resolve(__dirname, "..") },
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
