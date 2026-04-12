import type { SlackAPIClient } from 'slack-cloudflare-workers';

/**
 * Slack Canvas の本文を、渡した Markdown で全面置き換えする。
 *
 * `canvases.edit` の `replace` で `section_id` を省略するとドキュメント全体が置き換わる。
 * API は `changes` に 1 要素しか渡せないため、セクション列挙・個別 delete は行わない。
 *
 * @see https://docs.slack.dev/reference/methods/canvases.edit/
 */
export async function updateCanvas(
	client: SlackAPIClient,
	canvasId: string,
	markdown: string,
): Promise<void> {
	const result = (await client.call('canvases.edit', {
		canvas_id: canvasId,
		changes: [
			{
				operation: 'replace',
				document_content: {
					type: 'markdown',
					markdown,
				},
			},
		],
	})) as { ok: boolean; error?: string };

	if (!result.ok) {
		throw new Error(`canvases.edit (replace) failed: ${result.error}`);
	}
}
