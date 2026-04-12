/**
 * Canvas 出力用 Markdown の組み立てユーティリティ。
 *
 * 【使い方】
 * `CHANNELS_CONFIG` の `canvasId` を指定すると、morning / evening cron で Canvas のみ更新する。
 */

/** Slack Canvas API 用のユーザーメンション（https://docs.slack.dev/surfaces/canvases/） */
export function canvasUserMention(userId: string): string {
	return `![](@${userId})`;
}

/** Canvas 描画に渡す朝会データの型 */
export interface MorningCanvasData {
	dateStats: string;
	perUser: Record<string, { displayName: string; coreSummary: string }>;
}

/** Canvas 描画に渡す夕会データの型 */
export interface EveningCanvasData {
	perUser: Record<string, { detailedSummary: string }>;
	/** Pass2 チーム横断（累積）— 全体サマリーに続けて表示 */
	teamInsights?: string;
}

/**
 * 朝会フェーズ終了後に Canvas へ書き込む Markdown を組み立てる。
 * メンションなし（朝会時点ではまだ通知しない）。H3 見出しで人ごとに区切るスイムレーン形式。
 *
 * 出力イメージ:
 * ```
 * # 4/10(金) 日報ダイジェスト（朝会時点）
 * ## 全体サマリー
 * ...
 * ### Akito Shoji
 * ...
 * ```
 */
export function buildMorningCanvasMarkdown(dateLabel: string, data: MorningCanvasData): string {
	const lines: string[] = [
		`# ${dateLabel} 日報ダイジェスト（朝会時点）`,
		'',
		'## 全体サマリー',
		data.dateStats,
		'',
		'---',
		'',
	];

	for (const [, { displayName, coreSummary }] of Object.entries(data.perUser)) {
		lines.push(`### ${displayName}`, '', coreSummary, '');
	}

	lines.push('---', '*このレポートは AI が自動生成しました。詳細は日報チャンネルの原文をご確認ください。*');
	return lines.join('\n');
}

/**
 * 夕会フェーズ終了後に Canvas を上書きする Markdown を組み立てる。
 * 朝会データに夕会の累積サマリーを追記した完全版。
 * 人ごとの区切りは朝会と同様、メンションなしの H3 + displayName。
 *
 * 出力イメージ:
 * ```
 * # 4/10(金) 日報ダイジェスト（夕会時点・更新済み）
 * ## 全体サマリー
 * ...
 * ### Akito Shoji
 * **当日サマリー（朝会）**
 * ...
 * **累積サマリー（夕会）**
 * ...
 * ```
 */
export function buildEveningCanvasMarkdown(
	dateLabel: string,
	morning: MorningCanvasData,
	evening: EveningCanvasData,
): string {
	const lines: string[] = [
		`# ${dateLabel} 日報ダイジェスト（夕会時点・更新済み）`,
		'',
		'## 全体サマリー',
		morning.dateStats,
		'',
	];

	if (evening.teamInsights?.trim()) {
		lines.push('### チーム横断（夕会・累積）', evening.teamInsights.trim(), '');
	}

	lines.push('---', '');

	for (const [userId, { displayName, coreSummary }] of Object.entries(morning.perUser)) {
		const detailedSummary = evening.perUser[userId]?.detailedSummary ?? '';
		lines.push(
			`### ${displayName}`,
			'',
			'**当日サマリー（朝会）**',
			coreSummary,
			'',
		);
		if (detailedSummary) {
			lines.push('**累積サマリー（夕会）**', detailedSummary, '');
		}
	}

	lines.push('---', '*このレポートは AI が自動生成しました。詳細は日報チャンネルの原文をご確認ください。*');
	return lines.join('\n');
}
