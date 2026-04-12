/** Pass 1 — 個人の時系列・特徴抽出（goal/work/good/bad は使わない） */
export interface PersonExtractionPass1 {
	username: string;
	/** 投稿の時系列の流れを要約（箇条書き可） */
	timelineNarrative: string;
	/** 筆者の特徴・傾向（観察的な短文） */
	characteristics: string[];
	/** いまの関心・取り組み・モヤモヤ（日報に基づく観察） */
	currentThreads: string;
	/** 横断マッチング用（トピック・課題カテゴリ・経験タグ） */
	matchingHints: {
		topics: string[];
		challenges: string[];
		experienceTags: string[];
	};
}

export type PersonExtractionWithId = PersonExtractionPass1 & { userId: string };

/** Pass2 — 複数人にまたがるテーマ／悩み（memberUserIds は人数・% 計算のみ。Canvas には出さない） */
export interface SharedPatternItem {
	/** よくある悩み・具体アクションなど（人名・個人を特定しない書き方） */
	pattern: string;
	/** 上記に関する簡潔なアドバイス（1〜2 文・短く） */
	briefAdvice: string;
	memberUserIds: string[];
}

/** Pass 2 — チーム横断（類似・知見つなぎ） */
export interface TeamSynthesisPass2 {
	teamOverview: string;
	sharedThemes: SharedPatternItem[];
	sharedChallenges: SharedPatternItem[];
	similarGroups: Array<{ userIds: string[]; rationale: string }>;
	knowledgeBridges: Array<{
		seekerUserId: string;
		helperUserIds: string[];
		rationale: string;
	}>;
}
