/**
 * OpenAI SDK などが `Error: Connection error.` だけに伏せる場合があるため、
 * `cause` チェーンをたどってログ用の一行にまとめる（秘密は含めない）。
 */
export function formatErrorChain(err: unknown): string {
	const segments: string[] = [];
	let current: unknown = err;
	for (let depth = 0; depth < 6 && current != null; depth++) {
		if (current instanceof Error) {
			segments.push(`${current.name}: ${current.message}`);
			current = current.cause;
			continue;
		}
		if (typeof current === 'string') {
			segments.push(current);
			break;
		}
		segments.push(String(current));
		break;
	}
	return segments.join(' → ');
}
