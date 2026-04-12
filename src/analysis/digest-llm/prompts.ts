import type { PersonExtractionWithId } from './types';

/** Pass 1 / 2 共通の中立性ルール（Canvas はチャンネルメンバー全員が閲覧可） */
export const NEUTRAL_LANGUAGE_RULES = `【言語の中立性（厳守）】
- 日報に書かれた事実・表現を土台にする。推測・誇張・因果の捏造はしない。
- 能力評価や断定的なラベルは使わない（「サボった」「向いていない」等は禁止）。
- 観察的な言い方にする（「〜と書いている」「〜が繰り返し見られる」など）。
- 課題や悩みの深刻さ・優先度をモデルが判断しない。`;

const PERSON_PASS1_SYSTEM = `あなたは日報テキストから、時系列の流れと筆者の特徴を抽出するアシスタントです。
${NEUTRAL_LANGUAGE_RULES}

【方針】
- 定型フォーマット（目標・取り組みなどの見出し）に依存しない。本文の並び・日付の流れを優先する。
- セクション見出しがなくても、投稿の先から順に「何が起きたか」の筋を読み取る。

【出力】
マークダウンコードブロックなし・JSON のみ（日本語）：
{"username":"...","timelineNarrative":"...","characteristics":["..."],"currentThreads":"...","matchingHints":{"topics":["..."],"challenges":["..."],"experienceTags":["..."]}}

- timelineNarrative: その期間の流れを 1 段落または短い箇条書きで。
- characteristics: 3〜7 個程度の短文。
- currentThreads: いまの関心・着手していること・課題感（なければ空に近い短文）。
- matchingHints: チーム内マッチング用。topics=テーマ、challenges=困りごとの種類、experienceTags=強み・学びのタグ。`;

/**
 * 朝会: 前営業日ぶんの個人日報から抽出。
 */
export function buildMorningPersonPass1Prompt(
	username: string,
	chronologicalReportText: string,
	dateLabel: string,
): { system: string; user: string } {
	const user = `【対象者】${username} さん
【集計日（前営業日）】${dateLabel}

以下は、その期間にこの方がチャンネルに投稿した日報テキストです（時系列順）。

---
${chronologicalReportText}
---

上記から JSON 形式で抽出してください。日報が極端に短い場合は、分かる範囲だけ埋め、空は空配列・短い文でよいです。
username フィールドは "${username}" と一致させてください。`;

	return { system: PERSON_PASS1_SYSTEM, user };
}

/**
 * structured-digest / cron 用: チャンネル設定の取得期間に合わせた個人抽出（前営業日に限定しない）。
 */
export function buildStructuredIngestPersonPass1Prompt(
	username: string,
	chronologicalReportText: string,
	ingestPeriodLabelJa: string,
): { system: string; user: string } {
	const user = `【対象者】${username} さん
【取得期間】${ingestPeriodLabelJa}

以下は、その期間にこの方がチャンネルに投稿した日報テキストです（時系列順）。

---
${chronologicalReportText}
---

上記から JSON 形式で抽出してください。日報が極端に短い場合は、分かる範囲だけ埋め、空は空配列・短い文でよいです。
username フィールドは "${username}" と一致させてください。`;

	return { system: PERSON_PASS1_SYSTEM, user };
}

const PERSON_PASS1_BATCH_SYSTEM = `あなたは複数メンバーの日報テキストから、それぞれについて時系列の流れと筆者の特徴を抽出するアシスタントです。
${NEUTRAL_LANGUAGE_RULES}

【方針】
- ブロックごとに 1 人分の日報が与えられる。人物どうしの内容を混ぜない。
- 定型フォーマットに依存せず、本文の並び・日付の流れを優先する。

【出力】
マークダウンコードブロックなし・JSON のみ（日本語）：
{"people":[
  {"userId":"U…","username":"…","timelineNarrative":"…","characteristics":["…"],"currentThreads":"…","matchingHints":{"topics":["…"],"challenges":["…"],"experienceTags":["…"]}}
]}

- people の要素数は入力の人数と同じにする。各人 1 要素。
- userId・username は各ブロックの見出しで指定された値と必ず一致させる。
- timelineNarrative / characteristics / currentThreads / matchingHints の意味は単独抽出時と同じ（matchingHints はチーム内マッチング用）。`;

