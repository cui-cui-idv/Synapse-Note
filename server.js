// ----------------------------------------------------------------
// 1. モジュールのインポート
// ----------------------------------------------------------------
const express = require('express');
const session = require('express-session');
const path = require('path');
const admin = require('firebase-admin');
const { FirestoreStore } = require('@google-cloud/connect-firestore');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// ----------------------------------------------------------------
// 2. 初期化と設定
// ----------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin SDKの初期化
try {
  // 本番環境（Render, Fly.ioなど）では、環境変数 GOOGLE_APPLICATION_CREDENTIALS_JSON を
  // 設定することで、引数なしで初期化するのが一般的です。
  admin.initializeApp();
  console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
  console.error("Error initializing Firebase Admin SDK:", error);
  process.exit(1);
}
const db = admin.firestore();

// Expressの基本設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Cloudflare環境におけるプロキシ設定
// これにより、secure: true のクッキーが正しく機能します。
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// セッションの設定 (FirestoreStoreを使用)
app.use(session({
    store: new FirestoreStore({
        dataset: db,
        kind: 'express-sessions', // Firestoreに保存されるコレクション名
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // 本番環境ではtrue
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1日
        sameSite: 'lax' // クロスドメイン問題を回避するための推奨設定
    }
}));


// ----------------------------------------------------------------
// 3. ルーターの読み込みとマウント (★ここが重要★)
// ----------------------------------------------------------------

// 機能ごとに分割したルーターファイルを読み込みます
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quizzes');

// ★★★ ここからが修正点 ★★★

// 1. トップページへのアクセスを処理するルートハンドラを最優先で定義します
// これが、今回のERR_FAILEDエラーを解決する中心的な修正です。
app.get('/', (req, res) => {
    try {
        if (req.session && req.session.user) {
            res.redirect('/dashboard');
        } else {
            res.redirect('/login');
        }
    } catch (err) {
        // 何があってもエラーは握りつぶしてログイン画面に飛ばす
        res.redirect('/login');
    }
});

// 2. 各ルーターを適切なパスにマウント（割り当て）します
//    より具体的なパス（/quiz）を先に記述するのがベストプラクティスです。
app.use('/quiz', quizRoutes); // クイズ関連 (/quiz/create-quiz など)
app.use('/', authRoutes);      // 認証関連 (/login, /register, /logout)
app.use('/', indexRoutes);     // その他 (/dashboard, /my-history など)

// ★★★ ここまでが修正点 ★★★


// ----------------------------------------------------------------
// 4. サーバーの起動
// ----------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Synapse Note server is running on port ${PORT}`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Local access: http://localhost:${PORT}`);
    }
});