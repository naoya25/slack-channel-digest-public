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
		await req.context.respond({ text: 'Command failed. Please try again.' });
	}
};

async function handleRegister(
	req: Parameters<SlashCommandLazyHandler<Env>>[0],
	parts: string[],
): Promise<string> {
	if (parts.length < 3) {
		return 'Usage: `/digest register <channel_id> <label>`';
	}

	const channelId = normalizeChannelId(parts[1]);
	const label = sanitizeLabel(parts.slice(2).join(' '));

	if (!channelId) {
		return 'Invalid channel ID format. Expected `C0AP4C8HJR2` or `<#C0...|name>`';
	}

	await addChannelToRegistry(req.env.THREAD_STORE, {
		channelId,
		type: 'structured-digest',
		label,
	});

	return `✓ Registered channel ${channelId} with label "${label}". Canvas will be created on next morning cron.`;
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
		const canvasStatus = entry.canvasId ? `\`${entry.canvasId}\`` : '_pending_';
		lines.push(`• <#${entry.channelId}> — "${entry.label}" (Canvas: ${canvasStatus})`);
	}

	return lines.join('\n');
}

/**
 * チャンネル ID をノーマライズ。
 * `C0AP4C8HJR2` 形式か `<#C0AP4C8HJR2|name>` 形式を受け付ける。
 */
function normalizeChannelId(raw: string): string | null {
	// 既に C で始まる ID 形式なら OK（C + 8文字のみ）
	if (/^C[A-Z0-9]{8}$/.test(raw)) {
		return raw;
	}

	// <#C...|...> メンション形式を抽出（C + 8文字のみ）
	const match = /<#(C[A-Z0-9]{8})\|/.exec(raw);
	if (match) {
		return match[1];
	}

	return null;
}

/**
 * ラベル入力をサニタイズ。
 * Markdown記号を削除し、100文字以内に制限する。
 */
function sanitizeLabel(label: string): string {
	// Markdown記号を削除（*、_、`、~、[、]など）
	let sanitized = label
		.replace(/[*_`~[\]]/g, '')
		.trim();

	// 100文字以内に制限
	if (sanitized.length > 100) {
		sanitized = sanitized.substring(0, 100);
	}

	return sanitized;
}
