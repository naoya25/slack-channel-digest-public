import {
	WEBHOOK_CHUNK_TEXT_MAX,
	WEBHOOK_SPLIT_TOTAL_PROBE_PAD,
} from '../../constants/incoming-webhook';

function prefixForChunk(label: string, index: number, total: number): string {
	if (index === 0) {
		return `*[${label}] digest* _${index + 1}/${total}_\n\n`;
	}
	return `*[${label}] digest（続き）* _${index + 1}/${total}_\n\n`;
}

/**
 * 固定の total チャンク数で markdown 本体を分割する。
 * 各チャンクについて prefixForChunk + body の長さが WEBHOOK_CHUNK_TEXT_MAX 以下になるようにする。
 * 不可能なら null（total が小さすぎる／大きすぎるなど）。
 */
function trySplitMarkdownBodies(markdown: string, label: string, total: number): string[] | null {
	const maxBodies: number[] = new Array(total);
	for (let j = 0; j < total; j++) {
		const mb = WEBHOOK_CHUNK_TEXT_MAX - prefixForChunk(label, j, total).length;
		if (mb < 0) {
			return null;
		}
		maxBodies[j] = mb;
	}

	/** suffixFuture[i] = sum(maxBodies[j] for j in [i, total)) */
	const suffixFuture = new Array(total + 1);
	suffixFuture[total] = 0;
	for (let j = total - 1; j >= 0; j--) {
		suffixFuture[j] = maxBodies[j] + suffixFuture[j + 1];
	}

	const chunks: string[] = [];
	let offset = 0;
	const n = markdown.length;

	for (let i = 0; i < total; i++) {
		const maxBody = maxBodies[i];
		const remaining = n - offset;

		if (i === total - 1) {
			if (remaining > maxBody) {
				return null;
			}
			chunks.push(markdown.slice(offset));
			return chunks;
		}

		const sumFutureMax = suffixFuture[i + 1];
		const take = Math.min(maxBody, remaining);
		if (remaining - take > sumFutureMax) {
			return null;
		}
		if (remaining - take === 0) {
			return null;
		}

		chunks.push(markdown.slice(offset, offset + take));
		offset += take;
	}

	return null;
}

/**
 * prefix 長の上下限（digit 幅は従来どおり markdown 長から導いた capTotal に合わせる）。
 */
function prefixLengthBoundsForLabel(label: string, capTotal: number): { min: number; max: number } {
	const t = Math.max(capTotal, 2);
	const lengths = [
		prefixForChunk(label, 0, 1).length,
		prefixForChunk(label, 1, 2).length,
		prefixForChunk(label, 0, t).length,
		prefixForChunk(label, 1, t).length,
		prefixForChunk(label, Math.max(1, t - 1), t).length,
	];
	return { min: Math.min(...lengths), max: Math.max(...lengths) };
}

/**
 * label 付き prefix を考慮し、各 POST の text 全体が WEBHOOK_CHUNK_TEXT_MAX 以下になるよう markdown を分割する。
 * total は概算区間だけ試し、フォールバック幅も n に比例しない。
 */
export function chunkMarkdownForWebhook(markdown: string, label: string): string[] {
	const probe = prefixForChunk(label, 0, 1);
	if (probe.length > WEBHOOK_CHUNK_TEXT_MAX) {
		throw new Error(`report label is too long for WEBHOOK_CHUNK_TEXT_MAX (${WEBHOOK_CHUNK_TEXT_MAX})`);
	}

	const n = markdown.length;
	const capTotal = Math.max(n + 2, 2);
	const { min: minPrefixLen, max: maxPrefixLen } = prefixLengthBoundsForLabel(label, capTotal);

	const bodyBudgetLo = Math.max(1, WEBHOOK_CHUNK_TEXT_MAX - maxPrefixLen);
	const bodyBudgetHi = Math.max(1, WEBHOOK_CHUNK_TEXT_MAX - minPrefixLen);

	const totalLo = Math.max(1, Math.ceil(n / bodyBudgetHi));
	const totalHi = Math.min(capTotal, Math.max(totalLo, Math.ceil(n / bodyBudgetLo) + 2));

	for (let total = totalLo; total <= totalHi; total++) {
		const bodies = trySplitMarkdownBodies(markdown, label, total);
		if (bodies !== null) {
			return bodies;
		}
	}

	const pad = WEBHOOK_SPLIT_TOTAL_PROBE_PAD;
	const fbLo = Math.max(1, totalLo - pad);
	const fbHi = Math.min(capTotal, totalHi + pad);
	for (let total = fbLo; total < totalLo; total++) {
		const bodies = trySplitMarkdownBodies(markdown, label, total);
		if (bodies !== null) {
			return bodies;
		}
	}
	for (let total = totalHi + 1; total <= fbHi; total++) {
		const bodies = trySplitMarkdownBodies(markdown, label, total);
		if (bodies !== null) {
			return bodies;
		}
	}

	for (let total = fbHi + 1; total <= capTotal; total++) {
		const bodies = trySplitMarkdownBodies(markdown, label, total);
		if (bodies !== null) {
			return bodies;
		}
	}

	throw new Error('could not split markdown for Incoming Webhook');
}

/** 各チャンク先頭に付けるプレフィックス（Webhook の `text` 用） */
export function webhookChunkPrefix(label: string, index: number, total: number): string {
	return prefixForChunk(label, index, total);
}
