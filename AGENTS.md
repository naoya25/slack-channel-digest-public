# slack-channel-digest — AI / エージェント向けガイド

このリポジトリは **日報チャンネルを毎朝まとめ、Slack Canvas に分析レポートを書き戻す** Cloudflare Worker です。プロダクト目標・背景・パイプライン詳細は **`docs/architecture.md` を正とする**。実装や変更の前に必ず読む。

## 何を作っているか（要約）

- **トリガー**: Cron（本番は JST 毎朝 6:00 相当＝UTC `0 21 * * 0-4` を想定。朝会の数時間前に前日分を処理）
- **流れ**: Slack `conversations.history` で取得 → **Pass 1**（人数分の個別サマリー JSON、並列想定）→ **Pass 2**（横断分析・Canvas 用 Markdown）→ `canvases.edit` で Canvas 更新
- **公開 HTTP ボットではない**: 検証の中心は **scheduled が動くことと Slack 側の結果**。テンプレの `fetch` は開発用の名残になり得る

## 現状のエントリポイント

**いまのリポジトリでは `src/index.ts` のみ** が Worker の実体である。Cron から呼ばれるのは **`export default` の `scheduled` ハンドラ**（現状は Wrangler テンプレートのサンプル処理）。`fetch` はローカル検証用の案内メッセージ用。

## ディレクトリ設計（目標構成・未反映）

次の表とファイル名は `docs/architecture.md` Phase 3 の **移行先の目安**であり、**まだリポジトリに存在しないことがある**。パスを前提に読まず、実際のツリーと突き合わせること。

`docs/architecture.md` に従い、責務を分離する想定。

| 層 | 役割 |
|----|------|
| `slack/ingest/` | 履歴・ユーザー等の **読み取り** |
| `llm/` | プロバイダ差し替え想定の **薄いクライアント** |
| `analysis/` | ドメイン。**`type` ごとにサブフォルダ**（例: `structured-digest/`） |
| `slack/output/` | Canvas 更新など **書き込み・副作用** |

**いまの実装**では、`handlers/cron.ts` が **ingest → `analysis/structured-digest` の `runStructuredDigest` → output** の順だけ把握すればよい。分析種別を増やす場合は `cron` 側で分岐するか、薄いレジストリを別途置く。

## 設定ファイル（このリポジトリ）

- **Wrangler 設定**: `wrangler.jsonc`（`wrangler.toml` の記述はアーキテクチャ文書の参考例。実体は jsonc）
- **`compatibility_flags`**: `nodejs_compat` を使う想定（アーキテクチャ・依存に合わせる）
- **Cron**: 本番向けスケジュールは `docs/architecture.md` の値に合わせる。ローカル検証では `* * * * *` や `--test-scheduled` でよい
- **`vars`**: 非秘密の `CHANNELS_CONFIG`（チャンネル ID・分析 `type`・Canvas ID など）を載せる想定
- **Secrets**（リポジトリに書かない）: `SLACK_BOT_TOKEN`、`JAPANAI_API_KEY`、`JAPANAI_USER_ID` → `wrangler secret put`、ローカルは `.dev.vars`（Git 対象外）

`wrangler.jsonc` の bindings / `vars` を変えたら **`npm run cf-typegen`（`wrangler types`）で `Env` 型を再生成**する。

## よく使うコマンド

| コマンド | 用途 |
|----------|------|
| `npm run dev` | `wrangler dev --test-scheduled` — scheduled をローカルで試す |
| `npm run deploy` | 本番デプロイ |
| `npm run cf-typegen` | `wrangler types` — バインディング変更後の型生成 |
| `npx wrangler secret put <NAME>` | 本番シークレット登録 |

ローカルでシークレットを使う場合はプロジェクト直下に `.dev.vars` を置く（値はコミットしない）。手順の詳細は `docs/architecture.md` Phase 5。

## Cloudflare Workers（一般ルール）

Workers の API・上限は更新が早い。**Workers / Cron / 利用プロダクトの公式ドキュメントを都度確認**すること。

- 概要: https://developers.cloudflare.com/workers/
- MCP: https://docs.mcp.cloudflare.com/mcp
- 上限・クォータ: 該当プロダクトの `platform/limits` など公式ページ
- Node 互換: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- エラー全般: https://developers.cloudflare.com/workers/observability/errors/
- Error **1102**（CPU/メモリ超過）: Workers の limits ドキュメントで確認

KV / R2 / D1 / Durable Objects / Queues 等を触る場合は、そのプロダクトの API と limits を公式から取る。

## 実装時の注意

- **秘密情報**（Bot トークン、API キー、生のチャンネル内容のログなど）をリポジトリやログに残さない
- 目標構成に沿って実装するときは、分析を **`analysis/<type>/` に閉じ**、Cron 側（現状は `scheduled`、移行後は `handlers/cron.ts` 想定）は **`runStructuredDigest` 等の分析関数の呼び出し**に留める
- ブランチの切り方・担当分担の目安は `docs/architecture.md` 末尾の TODO 表を参照

## 関連ドキュメント

- [設計・アーキテクチャ](./docs/architecture.md)
