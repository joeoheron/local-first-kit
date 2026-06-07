# Infrastructure (Alchemy / Cloudflare)

`alchemy.run.ts` defines all Cloudflare resources for this app: the SvelteKit
Worker, the D1 auth database, the Durable Object sync namespace, and secret
bindings.

## Commands

| Script | Stage | What it does |
| --- | --- | --- |
| `npm run dev` | `test` | Local dev (`alchemy dev --stage test`). |
| `npm run deploy:staging` | `test` | Deploy the staging stack. |
| `npm run deploy:prod` | `production` | Deploy the production stack. |
| `npm run destroy:staging` | `test` | Tear down staging. |
| `npm run destroy:prod` | `production` | Tear down prod (requires `CONFIRM_DESTROY=production`). |

## Stage isolation

Resources are scoped per stage so staging and production never collide:

- **Worker** — Alchemy auto-suffixes the script name: `local-first-kit-web-test`
  vs `local-first-kit-web-production`.
- **Durable Object (`SYNC_DO`)** — bound to the worker script, so DO storage is
  inherently per-stage. No extra config needed.
- **D1 (`auth-db`)** — Alchemy does *not* auto-suffix D1 names, so we name it by
  stage explicitly in `alchemy.run.ts`:
  - `production` → `local-first-kit-auth`
  - any other stage → `local-first-kit-<stage>-auth` (e.g. `local-first-kit-test-auth`)

  ⚠️ If you remove the per-stage naming, `adopt: true` will cause every stage to
  adopt the *same* database — staging and production would share all user
  records and refresh tokens.

## `PUBLIC_SERVER_URL`

There is intentionally **no** `PUBLIC_SERVER_URL` binding. The client falls back
to the request origin (`apps/web/src/routes/auth/welcome/+page.server.ts`), which
keeps the sync websocket same-origin as the page on both the `*.workers.dev` URL
and any custom domain. Binding `Worker.DevUrl` would pin sync to the workers.dev
origin and break cookie-based auth when the worker is served from a custom
domain.

## Recovering from stranded state (failed destroy)

Alchemy tracks resource state under `.alchemy/<app>/<stage>/<id>.json`. If a
`destroy` fails partway — e.g. a resource was already deleted in the Cloudflare
dashboard, so Alchemy gets a `404` deleting it — it logs `Scope is in error,
skipping finalize` and **leaves the stale state entry behind**.

The next deploy then reports `[skipped] <id> (no changes)` and binds the worker
to a resource id that no longer exists, producing an error like:

```
[10181] D1 binding 'DB' references database '<id>' which was not found.
```

**Fix:** delete the stranded state file for that resource, then redeploy:

```bash
rm .alchemy/local-first-kit/<stage>/auth-db.json
npm run deploy:staging   # or deploy:prod
```

Alchemy will recreate (or `adopt`) the resource and rebind it. Only remove the
specific stranded entry — deleting the whole stage scope forces every resource
to be recreated.
