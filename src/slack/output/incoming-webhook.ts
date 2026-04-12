import {
	WEBHOOK_BACKOFF_CAP_MS,
	WEBHOOK_CHUNK_GAP_MS,
	WEBHOOK_CHUNK_TEXT_MAX,
	WEBHOOK_MAX_429_ATTEMPTS,
	WEBHOOK_RETRY_AFTER_MAX_MS,
} from '../../constants/incoming-webhook';
import { sleep } from '../../utils/sleep';
import { chunkMarkdownForWebhook, webhookChunkPrefix } from './webhook-chunking';

/**
 * Retry-After: 秒数（整数）または HTTP-date。
 * @returns 待機 ms（0 は「ヘッダなし・解釈不能」）
 */
function delayMsFromRetryAfter(res: Response): number {
	const raw = res.headers.get('Retry-After')?.trim();
	if (!raw) {
		return 0;
	}
	if (/^\d+$/.test(raw)) {
		const sec = parseInt(raw, 10);
		return Math.min(sec * 1000, WEBHOOK_RETRY_AFTER_MAX_MS);
	}
	const until = Date.parse(raw);
	if (!Number.isNaN(until)) {
		return Math.min(Math.max(0, until - Date.now()), WEBHOOK_RETRY_AFTER_MAX_MS);
	}
	return 0;
}

function assertWebhookResponseOk(body: string): void {
	try {
		const j = JSON.parse(body) as { ok?: boolean; error?: string };
		if (j.ok === false) {
			throw new Error(`Incoming Webhook: ${j.error ?? 'unknown'}`);
		}
	} catch (e) {
		if (e instanceof SyntaxError) {
			// 成功時は plain text "ok" など
		} else {
			throw e;
		}
	}
}

/**
 * 単一 POST。429 のときは Retry-After または指数バックオフで再試行する。
 */
async function postWebhookPayload(webhookUrl: string, payload: unknown): Promise<void> {
	for (let attempt = 1; attempt <= WEBHOOK_MAX_429_ATTEMPTS; attempt++) {
		const res = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		const lastBody = await res.text();

		if (res.status === 429) {
			if (attempt < WEBHOOK_MAX_429_ATTEMPTS) {
				let wait = delayMsFromRetryAfter(res);
				if (wait <= 0) {
					wait = Math.min(1000 * 2 ** (attempt - 1), WEBHOOK_BACKOFF_CAP_MS);
				}
				await sleep(wait);
				continue;
			}
			throw new Error(
				`Incoming Webhook rate limited (429) after ${WEBHOOK_MAX_429_ATTEMPTS} attempts: ${lastBody.slice(0, 200)}`,
			);
		}

		if (!res.ok) {
			throw new Error(`Incoming Webhook failed: ${res.status} ${lastBody.slice(0, 200)}`);
		}

		assertWebhookResponseOk(lastBody);
		return;
	}
}

/**
 * Slack Incoming Webhook でレポートを投稿する（URL に紐づくワークスペース／チャンネルへ）。
 * URL は秘密情報のため `.dev.vars` / `wrangler secret` のみに置くこと。
 */
export async function postReportToIncomingWebhook(
	webhookUrl: string,
	label: string,
	markdown: string,
): Promise<void> {
	const parts = chunkMarkdownForWebhook(markdown, label);
	const total = parts.length;

	for (let i = 0; i < parts.length; i++) {
		const prefix = webhookChunkPrefix(label, i, total);
		const text = prefix + parts[i];
		if (text.length > WEBHOOK_CHUNK_TEXT_MAX) {
			throw new Error(`Incoming Webhook chunk invariant: text exceeds WEBHOOK_CHUNK_TEXT_MAX (${WEBHOOK_CHUNK_TEXT_MAX})`);
		}

		await postWebhookPayload(webhookUrl, { text });

		if (i < parts.length - 1) {
			await sleep(WEBHOOK_CHUNK_GAP_MS);
		}
	}
}
