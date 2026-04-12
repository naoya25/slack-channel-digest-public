# channel-digest — 設計ドキュメント

## 目標

> **研修期間中、同期全員が日報チャンネルの情報を毎日5分以内に把握できる状態を作る。**
> 具体的には「誰が何に悩んでいるか」「共通テーマは何か」「目標とのズレがある人は誰か」を、能動的に全件を読まずとも分かるようにする。

---

## 現状（What）

> **事実のみ**

1. 同期は約30人。日報チャンネルに毎営業日、全員分のメッセージが投稿される（約30件/日）
2. 日報のフォーマット（大見出し4項目）は共通して決まっている
   - 今日の目標
   - 今日の取り組み
   - 上手く行ったこと / 学び
   - 上手くいかなかったこと / 改善点
3. 各セクション内の書き方（箇条書きの粒度・文体・詳細度）は人によってバラバラ
4. SlackのUIはタイムライン形式のため、過去メッセージは流れて埋もれる
5. 夕会で日報共有に使える時間は5〜10分
6. 横断的に「誰が何に悩んでいるか」「目標と取り組みがズレていないか」を見る機能が現状存在しない
7. 5〜10分で全員の日報（約30件）を読んで議論の的を絞ることは不可能（1件1分でも30分かかる）

---

## ギャップ（Why）

> **なぜ現状が目標を達成していないか。ボトルネックの特定。**

### Why-1: 5〜10分で「全体の状況把握 → 議論」をするには生の日報は重すぎる

- 夕会の5〜10分で全員分の日報を読んで要点を掴むのは時間的に不可能
- 読めないまま夕会が終わると「今日みんな何してたか」が共有されず、チームとしての学びが積み上がらない
- 結果として夕会の日報タイムが「形式的な消化」になりやすい

### Why-2: 各セクション内の情報が整理されていない

- 大見出しは共通だが、各セクション内の粒度・詳しさが人によって大きく異なる
- 「今日の目標」を全員分並べて比較するという行為をSlack上ではできない
- 「上手くいかなかったこと」を全員分まとめて見れば共通の悩みが見えるが、現状それが一覧化されていない

### Why-3: 過去の日報は遡れるが、量が多すぎて実用的でない

- Slackをスクロールすれば過去の投稿には辿り着けるが、30人×日数分の投稿が積み上がっており現実的な遡り方ではない
- キーワード検索はできるが「先週みんなが詰まっていたこと」のような問いはクエリにできない

### Why-4: 時系列の変化・傾向が掴めない

- 「先週と今週で同じ悩みが繰り返されていないか」「誰かの課題が改善されているか」といった変化の観察ができない
- 日々の流れの中で一時点しか見えないため、チームとしての成長や停滞に気づくタイミングが遅れる

---

## アクション（How）

> **専用 Slack Bot が、毎朝6:00（朝会10:00の4時間前）に、日報チャンネルの前日分全員の投稿を読み取り、分析結果を Canvas「日報分析レポート」に上書きする。**

### 全体アーキテクチャ

```
Slack チャンネル
    ↓ conversations.history API（全メッセージ取得）
Cloudflare Workers (TypeScript)
    ↓ [Pass 1] 30人を並列処理 → 1人ずつ個別サマリーをJSON生成（gpt-4o-mini × 30並列）
    ↓ [Pass 2] 30件のJSON → 横断分析・Canvas用Markdown生成（gpt-4o-mini × 1回）
    ↓ canvases.edit API
Slack Canvas（分析結果を常に最新の状態で参照可能）
```

**トリガー**

- Cron Trigger（Cloudflare側）のみ → 毎朝6:00 JST に自動実行（朝会10:00の4時間前）
  - `0 21 * * 0-4`（UTC 21:00 = JST 6:00、日〜木に実行 = 月〜金の朝6時）

> 朝6:00に実行し、前日分の日報を分析。朝会10:00の時点で Canvas が更新済みの状態になる。

---

