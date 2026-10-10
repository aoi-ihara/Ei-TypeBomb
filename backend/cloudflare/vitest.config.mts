import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					JWT_SECRET: 'test-only-secret',
					SUPABASE_DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
					NEXT_PUBLIC_POSTHOG_KEY: '',
				},
			},
		}),
	],
	test: { testTimeout: 20_000, include: ['test/**/*.test.ts'] },
});
