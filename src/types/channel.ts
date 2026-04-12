/**
 * メッセージ取得の時間範囲。いずれも「Cron 実行時刻」を基準にした **何日前か**（日単位・整数）。
 * Slack `conversations.history` の `oldest` / `latest`（Unix 秒）は、実行時に `latestDaysAgo` / `oldestDaysAgo` から算出する。
 */
export interface ChannelIngestRange {
	/**
	 * 取得の下端（より過去）。実行時刻からこの日数だけさかのぼった瞬間を `oldest` にする。
	 * 例: `7` なら「いまから 7 日前」の時刻。
	 */
	oldestDaysAgo: number;
	/**
	 * 取得の上端（より新しい方）。実行時刻からこの日数だけさかのぼった瞬間を `latest` にする。
	 * `0` で実行直前まで。例: `1` なら「昨日このくらいの時刻」までで、直近 24 時間より手前を切る。
	 * @default 0
	 */
	latestDaysAgo?: number;
}

/**
 * 1 チャンネル分の設定。
 * Env の `CHANNELS_CONFIG`（string）を JSON 配列としてパースした各要素。
 * 必須: channelId, type, label。任意: digestChannelId, canvasId, reportWebhookUrl, ingestRange。
 */
export interface ChannelConfig {
	/** 分析対象: `conversations.history` で日報などを取得する Slack チャンネル ID（ソース） */
	channelId: string;
	/** 分析の種類。現状は `structured-digest` のみ（`runStructuredDigest` と対応） */
	type: string;
	/** ログや Webhook プレフィックス用の表示名 */
	label: string;
	/** レガシー: ダイジェストチャンネルへの投稿用。現行の朝・夕 cron は Canvas のみで未使用。 */
	digestChannelId?: string;
	/** 朝会・夕会でレポートを書き込む Canvas の ID（朝・夕 cron では必須）。 */
	canvasId?: string;
	/**
	 * 設定時はこちらへ Incoming Webhook で投稿し、Canvas 更新は行わない（旧フロー用）。
	 * URL は投稿権限を持つため、公開リポジトリでは載せないこと。
	 */
	reportWebhookUrl?: string;
	/**
	 * 分析対象メッセージの取得範囲。省略時は `oldestDaysAgo: 7`・`latestDaysAgo: 0`（従来どおり直近 7 日）。
	 */
	ingestRange?: ChannelIngestRange;
}