export type StructuredPass1BatchMember = {
	userId: string;
	username: string;
	chronologicalReportText: string;
};

/**
 * structured-digest 用: 複数人分を 1 リクエストで Pass1 抽出する。
 */
export function buildStructuredIngestBatchPass1Prompt(
	members: StructuredPass1BatchMember[],
	ingestPeriodLabelJa: string,
): { system: string; user: string } {
	const blocks = members
		.map(
			(m) =>
				`### userId: ${m.userId}\n### 表示名（username）: ${m.username}\n\n---\n${m.chronologicalReportText}\n---`,
		)
		.join('\n\n');

	const user = `【取得期間】${ingestPeriodLabelJa}

以下は ${members.length} 名分の日報です。各 --- ブロックは 1 人分（時系列順）です。

${blocks}

上記全員分を、指定の JSON スキーマ（people 配列）で一度に出力してください。`;

	return { system: PERSON_PASS1_BATCH_SYSTEM, user };
}

/**
 * 夕会: 年度初め〜現在までの累積投稿から抽出。
 */
export function buildEveningPersonPass1Prompt(
	username: string,
	chronologicalReportText: string,
): { system: string; user: string } {
	const system = `${PERSON_PASS1_SYSTEM}

【夕会・累積モードの追記】
- timelineNarrative には、年度開始以降の変化・継続テーマの流れをまとめる（時系列の大筋）。
- characteristics は「続いている傾向」「最近の変化」が分かるようにする。`;

	const user = `【対象者】${username} さん
【対象期間】年度開始日（4/1）以降〜現在までの累積投稿（時系列順）

---
${chronologicalReportText}
---

上記から JSON 形式で抽出してください。投稿が多い場合は全体の傾向を優先し、細部の列挙は避けてください。
username フィールドは "${username}" と一致させてください。`;

	return { system, user };
}

export type TeamPass2Scenario = 'morning' | 'evening' | 'structured';

const TEAM_PASS2_SYSTEM = `あなたは、複数メンバーの日報「抽出結果」を横断し、チームが会議で使えるつながりのヒントを出すアシスタントです。
${NEUTRAL_LANGUAGE_RULES}

【やること】
- 全体の傾向（teamOverview）。個人名は使わず「複数の日報で〜が見られる」など観察的に。
- 複数人に共通または近いテーマ・学び（sharedThemes）、悩み・課題のパターン（sharedChallenges）。各項目に「該当メンバー」の userId を列挙（人数・割合はシステムが計算する。**Canvas には名前は出さないため、pattern / briefAdvice に人名を書かない**）。
- 似た関心・取り組みのメンバーをグループ化（similarGroups）。各グループ 2〜4 名、根拠は観察的に。
- 一方が課題・モヤモヤを書き、他方が関連する学び・うまくいった経験・ノウハウを書いている可能性がある組み合わせ（knowledgeBridges）。断定せず「日報上の内容が近いため、話してみる価値がありそう」程度のトーン。

【出力】
マークダウンコードブロックなし・JSON のみ：
{"teamOverview":"...","sharedThemes":[{"pattern":"具体テーマや取り組みの様子（人名なし）","briefAdvice":"チーム向けの短いアドバイス（1〜2文）","memberUserIds":["U...","U..."]}],"sharedChallenges":[{"pattern":"よくある悩みや詰まり方（人名なし）","briefAdvice":"検討のヒント（1〜2文・断定しすぎない）","memberUserIds":["U..."]}],"similarGroups":[{"userIds":["U..."],"rationale":"..."}],"knowledgeBridges":[{"seekerUserId":"U...","helperUserIds":["U..."],"rationale":"..."}]}

【sharedThemes / sharedChallenges のルール】
- pattern: 日報の内容に根ざした「よくある悩み」や「具体的なアクション・取り組み」の説明。個人名・「Aさん」等の特定は禁止。
- briefAdvice: そのパターンに対する簡潔なアドバイス。命令口調や評価は避け、「〜を一度整理するとよさそう」「ペアやレビューで共有するとよい場合がある」など短く。
- memberUserIds: その pattern に該当するメンバー全員（入力の userId のみ・重複なし）。割合計算にのみ使われ、レポート本文には載らない。
- 2 名未満しか該当しない項目は出力しない。

【厳守】
- userIds / memberUserIds / seekerUserId / helperUserIds は、入力 JSON に現れる Slack の userId のみ使用する。捏造禁止。
- 根拠のないペアリングはしない。データが薄い場合は配列を空に近くしてよい。
- teamOverview・pattern・briefAdvice には個人名・表示名・ユーザーメンションを書かない。`;

