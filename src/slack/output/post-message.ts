import type { SlackAPIClient } from 'slack-cloudflare-workers';

/** chat.postMessage のレスポンス（client.call 用） */
interface PostMessageResult {
	ok: boolean;
	ts?: string;
	error?: string;
}

/**
 * チャンネルにトップレベルのメッセージを投稿し、メッセージ TS を返す。
 */
export async function postMessage(
	client: SlackAPIClient,
	channelId: string,
	text: string,
): Promise<string> {
	const result = (await client.call('chat.postMessage', {
		channel: channelId,
		text,
	})) as PostMessageResult;

	if (!result.ok || !result.ts) {
		throw new Error(`chat.postMessage failed: ${result.error ?? 'no ts returned'}`);
	}
	return result.ts;
}

/**
 * 既存メッセージのスレッドに返信する。
 */
export async function replyToThread(
	client: SlackAPIClient,
	channelId: string,
	threadTs: string,
	text: string,
): Promise<void> {
	const result = (await client.call('chat.postMessage', {
		channel: channelId,
		text,
		thread_ts: threadTs,
	})) as PostMessageResult;

	if (!result.ok) {
		throw new Error(`chat.postMessage (thread reply) failed: ${result.error}`);
	}
}
