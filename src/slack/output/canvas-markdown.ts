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
	/** Pass2 の類似グループ（スイムレーン表示用） */
	similarGroups?: Array<{ userIds: string[]; rationale: string }>;
}

/** Canvas 描画に渡す夕会データの型 */
export interface EveningCanvasData {
	perUser: Record<string, { detailedSummary: string }>;
	/** Pass2 チーム横断（累積）— 全体サマリーに続けて表示 */
	teamInsights?: string;
}

/**
 * 類似グループに基づいてスイムレーンを組み立てるヘルパー。
 *
 * - 2名以上が所属するグループのみレーンとして出力する。
 * - `perUser` に存在しない userId はスキップする。
 * - グループに属さなかったメンバーは返り値の `ungroupedIds` に含める。
 */
function buildSwimlanes(
	similarGroups: Array<{ userIds: string[]; rationale: string }> | undefined,
	perUserIds: string[],
): { lanes: Array<{ rationale: string; memberIds: string[] }>; ungroupedIds: string[] } {
	const assignedIds = new Set<string>();
	const lanes: Array<{ rationale: string; memberIds: string[] }> = [];

	for (const group of similarGroups ?? []) {
		const validMembers = group.userIds.filter((id) => perUserIds.includes(id));
		if (validMembers.length < 2) continue;
		lanes.push({ rationale: group.rationale, memberIds: validMembers });
		for (const id of validMembers) assignedIds.add(id);
	}

	const ungroupedIds = perUserIds.filter((id) => !assignedIds.has(id));
	return { lanes, ungroupedIds };
}

/**
 * 朝会フェーズ終了後に Canvas へ書き込む Markdown を組み立てる。
 * `similarGroups` を使ってスイムレーン形式でグループ化する。
 * グループに属さないメンバーは末尾の「その他のメンバー」セクションに集約する。
 *
 * 出力イメージ（グループあり）:
 * ```
 * # 4/10(金) 日報ダイジェスト（朝会時点）
 * ## チームサマリー
 * ...
 * ---
 * ## グループ 1 — API設計と実装に取り組むメンバー
 * ### Person A
 * ...
 * ### Person B
 * ...
 * ---
 * ## その他のメンバー
 * ### Person C
 * ...
 * ```
 */
export function buildMorningCanvasMarkdown(dateLabel: string, data: MorningCanvasData): string {
	const lines: string[] = [
		`# ${dateLabel} 日報ダイジェスト（朝会時点）`,
		'',
		'## チームサマリー',
		data.dateStats,
		'',
		'---',
		'',
	];

	const perUserIds = Object.keys(data.perUser);
	const { lanes, ungroupedIds } = buildSwimlanes(data.similarGroups, perUserIds);

	if (lanes.length > 0) {
		for (let i = 0; i < lanes.length; i++) {
			const { rationale, memberIds } = lanes[i];
			lines.push(`## グループ ${i + 1} — ${rationale}`, '');
			for (const userId of memberIds) {
				const { displayName, coreSummary } = data.perUser[userId];
				lines.push(`### ${displayName}`, '', coreSummary, '');
			}
			lines.push('---', '');
		}

		if (ungroupedIds.length > 0) {
			lines.push('## その他のメンバー', '');
			for (const userId of ungroupedIds) {
				const { displayName, coreSummary } = data.perUser[userId];
				lines.push(`### ${displayName}`, '', coreSummary, '');
			}
			lines.push('---', '');
		}
	} else {
		// グループ情報がない場合は全員を並列に列挙するフォールバック
		for (const { displayName, coreSummary } of Object.values(data.perUser)) {
			lines.push(`### ${displayName}`, '', coreSummary, '');
		}
		lines.push('---', '');
	}

	lines.push('*このレポートは AI が自動生成しました。詳細は日報チャンネルの原文をご確認ください。*');
	return lines.join('\n');
}

/**
 * 夕会フェーズ終了後に Canvas を上書きする Markdown を組み立てる。
 * 朝会の `similarGroups` を引き継いでスイムレーン形式を維持する。
 * 各レーン内では当日サマリー（朝会）と累積サマリー（夕会）を並べて表示する。
 *
 * 出力イメージ:
 * ```
 * # 4/10(金) 日報ダイジェスト（夕会時点・更新済み）
 * ## チームサマリー
 * ...
 * ---
 * ## グループ 1 — API設計と実装に取り組むメンバー
 * ### Person A
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
		'## チームサマリー',
		morning.dateStats,
		'',
	];

	if (evening.teamInsights?.trim()) {
		lines.push('### チーム横断（夕会・累積）', evening.teamInsights.trim(), '');
	}

	lines.push('---', '');

	const perUserIds = Object.keys(morning.perUser);
	const { lanes, ungroupedIds } = buildSwimlanes(morning.similarGroups, perUserIds);

	function pushPersonSection(userId: string): void {
		const { displayName, coreSummary } = morning.perUser[userId];
		const detailedSummary = evening.perUser[userId]?.detailedSummary ?? '';
		lines.push(`### ${displayName}`, '', '**当日サマリー（朝会）**', coreSummary, '');
		if (detailedSummary) {
			lines.push('**累積サマリー（夕会）**', detailedSummary, '');
		}
	}

	if (lanes.length > 0) {
		for (let i = 0; i < lanes.length; i++) {
			const { rationale, memberIds } = lanes[i];
			lines.push(`## グループ ${i + 1} — ${rationale}`, '');
			for (const userId of memberIds) pushPersonSection(userId);
			lines.push('---', '');
		}

		if (ungroupedIds.length > 0) {
			lines.push('## その他のメンバー', '');
			for (const userId of ungroupedIds) pushPersonSection(userId);
			lines.push('---', '');
		}
	} else {
		for (const userId of perUserIds) pushPersonSection(userId);
		lines.push('---', '');
	}

	lines.push('*このレポートは AI が自動生成しました。詳細は日報チャンネルの原文をご確認ください。*');
	return lines.join('\n');
}
