import { SECONDS_PER_DAY } from '../constants/time';
import type { ChannelConfig } from '../types/channel';

/**
 * `oldest` / `latest`（Unix 秒）を JST の日付表記で示す（プロンプト・見出し用）。
 */
export function formatIngestPeriodLabelJa(oldestUnix: number, latestUnix: number): string {
	const opts: Intl.DateTimeFormatOptions = {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	};
	const start = new Date(oldestUnix * 1000).toLocaleDateString('ja-JP', opts);
	const end = new Date(latestUnix * 1000).toLocaleDateString('ja-JP', opts);
	if (start === end) {
		return `${start}（JST）`;
	}
	return `${start}〜${end}（JST）`;
}

const DEFAULT_OLDEST_DAYS_AGO = 7;
const DEFAULT_LATEST_DAYS_AGO = 0;

/**
 * チャンネル設定に従い `conversations.history` 用の窓と、プロンプト用ラベルを返す。
 * `targetDate` はレポート見出し・プロンプトの基準（実行時の「いま」）。
 */
export function getIngestWindowForChannel(
	channel: ChannelConfig,
	nowMs: number = Date.now(),
): { oldest: number; latest: number; targetDate: Date; ingestPeriodLabelJa: string } {
	const oldestDaysAgo = channel.ingestRange?.oldestDaysAgo ?? DEFAULT_OLDEST_DAYS_AGO;
	const latestDaysAgo = channel.ingestRange?.latestDaysAgo ?? DEFAULT_LATEST_DAYS_AGO;

	if (!Number.isInteger(oldestDaysAgo) || oldestDaysAgo < 0) {
		throw new Error(`${channel.label}: ingestRange.oldestDaysAgo must be a non-negative integer`);
	}
	if (!Number.isInteger(latestDaysAgo) || latestDaysAgo < 0) {
		throw new Error(`${channel.label}: ingestRange.latestDaysAgo must be a non-negative integer`);
	}
	if (oldestDaysAgo <= latestDaysAgo) {
		throw new Error(`${channel.label}: ingestRange.oldestDaysAgo (${oldestDaysAgo}) must be greater than latestDaysAgo (${latestDaysAgo})`);
	}

	const nowSec = Math.floor(nowMs / 1000);
	const latest = nowSec - latestDaysAgo * SECONDS_PER_DAY;
	const oldest = nowSec - oldestDaysAgo * SECONDS_PER_DAY;

	if (oldest >= latest) {
		throw new Error(`${channel.label}: invalid ingest window (oldest >= latest)`);
	}

	return {
		oldest,
		latest,
		targetDate: new Date(nowMs),
		ingestPeriodLabelJa: formatIngestPeriodLabelJa(oldest, latest),
	};
}
