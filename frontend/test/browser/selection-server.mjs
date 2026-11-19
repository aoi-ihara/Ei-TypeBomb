import { build } from "esbuild";
import { createServer } from "node:http";
const result = await build({
  entryPoints: ["test/browser/selection-fixture.tsx"],
  bundle: true,
  write: false,
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"development"' },
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
                      : "export const loadPlaygroundMemory = async () => ({userId:null, memoryByItem:{}}); export const syncPlaygroundMemory = async () => ({error:null});",
          resolveDir: process.cwd(),
          loader: "js",
        }));
      },
    },
  ],
});
createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/bundle.js" ? "text/javascript" : "text/html",
  );
  res.end(
    req.url === "/bundle.js"
      ? result.outputFiles[0].text
      : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
  );
}).listen(3101, "127.0.0.1");
