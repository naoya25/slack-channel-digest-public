import type { MorningAnalysisInput, MorningAnalysisOutput } from '../types/digest';
import { createOpenAIClient, chatCompletion } from '../llm/client';
import { groupBy } from '../utils/group-by';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { buildMorningPersonPass1Prompt, buildTeamPass2Prompt } from './digest-llm/prompts';
import {
	emptyTeamSynthesis,
	formatPersonExtractionMarkdown,
	formatTeamSynthesisForMorningCanvas,
	joinMessagesChronological,
	parsePersonExtraction,
	parseTeamSynthesis,
	sanitizeTeamSynthesis,
	truncateMiddle,
} from './digest-llm/format';
import type { PersonExtractionWithId } from './digest-llm/types';

const MAX_CONTEXT_CHARS = 14_000;

/**
 * 朝会向け分析: 前営業日の日報から Pass1（個人の時系列・特徴）→ Pass2（類似・知見マッチング）を経て Canvas 用 Markdown を組み立てる。
 */
export async function runMorningDigest(input: MorningAnalysisInput): Promise<MorningAnalysisOutput> {
	const { messages, users, dateLabel, openaiApiKey } = input;
	const userMessages = groupBy(messages, (m) => m.user);

	if (userMessages.size === 0) {
		return {
			dateStats: `**${dateLabel} の日報**\n\n対象の投稿がありませんでした。`,
			perUser: new Map(),
			similarGroups: [],
		};
	}

	const llm = createOpenAIClient(openaiApiKey);
	const validIds = new Set(userMessages.keys());

	const entries = Array.from(userMessages.entries());
	const extractions: PersonExtractionWithId[] = await mapWithConcurrency(entries, 2, async ([userId, msgs]) => {
		const username = users.get(userId) ?? userId;
		let text = joinMessagesChronological(msgs, MAX_CONTEXT_CHARS);
		text = truncateMiddle(text, MAX_CONTEXT_CHARS);
		const { system, user } = buildMorningPersonPass1Prompt(username, text, dateLabel);

		const raw = await chatCompletion(
			llm,
			[
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			{ jsonMode: true, maxTokens: 900 },
		);

		const parsed = parsePersonExtraction(raw, username);
		return { userId, ...parsed };
	});

	const { system: sys2, user: user2 } = buildTeamPass2Prompt(
		extractions,
		'morning',
		`前営業日 ${dateLabel} の日報のみを対象`,
	);

	const raw2 = await chatCompletion(
		llm,
		[
			{ role: 'system', content: sys2 },
			{ role: 'user', content: user2 },
		],
		{ jsonMode: true, maxTokens: 2000 },
	);

	let synthesis = parseTeamSynthesis(raw2);
	if (!synthesis) synthesis = emptyTeamSynthesis('横断分析の結果を JSON として解釈できませんでした。');
	synthesis = sanitizeTeamSynthesis(synthesis, validIds);

	const dateStats = [
		`**${dateLabel} の日報サマリー**`,
		'',
		formatTeamSynthesisForMorningCanvas(synthesis, users, extractions.length, {
			anonymousTeamSummary: true,
		}),
	].join('\n');

	const perUser = new Map<string, string>();
	for (const e of extractions) {
		// 見出しは canvas-markdown 側で displayName の H3 を使うため、本文のみ
		const block = [`_コアサマリー（${dateLabel}）_`, '', formatPersonExtractionMarkdown(e)].join('\n');
		perUser.set(e.userId, block);
	}

	return { dateStats, perUser, similarGroups: synthesis.similarGroups };
}
