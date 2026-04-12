/**
 * Slack Incoming Webhook 送信用のチューニング定数。
 * 1 POST あたり `text`（prefix + 本文）の上限の安全側。
 */
export const WEBHOOK_CHUNK_TEXT_MAX = 3500;

/** 連続 POST で 429 を避けるため、チャンク間の待機（ms） */
export const WEBHOOK_CHUNK_GAP_MS = 200;

/** 429 の再試行上限（1 チャンクあたり） */
export const WEBHOOK_MAX_429_ATTEMPTS = 8;

/** Retry-After が無い／解釈できない場合の指数バックオフ上限（ms） */
export const WEBHOOK_BACKOFF_CAP_MS = 30_000;

/** `Retry-After` ヘッダから解釈した待機時間の上限（ms） */
export const WEBHOOK_RETRY_AFTER_MAX_MS = 60_000;

/** 分割時に `total` の探索範囲を広げるフォールバック幅（`webhook-chunking`） */
export const WEBHOOK_SPLIT_TOTAL_PROBE_PAD = 8;
