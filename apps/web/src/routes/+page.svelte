<div class="mx-auto max-w-2xl px-6 py-12 space-y-12">

  <section class="space-y-3">
    <h1 class="text-3xl font-bold text-fg">Local First Kit</h1>
    <p class="text-lg text-fg-muted">
      A reference stack for building local-first web apps — real-time sync,
      passkey auth, and end-to-end encryption, ready to adapt.
    </p>
    <p class="text-sm">
      <a href="/todos" class="text-info transition-colors hover:text-info/80">Open the todo demo →</a>
    </p>
  </section>

  <section class="space-y-4">
    <h2 class="text-xl font-semibold text-fg">Quick start</h2>
    <ol class="space-y-4 text-sm text-fg-muted">
      <li class="flex gap-3">
        <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--surface-2))] text-xs font-semibold text-fg">1</span>
        <div class="space-y-1.5">
          <p>Clone the repo and install dependencies.</p>
          <pre class="rounded-lg bg-[hsl(var(--surface-2))] px-4 py-3 text-xs text-fg">git clone https://github.com/your-org/local-first-kit
npm install</pre>
        </div>
      </li>
      <li class="flex gap-3">
        <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--surface-2))] text-xs font-semibold text-fg">2</span>
        <div class="space-y-1.5">
          <p>Copy the example env file. <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">JWT_SECRET</code> is auto-generated on first run.</p>
          <pre class="rounded-lg bg-[hsl(var(--surface-2))] px-4 py-3 text-xs text-fg">cp packages/infra/.env.example packages/infra/.env</pre>
        </div>
      </li>
      <li class="flex gap-3">
        <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--surface-2))] text-xs font-semibold text-fg">3</span>
        <div class="space-y-1.5">
          <p>Start the dev server (Vite + HMR). The dev URL is printed on startup.</p>
          <pre class="rounded-lg bg-[hsl(var(--surface-2))] px-4 py-3 text-xs text-fg">npm run dev</pre>
        </div>
      </li>
    </ol>
    <p class="text-xs text-fg-muted">
      <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">npm run dev</code> is best for UI work — the sync Durable Object does not run here.
      To exercise real-time sync locally, use <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">npm run dev:workers</code>. See the README for both dev modes.
    </p>
  </section>

  <section class="space-y-4">
    <h2 class="text-xl font-semibold text-fg">Stack</h2>
    <dl class="divide-y divide-[hsl(var(--stroke))] text-sm">
      {#each [
        ['UI',      'SvelteKit — Svelte 5 runes'],
        ['Styling', 'UnoCSS (presetMini) + BitsUI'],
        ['Data',    'TinyBase MergeableStore — local-first CRDT sync'],
        ['Auth',    '@oslojs primitives — passkey-only, no framework'],
        ['Infra',   'Cloudflare Workers + Durable Objects via Alchemy'],
      ] as [label, description]}
        <div class="flex gap-4 py-3">
          <dt class="w-16 shrink-0 font-medium text-fg">{label}</dt>
          <dd class="text-fg-muted">{description}</dd>
        </div>
      {/each}
    </dl>
  </section>

  <section class="space-y-4">
    <h2 class="text-xl font-semibold text-fg">Adapting it to your app</h2>
    <p class="text-sm text-fg-muted">
      The todo list is a proving ground, not the product. Two steps make it yours:
    </p>
    <ol class="ml-4 list-decimal space-y-2 text-sm text-fg-muted">
      <li>
        Set <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">APP_ID</code> in
        <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">packages/config</code> —
        before your first deploy; storage keys derive from it and can't change later.
      </li>
      <li>
        Replace <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">packages/domain/</code> — schema, operations, and access control.
      </li>
    </ol>
    <p class="text-sm text-fg-muted">
      Everything else (auth, sync, persistence, infra) is infrastructure you keep as-is.
      Full steps live in <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">README.md</code> and <code class="rounded bg-[hsl(var(--surface-2))] px-1 py-0.5 text-xs text-fg">AGENTS.md</code>.
    </p>
  </section>

</div>
