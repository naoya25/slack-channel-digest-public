import type { SlashCommandAckHandler, SlashCommandLazyHandler } from 'slack-cloudflare-workers';
import {
	addChannelToRegistry,
	removeChannelFromRegistry,
	loadChannelRegistry,
} from '../../utils/kv-channel-registry';

/**
 * /digest コマンド ack ハンドラー。3秒以内に応答を返す必要がある。
 */
export const digestCommandAck: SlashCommandAckHandler<Env> = async (req) => {
	await req.context.respond({ text: 'Processing...' });
};

/**
 * /digest コマンド lazy ハンドラー。実際の処理はここで行う（タイムアウトなし）。
 */
export const digestCommandLazy: SlashCommandLazyHandler<Env> = async (req) => {
	const text = (req.payload.text || '').trim();
	const parts = text.split(/\s+/);
	const subcommand = parts[0]?.toLowerCase() || '';

	try {
		let responseText: string;
		switch (subcommand) {
			case 'register':
				responseText = await handleRegister(req, parts);
				break;
			case 'unregister':
				responseText = await handleUnregister(req, parts);
				break;
			case 'list':
				responseText = await handleList(req);
				break;
			default:
				responseText = 'Invalid subcommand. Usage: `/digest register <channel_id> <label>`, `/digest unregister <channel_id>`, `/digest list`';
				break;
		}
		try {
			await req.context.respond({ text: responseText });
		} catch (respondErr) {
			console.error('[digest] respond() failed:', respondErr);
			throw respondErr;
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[digest] Error:', msg);

		// エラー分類してユーザー向けメッセージを返す
		let userMsg = 'Command failed. Please try again.';
		if (msg.includes('already registered')) {
			userMsg = '❌ This channel is already registered.';
		} else if (msg.includes('not found')) {
			userMsg = '❌ Channel not found. Please check the channel ID.';
		} else if (msg.includes('Invalid channel ID')) {
			userMsg = '❌ Invalid channel ID format. Use `C0AP4C8HJR2` or mention the channel.';
		}

		await req.context.respond({ text: userMsg });
	}
};

async function handleRegister(
	req: Parameters<SlashCommandLazyHandler<Env>>[0],
	parts: string[],
): Promise<string> {
	if (parts.length < 2) {
		return 'Usage: `/digest register <label>`';
	}

	// 呼び出されたチャンネルを自動取得
	const channelId = req.payload.channel_id;
	if (!channelId) {
		return '❌ This command must be called from a channel.';
	}

	const label = sanitizeLabel(parts.slice(1).join(' '));

	// 既に登録されているかチェック
	const registry = await loadChannelRegistry(req.env.THREAD_STORE);
	if (registry.some((entry) => entry.channelId === channelId)) {
		return `⚠️ This channel is already registered with label "${registry.find((entry) => entry.channelId === channelId)?.label}". Please unregister first if you want to update.`;
	}

	// Canvas を作成
	const canvasId = await createCanvas(req.env, label);

	await addChannelToRegistry(req.env.THREAD_STORE, {
		channelId,
		type: 'structured-digest',
		label,
		canvasId,
	});

	return `✓ Registered <#${channelId}> with label "${label}". Canvas created: <https://slack.com/files/${canvasId}|View Canvas>`;
}

async function handleUnregister(
	req: Parameters<SlashCommandLazyHandler<Env>>[0],
	parts: string[],
): Promise<string> {
	if (parts.length < 2) {
		return 'Usage: `/digest unregister <channel_id>`';
	}

	const channelId = normalizeChannelId(parts[1]);
	if (!channelId) {
		return 'Invalid channel ID format. Expected `C0AP4C8HJR2` or `<#C0...|name>`';
	}

	const removed = await removeChannelFromRegistry(req.env.THREAD_STORE, channelId);
	if (!removed) {
		return '❌ Unregister failed. Channel may not exist or already removed.';
	}

	return `✓ Unregistered channel ${channelId}.`;
}

async function handleList(req: Parameters<SlashCommandLazyHandler<Env>>[0]): Promise<string> {
	const registry = await loadChannelRegistry(req.env.THREAD_STORE);

	if (registry.length === 0) {
		return 'No channels registered yet.';
	}

	const lines = ['*Registered channels:*'];
	for (const entry of registry) {
		const canvasLink = entry.canvasId
			? `<slack://canvas/${entry.canvasId}|${entry.canvasId}>`
			: '_pending_';
		lines.push(`• <#${entry.channelId}> — "${entry.label}" (Canvas: ${canvasLink})`);
	}

	return lines.join('\n');
}

/**
 * Canvas を Slack API で作成する
 */
async function createCanvas(env: Env, title: string): Promise<string> {
	const token = env.SLACK_BOT_TOKEN;

	const response = await fetch('https://slack.com/api/canvases.create', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			title,
			content: {
				type: 'markdown',
				markdown: `# ${title}\n\n*Created by Slack Channel Digest*`,
			},
		}),
	});

	const data = (await response.json()) as { ok: boolean; canvas_id?: string; error?: string };

	if (!data.ok) {
		throw new Error(`Failed to create canvas: ${data.error || 'unknown error'}`);
	}

	return data.canvas_id || '';
}

/**
 * チャンネル ID をノーマライズ。
 * `C0AP4C8HJR2` 形式か `<#C0AP4C8HJR2|name>` 形式を受け付ける。
 *
 * Slack Channel ID フォーマット: C + 9文字（計10文字）
 * https://api.slack.com/types/channel
 */
function normalizeChannelId(raw: string): string | null {
	// 既に C で始まる ID 形式なら OK（C + 9文字のみ）
	if (/^C[A-Z0-9]{9}$/.test(raw)) {
		return raw;
	}

	// <#C...|...> メンション形式を抽出（C + 9文字のみ）
	const match = /<#(C[A-Z0-9]{9})\|/.exec(raw);
	if (match) {
		return match[1];
	}

	return null;
}

/**
 * ラベル入力をサニタイズ。
 * 制御文字・危険な記号を削除し、100文字以内に制限する。
 */
function sanitizeLabel(label: string): string {
	// 1. 長さ先制限（削除前）
	let sanitized = label.slice(0, 100);

	// 2. 制御文字を除去し、改行・CR・タブはスペースへ正規化
	sanitized = Array.from(sanitized)
		.map((char) => {
			if (char === '\n' || char === '\r' || char === '\t') {
				return ' ';
			}

			const code = char.charCodeAt(0);
			return code >= 32 ? char : '';
		})
		.join('');

	// 3. Markdown記号削除（*、_、`、~、[、]など）
	sanitized = sanitized.replace(/[*_`~[\]]/g, '');

	return sanitized.trim();
}
