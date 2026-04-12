import type { ChannelConfig, ChannelIngestRange } from '../types/channel';

/** 環境変数 `CHANNELS_CONFIG`（string の JSON 配列）をパースし、`ChannelConfig` に整形する。 */
export function parseChannelsConfig(raw: string): ChannelConfig[] {
	const trimmed = raw.trim();
	if (!trimmed) {
		return [];
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed) as unknown;
	} catch {
		throw new Error('CHANNELS_CONFIG: invalid JSON');
	}

	if (!Array.isArray(parsed)) {
		throw new Error('CHANNELS_CONFIG: expected a JSON array');
	}

	return parsed.map((item, i) => parseOneChannel(item, i));
}

function parseOneChannel(item: unknown, index: number): ChannelConfig {
	const prefix = `CHANNELS_CONFIG[${index}]`;
	if (!item || typeof item !== 'object') {
		throw new Error(`${prefix}: expected an object`);
	}

	const o = item as Record<string, unknown>;
	const channelId = requireString(o, 'channelId', prefix);
	const type = requireString(o, 'type', prefix);
	const label = requireString(o, 'label', prefix);

	// digestChannelId（任意）
	const digestChannelId = optionalString(o, 'digestChannelId', prefix);

	// canvasId（任意 — 旧フロー用）
	const canvasId = optionalString(o, 'canvasId', prefix);

	// reportWebhookUrl（任意）
	const reportWebhookUrl = optionalString(o, 'reportWebhookUrl', prefix);

	let ingestRange: ChannelIngestRange | undefined;
	if (o.ingestRange !== undefined && o.ingestRange !== null) {
		if (typeof o.ingestRange !== 'object') {
			throw new Error(`${prefix}.ingestRange: expected an object`);
		}
		const r = o.ingestRange as Record<string, unknown>;
		if (typeof r.oldestDaysAgo !== 'number' || !Number.isFinite(r.oldestDaysAgo)) {
			throw new Error(`${prefix}.ingestRange.oldestDaysAgo: expected a finite number`);
		}
		let latestDaysAgo = 0;
		if (r.latestDaysAgo !== undefined) {
			if (typeof r.latestDaysAgo !== 'number' || !Number.isFinite(r.latestDaysAgo)) {
				throw new Error(`${prefix}.ingestRange.latestDaysAgo: expected a finite number`);
			}
			latestDaysAgo = r.latestDaysAgo;
		}
		ingestRange = { oldestDaysAgo: r.oldestDaysAgo, latestDaysAgo };
	}

	return {
		channelId,
		type,
		label,
		...(digestChannelId !== undefined ? { digestChannelId } : {}),
		...(canvasId !== undefined ? { canvasId } : {}),
		...(reportWebhookUrl !== undefined ? { reportWebhookUrl } : {}),
		...(ingestRange !== undefined ? { ingestRange } : {}),
	};
}

function requireString(o: Record<string, unknown>, key: string, prefix: string): string {
	const v = o[key];
	if (typeof v !== 'string' || !v.trim()) {
		throw new Error(`${prefix}.${key}: expected a non-empty string`);
	}
	return v.trim();
}

function optionalString(o: Record<string, unknown>, key: string, prefix: string): string | undefined {
	if (o[key] === undefined || o[key] === null) return undefined;
	if (typeof o[key] !== 'string') {
		throw new Error(`${prefix}.${key}: expected a string`);
	}
	const v = (o[key] as string).trim();
	return v || undefined;
}
