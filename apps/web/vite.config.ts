import { sveltekit } from "@sveltejs/kit/vite";
import UnoCSS from 'unocss/vite';
import { defineConfig } from "vite";
import { resolve } from "path";
import { existsSync } from "fs";
import { build } from "esbuild";

// After SvelteKit generates _worker.js, rebundle it to also export WsServerDurableObject.
// Cloudflare requires all DO classes to be named exports of the worker entry point.
// SvelteKit's adapter has no knowledge of our DO subclass, so we inject it post-build.
//
// NOTE: this DO bundling mechanism (the deploy path used pre-6f49b72) is kept because it
// deploys cleanly. The cross-space data corruption once attributed here was actually a
// CLIENT-side bug — a shared singleton MergeableStore reused across spaces, fixed in
// apps/web/src/lib/local/ — NOT this bundling, so that earlier attribution was wrong.
// Either DO bundling approach deploys fine; if you change it, just re-verify the DO is
// exported in .svelte-kit/cloudflare/_worker.js.
const injectDurableObject = () => ({
  name: "inject-durable-object",
  apply: "build" as const,
  enforce: "post" as const,
  async closeBundle() {
    const workerPath = resolve(".svelte-kit/cloudflare/_worker.js");
    if (!existsSync(workerPath)) return;
    const doPath = resolve("../../packages/data/src/sync/syncDurableObject.ts");
    await build({
      stdin: {
        contents: `
export { default } from '${workerPath}';
export { WsServerDurableObject } from '${doPath}';
`,
        resolveDir: resolve("."),
      },
      bundle: true,
      format: "esm",
      outfile: workerPath,
      allowOverwrite: true,
      external: ["cloudflare:workers"],
      conditions: ["workerd", "worker", "browser"],
      platform: "neutral",
      mainFields: ["module", "main"],
      target: "es2022",
    });
  },
});

export default defineConfig({
  plugins: [
    UnoCSS({ configFile: resolve(import.meta.dirname, 'uno.config.ts') }),
    sveltekit(),
    injectDurableObject(),
  ],
});
