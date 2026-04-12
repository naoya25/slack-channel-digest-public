/** Slack `conversations.history` のメッセージ（本パイプラインが参照するフィールド） */
export interface SlackMessage {
	ts: string;
	user: string;
	text: string;
	type: string;
	subtype?: string;
	bot_id?: string;
	thread_ts?: string;
}
