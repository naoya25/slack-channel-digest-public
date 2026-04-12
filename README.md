# slack-channel-digest

Cloudflare Workers で動く Slack 日報ダイジェスト Bot。  
`26卒_日報` チャンネルから日報を自動収集し、GPT-4o-mini で分析した結果を **Slack Canvas** に朝会・夕会の2段階で書き込む。

---

## 出力フロー

```
[朝会 JST 9:30 / Cron: 30 0 * * 1-5]

26卒_日報_ダイジェスト > 日報分析レポート（Canvas）
┌─────────────────────────────────────────┐
│ # 4/10(金) 日報ダイジェスト（朝会時点） │
│                                         │
│ ## 全体サマリー                         │
│ ...                                     │
│                                         │
│ ## ![](@U_AKITO)                        │
│ 当日コアサマリー                        │
│                                         │
│ ## ![](@U_NAOYA)                        │
│ 当日コアサマリー                        │
└─────────────────────────────────────────┘

[夕会 JST 18:00 / Cron: 0 9 * * 1-5]

Canvas を上書き更新
┌──────────────────────────────────────────────────┐
│ # 4/10(金) 日報ダイジェスト（夕会時点・更新済み） │
│                                                  │
│ ## 全体サマリー                                  │
│ ...                                              │
│                                                  │
│ ## ![](@U_AKITO)                                 │
│ ### 当日サマリー（朝会）                         │
│ ...                                              │
│ ### 累積サマリー（夕会）← 4/1〜当日の全日報分析  │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

> ユーザーは Canvas の `![](@userId)` 形式でメンションされる。

## LLM 分析パイプライン（2フェーズ）

```
Slack 26卒_日報
      │
      ▼
[Ingest] conversations.history API でメッセージ取得
      │
      ▼
[Pass 1] ユーザーごとに並列で個人サマリーを生成（gpt-4o-mini）
      │
      ▼
[Pass 2] 全員分のサマリーをまとめて横断分析（gpt-4o-mini）
      │
      ├── 朝会: 前営業日分のみ → コアサマリー → Canvas 書き込み
      └── 夕会: 4/1〜当日累積 → 詳細・人ベースサマリー → Canvas 上書き
```

---

## セットアップ

### 必要なもの

- Node.js >= 20.19.0（`nvm` / `fnm` ならリポジトリ直下の `.nvmrc` を参照）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare アカウント
- Slack Bot Token（`xoxb-...`）と OpenAI API Key

### インストール

```bash
npm install
```

### ローカル開発用の設定ファイル作成

`.dev.vars.example` をコピーして `.dev.vars` を作成し、実際の値を入力する（`.dev.vars` はコミットしない）。

```bash
cp .dev.vars.example .dev.vars
```

```dotenv
# .dev.vars
SLACK_BOT_TOKEN="xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx"
OPENAI_API_KEY="sk-proj-xxxx"

# channelId : 26卒_日報 のチャンネル ID（メッセージ取得元）
# canvasId  : 26卒_日報_ダイジェスト > 日報分析レポート の Canvas ID
CHANNELS_CONFIG='[{"channelId":"C_SOURCE","type":"structured-digest","label":"日報","canvasId":"F_CANVAS"}]'
```

### KV Namespace のセットアップ（夕会フェーズで必要）

朝会の分析結果を夕会で参照するための Cloudflare KV Namespace を作成する。

```bash
# 本番用
wrangler kv namespace create THREAD_STORE

# プレビュー（ローカル dev）用
wrangler kv namespace create THREAD_STORE --preview
```

出力された `id` と `preview_id` を `wrangler.jsonc` の該当箇所に設定する。

```jsonc
"kv_namespaces": [
  {
    "binding": "THREAD_STORE",
    "id": "ここに本番の id",
    "preview_id": "ここに preview_id"
  }
]
```

`vars` やバインディングを変えたら `npm run cf-typegen` で型定義を再生成する。

---

## コマンド

```bash
npm run dev      # ローカル起動（wrangler dev --test-scheduled）
npm run build    # TypeScript 型チェック（tsc --noEmit）
npm run lint     # ESLint
npm run deploy   # 本番デプロイ（事前に Secret 登録が必要）
```

### ローカルでの動作確認

```bash
# Worker 起動後、別ターミナルで各フェーズをトリガー
curl "http://localhost:8787/__scheduled?cron=30%200%20*%20*%201-5"  # 朝会フェーズ
curl "http://localhost:8787/__scheduled?cron=0%209%20*%20*%201-5"   # 夕会フェーズ
```

ログは `wrangler tail` で確認できる（本番デプロイ後）。

---

## 本番デプロイ

```bash
# Secret を登録（wrangler.jsonc の vars には入れないこと）
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put OPENAI_API_KEY

