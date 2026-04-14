import { formatErrorChain } from '../utils/format-error-for-log';
import { parseChannelsConfig } from '../utils/parse-channels-config';
import { createSlackClient } from '../slack/ingest/client';
import { fetchHistory } from '../slack/ingest/history';
import { fetchUsers } from '../slack/ingest/users';
import { runMorningDigest } from '../analysis/morning-digest';
import { getPreviousBusinessDay } from '../utils/business-day';
import { saveMorningThreads } from '../utils/kv-thread-store';
import { updateCanvas } from '../slack/output/canvas';
import { buildMorningCanvasMarkdown } from '../slack/output/canvas-markdown';

/**
 * 朝会フェーズ（JST 9:30 に実行）:
 * 前営業日の日報を取得し分析し、Canvas を更新する。
 * 夕会用に `canvasData` を KV に保存する（`chat.postMessage` は使わない）。
 */
export async function handleMorningCron(env: Env): Promise<void> {
	const channels = parseChannelsConfig(env.CHANNELS_CONFIG);
	if (channels.length === 0) {
		console.warn('[Morning] CHANNELS_CONFIG is empty — no channels to process');
		return;
	}

	for (const channel of channels) {
		if (!channel.canvasId) {
			console.warn(`[${channel.label}][Morning] canvasId が未設定 — スキップ`);
			continue;
		}

		try {
			const { dateLabel, isoDate, oldest, latest } = getPreviousBusinessDay();
			console.log(`[${channel.label}][Morning] Start — date: ${dateLabel} | source: ${channel.channelId} → canvas: ${channel.canvasId}`);

			// 1. 前営業日の日報を取得
			const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
			const messages = await fetchHistory(slackClient, channel.channelId, oldest, latest);
			console.log(`[${channel.label}][Morning] Fetched ${messages.length} messages`);

			const userIds = [...new Set(messages.map((m) => m.user))];
			const users = await fetchUsers(slackClient, userIds, env.THREAD_STORE);

			// 2. 分析
			const { dateStats, perUser } = await runMorningDigest({
				messages,
				users,
				dateLabel,
				llmApiKey: env.JAPANAI_API_KEY,
				llmUserId: env.JAPANAI_USER_ID,
			});

			const canvasData = {
				dateStats,
				perUser: Object.fromEntries(
					Array.from(perUser.entries()).map(([userId, coreSummary]) => [
						userId,
						{ displayName: users.get(userId) ?? userId, coreSummary },
					]),
				),
			};

			await saveMorningThreads(env.THREAD_STORE, isoDate, channel.channelId, { canvasData });
			console.log(`[${channel.label}][Morning] Saved KV — key: morning:${isoDate}:${channel.channelId}`);

			const morningMarkdown = buildMorningCanvasMarkdown(dateLabel, canvasData);
			await updateCanvas(slackClient, channel.canvasId, morningMarkdown);
			console.log(`[${channel.label}][Morning] Canvas updated — ${channel.canvasId}`);

		} catch (err) {
			console.error(
				`[${channel.label}][Morning] Failed: ${formatErrorChain(err)}`,
				err,
			);
		}
	}
}
