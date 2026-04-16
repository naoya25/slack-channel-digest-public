import type { ChannelConfig, ChannelRegistryEntry } from '../types/channel';
import { loadChannelRegistry } from './kv-channel-registry';
import { parseChannelsConfig } from './parse-channels-config';

/**
 * KV レジストリからチャンネル設定を取得する。
 * KV が空の場合は `CHANNELS_CONFIG` ENV にフォールバック（後方互換性）。
 */
export async function resolveChannels(env: Env): Promise<ChannelConfig[]> {
	const registry = await loadChannelRegistry(env.THREAD_STORE);
	if (registry.length > 0) {
		return registry.map(entryToChannelConfig);
	}
	// フォールバック: 既存の CHANNELS_CONFIG ENV を使用
	return parseChannelsConfig(env.CHANNELS_CONFIG);
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
