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
  // 環境変数 GOOGLE_APPLICATION_CREDENTIALS が設定されていれば引数は不要です
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

// ★★★ Cloudflare環境における、絶対的に正しいプロキシ設定 ★★★
// これにより、Cloudflareから転送された、真のユーザーIPアドレスを認識し、
// 同時に、secure: true のクッキーが、完璧に機能します。
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1); // `true`または`1`を設定
}

// セッションの設定 (FirestoreStoreを使用)
app.use(session({
    store: new FirestoreStore({
        dataset: db,
        kind: 'express-sessions',
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // 本番環境ではtrueに
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1日
        // ★★★ Cloudflare環境下での推奨設定 ★★★
        // SameSiteを'Lax'に設定することで、いくつかのクロスドメイン問題を回避できます。
        sameSite: 'lax'
    }
}));

// ----------------------------------------------------------------
// 3. ルーターの読み込み (★ここを修正・統合しました★)
// ----------------------------------------------------------------
// 機能ごとに分割したルーターファイルを読み込みます
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quizzes');

// 各ルーターを適切なパスにマウント（割り当て）します
app.use('/', indexRoutes); // '/', '/dashboard', '/my-history' などを担当
app.use('/', authRoutes);  // '/login', '/register', '/logout' などを担当
app.use('/quiz', quizRoutes); // クイズ関連のパスはすべて '/quiz' プレフィックスで集約

// ----------------------------------------------------------------
// 4. サーバーの起動
// ----------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => { // ★★★ 家庭サーバーからのアクセスを許可 ★★★
    console.log(`Synapse Note server is running on port ${PORT}`);
    console.log(`It is now accessible from your local network.`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`Local access: http://localhost:${PORT}`);
    }
});