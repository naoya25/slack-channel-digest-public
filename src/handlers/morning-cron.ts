import { formatErrorChain } from '../utils/format-error-for-log';
import { resolveChannels } from '../utils/resolve-channels';
import { createSlackClient } from '../slack/ingest/client';
import { fetchHistory } from '../slack/ingest/history';
import { fetchUsers } from '../slack/ingest/users';
import { runMorningDigest } from '../analysis/morning-digest';
import { getPreviousBusinessDay } from '../utils/business-day';
import { saveMorningThreads } from '../utils/kv-thread-store';
import { updateCanvas } from '../slack/output/canvas';
import { createCanvas } from '../slack/output/create-canvas';
import { buildMorningCanvasMarkdown } from '../slack/output/canvas-markdown';
import { updateCanvasId } from '../utils/kv-channel-registry';

/**
 * 朝会フェーズ（JST 9:30 に実行）:
 * 前営業日の日報を取得し分析し、Canvas を更新する。
 * Canvas が未設定なら自動作成する。
 * 夕会用に `canvasData` を KV に保存する（`chat.postMessage` は使わない）。
 */
export async function handleMorningCron(env: Env): Promise<void> {
	const channels = await resolveChannels(env);
	if (channels.length === 0) {
		console.warn('[Morning] No channels to process (KV registry empty, CHANNELS_CONFIG empty)');
		return;
	}

	for (let channel of channels) {
		try {
			// Canvas 未設定時に自動作成
			if (!channel.canvasId) {
				const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
				const newCanvasId = await createCanvas(slackClient, `日報分析 - ${channel.label}`, '# 初期化中...');
				await updateCanvasId(env.THREAD_STORE, channel.channelId, newCanvasId);
				channel = { ...channel, canvasId: newCanvasId };
				console.log(`[${channel.label}][Morning] Canvas auto-created — ${newCanvasId}`);
			}

			const { dateLabel, isoDate, oldest, latest } = getPreviousBusinessDay();
			console.log(`[${channel.label}][Morning] Start — date: ${dateLabel} | source: ${channel.channelId} → canvas: ${channel.canvasId}`);

			// 1. 前営業日の日報を取得
			const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
			const messages = await fetchHistory(slackClient, channel.channelId, oldest, latest);
			console.log(`[${channel.label}][Morning] Fetched ${messages.length} messages`);

			const userIds = [...new Set(messages.map((m) => m.user))];
			const users = await fetchUsers(slackClient, userIds, env.THREAD_STORE);

			// 2. 分析
			const { dateStats, perUser, similarGroups } = await runMorningDigest({
				messages,
				users,
				dateLabel,
				llmApiKey: env.JAPANAI_API_KEY,
				llmUserId: env.JAPANAI_USER_ID,
			});

			const canvasData = {
				dateStats,
				similarGroups,
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
			await updateCanvas(slackClient, channel.canvasId!, morningMarkdown);
			console.log(`[${channel.label}][Morning] Canvas updated — ${channel.canvasId}`);

		} catch (err) {
			console.error(
				`[${channel.label}][Morning] Failed: ${formatErrorChain(err)}`,
				err,
			);
		}
	}
}
