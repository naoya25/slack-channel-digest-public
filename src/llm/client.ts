import OpenAI from 'openai';
import type { LLMMessage } from '../types/llm';
import { formatErrorChain } from '../utils/format-error-for-log';

export function createOpenAIClient(apiKey: string): OpenAI {
	return new OpenAI({
		apiKey,
		// nodejs_compat 下で Node の fetch が選ばれると Workers 外の挙動になり得るため明示
		fetch: globalThis.fetch,
		// 一時的な接続切れ向け（デフォルト 2 に上乗せ）
		maxRetries: 4,
	});
}

export async function chatCompletion(
	client: OpenAI,
	messages: LLMMessage[],
	options?: {
		model?: string;
		maxTokens?: number;
		jsonMode?: boolean;
	},
): Promise<string> {
	const model = options?.model ?? 'gpt-4o-mini';
	const maxTokens = options?.maxTokens ?? 800;
	const jsonMode = Boolean(options?.jsonMode);

	const charsByRole = messages.map((m) => ({ role: m.role, chars: m.content.length }));
	const totalChars = charsByRole.reduce((s, x) => s + x.chars, 0);
	const roleSummary = charsByRole.map((x) => `${x.role}=${x.chars}`).join(', ');
	console.log(
		`[LLM] request — model=${model} max_tokens=${maxTokens} jsonMode=${jsonMode} | ` +
			`messages=${messages.length} totalChars=${totalChars} (${roleSummary})`,
	);

	try {
		const response = await client.chat.completions.create({
			model,
			messages,
			max_tokens: maxTokens,
			...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
		});
		const out = response.choices[0]?.message?.content ?? '';
		console.log(`[LLM] response — outChars=${out.length}`);
		return out;
	} catch (err) {
		console.error(`[LLM] chat.completions.create failed: ${formatErrorChain(err)}`);
		throw err;
	}
}
