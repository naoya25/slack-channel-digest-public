import type { SlackAPIClient } from 'slack-cloudflare-workers';
import type { SlackMessage } from '../../types/slack';

/**
 * 指定チャンネルで [oldest, latest]（Unix 秒）に含まれるメッセージをすべて取得する。
 * カーソル付きページネーションを内側で処理する。
 * ボット・subtype 付きなど、通常のユーザーメッセージ以外は除外する。
 */
export async function fetchHistory(
	client: SlackAPIClient,
	channelId: string,
	oldest: number,
	latest: number,
): Promise<SlackMessage[]> {
	const messages: SlackMessage[] = [];
	let cursor: string | undefined;

	do {
		const result = await client.conversations.history({
			channel: channelId,
			oldest: oldest.toString(),
			latest: latest.toString(),
			limit: 200,
			...(cursor ? { cursor } : {}),
		});

		if (!result.ok) {
			throw new Error(`conversations.history failed: ${result.error}`);
		}

		const batch = (result.messages ?? []) as SlackMessage[];
		messages.push(
			// subtype なし・ボットでない通常のユーザーメッセージのみ
			...batch.filter((m) => m.type === 'message' && m.user && !m.subtype && !m.bot_id),
		);

		cursor = result.response_metadata?.next_cursor || undefined;
	} while (cursor);

	return messages;
}
