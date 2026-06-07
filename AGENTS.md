# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

A **local-first web app reference stack**. The todo-list is a demo domain — a proving ground for architecture decisions. The goal is a reusable foundation that developers adapt for their own apps by replacing the domain layer and keeping everything else.

Do not treat the todo app as the product. Treat it as a working example of the patterns.

---

## Commands

```bash
npm run dev              # Vite + HMR for UI work — test-stage bindings, URL on startup. Sync DO does NOT run here.
npm run dev:workers      # full app + Durable Object in workerd (real sync, /api, /mcp) — no HMR. See "Two dev modes".
npm run check-types      # TypeScript check (all packages)
npm run check --workspace web              # svelte-check + tsc for the web app
npm test --workspace @local-first-kit/domain  # domain unit tests
npm run deploy:staging   # deploy to staging on Cloudflare (real DO, separate instances)
npm run deploy:prod      # deploy to production
npm run destroy:staging  # tear down staging resources
npm run destroy:prod     # tear down production (requires CONFIRM_DESTROY=production env var)
```

---

## Two dev modes

SvelteKit cannot yet run a Durable Object inside `vite dev`, so local dev has two modes. This matters: **anything that touches the DO only works in the second one.**

- **`npm run dev`** — Alchemy + Vite with HMR. Best for UI work. The `SYNC_DO` namespace is bound but the DO does **not** run, so sync stays disconnected and `/api/*` and `/mcp` (which call the DO) do not work.
- **`npm run dev:workers`** — builds the worker and runs it (handler **+** `WsServerDurableObject`) in the real `workerd` runtime at `http://localhost:8787`. TinyBase sync, `/api/*`, and `/mcp` all work locally, exactly like production. No HMR — re-run after changing app code.

First-time `dev:workers` setup:

```bash
npm run dev                        # once: generates .alchemy/local/wrangler.jsonc, then Ctrl-C
npm run db:local --workspace web   # once: applies D1 migrations to local state so sign-in works
```

If sync, `/api/*`, or `/mcp` appears broken, check you are on `dev:workers` — under `npm run dev` those paths are expected to fail.

---

## Package structure

```
packages/
  auth/      — stateless crypto primitives (JWT, passkeys, password hashing)
  config/    — APP_ID and derived storage key constants
  data/      — TinyBase store factory, browser persistence, sync Durable Object
  domain/    — DEMO DOMAIN: todos schema, operations, access control — replace this
  infra/     — Alchemy IaC: D1, DO namespace, secrets, migrations
  tsconfig/  — shared TypeScript config
apps/
  web/       — SvelteKit application
```

Package scope: `@local-first-kit/*`

---

## Three-tier classification

This is the most important mental model for working in this repo.

**Replace this — it is your domain:**
- `packages/domain/` — schema, operations, `WRITE_TABLES_BY_ROLE`, `ENCRYPTED_FIELDS_BY_TABLE`, default role/space name constants

**Stable infrastructure — do not change when adapting the domain:**
- `packages/auth/`, `packages/data/`, `packages/config/`
- `apps/web/src/lib/local/` — persistence lifecycle, sync client, crypto, storage keys
- `apps/web/src/lib/server/users.ts`, `passkeys.ts`, `keys.ts`, `durableObjectClient.ts`
- `apps/web/src/routes/sync/`, `auth/`

**Optional collaboration layer — keep, adapt, or delete:**
- `apps/web/src/lib/server/collab/` — space creation, invite management
- `apps/web/src/routes/api/spaces/`, `api/invites/`, `api/keys/`
- `apps/web/src/components/SpaceList.svelte`, `PendingInvites.svelte`
- A single-user app can delete all of this; sync works without it.

---

## Data layer

The browser writes directly to a `MergeableStore` — there is no server CRUD API for app data. The Durable Object is a sync peer, not a gatekeeper.

```
packages/data/src/
  stores/       — createAppStore(schema) — generic, accepts any TinyBase schema
  persistence/  — OPFS first, localStorage fallback, AES-256-GCM encryption
  sync/         — WsServerDurableObject subclass, JWT verification, HTTP endpoints

packages/domain/src/
  schema/       — table definitions and TypeScript types
  operations/   — domain mutations (addTodo, toggleTodo, deleteTodo)
  access.ts     — WRITE_TABLES_BY_ROLE, ENCRYPTED_FIELDS_BY_TABLE, default constants

apps/web/src/lib/local/
  appStore.ts                     — singleton store: createAppStore(yourSchema)
  persistenceLifecycle.svelte.ts  — anonymous → user → logout state machine
  sync.ts                         — WebSocket synchronizer (connect/reconnect)
  crypto.ts                       — PRF key derivation, sessionStorage helpers
  storageKeys.ts                  — browser storage key constants
```

**Rules:**
- Always use `createMergeableStore()` — never a plain `Store`. Sync requires it.
- Never hand-roll a sync protocol. Use TinyBase's built-in `WsServerDurableObject`, `createWsSynchronizer`, `createDurableObjectSqlStoragePersister`.
- `packages/data` intentionally excludes `src/sync` from its tsconfig. Do not re-add it — the sync module uses Cloudflare Workers globals that conflict with DOM types and cause tsc to hang. It is type-checked via the web app's import chain instead.

---

## Sync architecture

The DO subclass (`packages/data/src/sync/syncDurableObject.ts`) verifies a JWT passed as a query param on WebSocket upgrade, then delegates to TinyBase's built-in WebSocket handler. It also exposes generic HTTP endpoints (`/:tableId[/:rowId]`) for agent/API access — the DO enforces write permissions from the JWT's `writeTables` claim but has no domain knowledge.

