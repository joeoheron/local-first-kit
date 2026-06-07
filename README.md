# local-first-kit

A local-first web app reference stack. The todo-list prototype is a proving ground for architecture decisions — the goal is a reusable foundation for privacy-respecting, AI-ready local-first apps.

## Stack

| Layer | Choice |
|-------|--------|
| UI | SvelteKit (Svelte 5 runes) |
| Styling | UnoCSS + BitsUI |
| Data | TinyBase 8 `MergeableStore` |
| Auth | Passkeys via `@oslojs/*` primitives (no auth framework) |
| Infra | Cloudflare Workers + Durable Objects via Alchemy |

## Architecture

Data lives on-device in a TinyBase `MergeableStore` persisted to OPFS (localStorage fallback). A per-space Durable Object acts as a sync peer — not a gatekeeper. The CRDT merges changes from all sources (browser, API, agents) on reconnect.

Auth data (users, refresh tokens, API tokens) lives in D1. App data lives in TinyBase. A short-lived JWT bridges them.

```
Browser (TinyBase MergeableStore + OPFS)
    │  WebSocket sync (CRDT)
    ▼
Durable Object (per space — TinyBase SQLite)
    │  internal fetch
    ▼
SvelteKit Worker
├── /sync/[spaceId]  WebSocket proxy
├── /api/todos       REST API (session cookie or Bearer token)
├── /mcp             MCP server for AI agents
├── /settings        API token management
└── /auth/*          Passkey auth + JWT issuance
```

## Packages

```
packages/auth/     Stateless crypto primitives (JWT, passkeys, password hashing)
packages/config/   APP_ID and derived storage-key constants
packages/data/     TinyBase store factory, browser persistence, sync Durable Object
packages/domain/   DEMO DOMAIN: todos schema, operations, access control — replace this
packages/infra/    Alchemy IaC — D1, DO, secrets, migrations
apps/web/          SvelteKit app
```

## Getting started

```bash
npm install
```

Copy `packages/infra/.env.example` to `packages/infra/.env`:

```bash
cp packages/infra/.env.example packages/infra/.env
```

- `JWT_SECRET` — auto-generated on first `npm run dev` if left empty. For staging/prod, set it as a Cloudflare secret.
- `ALCHEMY_PASSWORD` — encrypts Alchemy's local state file. Any value works for local dev.

Auth runs on passkeys out of the box.

```bash
npm run dev          # Alchemy + Vite — HMR, test-stage bindings (no local Durable Object)
npm run dev:workers  # full app + Durable Object in the workerd runtime (sync works; no HMR)
npm run check-types  # TypeScript check (all packages)
npm test --workspace @local-first-kit/domain  # domain unit tests
```

The dev server URL is printed to the terminal on startup.

### Two dev modes

There are two, because SvelteKit can't yet run a Durable Object inside `vite dev`
(`@cloudflare/vite-plugin` has no SvelteKit support — see [sveltejs/kit#15627](https://github.com/sveltejs/kit/pull/15627), blocked on SvelteKit 3):

- **`npm run dev`** — Alchemy + Vite with hot module reload. Best for UI work. The
  `SYNC_DO` namespace is bound but the DO does **not** run here (sync stays disconnected).
- **`npm run dev:workers`** — builds the SvelteKit worker and runs it (handler **+**
  `WsServerDurableObject`) in the real `workerd` runtime via `wrangler dev`, serving at
  `http://localhost:8787`. TinyBase sync, the DO's WebSocket, and native DO RPC
  (`/api/*`, `/mcp`) all work locally, exactly like production. No Vite HMR — re-run after
  changing app code (or run `vite build --watch` in a second terminal alongside it).

First-time setup for `dev:workers`:

```bash
npm run dev                        # once: generates .alchemy/local/wrangler.jsonc (Ctrl-C after it boots)
npm run db:local --workspace web   # once: applies D1 migrations to local state so sign-in works
```

(The `vite build` inside `dev:workers` uses the SvelteKit adapter's Alchemy config, which
`npm run dev` or any deploy creates — you'll get a clear "run alchemy dev or alchemy deploy"
error if it's missing.)

Local config for this mode lives in `apps/web/wrangler.dev.jsonc`; it only mirrors the
bindings owned by `packages/infra/alchemy.run.ts` and runs entirely against local state
(`.wrangler/state`), never real Cloudflare resources.

## Adapting it to your domain

`packages/domain/` is the demo (todos); everything else is infrastructure you keep. To make it your app:

1. **Set `APP_ID`** in `packages/config/src/index.ts` — *before your first deployment*. Storage keys, OPFS file prefixes, and the JWT issuer all derive from it and must not change once users have data.
2. **Replace `packages/domain/`** — your table schema (`schema/`), operations (`operations/`), and access control (`access.ts`: `WRITE_TABLES_BY_ROLE`, `ENCRYPTED_FIELDS_BY_TABLE`).
3. **Point the app at your schema** — pass it to `createAppStore()` in `apps/web/src/lib/local/appStore.ts`.
4. **Update the agent surface** — `apps/web/src/routes/api/todos/` (REST) and the tools in `apps/web/src/routes/mcp/+server.ts`.

The collaboration layer (`lib/server/collab/`, `routes/api/spaces/`, `routes/api/invites/`) is domain-independent — keep it for multi-user spaces, or delete it for a single-user app. `AGENTS.md` has the full step-by-step.

## Deployment

```bash
npm run deploy:staging   # deploy to staging (separate D1/DO instances)
npm run deploy:prod      # deploy to production
npm run destroy:staging  # tear down staging resources
npm run destroy:prod     # tear down production resources (requires CONFIRM_DESTROY=production)
```


## AI agent access

The app exposes an MCP server at `/mcp` and a REST API at `/api/todos`. Generate an API token at `/settings`, then:

```bash
# REST
curl -H "Authorization: Bearer <token>" <dev-url>/api/todos

# MCP
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' <dev-url>/mcp
```