/** 朝会: 入力に表示名が無い前提で、全体サマリー欄を完全匿名＋洞察を鋭く */
const TEAM_PASS2_MORNING_ANONYMOUS = `

【朝会・全体サマリー欄（匿名性・最優先）】
- このシナリオでは入力 JSON に **username（表示名）は含まれない**。userId のみが人物のキー。本文（teamOverview・各 rationale・briefAdvice）に **いかなる個人名・ニックネーム・表示名・「〇〇さん」・メール名・@メンション相当の表現も書かない**。
- teamOverview: 3〜6 文程度で、チーム全体の流れ・リスク・機会を **匿名のまま** はっきり書く。抽象的な慰めより、**業務・プロセス・優先度・検証すべき仮説**に踏み込んでよい（上記の中立性ルールの精神は守る）。
- sharedThemes / sharedChallenges の briefAdvice: 一般論に逃げず、**チームが今日試せる打ち手・問い・注意点**を短く具体的に（依然として個人特定なし）。
- similarGroups の rationale: **誰がどうとは書かず**、共通している関心・文脈と、チームとしての打ち手・対話の切り口を鋭く。
- knowledgeBridges の rationale: **誰から誰へとは書かず**、「課題やモヤモヤが書かれている記述」と「関連する学び・再現手順が書かれている記述」の **あいだで起きうるシナジー**を匿名で述べ、会議やペアでの確認を促す具体度まで含めてよい。`;

function teamPass2SystemForScenario(scenario: TeamPass2Scenario): string {
	return scenario === 'morning' ? TEAM_PASS2_SYSTEM + TEAM_PASS2_MORNING_ANONYMOUS : TEAM_PASS2_SYSTEM;
}

/** Pass2 投入用。朝会は username を渡さない（全体サマリー匿名化） */
function pass2InputRow(scenario: TeamPass2Scenario, e: PersonExtractionWithId) {
	if (scenario === 'morning') {
		return {
			userId: e.userId,
			timelineNarrative: e.timelineNarrative,
			characteristics: e.characteristics,
			currentThreads: e.currentThreads,
			matchingHints: e.matchingHints,
		};
	}
	return {
		userId: e.userId,
		username: e.username,
		timelineNarrative: e.timelineNarrative,
		characteristics: e.characteristics,
		currentThreads: e.currentThreads,
		matchingHints: e.matchingHints,
	};
}

function scenarioIntro(scenario: TeamPass2Scenario, periodNote: string): string {
	switch (scenario) {
		case 'morning':
			return `【シナリオ】朝会用 — 前営業日の日報に基づく横断分析。\n【集計の説明】${periodNote}`;
		case 'evening':
			return `【シナリオ】夕会用 — 年度累積の抽出結果に基づく横断分析。\n【集計の説明】${periodNote}`;
		case 'structured':
			return `【シナリオ】単発レポート用 — 下記の取得期間に基づく横断分析。\n【集計の説明】${periodNote}`;
	}
}

/**
 * Pass 2 — 各人の Pass1 抽出 JSON を入力に、チーム横断 JSON を返す。
 */
export function buildTeamPass2Prompt(
	extractions: PersonExtractionWithId[],
	scenario: TeamPass2Scenario,
	periodNote: string,
): { system: string; user: string } {
	const payload = extractions.map((e) => pass2InputRow(scenario, e));

	const user = `${scenarioIntro(scenario, periodNote)}

以下は各メンバーの Pass1 抽出結果です（${extractions.length} 名分）。

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

上記のみを根拠に JSON を出力してください。`;

	return { system: teamPass2SystemForScenario(scenario), user };
}
