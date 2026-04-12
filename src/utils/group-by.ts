/** 配列をキー関数の戻り値で `Map` にグループ化する */
export function groupBy<T, K extends string | number | symbol>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const key = keyFn(item);
		const bucket = groups.get(key) ?? [];
		bucket.push(item);
		groups.set(key, bucket);
	}
	return groups;
}
