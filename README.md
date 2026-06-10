# AIMA — 忙しい二人の、ちょうどいい合間。

Google カレンダーの空き時間を自動で読み取り、相手にシェアできる日程調整ツール。

- 今日から2週間分の空き時間を自動表示
- 30分 / 1時間単位で切り替え可能
- オンライン・対面（前後30分バッファ）に対応
- 時間枠をタップするだけで相手のカレンダーに招待を送信
- 日曜・祝日・振替休日を自動除外

**スタック:** Cloudflare Workers (TypeScript) + 静的HTML/CSS/JS フロントエンド  
**フォント:** MOBO (WOFF2)  
**認証:** サービスアカウント（カレンダー読み取り）+ OAuth 2.0 リフレッシュトークン（イベント作成・招待送信）

---

## ローカル起動

### 1. 依存インストール

```bash
cd worker
npm install
```

### 2. Google Cloud の準備

#### サービスアカウント（カレンダー読み取り用）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIとサービス → ライブラリ** で **Google Calendar API** を有効化
3. **IAMと管理 → サービスアカウント** でサービスアカウントを作成（ロール不要）
4. 作成したサービスアカウントの **キー → JSON** をダウンロード
5. サービスアカウントのメールアドレスを、対象の各 Google カレンダーに **「閲覧者」として共有**

#### OAuth クライアント（イベント作成・招待送信用）

1. **APIとサービス → 認証情報 → OAuthクライアントID** を作成（種類: ウェブアプリケーション）
2. 承認済みリダイレクトURIに `http://localhost:8080` を追加
3. 以下のURLにブラウザでアクセスして認可コードを取得：

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=<CLIENT_ID>&redirect_uri=http://localhost:8080&response_type=code&scope=https://www.googleapis.com/auth/calendar.events&access_type=offline&prompt=consent
```

4. リダイレクト先URLの `code=` パラメータを使ってリフレッシュトークンを取得：

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d client_id=<CLIENT_ID> \
  -d client_secret=<CLIENT_SECRET> \
  -d code=<AUTH_CODE> \
  -d redirect_uri=http://localhost:8080 \
  -d grant_type=authorization_code
```

レスポンスの `refresh_token` を控えておく。

### 3. ローカル用シークレットを設定

`worker/.dev.vars` を作成して以下を記入：

```
GOOGLE_CLIENT_EMAIL=xxxx@xxxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
GOOGLE_OAUTH_CLIENT_ID=<CLIENT_ID>
GOOGLE_OAUTH_CLIENT_SECRET=<CLIENT_SECRET>
GOOGLE_REFRESH_TOKEN=<REFRESH_TOKEN>
CALENDAR_IDS=your-email@gmail.com
OWNER_CALENDAR=your-email@gmail.com
```

> `GOOGLE_PRIVATE_KEY` はJSONの `"private_key"` の値をそのまま貼る（`\n` はエスケープのまま）。  
> `CALENDAR_IDS` はカンマ区切りで複数指定可能。

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

ブラウザで `http://localhost:3000` を開く。

---

## デプロイ

### Worker（Cloudflare Workers）

```bash
cd worker

# シークレットを登録
wrangler secret put GOOGLE_CLIENT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put CALENDAR_IDS
wrangler secret put OWNER_CALENDAR

# デプロイ
wrangler deploy
```

デプロイ後に表示されるURL（例: `https://share-calendar.xxxx.workers.dev`）が `frontend/app.js` で自動的に本番URLとして使われる（localhost/192.168.x.x 以外は本番URLを参照）。

### フロントエンド（Cloudflare Pages）

[Cloudflare ダッシュボード](https://dash.cloudflare.com/) → **Workers & Pages → Create → Pages → Direct Upload** で `frontend/` フォルダをアップロード。

---

## ディレクトリ構成

```
├── worker/
│   ├── src/index.ts        # Cloudflare Workers エントリポイント
│   ├── .dev.vars           # ローカル用シークレット（git管理外）
│   ├── wrangler.toml
│   └── package.json
└── frontend/
    ├── index.html          # メインページ（空き時間一覧・予約）
    ├── howto.html          # 使い方ページ
    ├── about.html          # サービス紹介ページ
    ├── style.css           # 共通スタイル
    ├── howto.css           # 使い方ページ専用スタイル
    ├── about.css           # サービス紹介ページ専用スタイル
    ├── app.js              # メインページロジック
    ├── fonts/
    │   ├── MOBO-Regular.woff2
    │   └── MOBO-SemiBold.woff2
    └── (画像ファイル群)
```

---

## 注意事項

- Gmail / Google カレンダーとの連携設定はやや複雑です。自分でも使ってみたい方は [@masaBa-13](https://github.com/masaBa-13) までお気軽にご連絡ください。環境構築をサポートします。
- OAuth リフレッシュトークンはカレンダーへの書き込み権限を持つため、公開リポジトリにコミットしないよう注意してください。
