# Backend

```text
backend/
├── server/       # Node.js, Socket.IO, setTimeout, PostgreSQL
├── cloudflare/   # Workers, WebSocket, DO Alarm/Storage, Supabase
└── shared/       # Common game types, protocol, validation and transitions
```

Run commands from the repository root:

| Task | Node | Cloudflare |
| --- | --- | --- |
| Install | `npm ci --prefix backend/server` | `npm ci --prefix backend/cloudflare` |
| Development | `npm run dev --prefix backend/server` | `npm run dev --prefix backend/cloudflare` |
| Tests | `npm test --prefix backend/server` | `npm test --prefix backend/cloudflare` |
| Typecheck | `npm run typecheck --prefix backend/server` | `npm run typecheck --prefix backend/cloudflare` |
| Build | `npm run build --prefix backend/server` | `npm run build --prefix backend/cloudflare` |

Both source builds need the adjacent `shared/` directory. `shared/` has no runtime
or npm dependencies. Its editor configuration is `shared/tsconfig.json`; Node
unit tests live in `server/test/` with their own Node type configuration.

## Node deployment

`npm start --prefix backend/server` runs `server/src/index.ts` with tsx, reading
configuration from the server directory. Keep `server/` and `shared/` together.
For compiled deployment, copy the complete `server/dist/` directory with the
server's production npm dependencies and configuration. Start from the server
working directory with `node dist/index.js`. The generated entry loads the
compiled runtime and shared code inside `dist/`; no sibling source files are
needed at runtime.

## Cloudflare deployment

Use `backend/cloudflare` as the Wrangler project directory, and retain
`backend/shared` in the build checkout. `npm run build --prefix backend/cloudflare`
performs a dry run. `npm run deploy --prefix backend/cloudflare` publishes the
Worker, including bundled shared code. Worker production builds do not import
Node runtime sources; the cross-adapter test imports the Node adapter for tests.
The deployed Worker does not access repository files at runtime.

For Git-connected Workers Builds, set Root directory to `backend/cloudflare`,
Build command to `npm ci --include=dev && npm run build`, and Deploy command to
`npm run deploy`. Commands run inside the configured root; do not prepend
`cd cloudflare`. The explicit install includes Wrangler's devDependency even
when the environment otherwise omits development dependencies.

Runtime details: [server](server/README.md), [Cloudflare](cloudflare/README.md),
and [shared core](shared/README.md).