### 個人サマリー（Pass 1）のセーフティネット

Canvas はチャンネルメンバーが参照する**オープンな場所**になり得る。Pass 1 の「1人ずつ個別サマリー」は、まとめ方次第で原文より**攻撃的・断定的・評価的**に言い換わり、本人や周囲への負担や信頼低下につながりうる。

**方針**

- **原文の事実と本人の言い回しを尊重**する。推測・誇張・因果の捏造はしない。
- **キツい表現を出さない**: 人格・能力へのレッテル、嘲り、断定の非難、他人のせいにするフレーミング、「サボった」「能力不足」「やる気がない」などの評価語は使わない。
- **中立的・観察的な言い方**に寄せる（例: 「〜できていない」より、日報に即した「〜に着手できていない」「〜が課題として挙がっている」など）。
- **悩み・改善点は「投稿に書かれている内容の要約」**として扱い、優先度や深刻さを勝手に煽らない。

**実装でのフック**（`analysis/structured-digest/prompts.ts` ほか）

- Pass 1 プロンプトに上記を**システム指示または固定ルール**として明示する。
- 必要なら Pass 1 出力に対する**軽量なセカンドパス**（同じモデルで「過剰に厳しい・評価的な表現の除去・ニュートラル化のみ」）や、禁止パターンの簡易チェック（ヒット時はログ警告・再生成のトリガーなど）を検討する。
- チーム合意のもと、**最初は短文・事実列挙中心の控えめな要約**から始め、運用で問題がなければ詳細度を上げる段階導入もありうる。

---

### Phase 0: 前提確認（着手前チェック）

- [x] Slack Bot（プロジェクト用アプリ）の権限: `canvas:write`だけ足りなそうだったので申請済
- [x] OpenAI APIキー: ~~開発メンバー個人のキーで当面運用~~ → 共同開発者のキーを GitHub Secrets に登録予定（`OPENAI_API_KEY`）
  - [ ] 今後の展望として、ローカルで動くLLMを使うと完全無料でいけそう
- [x] Node.js 20.19 以上（`package.json` の `engines` / `.nvmrc`。ESLint 10 など開発依存の下限）・Wrangler CLIが入っているか
  - [x] `node -v` / `wrangler --version`

---

### Phase 1: プロジェクト作成

参考: Qiita 等の「Slack API × TypeScript × Cloudflare Workers でボットを作る」系の解説記事（プロジェクト初期化・Cron の手順の参照用。著者固有の URL は伏せる）

↑手順の参考として有用

```bash
# 記事と同じ手順でプロジェクト作成
npx wrangler init channel-digest
# 対話: **Scheduled Worker (Cron Trigger)** + TypeScript を推奨
#   → wrangler に [triggers] crons の例と export default { scheduled } の骨格が入る
# Worker Only でもよい（その場合は wrangler.toml に [triggers] crons と scheduled を自分で足す）

cd channel-digest

# Slack SDK（Workers対応版）
npm i slack-cloudflare-workers@latest
```

