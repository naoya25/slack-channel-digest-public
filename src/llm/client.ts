import type { LLMMessage } from '../types/llm';
import { formatErrorChain } from '../utils/format-error-for-log';

const JAPAN_AI_API_URL = 'https://api.japan-ai.co.jp/chat/v2';

export interface JapanAIClient {
	apiKey: string;
	userId: string;
}

export function createJapanAIClient(apiKey: string, userId: string): JapanAIClient {
	return { apiKey, userId };
}

const RETRY_MAX = 4;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/** リトライ対象かどうか（ネットワーク例外・429・5xx） */
function isRetryable(err: unknown): boolean {
	if (err instanceof RetryableHttpError) return true;
	// fetch 自体が投げるネットワーク例外
	if (err instanceof TypeError) return true;
	return false;
}

class RetryableHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly retryAfterMs?: number,
	) {
		super(message);
	}
}

/** 指数バックオフ（±10% ジッター）、Retry-After があればそちらを優先 */
function backoffMs(attempt: number, retryAfterMs?: number): number {
	if (retryAfterMs != null) return Math.min(retryAfterMs, RETRY_MAX_MS);
	const exp = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
	return exp * (0.9 + Math.random() * 0.2); // ±10% jitter
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * jsonMode 応答を正規化する。
 * コードフェンス除去 → 最初の {...} / [...] 抽出 → JSON.parse で検証。
 * 有効な JSON が見つからなければ例外を投げる。
 */
function extractJson(raw: string): string {
	// コードフェンス（```json ... ``` / ``` ... ```）を除去
	const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

	// 最初の { または [ から対応する閉じ括弧までを抽出
	const start = stripped.search(/[{[]/);
	if (start === -1) throw new Error(`[LLM] jsonMode: no JSON object/array found in response — raw="${raw.slice(0, 200)}"`);

	const openChar = stripped[start];
	const closeChar = openChar === '{' ? '}' : ']';
	const end = stripped.lastIndexOf(closeChar);
	if (end === -1) throw new Error(`[LLM] jsonMode: unmatched "${openChar}" in response — raw="${raw.slice(0, 200)}"`);

	const candidate = stripped.slice(start, end + 1);

	// parse で構造を検証（失敗なら例外が伝播する）
	JSON.parse(candidate);
	return candidate;
}

/** messages 配列を JAPAN AI の単一 prompt 文字列に変換する */
function messagesToPrompt(messages: LLMMessage[], jsonMode: boolean): string {
	const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
	const otherParts = messages.filter((m) => m.role !== 'system').map((m) => m.content);
	let prompt = [...systemParts, ...otherParts].join('\n\n');
	if (jsonMode) {
		prompt += '\n\n必ず有効なJSONオブジェクトのみを返してください。説明文は不要です。';
	}
	return prompt;
}

export async function chatCompletion(
	client: JapanAIClient,
	messages: LLMMessage[],
	options?: {
		model?: string;
		jsonMode?: boolean;
	},
): Promise<string> {
	const model = options?.model ?? 'gemini-2.5-flash';
	const jsonMode = Boolean(options?.jsonMode);

	const charsByRole = messages.map((m) => ({ role: m.role, chars: m.content.length }));
	const totalChars = charsByRole.reduce((s, x) => s + x.chars, 0);
	const roleSummary = charsByRole.map((x) => `${x.role}=${x.chars}`).join(', ');
	console.log(
		`[LLM] request — model=${model} jsonMode=${jsonMode} | ` +
			`messages=${messages.length} totalChars=${totalChars} (${roleSummary})`,
	);

	const prompt = messagesToPrompt(messages, jsonMode);
	const body = JSON.stringify({ prompt, model, userId: client.userId });

	let lastErr: unknown;
	for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
		if (attempt > 0) {
			const delay = backoffMs(attempt - 1, lastErr instanceof RetryableHttpError ? lastErr.retryAfterMs : undefined);
			console.warn(`[LLM] retry ${attempt}/${RETRY_MAX} — waiting ${Math.round(delay)}ms`);
			await sleep(delay);
		}

		try {
			const res = await fetch(JAPAN_AI_API_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${client.apiKey}`,
					'Content-Type': 'application/json',
				},
				body,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '(body unreadable)');
				if (res.status === 429 || res.status >= 500) {
					const retryAfterSec = res.headers.get('Retry-After');
					const retryAfterMs = retryAfterSec != null ? parseFloat(retryAfterSec) * 1000 : undefined;
					throw new RetryableHttpError(res.status, `JAPAN AI API error: ${res.status} ${res.statusText} — ${text}`, retryAfterMs);
				}
				throw new Error(`JAPAN AI API error: ${res.status} ${res.statusText} — ${text}`);
			}

			const data = (await res.json()) as { status?: string; chatMessage?: string };

			if (data.status && data.status !== 'succeeded') {
				throw new Error(`JAPAN AI API returned status="${data.status}"`);
			}

			const raw = data.chatMessage ?? '';
			const out = jsonMode ? extractJson(raw) : raw;
			console.log(`[LLM] response — outChars=${out.length}`);
			return out;
		} catch (err) {
			lastErr = err;
			if (!isRetryable(err) || attempt === RETRY_MAX) {
				console.error(`[LLM] chatCompletion failed: ${formatErrorChain(err)}`);
				throw err;
			}
		}
	}

	// ループを抜けることはないが TypeScript の型推論を満たすために
	throw lastErr;
}
