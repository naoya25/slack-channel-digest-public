import type { SlackMessage } from './slack';

// ---------------------------------------------------------------------------
// 朝会フェーズ
// ---------------------------------------------------------------------------

/** 朝会分析への入力 */
export interface MorningAnalysisInput {
	/** 前営業日のメッセージ（全ユーザー分） */
	messages: SlackMessage[];
	/** userId → 表示名 */
	users: Map<string, string>;
	/** 前営業日ラベル（例: `4/10(金)`） */
	dateLabel: string;
	openaiApiKey: string;
}

/** 朝会分析の出力 */
export interface MorningAnalysisOutput {
	/** チャンネル全体の統計サマリー（Markdown）— 日付ヘッダーのスレッドに投稿 */
	dateStats: string;
	/** userId → 個人のコアサマリー（Markdown）— 各ユーザーのスレッドに投稿 */
	perUser: Map<string, string>;
}

// ---------------------------------------------------------------------------
// 夕会フェーズ
// ---------------------------------------------------------------------------

/** 夕会分析への入力 */
export interface EveningAnalysisInput {
	/** 年度始め（4/1）以降の全メッセージ */
	messages: SlackMessage[];
	/** userId → 表示名 */
	users: Map<string, string>;
	/** 前営業日ラベル（例: `4/10(金)`）— プロンプト用 */
	dateLabel: string;
	openaiApiKey: string;
}

/** 夕会分析の出力 */
export interface EveningAnalysisOutput {
	/** userId → 累積・人ベースの詳細サマリー（Markdown）— 朝会スレッドへの返信として投稿 */
	perUser: Map<string, string>;
	/** Pass2 によるチーム横断（累積）— Canvas の全体サマリー直下に追記 */
	teamInsights?: string;
}
