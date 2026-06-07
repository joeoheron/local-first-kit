// Deploy entrypoint for Alchemy's esbuild bundle (npm run deploy:*).
//
// Cloudflare requires every Durable Object class to be a named export of the
// SAME worker script that serves the app. SvelteKit's adapter only generates a
// default fetch handler, so we wrap its output here and add the DO export.
//
// At deploy time `vite build` has already produced .svelte-kit/cloudflare/_worker.js
// (the adapter's generated worker); esbuild bundles it together with the DO class
// into one script. Alchemy points the adapter at _worker.js via wrangler.main, so
// this file is never overwritten by the build. Dev uses worker-dev.ts instead —
// see packages/infra/alchemy.run.ts.
export { default } from "./.svelte-kit/cloudflare/_worker.js";
export { WsServerDurableObject } from "../../packages/data/src/sync/syncDurableObject";