The server-side proxy route (`apps/web/src/routes/sync/[spaceId]/+server.ts`) reads the session cookie, checks space membership in D1, and mints a short-lived space JWT before forwarding to the DO. The `writeTables` claim comes from `WRITE_TABLES_BY_ROLE` in `packages/domain/src/access.ts` — the single place to update when changing domains.

The server-side DO caller (`apps/web/src/lib/server/durableObjectClient.ts`) handles internal fetch calls from API and MCP routes to the DO.

---

## Auth architecture

`packages/auth` exports stateless crypto functions only. It does not touch D1, cookies, or TinyBase.

- D1 user/token queries: `apps/web/src/lib/server/users.ts`
- D1 passkey/challenge queries: `apps/web/src/lib/server/passkeys.ts`
- Cookie and session management: SvelteKit server hooks and route handlers
- Auth is passkey-only by default.

Auth flow: SvelteKit server function → D1 lookup → short-lived JWT + refresh token in HttpOnly cookie → DO verifies JWT at WebSocket upgrade (no callback to central auth).

**Why D1 for auth, TinyBase for app data:** Durable Objects are isolated by space ID — unsuitable for cross-user queries like "find user by email". D1 handles identity. TinyBase + DO handles collaborative app data. JWT bridges them.

---

## Spaces

A **space** is a sync partition — one Durable Object instance, one set of app data. Every user gets a personal space on signup. Sharing is opt-in via the collaboration layer.

Defaults live in `packages/domain/src/access.ts`:
- `DEFAULT_CREATOR_ROLE` — role for space creator (`'owner'`)
- `DEFAULT_INVITEE_ROLE` — role when invite is accepted (`'member'`)
- `DEFAULT_PERSONAL_SPACE_NAME` — name for the auto-created personal space (`'Personal'`)

---

## Infra

`packages/infra/alchemy.run.ts` defines all Cloudflare resources: D1 database, DO namespace, secret bindings. It is the single source of truth — do not create Cloudflare resources outside it.

Migrations live in `packages/infra/migrations/`. There is one migration file (`0001_init.sql`) representing the full initial schema. Add new numbered files for subsequent schema changes.

**Environment:** copy `packages/infra/.env.example` to `packages/infra/.env`.
- `JWT_SECRET` — auto-generated on first `npm run dev` if left empty. For staging/prod, set it as a Cloudflare secret (`wrangler secret put JWT_SECRET`).
- `ALCHEMY_PASSWORD` — encrypts Alchemy's local state file. Any value works for local dev.

**APP_ID** in `packages/config/src/index.ts` is the one value to change when adopting this as a template. Change it before first deployment — derived storage keys, JWT issuer, and OPFS file prefixes all depend on it and cannot change once users have data.

---

## Replacing the demo domain

`packages/domain/` is the only layer to replace. Everything else is infrastructure.

1. Replace `packages/domain/src/schema/todos.ts` with your table schema and TypeScript types
2. Update `packages/domain/src/schema/index.ts` to export your schema
3. Replace `packages/domain/src/operations/todos.ts` with your domain operations
4. Update `packages/domain/src/operations/index.ts` to export your operations
5. Update `packages/domain/src/access.ts`:
   - `WRITE_TABLES_BY_ROLE` — which tables each role can write to
   - `ENCRYPTED_FIELDS_BY_TABLE` — fields encrypted at rest with the space key
   - Adjust the `DEFAULT_*` constants if needed
6. Update `apps/web/src/lib/local/appStore.ts` — pass your schema to `createAppStore()`
7. Replace `apps/web/src/routes/api/todos/` with your domain's API routes
8. Update `apps/web/src/routes/mcp/+server.ts` tools to match your domain

The collaboration layer is domain-independent — keep, adapt, or remove it separately.

---

## Conventions

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`) everywhere — no legacy stores or `writable()`.
- **TypeScript strict mode** in all packages.
- **Tests beside the code**: `packages/domain/src/operations/todos.test.ts`.
- **No comments** unless the why is non-obvious. Well-named identifiers carry the what.
- **Dev-only routes** live under `/dev/*` and are blocked in production by `apps/web/src/hooks.server.ts`. Individual `+page.server.ts` files add a second guard.
- **Styling** uses UnoCSS with `presetMini` — not Tailwind. Class names look similar but the dependency is UnoCSS only. Custom shortcuts and design tokens are defined in `apps/web/uno.config.ts` and `apps/web/src/app.css`.

---

## Glossary

| Term | Meaning |
|------|---------|
| **MergeableStore** | TinyBase store type that supports CRDT merging. Required for sync. Always use `createMergeableStore()`. |
| **space** | A sync partition — one DO instance, one set of app data. Users have a personal space by default; additional spaces are shared via invites. |
| **appStore** | The singleton `MergeableStore` instance in `apps/web/src/lib/local/appStore.ts`. |
| **domainCrypto** | A `DomainCrypto` instance (from `packages/domain`) that encrypts/decrypts fields listed in `ENCRYPTED_FIELDS_BY_TABLE` using the space key. Null when no encryption key is available. |
| **PRF** | WebAuthn Pseudo-Random Function extension. Derives a deterministic AES key from a passkey, used to encrypt OPFS persistence. |
| **OPFS** | Origin Private File System — browser API for local file storage. Primary persistence backend; localStorage is the fallback. |
| **trusted device** | A session where the user opted to keep data after logout. The encryption key survives in sessionStorage and OPFS files are not cleared. |
| **claim path** | `enableWithClaim()` — new account registration where the user keeps their anonymous session data. |
| **fresh path** | `enableFresh()` — new account registration where the user starts with an empty store. |
| **device key** | An AES key wrapped by the PRF-derived storage key and stored server-side. Used to unwrap other keys (identity, space) when PRF is unavailable. |
