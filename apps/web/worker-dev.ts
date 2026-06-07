// Dev-only worker entry for getPlatformProxy (wrangler dev).
// The SvelteKit app runs via Vite in dev mode — this file only needs
// to export the DO class so Miniflare can serve DO RPC calls.
export { WsServerDurableObject } from '../../packages/data/src/sync/syncDurableObject';

export default {
	async fetch(): Promise<Response> {
		return new Response('Not found', { status: 404 });
	},
};