# デプロイ
npm run deploy
```

本番の Cron スケジュールは `wrangler.jsonc` の `triggers.crons` で確認・変更できる。

---

## 環境変数・設定一覧

| 変数名 | 種別 | 説明 |
|---|---|---|
| `SLACK_BOT_TOKEN` | Secret | Slack Bot Token（`xoxb-...`） |
| `OPENAI_API_KEY` | Secret | OpenAI API Key |
| `CHANNELS_CONFIG` | Var (JSON) | チャンネル設定の配列（下記参照） |
| `THREAD_STORE` | KV Namespace | 朝会分析結果の保存先（夕会フェーズで参照） |

### CHANNELS_CONFIG の各フィールド

| フィールド | 必須 | 説明 |
|---|---|---|
| `channelId` | ✅ | 日報取得元の Slack チャンネル ID（`26卒_日報`） |
| `type` | ✅ | 分析種別。現状は `structured-digest` のみ |
| `label` | ✅ | ログ・プレフィックス用の表示名 |
| `canvasId` | ✅ | 出力先 Canvas の ID（`26卒_日報_ダイジェスト > 日報分析レポート`） |

---

## Slack Bot の必要権限（OAuth Scopes）

| Scope | 用途 |
|---|---|
| `channels:history` | 日報チャンネルのメッセージ取得 |
| `users:read` | userId → 表示名の解決 |
| `canvases:write` | Canvas の作成・更新 |
| `canvases:read` | Canvas セクションの読み取り（上書き前の削除に使用） |

---

## ディレクトリ構成

```
src/
├── index.ts                        # エントリーポイント・Cron ディスパッチ
├── env-extensions.d.ts             # KVNamespace の型定義
├── handlers/
│   ├── morning-cron.ts             # 朝会フェーズ（JST 9:30）→ Canvas 書き込み
│   ├── evening-cron.ts             # 夕会フェーズ（JST 18:00）→ Canvas 上書き
│   └── cron.ts                     # 旧フロー（Incoming Webhook / Canvas 単体出力）
├── analysis/
│   ├── morning-digest.ts           # 朝会分析（TODO: LLM 実装 @naoya25）
│   ├── evening-digest.ts           # 夕会分析（TODO: LLM 実装 @naoya25）
│   └── structured-digest/          # 旧フロー用 2-Pass LLM パイプライン
│       ├── index.ts
│       ├── parser.ts               # 4フォーマット対応の日報パーサー
│       ├── prompts.ts              # Pass1 / Pass2 プロンプト定義
│       └── types.ts
├── slack/
│   ├── ingest/
│   │   ├── client.ts               # SlackAPIClient ファクトリ
│   │   ├── history.ts              # conversations.history（ページネーション対応）
│   │   └── users.ts                # userId → 表示名の解決
│   └── output/
│       ├── canvas.ts               # canvases.edit（Canvas 上書き）
│       ├── canvas-markdown.ts      # Canvas 用 Markdown ビルダー・メンション生成
│       ├── post-message.ts         # chat.postMessage / スレッド返信（旧フロー用）
│       ├── incoming-webhook.ts     # Incoming Webhook 投稿（旧フロー用）
│       └── webhook-chunking.ts     # Webhook 用 Markdown チャンク分割（旧フロー用）
├── llm/
│   └── client.ts                   # OpenAI クライアント・chatCompletion ラッパー
├── types/
│   ├── analysis.ts                 # 分析 I/O の共通型
│   ├── channel.ts                  # ChannelConfig 型定義
│   ├── digest.ts                   # 朝会・夕会分析 I/O 型
│   ├── llm.ts                      # LLMMessage 型
│   └── slack.ts                    # SlackMessage 型
├── constants/
│   ├── incoming-webhook.ts         # Webhook 定数（旧フロー用）
│   └── time.ts                     # SECONDS_PER_DAY 等の時間定数
└── utils/
    ├── business-day.ts             # 前営業日窓・年度累積窓の計算（JST）
    ├── group-by.ts                 # Map グループ化ユーティリティ
    ├── ingest-window.ts            # 旧フロー用取得窓計算
    ├── kv-thread-store.ts          # KV への朝会分析結果保存・取得
    ├── parse-channels-config.ts    # CHANNELS_CONFIG JSON パーサー
    └── sleep.ts                    # sleep ユーティリティ
```

---

## CI

push / PR 時に GitHub Actions で自動チェックが走る（`.github/workflows/ci.yml`）。

```bash
npm run build   # TypeScript 型チェック
npm run lint    # ESLint
```

PR を出す前にローカルで両方を通しておくこと。

## コントリビューション

PR を作成すると `.github/pull_request_template.md` のテンプレートが自動で適用される。  
レビューは GitHub Copilot（`.github/copilot-instructions.md`）が自動でコメントを行う。

---

## 開発体制

| 担当 | 役割 |
|---|---|
| @torifo | インフラ・基盤実装（Cron / Canvas 出力 / KV / 型定義） |
| @naoya25 | LLM 分析ロジック（`morning-digest.ts` / `evening-digest.ts`）、CI / GitHub 設定 |
