# Backend

```text
backend/
├── server/       # Current Node.js / Socket.IO runtime
├── shared/       # Runtime-independent game, protocol and backend utilities
└── cloudflare/   # Native WebSocket Worker + Durable Object runtime
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

## Cloudflare runtime

`backend/cloudflare/` implements native WebSocket handling, verified JWT room
authorization, RLS-scoped Supabase room loading, Durable Object state storage,
and alarm scheduling. It uses the same `backend/shared/` game core as Node.

This is a standalone backend: no active-match migration, persistent client
identities, or cross-server synchronization yet. See [Cloudflare](cloudflare/README.md).

See [Node](server/README.md) and [shared](shared/README.md).
