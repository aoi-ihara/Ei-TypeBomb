import { Client } from 'pg';
import type { Room, Secrets } from '../types';
import { ClientError, requireRoomItems } from '../../../shared/validation';
import { roomFromRow, type RoomRow } from '../../../shared/room';

export async function getRoom(env: Secrets, id: string): Promise<Room> {
	const db = new Client({ connectionString: env.SUPABASE_DATABASE_URL, connectionTimeoutMillis: 5_000 });
	try {
		await db.connect();
		const { rows } = await db.query<RoomRow>(
			`SELECT id, title, user_id, explanation, max_players, game_duration,
				password, created_at, updated_at, items
			FROM public.ei_typebomb_rooms
			WHERE id = $1
			LIMIT 1`,
			[id],
		);
		const data = rows[0];
		if (!data) throw new ClientError('ルーム情報を取得できませんでした。ルームを確認して再度お試しください。');
		const items = data.items ?? [];
		requireRoomItems({ items });
		return roomFromRow({ ...data, items });
	} finally {
		await db.end();
	}
}
