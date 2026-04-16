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
import { updateCanvasId, loadChannelRegistry } from '../utils/kv-channel-registry';

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
 * Canvas ID を確保する（未設定なら自動作成＋KV登録）。
 * 競合状態を避けるため、KV読み込み → 確認 → 作成 → 登録 の順序を厳格に。
 */
async function ensureCanvasId(
	env: Env,
	channelId: string,
	label: string,
	PREFIX: string,
): Promise<string> {
	// 1. KV から最新状態を確認（他のプロセスが既に作成しているかチェック）
	const registry = await loadChannelRegistry(env.THREAD_STORE);
	const entry = registry.find((e) => e.channelId === channelId);
	if (entry?.canvasId) {
		console.log(`${PREFIX} Canvas already exists — ${entry.canvasId}`);
		return entry.canvasId;
	}

	// 2. Canvas を新規作成
	const slackClient = createSlackClient(env.SLACK_BOT_TOKEN);
	const newCanvasId = await createCanvas(slackClient, `日報分析 - ${label}`, '# 初期化中...');

	// 3. 再度確認 → 登録（二重チェック）
	const latestRegistry = await loadChannelRegistry(env.THREAD_STORE);
	const latestEntry = latestRegistry.find((e) => e.channelId === channelId);
	if (latestEntry?.canvasId) {
		// 他のプロセスが既に設定した → そちらを使用
		console.log(`${PREFIX} Canvas set by concurrent process — ${latestEntry.canvasId}`);
		return latestEntry.canvasId;
	}

	// 4. KV に登録
	try {
		await updateCanvasId(env.THREAD_STORE, channelId, newCanvasId);
		console.log(`${PREFIX} Canvas auto-created — ${newCanvasId}`);
		return newCanvasId;
	} catch (err) {
		// 登録失敗 → 最後にもう一度確認してから失敗判定
		const finalRegistry = await loadChannelRegistry(env.THREAD_STORE);
		const finalEntry = finalRegistry.find((e) => e.channelId === channelId);
		if (finalEntry?.canvasId) {
			return finalEntry.canvasId;
		}
		throw err;
	}
}

/**
 * 単一チャンネルの朝会処理
 */
async function processChannel(env: Env, channel: Awaited<ReturnType<typeof resolveChannels>>[0]): Promise<void> {
	const PREFIX = `[${channel.label}][Morning]`;

	// Canvas ID を確保（未設定なら自動作成）
	const canvasId = await ensureCanvasId(env, channel.channelId, channel.label, PREFIX);

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
