/** KV に保存する朝会スナップショット（Canvas 夕会用の canvasData が主用途） */
export interface MorningThreadRecord {
	/** 旧フロー: 日付ヘッダー `chat.postMessage` の TS */
	dateTs?: string;
	/** 旧フロー: userId → 親投稿 TS / 表示名 */
	users?: Record<string, { ts: string; displayName: string }>;
	/** 朝会の分析結果。夕会で Canvas を更新するときに利用する。 */
	canvasData?: {
		dateStats: string;
		perUser: Record<string, { displayName: string; coreSummary: string }>;
		similarGroups?: Array<{ userIds: string[]; rationale: string }>;
	};
}

/** KV キーのプレフィックス */
const KEY_PREFIX = 'morning';

/** KV キーを生成（例: `morning:2026-04-10:C0AP4C8HJR2`） */
function buildKey(isoDate: string, channelId: string): string {
	return `${KEY_PREFIX}:${isoDate}:${channelId}`;
}

/**
 * 朝会の KV レコードを保存する。TTL は 30 日。
 */
export async function saveMorningThreads(
	kv: KVNamespace,
	isoDate: string,
	channelId: string,
	record: MorningThreadRecord,
): Promise<void> {
	await kv.put(buildKey(isoDate, channelId), JSON.stringify(record), {
		expirationTtl: 60 * 60 * 24 * 30, // 30 日
	});
}

/**
 * 朝会投稿の TS を KV から取得する。存在しなければ null。
 */
export async function loadMorningThreads(
	kv: KVNamespace,
	isoDate: string,
	channelId: string,
): Promise<MorningThreadRecord | null> {
	const raw = await kv.get(buildKey(isoDate, channelId));
	if (!raw) return null;
	return JSON.parse(raw) as MorningThreadRecord;
}
