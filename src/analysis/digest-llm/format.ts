import { canvasUserMention } from '../../slack/output/canvas-markdown';
import type {
	PersonExtractionPass1,
	PersonExtractionWithId,
	SharedPatternItem,
	TeamSynthesisPass2,
} from './types';

function displayNameFor(userId: string, users: Map<string, string>): string {
	return users.get(userId) ?? userId;
}

function displayNameList(userIds: string[], users: Map<string, string>): string {
	return userIds.map((id) => displayNameFor(id, users)).join('、');
}

/** 朝の全体サマリー用：メンション・Slack userId 風文字列・既知の displayName をマスク */
function scrubMorningPublicSummaryText(text: string, users: Map<string, string>): string {
	let t = text.replace(/!\[\]\(@U[A-Z0-9]+\)/g, '（メンバー）');
	t = t.replace(/<@(U[A-Z0-9]+)>/g, '（メンバー）');
	t = t.replace(/U[A-Z0-9]{9,}/g, '（メンバー）');
	const names = [...users.values()]
		.filter((n) => n.trim().length >= 2)
		.sort((a, b) => b.length - a.length);
	for (const name of names) {
		const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!esc) continue;
		t = t.replace(new RegExp(esc, 'g'), '（チーム内のメンバー）');
	}
	return t.trim();
}

export interface TeamSynthesisFormatOptions {
	/** 朝会の全体サマリー：個人名を出さず人数・割合のみ（teamOverview もサニタイズ） */
	anonymousTeamSummary?: boolean;
}

/** 分母は Pass1 対象者数。名前は出さず pattern + 短いアドバイスのみ。 */
function formatSharedPatternBullet(item: SharedPatternItem, participantTotal: number): string {
	const ids = [...new Set(item.memberUserIds)];
	const n = ids.length;
	const stat =
		participantTotal > 0 && n > 0
			? `（対象${participantTotal}名中${n}名・約${Math.round((n / participantTotal) * 100)}%）`
			: '';
	const advice = item.briefAdvice.trim() || '_（ヒントなし）_';
	const lead = stat ? `${stat} ` : '';
	return `- ${lead}${item.pattern.trim()}\n  - *ヒント*: ${advice}`;
}

function parseSharedPatternArray(raw: unknown): SharedPatternItem[] {
	if (!Array.isArray(raw)) return [];
	const out: SharedPatternItem[] = [];
	for (const el of raw) {
		if (typeof el === 'string') {
			const pattern = el.trim();
			if (pattern) out.push({ pattern, briefAdvice: '', memberUserIds: [] });
			continue;
		}
		if (el && typeof el === 'object') {
			const o = el as Record<string, unknown>;
			const patternRaw =
				typeof o.pattern === 'string'
					? o.pattern
					: typeof o.label === 'string'
						? o.label
						: '';
			const pattern = patternRaw.trim();
			const briefAdviceRaw =
				typeof o.briefAdvice === 'string'
					? o.briefAdvice
					: typeof o.note === 'string'
						? o.note
						: '';
			const briefAdvice = briefAdviceRaw.trim();
			const memberUserIds = Array.isArray(o.memberUserIds)
				? o.memberUserIds.filter((id): id is string => typeof id === 'string')
				: [];
			if (pattern) out.push({ pattern, briefAdvice, memberUserIds });
		}
	}
	return out;
}

function sanitizeSharedPatternItems(
	items: SharedPatternItem[],
	keep: (id: string) => boolean,
): SharedPatternItem[] {
	return items
		.map((it) => ({
			pattern: it.pattern.trim(),
			briefAdvice: it.briefAdvice.trim(),
			memberUserIds: [...new Set(it.memberUserIds.filter(keep))],
		}))
		.filter((it) => it.pattern.length > 0 && it.memberUserIds.length >= 2);
}

const ISO_JST = { timeZone: 'Asia/Tokyo' } as const;

