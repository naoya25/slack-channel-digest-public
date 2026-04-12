import { SECONDS_PER_DAY } from '../constants/time';

/** JST オフセット（ミリ秒） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * UTC ms を受け取り、JST カレンダー上で「その日の 0:00:00 JST」を UTC ms で返す。
 */
function jstMidnightMs(nowMs: number): number {
	const nowJst = nowMs + JST_OFFSET_MS;
	const midnightJst = nowJst - (nowJst % (24 * 60 * 60 * 1000));
	return midnightJst - JST_OFFSET_MS;
}

/** `{ dateLabel, isoDate, oldest, latest }` */
export interface BusinessDayWindow {
	/** 表示用ラベル（例: `4/10(金)`） */
	dateLabel: string;
	/** KV キー用 ISO 日付（例: `2026-04-10`） */
	isoDate: string;
	/** `conversations.history` 用 oldest（Unix 秒） */
	oldest: number;
	/** `conversations.history` 用 latest（Unix 秒） */
	latest: number;
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

/**
 * 前営業日の取得窓を返す（月〜金を営業日とみなす）。
 * - 月曜: 金曜（3 日前）
 * - 日曜: 金曜（2 日前。前日の土曜は非営業日のため）
 * - 火〜土: 直前のカレンダー日が営業日なので 1 日前
 */
export function getPreviousBusinessDay(nowMs: number = Date.now()): BusinessDayWindow {
	const nowJst = new Date(nowMs + JST_OFFSET_MS);
	const dayOfWeek = nowJst.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
	let daysBack = 1;
	if (dayOfWeek === 1) daysBack = 3; // 月 → 金
	else if (dayOfWeek === 0) daysBack = 2; // 日 → 金（土はスキップ）

	const prevMs = nowMs - daysBack * 24 * 60 * 60 * 1000;
	const prevMidnightUtcMs = jstMidnightMs(prevMs);

	const prevJst = new Date(prevMs + JST_OFFSET_MS);
	const month = prevJst.getUTCMonth() + 1;
	const day = prevJst.getUTCDate();
	const weekday = WEEKDAY_JA[prevJst.getUTCDay()];

	const yyyy = prevJst.getUTCFullYear();
	const mm = String(month).padStart(2, '0');
	const dd = String(day).padStart(2, '0');

	return {
		dateLabel: `${month}/${day}(${weekday})`,
		isoDate: `${yyyy}-${mm}-${dd}`,
		oldest: Math.floor(prevMidnightUtcMs / 1000),
		latest: Math.floor(prevMidnightUtcMs / 1000) + SECONDS_PER_DAY - 1,
	};
}

/**
 * 当該年度の 4/1 00:00 JST〜現在の取得窓を返す。
 * 4 月以降なら当年の 4/1、それ以前なら前年の 4/1 を起点とする。
 */
export function getFiscalYearToDateWindow(nowMs: number = Date.now()): {
	oldest: number;
	latest: number;
} {
	const nowJst = new Date(nowMs + JST_OFFSET_MS);
	const year = nowJst.getUTCFullYear();
	const month = nowJst.getUTCMonth() + 1; // 1-indexed
	const fiscalYear = month >= 4 ? year : year - 1;

	// 4/1 00:00 JST = UTC 上では前日 15:00
	// Date.UTC(fiscalYear, 3 /* 0-indexed=April */, 1) は 4/1 00:00 UTC
	// そこから JST オフセット分引くと 4/1 00:00 JST (= 3/31 15:00 UTC) になる
	const apr1JstMs = Date.UTC(fiscalYear, 3, 1, 0, 0, 0) - JST_OFFSET_MS;

	return {
		oldest: Math.floor(apr1JstMs / 1000),
		latest: Math.floor(nowMs / 1000),
	};
}
