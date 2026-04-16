import type { ChannelRegistryEntry } from '../types/channel';

const REGISTRY_KEY = 'channels:registry';

/**
 * KV からチャンネルレジストリを読み込む。存在しなければ空配列。
 */
export async function loadChannelRegistry(kv: KVNamespace): Promise<ChannelRegistryEntry[]> {
	const raw = await kv.get(REGISTRY_KEY);
	if (!raw) return [];
	try {
		return JSON.parse(raw) as ChannelRegistryEntry[];
	} catch {
		console.error('[kv-channel-registry] Failed to parse registry:', raw);
		return [];
	}
}

/**
 * チャンネルレジストリを KV に保存する。
 */
export async function saveChannelRegistry(kv: KVNamespace, entries: ChannelRegistryEntry[]): Promise<void> {
	await kv.put(REGISTRY_KEY, JSON.stringify(entries));
}

/**
 * レジストリにチャンネルを追加する。重複時はエラーを投げる。
 */
export async function addChannelToRegistry(kv: KVNamespace, entry: ChannelRegistryEntry): Promise<void> {
	const registry = await loadChannelRegistry(kv);
	if (registry.some((e) => e.channelId === entry.channelId)) {
		throw new Error(`Channel ${entry.channelId} is already registered`);
	}
	registry.push(entry);
	await saveChannelRegistry(kv, registry);
}

/**
 * レジストリからチャンネルを削除する。削除できたら true、見つからなければ false。
 */
export async function removeChannelFromRegistry(kv: KVNamespace, channelId: string): Promise<boolean> {
	const registry = await loadChannelRegistry(kv);
	const initialLength = registry.length;
	const filtered = registry.filter((e) => e.channelId !== channelId);
	if (filtered.length === initialLength) return false;
	await saveChannelRegistry(kv, filtered);
	return true;
}

/**
 * レジストリ内のチャンネルの Canvas ID を更新する。見つからなければエラーを投げる。
 */
export async function updateCanvasId(kv: KVNamespace, channelId: string, canvasId: string): Promise<void> {
	const registry = await loadChannelRegistry(kv);
	const entry = registry.find((e) => e.channelId === channelId);
	if (!entry) {
		throw new Error(`Channel ${channelId} not found in registry`);
	}
	entry.canvasId = canvasId;
	await saveChannelRegistry(kv, registry);
}
