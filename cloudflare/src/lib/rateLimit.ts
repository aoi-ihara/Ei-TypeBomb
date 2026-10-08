import type { Session } from '../types';
import { EVENT_RATE_LIMITS as limits } from '../../../shared/rateLimit';

export function acceptEvent(session: Session, event: string, now = Date.now()): boolean {
	const limit = Object.hasOwn(limits, event) ? limits[event] : undefined;
	if (!limit) return false;
	const { capacity, perSecond } = limit;
	const bucket = session.buckets[event] ?? { tokens: capacity, updatedAt: now };
	bucket.tokens = Math.min(capacity, bucket.tokens + (Math.max(0, now - bucket.updatedAt) * perSecond) / 1000);
	bucket.updatedAt = now;
	session.buckets[event] = bucket;
	if (bucket.tokens < 1) return false;
	bucket.tokens -= 1;
	return true;
}
