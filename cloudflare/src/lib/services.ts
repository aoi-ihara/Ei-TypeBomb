import { jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import type { Room, Secrets } from '../types';
import { ClientError, requireRoomItems } from '../../../shared/validation';
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
export async function getRoom(env: Secrets, id: string): Promise<Room> {
	const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const { data, error } = await db
		.from('ei_typebomb_rooms')
		.select('id,title,user_id,explanation,max_players,game_duration,created_at,updated_at,items')
		.eq('id', id)
		.abortSignal(AbortSignal.timeout(10_000))
		.maybeSingle();
	if (error) throw new Error(`Room lookup failed: ${error.code}`);
	if (!data) throw new ClientError('ルーム情報を取得できませんでした。ルームを確認して再度お試しください。');
	requireRoomItems({ items: data.items });
	return {
		id: data.id,
		title: data.title,
		userId: data.user_id,
		explanation: data.explanation,
		maxPlayers: data.max_players,
		gameDuration: data.game_duration ?? 20,
		createdAt: data.created_at,
		updatedAt: data.updated_at,
		items: data.items,
		users: [],
		isStart: false,
		bombHolder: 0,
		bombStatus: 0,
	};
}
export async function checkDatabase(env: Secrets): Promise<number> {
	const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
	const startedAt = performance.now();
	const { error } = await db
		.from('ei_typebomb_rooms')
		.select('id')
		.limit(1)
		.abortSignal(AbortSignal.timeout(10_000));
	if (error) throw new Error(`Database health check failed: ${error.code}`);
	return Math.round(performance.now() - startedAt);
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
