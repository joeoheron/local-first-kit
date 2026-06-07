/**
 * Infrastructure as Code (Alchemy / Cloudflare)
 * Defines all Cloudflare resources: Workers app, D1 auth database,
 * Durable Object sync namespace, and secret bindings.
 *
 * Run with: npm run dev | deploy | destroy (from packages/infra/)
 */
import alchemy, { secret } from "alchemy";
import {
  SvelteKit,
  D1Database,
  DurableObjectNamespace,
} from "alchemy/cloudflare";
import { config } from "dotenv";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { APP_ID } from "@local-first-kit/config";

config({ path: "./.env" });

// Auto-generate JWT_SECRET for local dev if missing — persisted to .env so
// sessions survive restarts. For staging/prod, set it as a Cloudflare secret.
if (!process.env.JWT_SECRET) {
  const generated = randomBytes(32).toString("hex");
  const envPath = "./.env";
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const updated = existing.match(/^JWT_SECRET=.*$/m)
    ? existing.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${generated}`)
    : existing + `\nJWT_SECRET=${generated}`;
  writeFileSync(envPath, updated);
  process.env.JWT_SECRET = generated;
  console.log("Generated JWT_SECRET and saved to .env");
}

const app = await alchemy(APP_ID);

// D1 database for user records and refresh tokens (central/auth data).
// Name is scoped by stage so staging and production never share a database:
//   production       -> local-first-kit-auth
//   any other stage  -> local-first-kit-<stage>-auth  (e.g. local-first-kit-test-auth)
// The worker itself is auto-suffixed by Alchemy (local-first-kit-web-<stage>); D1 is not,
// so we suffix it here explicitly. Without this, both stages adopt the same DB.
const dbName =
  app.stage === "production" ? `${APP_ID}-auth` : `${APP_ID}-${app.stage}-auth`;

const db = await D1Database("auth-db", {
  name: dbName,
  migrationsDir: "./migrations",
  adopt: true,
});

// Durable Object namespace for TinyBase sync
// sqlite: true is required on free plan — triggers new_sqlite_classes migration
const syncDo = DurableObjectNamespace("sync-do", {
  className: "WsServerDurableObject",
  sqlite: true,
});

// Secrets — values come from packages/infra/.env locally, Cloudflare secrets in production
const jwtSecret = secret.env("JWT_SECRET");

// Deploy via the SvelteKit() helper: its entrypoint defaults to the adapter's
// .svelte-kit/cloudflare/_worker.js, which the `injectDurableObject` vite plugin
// (apps/web/vite.config.ts) has rebundled to also export WsServerDurableObject.
export const web = await SvelteKit("web", {
  cwd: "../../apps/web",
  observability: {
    logs: {
      // Suppress per-invocation logs (websocket:message, fetch events) to avoid
      // observability volume from TinyBase's multi-round-trip sync protocol.
      // console.error output and exceptions are retained.
      invocationLogs: false,
    },
  },
  bindings: {
    DB: db,
    SYNC_DO: syncDo,
    JWT_SECRET: jwtSecret,
    // No PUBLIC_SERVER_URL binding: the client falls back to the request origin
    // (apps/web/.../auth/welcome/+page.server.ts), so sync stays same-origin on
    // both the workers.dev URL and a custom domain. Binding Worker.DevUrl here
    // would force the sync websocket to workers.dev and break cookie-based auth
    // when served from a custom domain.
  },
});

console.log(`Web -> ${web.url}`);

await app.finalize();
