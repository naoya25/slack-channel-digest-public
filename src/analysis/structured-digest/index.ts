import type { AnalysisInput, AnalysisOutput } from '../../types/analysis';
import { createJapanAIClient, chatCompletion } from '../../llm/client';
import { groupBy } from '../../utils/group-by';
import { buildStructuredIngestBatchPass1Prompt, buildTeamPass2Prompt } from '../digest-llm/prompts';
import {
	emptyTeamSynthesis,
	formatStructuredDigestMarkdown,
	joinMessagesChronological,
	parseBatchPersonExtractions,
	parseTeamSynthesis,
	sanitizeTeamSynthesis,
	truncateMiddle,
} from '../digest-llm/format';

const MAX_CONTEXT_CHARS = 14_000;
/** Pass1 の LLM 呼び出し上限（人数をおおむね等分） */
const STRUCTURED_PASS1_MAX_BATCHES = 3;
/** バッチ 1 回あたりの入力文字のおおよその上限（複数人で分割） */
const PASS1_BATCH_INPUT_BUDGET_CHARS = 120_000;

function splitIntoAtMostChunks<T>(items: T[], maxChunks: number): T[][] {
	const n = items.length;
	if (n === 0) return [];
	const k = Math.min(maxChunks, n);
	const base = Math.floor(n / k);
	const rem = n % k;
	const chunks: T[][] = [];
	let start = 0;
	for (let i = 0; i < k; i++) {
		const size = i < rem ? base + 1 : base;
		chunks.push(items.slice(start, start + size));
		start += size;
	}
	return chunks;
}

/** ingest 済みメッセージから Pass 1/2 の LLM 処理を経て Canvas / Webhook 用 Markdown を生成する */
export async function runStructuredDigest(input: AnalysisInput): Promise<AnalysisOutput> {
	const { messages, users, targetDate, ingestPeriodLabelJa, llmApiKey, llmUserId, channelConfig } = input;
	const label = channelConfig.label;
	const llm = createJapanAIClient(llmApiKey, llmUserId);

	const userMessages = groupBy(messages, (m) => m.user);

	if (userMessages.size === 0) {
		const dateStr = targetDate.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
		return {
			markdown: `# ${dateStr} 時点 · 日報分析レポート（${ingestPeriodLabelJa}）\n\nこの集計期間の対象チャンネルに日報が見つかりませんでした。`,
		};
	}

	const validIds = new Set(userMessages.keys());

	const entries = Array.from(userMessages.entries());
	const chunks = splitIntoAtMostChunks(entries, STRUCTURED_PASS1_MAX_BATCHES);

	const extractionsNested = await Promise.all(
		chunks.map(async (chunk, batchIndex) => {
			const perUserCap = Math.min(
				MAX_CONTEXT_CHARS,
				Math.max(2_000, Math.floor(PASS1_BATCH_INPUT_BUDGET_CHARS / chunk.length)),
			);
			const members = chunk.map(([userId, msgs]) => {
				const username = users.get(userId) ?? userId;
				let text = joinMessagesChronological(msgs, perUserCap);
				text = truncateMiddle(text, perUserCap);
				return { userId, username, chronologicalReportText: text };
			});

			const { system, user } = buildStructuredIngestBatchPass1Prompt(members, ingestPeriodLabelJa);
			const orderedIds = members.map((m) => m.userId);

			console.log(
				`[${label}][Pass 1 batch ${batchIndex + 1}/${chunks.length}] LLM input — ` +
					`people=${chunk.length} perUserCapChars=${perUserCap} | ` +
					`systemChars=${system.length} userChars=${user.length}`,
			);

			const raw = await chatCompletion(
				llm,
				[
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				{ jsonMode: true },
			);

			console.log(`[${label}][Pass 1 batch ${batchIndex + 1}/${chunks.length}] LLM raw — ${raw.length} chars`);

			const parsedList = parseBatchPersonExtractions(raw, orderedIds, (id) => users.get(id) ?? id);
			for (const p of parsedList) {
				console.log(
					`[${label}][Pass 1] parsed — userId=${p.userId} timelineChars=${p.timelineNarrative.length}`,
				);
			}
			return parsedList;
		}),
	);

	const extractions = extractionsNested.flat();

	const { system: sys2, user: user2 } = buildTeamPass2Prompt(
		extractions,
		'structured',
		ingestPeriodLabelJa,
	);

	console.log(
		`[${label}][Pass 2] LLM input — extractions=${extractions.length} | ` +
			`systemChars=${sys2.length} userChars=${user2.length}`,
	);

	const raw2 = await chatCompletion(
		llm,
		[
			{ role: 'system', content: sys2 },
			{ role: 'user', content: user2 },
		],
		{ jsonMode: true },
	);

	console.log(`[${label}][Pass 2] LLM raw response — ${raw2.length} chars`);

	let synthesis = parseTeamSynthesis(raw2);
	if (!synthesis) synthesis = emptyTeamSynthesis('横断分析の結果を JSON として解釈できませんでした。');
	synthesis = sanitizeTeamSynthesis(synthesis, validIds);

	const dateHeading = targetDate.toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'Asia/Tokyo',
	});

	const markdown = formatStructuredDigestMarkdown(dateHeading, ingestPeriodLabelJa, synthesis, extractions, users);
	console.log(`[${label}][Pass 2] markdown — ${markdown.length} chars`);

	return { markdown };
}
