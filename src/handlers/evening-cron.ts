import { formatErrorChain } from '../utils/format-error-for-log';
import { resolveChannels } from '../utils/resolve-channels';
import { createSlackClient } from '../slack/ingest/client';
import { fetchHistory } from '../slack/ingest/history';
import { fetchUsers } from '../slack/ingest/users';
import { runEveningDigest } from '../analysis/evening-digest';
import { getPreviousBusinessDay, getFiscalYearToDateWindow } from '../utils/business-day';
import { loadMorningThreads } from '../utils/kv-thread-store';
import { updateCanvas } from '../slack/output/canvas';
import { buildEveningCanvasMarkdown } from '../slack/output/canvas-markdown';

/**
 * 夕会フェーズ（JST 18:00 に実行）:
 * 年度始め（4/1）以降の全日報を取得して累積分析し、Canvas を朝会内容に続けて上書きする。
 */
export async function handleEveningCron(env: Env): Promise<void> {
	const channels = await resolveChannels(env);
	if (channels.length === 0) {
		console.warn('[Evening] No channels to process (KV registry empty, CHANNELS_CONFIG empty)');
		return;
	}

	for (const channel of channels) {
		if (!channel.canvasId) {
			console.warn(`[${channel.label}][Evening] canvasId が未設定 — スキップ`);
			continue;
		}

		try {
			const { dateLabel, isoDate } = getPreviousBusinessDay();
			console.log(`[${channel.label}][Evening] Start — date: ${dateLabel}`);

			const morningRecord = await loadMorningThreads(env.THREAD_STORE, isoDate, channel.channelId);
			if (!morningRecord?.canvasData) {
				console.warn(`[${channel.label}][Evening] KV に朝会 canvasData なし（${isoDate}）— スキップ`);
				continue;
			}

			// 2. 年度始め〜現在の全日報を取得（累積分析用）
			const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
			const { oldest, latest } = getFiscalYearToDateWindow();
			const messages = await fetchHistory(slackClient, channel.channelId, oldest, latest);
			console.log(`[${channel.label}][Evening] Fetched ${messages.length} messages (FY-to-date)`);

			const userIds = [...new Set(messages.map((m) => m.user))];
			const users = await fetchUsers(slackClient, userIds, env.THREAD_STORE);

			// 3. 累積分析
			const { perUser, teamInsights } = await runEveningDigest({
				messages,
				users,
				dateLabel,
				llmApiKey: env.JAPANAI_API_KEY,
				llmUserId: env.JAPANAI_USER_ID,
			});

			const eveningData = {
				perUser: Object.fromEntries(
					Array.from(perUser.entries()).map(([userId, detailedSummary]) => [
						userId,
						{ detailedSummary },
					]),
				),
				teamInsights,
			};
			const eveningMarkdown = buildEveningCanvasMarkdown(
				dateLabel,
				morningRecord.canvasData,
				eveningData,
			);
			await updateCanvas(slackClient, channel.canvasId, eveningMarkdown);
			console.log(`[${channel.label}][Evening] Canvas updated — ${channel.canvasId}`);

		} catch (err) {
			console.error(
				`[${channel.label}][Evening] Failed: ${formatErrorChain(err)}`,
				err,
			);
		}
	}
}
