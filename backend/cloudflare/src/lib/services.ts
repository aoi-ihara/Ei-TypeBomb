import { jwtVerify } from 'jose';
import { Client } from 'pg';
import type { Secrets } from '../types';
export { ClientError, validateDisplayName } from '../../../shared/validation';

export async function verifyToken(token: unknown, secret: string): Promise<string | null> {
	if (typeof token !== 'string' || !secret) return null;
	try {
		const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
		return typeof payload.id === 'string' && payload.id.trim() ? payload.id : null;
	} catch {
		return null;
	}
}

export async function checkDatabase(env: Secrets): Promise<number> {
	const startedAt = performance.now();
	const db = new Client({ connectionString: env.SUPABASE_DATABASE_URL, connectionTimeoutMillis: 5_000 });
	try {
		await db.connect();
		await db.query('SELECT id FROM public.ei_typebomb_rooms LIMIT 1');
		return Math.round(performance.now() - startedAt);
	} finally {
		await db.end();
	}
}

export async function capture(env: Secrets, event: string, properties: Record<string, unknown> = {}) {
	if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
	try {
		const response = await fetch(`${(env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, '')}/capture/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.NEXT_PUBLIC_POSTHOG_KEY,
				event,
				distinct_id: 'server',
				properties: { ...properties, $lib: 'ei-typebomb-cloudflare', $process_person_profile: false },
			}),
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) console.error('PostHog capture failed', response.status);
	} catch {
		console.error('PostHog capture failed');
	}
}
