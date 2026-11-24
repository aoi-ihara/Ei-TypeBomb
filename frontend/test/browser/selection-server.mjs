import { build } from "esbuild";
import { createServer } from "node:http";
const bundle = async (beta) => build({
  entryPoints: ["test/browser/selection-fixture.tsx"],
  bundle: true,
  write: false,
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
              ? "export const useRouter = () => ({push(){}, refresh(){}});"
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
createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url?.endsWith(".js") ? "text/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? result.outputFiles[0].text
      : req.url === "/production.js" ? production.outputFiles[0].text
      : `<!doctype html><html><body><div id="root"></div><script src="${req.url === "/production" ? "/production.js" : "/bundle.js"}"></script></body></html>`,
  );
}).listen(3101, "127.0.0.1");
