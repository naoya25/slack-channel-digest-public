import type { EveningAnalysisInput, EveningAnalysisOutput } from '../types/digest';
import { createJapanAIClient, chatCompletion } from '../llm/client';
import { groupBy } from '../utils/group-by';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { buildEveningPersonPass1Prompt, buildTeamPass2Prompt } from './digest-llm/prompts';
import {
	emptyTeamSynthesis,
	formatPersonExtractionMarkdown,
	formatTeamSynthesisForEveningCanvas,
	joinMessagesChronological,
	parsePersonExtraction,
	parseTeamSynthesis,
	sanitizeTeamSynthesis,
	truncateMiddle,
} from './digest-llm/format';
import type { PersonExtractionWithId } from './digest-llm/types';

const MAX_CONTEXT_CHARS = 16_000;

/**
 * 夕会向け分析: 年度累積の日報から Pass1（個人の累積の流れ・特徴）→ Pass2（類似・知見マッチング）を経て Canvas 追記用テキストを組み立てる。
 */
export async function runEveningDigest(input: EveningAnalysisInput): Promise<EveningAnalysisOutput> {
	const { messages, users, dateLabel, llmApiKey, llmUserId } = input;
	const userMessages = groupBy(messages, (m) => m.user);

	if (userMessages.size === 0) {
		return { perUser: new Map(), teamInsights: undefined };
	}

	const llm = createJapanAIClient(llmApiKey, llmUserId);
	const validIds = new Set(userMessages.keys());

	const entries = Array.from(userMessages.entries());
	const extractions: PersonExtractionWithId[] = await mapWithConcurrency(entries, 2, async ([userId, msgs]) => {
		const username = users.get(userId) ?? userId;
		let text = joinMessagesChronological(msgs, MAX_CONTEXT_CHARS);
		text = truncateMiddle(text, MAX_CONTEXT_CHARS);
		const { system, user } = buildEveningPersonPass1Prompt(username, text);

		const raw = await chatCompletion(
			llm,
			[
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
			{ jsonMode: true, maxTokens: 1200 },
		);

		const parsed = parsePersonExtraction(raw, username);
		return { userId, ...parsed };
	});

	const { system: sys2, user: user2 } = buildTeamPass2Prompt(
		extractions,
		'evening',
		`会計年度開始（4/1）以降〜現在までの累積日報（基準日ラベル: ${dateLabel}）`,
	);

	const raw2 = await chatCompletion(
		llm,
		[
			{ role: 'system', content: sys2 },
			{ role: 'user', content: user2 },
		],
		{ jsonMode: true, maxTokens: 2200 },
	);

	let synthesis = parseTeamSynthesis(raw2);
	if (!synthesis) synthesis = emptyTeamSynthesis('夕会の横断分析を JSON として解釈できませんでした。');
	synthesis = sanitizeTeamSynthesis(synthesis, validIds);
	const teamInsights = formatTeamSynthesisForEveningCanvas(synthesis, users, extractions.length);

	const perUser = new Map<string, string>();
	for (const e of extractions) {
		// 見出しは canvas-markdown 側で displayName の H3。本文はメンションなし
		const block = ['_累積サマリー（年度初め〜現在）_', '', formatPersonExtractionMarkdown(e)].join('\n');
		perUser.set(e.userId, block);
	}

	return { perUser, teamInsights };
}
