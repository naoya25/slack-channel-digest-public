import type { SlackAPIClient } from 'slack-cloudflare-workers';

/**
 * 新規 Canvas を作成し、canvas_id を返す。
 *
 * @param client Slack API クライアント
 * @param title Canvas のタイトル
 * @param markdown 初期本文（Markdown）
 * @returns 作成された Canvas の ID
 */
export async function createCanvas(
	client: SlackAPIClient,
	title: string,
	markdown: string,
): Promise<string> {
	const result = (await client.call('canvases.create', {
		document_content: {
			type: 'markdown',
			markdown,
		},
		properties: {
			title,
		},
	})) as { ok: boolean; canvas_id?: string; error?: string };

	if (!result.ok || !result.canvas_id) {
		throw new Error(`canvases.create failed: ${result.error || 'unknown error'}`);
	}

	return result.canvas_id;
}
