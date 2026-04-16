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

	// Promise.allSettled で各チャンネルを並列処理（1チャンネルの失敗が他にブロック影響しない）
	const results = await Promise.allSettled(
		channels.map((channel) => processChannel(env, channel))
	);

	// 各チャンネルエラーを個別に処理
	results.forEach((result, index) => {
		if (result.status === 'rejected') {
			const channel = channels[index];
			console.error(
				`[${channel.label}][Morning] Failed: ${formatErrorChain(result.reason)}`,
				result.reason,
			);
		}
	});
}

/**
 * 単一チャンネルの朝会処理
 */
async function processChannel(env: Env, channel: Awaited<ReturnType<typeof resolveChannels>>[0]): Promise<void> {
	const PREFIX = `[${channel.label}][Morning]`;
	let canvasId = channel.canvasId;

	// Canvas 未設定時に自動作成 + 二重チェック（KVから再確認）
	if (!canvasId) {
		const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
		const newCanvasId = await createCanvas(slackClient, `日報分析 - ${channel.label}`, '# 初期化中...');

		// KVから再確認（競合防止）
		try {
			await updateCanvasId(env.THREAD_STORE, channel.channelId, newCanvasId);
			canvasId = newCanvasId;
			console.log(`${PREFIX} Canvas auto-created — ${newCanvasId}`);
		} catch (err) {
			// 既に設定されている場合は再度KVから読み込み
			console.warn(`${PREFIX} Canvas already set during update, reloading...`);
			const registry = await import('./kv-channel-registry').then(m => m.loadChannelRegistry(env.THREAD_STORE));
			const entry = registry.find(e => e.channelId === channel.channelId);
			if (entry?.canvasId) {
				canvasId = entry.canvasId;
			} else {
				throw err;
			}
		}
	}

	const { dateLabel, isoDate, oldest, latest } = getPreviousBusinessDay();
	console.log(`${PREFIX} Start — date: ${dateLabel} | source: ${channel.channelId} → canvas: ${canvasId}`);

	// 1. 前営業日の日報を取得
	const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
	const messages = await fetchHistory(slackClient, channel.channelId, oldest, latest);
	console.log(`${PREFIX} Fetched ${messages.length} messages`);

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
	console.log(`${PREFIX} Saved KV — key: morning:${isoDate}:${channel.channelId}`);

	const morningMarkdown = buildMorningCanvasMarkdown(dateLabel, canvasData);
	await updateCanvas(slackClient, canvasId, morningMarkdown);
	console.log(`${PREFIX} Canvas updated — ${canvasId}`);
}
