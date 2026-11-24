import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = async (beta) => build({
  entryPoints: ["test/browser/selection-fixture.tsx"],
  bundle: true,
  write: false,
  outdir: "test/browser/.fixture-output",
  entryNames: "fixture",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_BETA_ENVIRONMENT": JSON.stringify(beta) },
  plugins: [
    {
      name: "browser-fixture-adapters",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(next\/navigation|next\/link|posthog-js|posthog-js\/react|\.\/auth|@\/lib\/room\/auth|@\/lib\/playground\/memory-client)$/,
          },
          ({ path }) => ({ path, namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "next/navigation"
              ? "export const useRouter = () => ({push(){}, refresh(){}}); export const usePathname = () => window.location.pathname;"
              : path === "next/link"
                ? 'import React from "react"; export default function Link(props) { return React.createElement("a", props); }'
                : path === "@/lib/room/auth" || path === "./auth"
                  ? "export const getAuthToken = async () => null;"
                  : path === "posthog-js/react"
                    ? "export const useFeatureFlagEnabled = () => false;"
                    : path === "posthog-js"
                      ? "export default {capture(){}};"
                      : "export const loadPlaygroundMemory = async () => ({userId:null, memoryByItem:{}}); export const startMemorySync = () => { throw new Error('guest fixture must not create a sync queue'); };",
          resolveDir: process.cwd(),
          loader: "js",
        }));
      },
    },
  ],
});
const result = await bundle("true");
const production = await bundle("false");
function output(bundle, extension) {
  return bundle.outputFiles.find(file => file.path.endsWith(extension))?.text ?? "";
}
createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  const isProduction = pathname === "/production" || pathname.startsWith("/production.");
  const buildResult = isProduction ? production : result;
  if (pathname === "/bundle.js" || pathname === "/production.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(output(buildResult, ".js"));
    return;
  }
  if (pathname === "/bundle.css" || pathname === "/production.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(output(buildResult, ".css"));
    return;
  }
  const asset = isProduction ? "/production" : "/bundle";
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><link rel="stylesheet" href="${asset}.css"></head><body><div id="root"></div><script src="${asset}.js"></script></body></html>`);
}).listen(3101, "127.0.0.1");
