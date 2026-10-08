export interface Secrets {
	JWT_SECRET: string;
	NEXT_PUBLIC_SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
	NEXT_PUBLIC_POSTHOG_KEY?: string;
	POSTHOG_HOST?: string;
}
export type WorkerEnv = Env & Secrets;
import type { Room as SharedRoom, User, Item } from '../../shared/types';
export type { User, Item, TypedRecallItem, GameState } from '../../shared/types';
export type Room = SharedRoom & {
	users: User[];
	items: Item[];
	isStart: boolean;
	bombHolder: number;
	gameDuration: number;
};
export type Session = {
	id: string;
	roomId: string;
	displayName?: string;
	authenticated: boolean;
	lastSeen: number;
	buckets: Record<string, { tokens: number; updatedAt: number }>;
};
