import type { ChannelConfig, ChannelRegistryEntry } from '../types/channel';
import { loadChannelRegistry } from './kv-channel-registry';

// リクエスト単位のレジストリキャッシュ（WeakMap使用）
const registryCache = new WeakMap<KVNamespace, ChannelRegistryEntry[]>();

/**
 * KV レジストリからチャンネル設定を取得する（メモリ内キャッシング有効）。
 */
export async function resolveChannels(env: Env): Promise<ChannelConfig[]> {
	let registry = registryCache.get(env.THREAD_STORE);
	if (!registry) {
		registry = await loadChannelRegistry(env.THREAD_STORE);
		registryCache.set(env.THREAD_STORE, registry);
	}
	return registry.map(entryToChannelConfig);
}

/**
 * レジストリエントリーを ChannelConfig に変換。
 */
function entryToChannelConfig(entry: ChannelRegistryEntry): ChannelConfig {
	return {
		channelId: entry.channelId,
		type: entry.type,
		label: entry.label,
		...(entry.canvasId !== undefined ? { canvasId: entry.canvasId } : {}),
	};
}