export function formatSlackTsForPrompt(ts: string): string {
	const ms = parseFloat(ts) * 1000;
	if (Number.isNaN(ms)) return '(日時不明)';
	return new Date(ms).toLocaleString('ja-JP', {
		...ISO_JST,
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

/** 時系列で並べ、プロンプスト用に連結 */
export function joinMessagesChronological(
	messages: Array<{ ts: string; text: string }>,
	maxChars: number,
): string {
	const sorted = [...messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
	const parts: string[] = [];
	let total = 0;
	for (const m of sorted) {
		const line = `[${formatSlackTsForPrompt(m.ts)}]\n${m.text.trim()}`;
		if (total + line.length > maxChars && parts.length > 0) {
			parts.push('…（以降の投稿は長さの都合で省略）');
			break;
		}
		parts.push(line);
		total += line.length + 2;
	}
	return parts.join('\n\n');
}

export function truncateMiddle(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = Math.floor(maxChars * 0.52);
	const tail = maxChars - head - 40;
	return `${text.slice(0, head)}\n\n…（中略）…\n\n${text.slice(-tail)}`;
}

export function formatPersonExtractionMarkdown(p: PersonExtractionPass1): string {
	const chars =
		p.characteristics.length > 0
			? p.characteristics.map((c) => `- ${c}`).join('\n')
			: '_（特徴の列挙は空）_';
	return [
		'**時系列の流れ**',
		p.timelineNarrative.trim() || '_（記述なし）_',
		'',
		'**特徴・傾向**',
		chars,
		'',
		'**いまの関心・取り組み・課題感**',
		p.currentThreads.trim() || '_（記述なし）_',
	].join('\n');
}

/** 朝会「全体サマリー」欄用。`anonymousTeamSummary` で匿名化（夕会のチーム横断は false） */
export function formatTeamSynthesisForMorningCanvas(
	s: TeamSynthesisPass2,
	users: Map<string, string>,
	participantTotal: number,
	options?: TeamSynthesisFormatOptions,
): string {
	const anonymous = options?.anonymousTeamSummary === true;
	const overviewRaw = s.teamOverview.trim() || '_（全体傾向の要約は空）_';
	const overview = anonymous ? scrubMorningPublicSummaryText(overviewRaw, users) : overviewRaw;
	const lines: string[] = [overview, ''];

	if (s.sharedThemes.length > 0) {
		lines.push('### チームで目立ったテーマ・学び');
		lines.push(...s.sharedThemes.map((t) => formatSharedPatternBullet(t, participantTotal)));
		lines.push('');
	}

	if (s.sharedChallenges.length > 0) {
		lines.push('### 共通して挙がった悩み・課題のパターン');
		lines.push(...s.sharedChallenges.map((t) => formatSharedPatternBullet(t, participantTotal)));
		lines.push('');
	}

	if (s.similarGroups.length > 0) {
		lines.push(anonymous ? '### 近い関心・傾向のパターン（匿名）' : '### 近い関心・傾向のメンバー');
		for (const g of s.similarGroups) {
			if (g.userIds.length < 2) continue;
			if (anonymous) {
				const n = g.userIds.length;
				const pct =
					participantTotal > 0 ? Math.round((n / participantTotal) * 100) : 0;
				lines.push(`- （該当${n}名・対象全体の約${pct}%）${g.rationale}`);
			} else {
				lines.push(`- ${displayNameList(g.userIds, users)}: ${g.rationale}`);
			}
		}
		lines.push('');
	}

	if (s.knowledgeBridges.length > 0) {
		lines.push(
			anonymous
				? '### 課題と学びをつなぐ余地（匿名）'
				: '### 学び・経験のシェアが期待できるつながり（参考）',
		);
		for (const b of s.knowledgeBridges) {
			if (anonymous) {
				const distinct = new Set([b.seekerUserId, ...b.helperUserIds]);
				const n = distinct.size;
				const pct =
					participantTotal > 0 ? Math.round((n / participantTotal) * 100) : 0;
				lines.push(`- （関連しそうな記述：${n}名分・対象全体の約${pct}%）${b.rationale}`);
			} else {
				const helpers = displayNameList(b.helperUserIds, users);
				lines.push(
					`- ${displayNameFor(b.seekerUserId, users)} → ${helpers}: ${b.rationale}`,
				);
			}
		}
		lines.push('');
	}

	return lines.join('\n').trim();
}

/** 夕会「チーム横断」追記用（表示名あり） */
export function formatTeamSynthesisForEveningCanvas(
	s: TeamSynthesisPass2,
	users: Map<string, string>,
	participantTotal: number,
): string {
	return formatTeamSynthesisForMorningCanvas(s, users, participantTotal, {
		anonymousTeamSummary: false,
	});
}

/** structured-digest 最終 Markdown */
export function formatStructuredDigestMarkdown(
	dateHeading: string,
	ingestPeriodLabelJa: string,
	synthesis: TeamSynthesisPass2,
	extractions: PersonExtractionWithId[],
	users: Map<string, string>,
): string {
	const participantTotal = extractions.length;
	const lines: string[] = [
		`# ${dateHeading} 時点 · 日報分析レポート（${ingestPeriodLabelJa}）`,
		'',
		'## 全体サマリー',
		synthesis.teamOverview.trim() || '_（空）_',
		'',
	];

	if (synthesis.sharedThemes.length > 0) {
		lines.push('## 共通テーマ・共有しやすい学び');
		lines.push(...synthesis.sharedThemes.map((t) => formatSharedPatternBullet(t, participantTotal)));
		lines.push('');
	}

	if (synthesis.sharedChallenges.length > 0) {
		lines.push('## 共通の悩み・改善点のパターン');
		lines.push(...synthesis.sharedChallenges.map((t) => formatSharedPatternBullet(t, participantTotal)));
		lines.push('');
	}

	if (synthesis.similarGroups.length > 0) {
		lines.push('## 近い関心・傾向のメンバー');
		for (const g of synthesis.similarGroups) {
			if (g.userIds.length < 2) continue;
			lines.push(`- ${displayNameList(g.userIds, users)}: ${g.rationale}`);
		}
		lines.push('');
	}

	if (synthesis.knowledgeBridges.length > 0) {
		lines.push('## 学び・経験のシェアが期待できるつながり（参考）');
		for (const b of synthesis.knowledgeBridges) {
			const helpers = displayNameList(b.helperUserIds, users);
			lines.push(`- ${displayNameFor(b.seekerUserId, users)} → ${helpers}: ${b.rationale}`);
		}
		lines.push('');
	}

	lines.push('## 個人の流れと特徴', '');

	for (const e of extractions) {
		lines.push(`### ${canvasUserMention(e.userId)}`, '', formatPersonExtractionMarkdown(e), '');
	}

	lines.push('---', '*このレポートは AI が自動生成しました。詳細は日報チャンネルの原文をご確認ください。*');
	return lines.join('\n');
}

export function emptyTeamSynthesis(reason: string): TeamSynthesisPass2 {
	return {
		teamOverview: reason,
		sharedThemes: [],
		sharedChallenges: [],
		similarGroups: [],
		knowledgeBridges: [],
	};
}

export function sanitizeTeamSynthesis(raw: TeamSynthesisPass2, validUserIds: Set<string>): TeamSynthesisPass2 {
	const keep = (id: string) => validUserIds.has(id);

	const similarGroups = raw.similarGroups
		.map((g) => ({
			userIds: g.userIds.filter(keep),
			rationale: g.rationale,
		}))
		.filter((g) => g.userIds.length >= 2);

	const knowledgeBridges = raw.knowledgeBridges
		.map((b) => ({
			seekerUserId: b.seekerUserId,
			helperUserIds: b.helperUserIds.filter(keep),
			rationale: b.rationale,
		}))
		.filter((b) => keep(b.seekerUserId) && b.helperUserIds.length > 0);

	return {
		teamOverview: raw.teamOverview,
		sharedThemes: sanitizeSharedPatternItems(parseSharedPatternArray(raw.sharedThemes), keep),
		sharedChallenges: sanitizeSharedPatternItems(parseSharedPatternArray(raw.sharedChallenges), keep),
		similarGroups,
		knowledgeBridges,
	};
}

export function parsePersonExtraction(
	raw: string,
	fallbackUsername: string,
): PersonExtractionPass1 {
	try {
		const data = JSON.parse(raw) as Partial<PersonExtractionPass1>;
		return {
			username: typeof data.username === 'string' ? data.username : fallbackUsername,
			timelineNarrative: typeof data.timelineNarrative === 'string' ? data.timelineNarrative : '',
			characteristics: Array.isArray(data.characteristics)
				? data.characteristics.filter((x): x is string => typeof x === 'string')
				: [],
			currentThreads: typeof data.currentThreads === 'string' ? data.currentThreads : '',
			matchingHints: {
				topics: Array.isArray(data.matchingHints?.topics)
					? data.matchingHints!.topics.filter((x): x is string => typeof x === 'string')
					: [],
				challenges: Array.isArray(data.matchingHints?.challenges)
					? data.matchingHints!.challenges.filter((x): x is string => typeof x === 'string')
					: [],
				experienceTags: Array.isArray(data.matchingHints?.experienceTags)
					? data.matchingHints!.experienceTags.filter((x): x is string => typeof x === 'string')
					: [],
			},
		};
	} catch {
		return {
			username: fallbackUsername,
			timelineNarrative: '',
			characteristics: [],
			currentThreads: '',
			matchingHints: { topics: [], challenges: [], experienceTags: [] },
		};
	}
}

/**
 * Pass1 バッチ応答（people 配列）を、期待する userId 順に並べた抽出結果にする。
 */
export function parseBatchPersonExtractions(
	raw: string,
	orderedUserIds: string[],
	getFallbackUsername: (userId: string) => string,
): PersonExtractionWithId[] {
	let people: unknown[] = [];
	try {
		const data = JSON.parse(raw) as { people?: unknown };
		if (Array.isArray(data.people)) people = data.people;
	} catch {
		// fall through — people stays []
	}

	const byId = new Map<string, Record<string, unknown>>();
	for (const el of people) {
		if (!el || typeof el !== 'object') continue;
		const row = el as Record<string, unknown>;
		const uid = typeof row.userId === 'string' ? row.userId : '';
		if (uid) byId.set(uid, row);
	}

	/** userId なしの要素を、欠けている順序に左から割り当てる */
	const orphans = people.filter((el) => {
		if (!el || typeof el !== 'object') return false;
		const row = el as Record<string, unknown>;
		return typeof row.userId !== 'string' || !row.userId;
	}) as Record<string, unknown>[];

	return orderedUserIds.map((userId) => {
		let row = byId.get(userId);
		if (!row && orphans.length > 0) {
			row = orphans.shift()!;
		}
		const fallback = getFallbackUsername(userId);
		if (!row) {
			return { userId, ...parsePersonExtraction('{}', fallback) };
		}
		const rest = { ...row };
		delete rest.userId;
		const subJson = JSON.stringify(rest);
		const parsed = parsePersonExtraction(subJson, fallback);
		return { userId, ...parsed };
	});
}

export function parseTeamSynthesis(raw: string): TeamSynthesisPass2 | null {
	try {
		const data = JSON.parse(raw) as Partial<TeamSynthesisPass2>;
		if (typeof data.teamOverview !== 'string') return null;
		return {
			teamOverview: data.teamOverview,
			sharedThemes: parseSharedPatternArray(data.sharedThemes),
			sharedChallenges: parseSharedPatternArray(data.sharedChallenges),
			similarGroups: Array.isArray(data.similarGroups)
				? data.similarGroups
						.filter(
							(g): g is { userIds: string[]; rationale: string } =>
								Array.isArray(g?.userIds) &&
								g.userIds.every((id) => typeof id === 'string') &&
								typeof g?.rationale === 'string',
						)
						.map((g) => ({ userIds: g.userIds, rationale: g.rationale }))
				: [],
			knowledgeBridges: Array.isArray(data.knowledgeBridges)
				? data.knowledgeBridges
						.filter(
							(b): b is { seekerUserId: string; helperUserIds: string[]; rationale: string } =>
								typeof b?.seekerUserId === 'string' &&
								Array.isArray(b?.helperUserIds) &&
								b.helperUserIds.every((id) => typeof id === 'string') &&
								typeof b?.rationale === 'string',
						)
						.map((b) => ({
							seekerUserId: b.seekerUserId,
							helperUserIds: b.helperUserIds,
							rationale: b.rationale,
						}))
				: [],
		};
	} catch {
		return null;
	}
}