**`wrangler.toml` を以下に書き換える：**
[wrangler.tomlについて](https://zenn.dev/iosamu/articles/c20298d5e7c1e1)

> Wranglerはオプションでwrangler.tomlというファイルを使ってWorkerの開発・デプロイ設定をカスタマイズする

wrangler.tomlは自作することになるね多分

↓合ってないとは思うが参考までに

```toml
name = "channel-digest"
main = "src/index.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 21 * * 0-4"]  # UTC 21:00 = JST 6:00（月〜金の朝6時）

[vars]
# チャンネルごとに type（分析タイプ）と canvasId を設定する
# type を増やすことで、日報以外のチャンネルにも対応できる
CHANNELS_CONFIG = '[{"channelId":"C000000001","type":"structured-digest","canvasId":"F000000001","label":"日報チャンネル"}]'
```

**Secrets（認証情報のみ）を登録する：**

```bash
wrangler secret put SLACK_BOT_TOKEN  # xoxb- で始まるBot User OAuth Token
wrangler secret put OPENAI_API_KEY   # OpenAI の APIキー
```

---

### Phase 2: Slack App 設定（プロジェクト用 Bot）

**③ 対象チャンネルに Bot を招待する：**

```
/invite @<Bot の表示名または App 名>
```

---

### Phase 3: ディレクトリ構成と実装

**主軸は「責務の分離」**。チャンネルごとの分析の違いは `analysis/` 配下の **type 名のフォルダ1つ**に閉じ込め、第一分類は ingest / llm / analysis / output のままにする。

| 層                 | 役割                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| **Slack 情報収集** | チャンネル履歴・ユーザー情報など、**読み取り**だけ                                       |
| **LLM**            | プロバイダ差し替えを想定した**薄いインターフェース**（OpenAI 呼び出しの集約）            |
| **分析**           | メッセージをどう解釈・構造化・要約するか（**ドメイン**。実装は type ごとのサブフォルダ） |
| **Slack 操作**     | Canvas 更新など、**書き込み・副作用**                                                    |

```
src/
├── index.ts                 # エントリ（scheduled のみ）
├── config.ts                # ChannelConfig 型・CHANNELS_CONFIG のパース
├── handlers/
│   └── cron.ts              # チャンネル設定をループし、ingest → runStructuredDigest → 出力
├── slack/
│   ├── ingest/              # Slack からの情報収集（読み取り専用）
│   │   ├── client.ts        # SlackAPIClient 生成（slack-cloudflare-workers）
│   │   ├── history.ts       # conversations.history（ページネーション含むならここ）
│   │   └── users.ts         # users.info 等
│   ├── output/              # Slack への操作（書き込み・副作用）
│   │   └── canvas.ts        # canvases.edit 等（SDK未対応なら fetch で実装）
│   └── types.ts             # SlackMessage 等
├── llm/
│   ├── client.ts            # chat/completions 等の共通呼び出し
│   └── types.ts             # 必要ならリクエスト/レスポンス型
└── analysis/
    └── structured-digest/   # type: "structured-digest"。固定見出し（目標・取り組み・良かった点・改善点）前提の2パス要約
        ├── index.ts         # runStructuredDigest：ingest 済み入力 → Pass 1/2 LLM → Canvas 用 Markdown
        ├── parser.ts        # 投稿テキスト → セクション構造体
        ├── prompts.ts       # Pass1 / Pass2 プロンプト（Pass1 は個人サマリー用セーフティネット方針を明示）
        └── types.ts         # Pass1 用の型
```

`cron.ts` は **ingest でメッセージ取得 → `runStructuredDigest`（`analysis/structured-digest/index.ts`）で Markdown 生成 → Webhook または `output/canvas`** の順だけ知っていればよい。LLM は分析側から `llm/client` を呼ぶ。分析種別を複数に増やす場合は `cron` で分岐するかレジストリを別途置く想定。

---

### 日報メッセージのフォーマット（`parser.ts` の参考）

実際の日報は以下の4パターンが混在する。`parser.ts` はこれらすべてを吸収してセクション構造体に変換する。

**パターン A: 番号付き（ピリオド区切り）**

```
1.今日の目標
人の発表を聞いたり、自分の気になる部分を確認したり
2.今日の取り組み
発表を聞く、法務とか
3.上手くいったこと / 今日の学び
いい感じに立ち回ることはできた
4.上手くいかなかったこと / 改善点
発表しながら自分が思ってる自分の理想との乖離を感じた
```

**パターン B: 箇条書き（`・` ＋ インデントで内容）**

```
・今日の目標
    ・時間内に、プレゼンをまとめる
・今日の取り組み
    ・福利厚生
・上手くいったこと/学び
    ・福利厚生賃貸があること
・上手くいかなかったこと/改善点
    ・プレゼン内容を少し端的に話せなかった
```

**パターン C: 番号付き（全角スペース＋サブ番号）**

```
1.　今日の目標
　1.1.　福利厚生やしゃとくの理解
2.　今日の取り組み
　2.1.　福利厚生
3.　今日の学び
　3.1.　福利厚生を活用して，ウェルビーイングの体現に努める。
4.　今日の反省
　4.1.　プレゼンがうまくいかず非常に悔しかった。
```

**パターン D: Markdown 見出し（`##` / `###`）**

```markdown
# 2026/04/10

## 振り返り

### 今日の目標

- PREP法について意識する

### 今日やったこと

- Valueプレゼン

### 良かった点・学び

- 福利厚生賃貸(シャトク)について知ることができた

### 課題と改善点

- Valueプレゼンの練習時間が圧倒的に足りていなかった
```

**パーサー方針**（`analysis/structured-digest/parser.ts`）

- セクション見出し判定: 行頭の `番号.`・`・`・`##` などのプレフィックスを除去した後、キーワードで分類
- インデントあり行（半角/全角スペース起点）は内容行として扱う（見出し判定スキップ）
- 見出しが見つからない項目は空文字。`raw` フィールドを Pass 1 プロンプトのフォールバックとして保持する

| カテゴリ | 代表キーワード                             |
| -------- | ------------------------------------------ |
| `goal`   | 目標                                       |
| `work`   | 取り組み、やったこと                       |
| `good`   | 上手くいったこと、良かった点、学び         |
| `bad`    | 上手くいかなかったこと、改善点、反省、課題 |

---

### Phase 4: Canvas を Slack で用意する

1. 日報チャンネルを開く → 上部「＋」ボタン → **Create a canvas**
2. タイトルを「日報分析レポート」など分かりやすい名前にして作成
3. Canvas のリンクをコピー → URL の `F...` の部分が Canvas ID
4. `wrangler.toml` の `CHANNELS_CONFIG` に、そのチャンネルの `channelId` と対になる `canvasId` を書く（Secret ではなく `[vars]`）

---

### Phase 5: 動作確認 → デプロイ

HTTP エンドポイントを公開するボットではないので、**「scheduled が走る → Slack 側の結果を見る」**が検証の中心になる。

#### 5-A: ローカル（scheduled を1回だけ発火）

1. プロジェクト直下に `.dev.vars`（Git に入れない）を用意する。

```bash
# .dev.vars
SLACK_BOT_TOKEN=xoxb-...
OPENAI_API_KEY=sk-...
```

2. **起動時に `scheduled` を1回実行**する（本番の Cron 時刻を待たない）。

```bash
npx wrangler dev --test-scheduled
```

3. Slack で **対象 Canvas を開き、内容が更新されているか**確認する

#### 5-B: 本番デプロイ

```bash
npx wrangler deploy
```

`crons` が本番用（朝6時 JST 相当）に戻っていることをデプロイ前に再確認する。

---

## 相談事項

- 既存の Slack Bot を流用するか、本プロジェクト専用アプリにするか
  - 一つの bot で複数の無関係な機能を持たせるのは運用上よくない場合がある
  - Bot のトークンを差し替えれば切り替え可能なので、まず本プロジェクトを完遂してから再検討でもよい
- LLM 何使うか
  - ~~一旦 gpt-4o-mini でいいかと思っているけど何か提案あれば聞くつもり~~ → `openai` npm パッケージ + gpt-4o-mini で確定。API キーは GitHub Secrets（`OPENAI_API_KEY`）に登録予定
- 共同開発での役割分担
  - ~~共同開発がむずそうすぎる~~ → コード実装を先に完成させ、デプロイ・インフラ時に発生した issue を A/B で分担予定
  - 案: 基盤系と分析系で分ける

|             | やることの例                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: 基盤** | `wrangler` / Cron / Secrets / `CHANNELS_CONFIG`、`slack/ingest`・`slack/output`、Slack の権限・Canvas 作成、デプロイ・`wrangler tail`・scheduled の動作確認 |
| **B: 分析** | `llm/client`、`analysis/structured-digest`（`parser` / `prompts`）、出力の品質調整、トークン量・コストの気にしどころ                                        |

- キックオフの時間調整
  - メンバー間で生活スケジュールが合わない場合もある
  - 上記の役割分担が明確なら、非同期・別時間帯でも進めやすい

---

## TODOリスト（ブランチ目安）

**進め方の目安**：まず基盤で「空でも scheduled → Canvas まで一本線」、続けて分析で中身を差し替え。PR は小さめ・レビューしやすい単位。

### 基盤系（担当 A 向け）

| ブランチ例                 | 内容                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chore/scaffold`           | `wrangler init`、依存（`slack-cloudflare-workers` 等）、`wrangler.toml`（`name` / `compatibility_*` / `crons` / `[vars]` の骨格）、空の `src/index.ts`（`scheduled` のみ） |
| `feat/config`              | `src/config.ts`（`ChannelConfig` 型、`CHANNELS_CONFIG` のパース・バリデーション）、`.dev.vars.example`（キー名のみ、値は書かない）                                         |
| `feat/slack-ingest`        | `slack/types.ts`、`slack/ingest/client.ts`、`history.ts`（`conversations.history`、必要ならカーソルページネーション）、`users.ts`（表示名解決）                            |
| `feat/slack-output-canvas` | `slack/output/canvas.ts`（`canvases.edit`、SDK 不可なら `fetch` + Bot トークン）                                                                                           |
| `feat/handler-cron`        | `handlers/cron.ts`：`CHANNELS_CONFIG` をループし、**いまは固定 Markdown** でもよいので `canvas` に書くまで接続（分析はスタブ or TODO コール）                              |
| `chore/secrets-deploy`     | `wrangler secret put` 手順の確認、本番 `deploy`、任意で GitHub Actions（別リポなら README にリンク）                                                                       |
| `chore/verify-scheduled`   | `wrangler dev --test-scheduled` / `wrangler tail` / 短い cron での検証手順を実際に踏んでドキュメントと差分があれば修正                                                     |

### 分析系（担当 B 向け）

| ブランチ例                        | 内容                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feat/llm-client`                 | `llm/client.ts`（`chat/completions`、モデル名・`max_tokens`・エラーハンドリング）、必要なら `llm/types.ts`                                              |
| `feat/analysis-base-pipeline`     | （完了イメージ）`types/analysis.ts` の `AnalysisInput` / `AnalysisOutput` と、`runStructuredDigest` への直接呼び出し。`pipeline.ts` は採用しない        |
| `feat/structured-digest-parser`   | `analysis/structured-digest/parser.ts`（4 見出しのゆれ吸収、構造体への分割）                                                                            |
| `feat/structured-digest-prompts`  | `analysis/structured-digest/prompts.ts`（Pass1 JSON / Pass2 横断レポートのプロンプト文面。**Pass1 に個人サマリー用セーフティネット**を組み込む）        |
| `feat/structured-digest-pipeline` | `analysis/structured-digest/index.ts` の `runStructuredDigest`（ingest 済みメッセージを受け取り、2 パス LLM → Markdown 生成）                           |
| `feat/wire-analysis-to-cron`      | `cron.ts` から `runStructuredDigest` を直接呼ぶ。失敗時ログ・1 チャンネル失敗で他を止めないかはここで決める                                             |
| `chore/prompt-quality`            | 実データでの出力確認、プロンプト微調整、**キツい表現が出ないかの目視・セーフティネットの効き具合**、トークン数・コストのメモ（必要なら `README` に1節） |

## 今後の展望

- スラッシュコマンドで任意のタイミングでチャンネルの分析をできるようにする
- 任意のチャンネルで使えるようにする
- 分析の精度検証、改善
- gpt-4o-mini ではなく、ローカルで動く LLM を使う
  - Gemma4が気になりすぎる
