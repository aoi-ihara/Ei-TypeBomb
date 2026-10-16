# Backend

```text
backend/
├── server/       # Current Node.js / Socket.IO runtime
└── shared/       # Runtime-independent game, protocol and backend utilities

# cloudflare/       # Planned Worker adapter (not implemented in this PR)
```

The Node server imports TypeScript directly from the adjacent `shared/`
directory. Shared code depends on neither Node.js nor Cloudflare APIs.

## Current Node commands

Run from the repository root:

| Task        | Command                                     |
| ----------- | ------------------------------------------- |
| Install     | `npm ci --prefix backend/server`            |
| Development | `npm run dev --prefix backend/server`       |
| Tests       | `npm test --prefix backend/server`          |
| Typecheck   | `npm run typecheck --prefix backend/server` |
| Build       | `npm run build --prefix backend/server`     |

The shared source has its own editor configuration at
`backend/shared/tsconfig.json` and requires no separate install.

## Node deployment

`npm start --prefix backend/server` runs the source with tsx.
For compiled deployment, copy the complete `server/dist/` directory and
the server's production dependencies/configuration. Start from the server
working directory with `node dist/index.js`. The build includes the
imported shared code inside `dist/`.

## Planned Cloudflare runtime

A future `backend/cloudflare/` Worker / Durable Object adapter can import
`backend/shared/` alongside the Node server. It must still implement its
own WebSocket transport, authentication key provisioning, storage, alarms,
and limiter lifetime/scope. The shared modules do not provide failover or
cross-server synchronization.

See [Node](server/README.md) and [shared](shared/README.md).
