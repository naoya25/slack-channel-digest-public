/** `THREAD_STORE` 内で朝会 KV と衝突しないプレフィックス */
const KV_PREFIX = 'slack_user:v1';

/**
 * 表示名は `expirationTtl` なしで PUT する（自動失効なし）。
 * 改名を反映したいときは該当キーを削除するか、同じ userId で再取得時に上書きされる。
 */

export interface CachedDisplayName {
	displayName: string;
	updatedAt: number;
}

export function displayNameCacheKey(userId: string): string {
	return `${KV_PREFIX}:${userId}`;
}

export function parseCachedDisplayName(raw: string | null): string | null {
	if (!raw) return null;
	try {
		const data = JSON.parse(raw) as Partial<CachedDisplayName>;
		if (typeof data.displayName === 'string' && data.displayName.length > 0) {
			return data.displayName;
		}
	} catch {
		/* ignore */
	}
	return null;
}

export function serializeCachedDisplayName(displayName: string): string {
	const payload: CachedDisplayName = { displayName, updatedAt: Date.now() };
	return JSON.stringify(payload);
}
