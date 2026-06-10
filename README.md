# 空き時間共有アプリ

Google Calendar の複数カレンダーを読み取り、今日から2週間の空きスロットを一覧表示するWebアプリ。

---

## ローカル起動

### 1. 依存インストール

```bash
cd worker
npm install
```

### 2. Google サービスアカウントの準備

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **API とサービス → ライブラリ** で **Google Calendar API** を有効化
3. **IAM と管理 → サービスアカウント** でサービスアカウントを作成（ロール不要）
4. 作成したサービスアカウントの **キー → JSON** をダウンロード
5. サービスアカウントのメールアドレスを、対象の各 Google カレンダーに **「閲覧者」として共有**

### 3. ローカル用シークレットを記入

`worker/.dev.vars` をエディタで開き、ダウンロードした JSON の値を転記：

```
GOOGLE_CLIENT_EMAIL=xxxx@xxxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

> `GOOGLE_PRIVATE_KEY` は JSON の `"private_key"` の値をそのまま貼る（`\n` はエスケープのまま）。

### 4. Worker を起動（ターミナル A）

```bash
cd worker
npm run dev
# → http://localhost:8787
```

### 5. フロントエンドを起動（ターミナル B）

```bash
cd frontend
npx serve .
# または
python3 -m http.server 3000
```

ブラウザで `http://localhost:3000` を開く。`?t=30` で 30 分単位に切替可能。

---

## デプロイ

### Worker（Cloudflare Workers）

```bash
cd worker

# シークレットを登録
wrangler secret put GOOGLE_CLIENT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY

# デプロイ
wrangler deploy
```

デプロイ後に表示される URL（例: `https://free-slot-worker.xxxx.workers.dev`）を `frontend/app.js` の `WORKER_URL` に書き換える。

### フロントエンド（Cloudflare Pages）

[Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → Direct Upload** で `frontend/` フォルダをアップロード。

---

## ディレクトリ構成

```
├── worker/
│   ├── src/index.ts      # Cloudflare Workers エントリポイント
│   ├── .dev.vars         # ローカル用シークレット（git 管理外）
│   ├── wrangler.toml
│   └── package.json
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```
