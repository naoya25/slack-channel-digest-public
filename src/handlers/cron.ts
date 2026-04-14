import { parseChannelsConfig } from '../utils/parse-channels-config';
import { createSlackClient } from '../slack/ingest/client';
import { fetchHistory } from '../slack/ingest/history';
import { fetchUsers } from '../slack/ingest/users';
import { updateCanvas } from '../slack/output/canvas';
import { postReportToIncomingWebhook } from '../slack/output/incoming-webhook';
import { runStructuredDigest } from '../analysis/structured-digest';
import { getIngestWindowForChannel } from '../utils/ingest-window';

export async function handleCron(env: Env): Promise<void> {
	const channels = parseChannelsConfig(env.CHANNELS_CONFIG);
	if (channels.length === 0) {
		console.warn('CHANNELS_CONFIG is empty — no channels to process');
		return;
	}

	for (const channel of channels) {
		try {
			const { oldest, latest, targetDate, ingestPeriodLabelJa } = getIngestWindowForChannel(channel);
			console.log(`[${channel.label}] Start — channel: ${channel.channelId} | ingest ${ingestPeriodLabelJa}`);

			// 1. 取り込み: メッセージ取得と表示名の解決
			const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
			const messages = await fetchHistory(slackClient, channel.channelId, oldest, latest);
			console.log(`[${channel.label}] Fetched ${messages.length} messages`);

			const userIds = [...new Set(messages.map((m) => m.user))];
			const users = await fetchUsers(slackClient, userIds, env.THREAD_STORE);

			// 2. 分析: structured-digest（Pass 1/2 LLM → Markdown）
			const result = await runStructuredDigest({
				messages,
				users,
				channelConfig: channel,
				targetDate,
				ingestPeriodLabelJa,
				llmApiKey: env.JAPANAI_API_KEY,
				llmUserId: env.JAPANAI_USER_ID,
			});

			// 3. 出力: チャンネル設定の Webhook があればそこへ、なければ Canvas のみ
			const webhookUrl = channel.reportWebhookUrl?.trim();
			if (webhookUrl) {
				await postReportToIncomingWebhook(webhookUrl, channel.label, result.markdown);
				console.log(`[${channel.label}] Incoming Webhook post`);
			} else if (channel.canvasId) {
				await updateCanvas(slackClient, channel.canvasId, result.markdown);
				console.log(`[${channel.label}] Canvas updated — ${channel.canvasId}`);
			} else {
				console.warn(`[${channel.label}] canvasId も reportWebhookUrl も未設定 — 出力先なし`);
			}
		} catch (err) {
			// 1 チャンネルの失敗で他チャンネルの処理を止めない
			console.error(`[${channel.label}] Failed:`, err);
		}
	}
}
