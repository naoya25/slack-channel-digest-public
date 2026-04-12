/**
 * 配列を同時実行数を抑えながら処理する（サブリクエストのピークを下げる用途）。
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const safeConcurrency = Math.max(1, Math.floor(concurrency));
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const i = nextIndex++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	}

	await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()));
	return results;
}
