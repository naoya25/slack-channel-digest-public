import type { ChannelConfig } from './channel';
import type { SlackMessage } from './slack';

/** 分析処理への入力（ingest 済み） */
export interface AnalysisInput {
	messages: SlackMessage[];
	/** userId → 表示名 */
	users: Map<string, string>;
	channelConfig: ChannelConfig;
	/** レポート見出し・プロンプトの基準日時（取得期間は cron 側で定義） */
	targetDate: Date;
	/** プロンプト・レポートに載せる取得期間の説明（例: JST の日付レンジ） */
	ingestPeriodLabelJa: string;
	openaiApiKey: string;
}

/** 分析処理の出力（Canvas / Webhook へ渡す Markdown） */
export interface AnalysisOutput {
	markdown: string;
}
