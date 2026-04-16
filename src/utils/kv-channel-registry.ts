import type { ChannelRegistryEntry } from '../types/channel';

const ENTRY_KEY_PREFIX = 'channels:entry:';

/**
 * KV からチャンネルレジストリを読み込む（KV.list() を使用）。存在しなければ空配列。
 */
export async function loadChannelRegistry(kv: KVNamespace): Promise<ChannelRegistryEntry[]> {
	const entries: ChannelRegistryEntry[] = [];
	let cursor: string | undefined;
	do {
		const result = await kv.list({ prefix: ENTRY_KEY_PREFIX, cursor });
		const { keys } = result;
		for (const key of keys) {
			const raw = await kv.get(key.name);
			if (raw) {
				try {
					entries.push(JSON.parse(raw) as ChannelRegistryEntry);
				} catch {
					console.error(`[kv-channel-registry] Failed to parse entry ${key.name}:`, raw);
				}
			}
		}
		cursor = (result as unknown).cursor as string | undefined;
	} while (cursor);
	return entries;
}

/**
 * レジストリにチャンネルを追加する。重複時はエラーを投げる。
 */
export async function addChannelToRegistry(kv: KVNamespace, entry: ChannelRegistryEntry): Promise<void> {
	const key = `${ENTRY_KEY_PREFIX}${entry.channelId}`;
	const exists = await kv.get(key);
	if (exists) {
		throw new Error(`Channel ${entry.channelId} is already registered`);
	}
	await kv.put(key, JSON.stringify(entry));
}

/**
 * レジストリからチャンネルを削除する。削除できたら true、見つからなければ false。
 */
export async function removeChannelFromRegistry(kv: KVNamespace, channelId: string): Promise<boolean> {
	const key = `${ENTRY_KEY_PREFIX}${channelId}`;
	const exists = await kv.get(key);
	if (exists) {
		await kv.delete(key);
		return true;
	}
	return false;
}

/**
 * レジストリ内のチャンネルの Canvas ID を更新する。見つからなければエラーを投げる。
 */
export async function updateCanvasId(kv: KVNamespace, channelId: string, canvasId: string): Promise<void> {
	const key = `${ENTRY_KEY_PREFIX}${channelId}`;
	const raw = await kv.get(key);
	if (!raw) {
		throw new Error(`Channel ${channelId} not found in registry`);
	}
	const entry = JSON.parse(raw) as ChannelRegistryEntry;
	entry.canvasId = canvasId;
	await kv.put(key, JSON.stringify(entry));
}
