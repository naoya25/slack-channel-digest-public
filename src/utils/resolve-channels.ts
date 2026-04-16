import type { ChannelConfig, ChannelRegistryEntry } from '../types/channel';
import { loadChannelRegistry } from './kv-channel-registry';

/**
 * KV レジストリからチャンネル設定を取得する。
 */
export async function resolveChannels(env: Env): Promise<ChannelConfig[]> {
	const registry = await loadChannelRegistry(env.THREAD_STORE);
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
