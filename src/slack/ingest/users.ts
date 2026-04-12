import type { SlackAPIClient } from 'slack-cloudflare-workers';
import { mapWithConcurrency } from '../../utils/map-with-concurrency';
import { slackDisplayName } from './display-name';
import {
	displayNameCacheKey,
	parseCachedDisplayName,
	serializeCachedDisplayName,
} from './user-display-cache';

const USERS_LIST_LIMIT = 200;
/** 巨大ワークスペースで users.list だけに頼るとサブリクエストが膨らむため上限 */
const USERS_LIST_MAX_PAGES = 25;

/**
 * users.info を少数同時実行で取得（フォールバック・補完用）
 */
async function fetchUsersByInfo(client: SlackAPIClient, userIds: string[]): Promise<Map<string, string>> {
	const uniqueIds = [...new Set(userIds)];
	if (uniqueIds.length === 0) return new Map();

	const pairs = await mapWithConcurrency(uniqueIds, 3, async (userId) => {
		try {
			const result = await client.users.info({ user: userId });
			if (result.ok && result.user) {
				return [userId, slackDisplayName(result.user, userId)] as const;
			}
			return [userId, userId] as const;
		} catch {
			console.warn(`[Slack] users.info failed for ${userId}, using ID`);
			return [userId, userId] as const;
		}
	});
	return new Map(pairs);
}

/**
 * KV なし時: `users.list` をページングしてまとめて取得し、取りこぼしは `users.info`。
 * （サブリクエストが増えやすいため、本番では `fetchUsers` に KV を渡すことを推奨）
 */
async function fetchUsersWithoutCache(client: SlackAPIClient, userIds: string[]): Promise<Map<string, string>> {
	const uniqueIds = [...new Set(userIds)];
	if (uniqueIds.length === 0) return new Map();

	const remaining = new Set(uniqueIds);
	const out = new Map<string, string>();
	for (const id of uniqueIds) out.set(id, id);

	let cursor: string | undefined;
	let pages = 0;

	try {
		while (remaining.size > 0 && pages < USERS_LIST_MAX_PAGES) {
			const result = await client.users.list({
				limit: USERS_LIST_LIMIT,
				...(cursor ? { cursor } : {}),
			});
			pages++;

			if (!result.ok) {
				console.warn(`[Slack] users.list not ok — falling back to users.info (${result.error ?? 'unknown'})`);
				return fetchUsersByInfo(client, uniqueIds);
			}

			for (const member of result.members ?? []) {
				if (!member.id || !remaining.has(member.id)) continue;
				if (member.deleted) {
					remaining.delete(member.id);
					continue;
				}
				out.set(member.id, slackDisplayName(member, member.id));
				remaining.delete(member.id);
			}

			cursor = result.response_metadata?.next_cursor;
			if (!cursor) break;
		}
	} catch (err) {
		console.warn('[Slack] users.list threw — falling back to users.info', err);
		return fetchUsersByInfo(client, uniqueIds);
	}

	if (remaining.size > 0) {
		console.warn(
			`[Slack] ${remaining.size} user id(s) unresolved after users.list — fetching via users.info`,
		);
		const extra = await fetchUsersByInfo(client, [...remaining]);
		for (const [id, name] of extra) out.set(id, name);
	}

	return out;
}

/**
 * KV あり: キャッシュヒットは Slack を呼ばず、ミスのみ `users.info`。
 * 取得できた表示名は KV に書き戻す（API 失敗で userId のままの場合は保存しない）。
 */
async function fetchUsersWithKv(
	client: SlackAPIClient,
	userIds: string[],
	kv: KVNamespace,
): Promise<Map<string, string>> {
	const uniqueIds = [...new Set(userIds)];
	if (uniqueIds.length === 0) return new Map();

	const out = new Map<string, string>();
	const missing: string[] = [];

	const resolved = await Promise.all(
		uniqueIds.map(async (id) => {
			const raw = await kv.get(displayNameCacheKey(id));
			const name = parseCachedDisplayName(raw);
			return { id, name } as const;
		}),
	);
	for (const { id, name } of resolved) {
		if (name !== null) out.set(id, name);
		else missing.push(id);
	}

	const hits = uniqueIds.length - missing.length;
	console.log(`[Slack] display name cache — hits=${hits} misses=${missing.length}`);

	if (missing.length === 0) {
		return out;
	}

	const fetched = await fetchUsersByInfo(client, missing);
	const putTasks: Promise<void>[] = [];

	for (const id of missing) {
		const name = fetched.get(id) ?? id;
		out.set(id, name);
		if (name !== id) {
			putTasks.push(kv.put(displayNameCacheKey(id), serializeCachedDisplayName(name)));
		}
	}

	await Promise.all(putTasks);
	return out;
}

/**
 * ユーザー ID の一覧を表示名に解決する。
 *
 * @param kv 渡した場合は KV キャッシュを利用し、Slack API はミスのみ `users.info`。
 *           省略時は従来どおり `users.list` ページング優先（サブリクエスト増に注意）。
 */
export async function fetchUsers(
	client: SlackAPIClient,
	userIds: string[],
	kv?: KVNamespace,
): Promise<Map<string, string>> {
	if (kv) {
		return fetchUsersWithKv(client, userIds, kv);
	}
	return fetchUsersWithoutCache(client, userIds);
}
