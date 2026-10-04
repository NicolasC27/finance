import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { dataPlugin } from './vite-plugin-donnees.ts';

// https://vite.dev/config/
// Kraken proxy, PUBLIC PRICES only (Ticker, OHLC: the Kraken API sends no
// CORS headers). Private calls (balances, ledger) no longer go through here:
// the server signs them itself, keys in the keyring
// (vite-plugin-donnees.ts, server/kraken.ts).
const krakenProxy = {
	'/kraken-api/0/public': {
		target: 'https://api.kraken.com',
		changeOrigin: true,
		rewrite: (path: string) => path.replace(/^\/kraken-api/, '')
	}
};

// App data lives in an encrypted SQLite database (instead of the browser's
// localStorage): `donnees/budget.db` at the project root, outside the app's
// git repository (BUDGET_DATA_DIR to change folder). See vite-plugin-donnees.ts.
const dataDir = process.env.BUDGET_DATA_DIR ?? fileURLToPath(new URL('../donnees', import.meta.url));

// Content security policy: only the app's code runs, nothing leaves for
// another site (the AI relay and the server stay local), and the page cannot
// be framed by another site. The inline script of index.html (theme without
// flash) is allowed by its hash.
const inlineScripts = [...readFileSync(new URL('./index.html', import.meta.url), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
	(m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`
);
const csp = [
	"default-src 'self'",
	`script-src 'self' ${inlineScripts.join(' ')}`,
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
	"worker-src 'self' blob:",
	"frame-src 'self' blob: data:",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'none'"
].join('; ');
const headers = {
	'Content-Security-Policy': csp,
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'no-referrer',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

export default defineConfig({
	plugins: [svelte(), tailwindcss(), dataPlugin(dataDir, process.env.BUDGET_DATA_DIR ?? 'donnees/')],
	// cors: false → no other page (even local, other port) can read the server's
	// responses; .ia/ (AI relay token) is never served.
	server: {
		proxy: krakenProxy,
		cors: false,
		headers,
		fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.ia/**'] }
	},
	preview: { proxy: krakenProxy, cors: false, headers },
	resolve: {
		alias: {
			// $lib alias (v1 convention) → src/lib
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	}
});
