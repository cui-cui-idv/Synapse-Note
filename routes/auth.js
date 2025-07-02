const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');

const db = admin.firestore();
const saltRounds = 10;

// --- ページ表示 ---
router.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('register', { error: null, user: req.session.user });
});

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login', { error: null, user: req.session.user });
});

// --- 機能ルート ---
router.post('/register', async (req, res) => {
    try {
        const { username, handle, password } = req.body;
        const fullHandle = '@' + handle.trim();
        const handleSnapshot = await db.collection('users').where('handle', '==', fullHandle).get();
        if (!handleSnapshot.empty) {
            return res.render('register', { error: 'このハンドル名は既に使用されています。', user: req.session.user });
        }
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // ★ 修正点: ユーザーIDを Firestore ドキュメント自体から取得するように変更
        const userRef = db.collection('users').doc();
        
        const newUser = {
            username,
            handle: fullHandle,
            password: hashedPassword,
            createdAt: new Date()
        };
        // 注意: newUser オブジェクトにはIDを含めず、setする
        await userRef.set(newUser);
        
        // セッションには userRef.id を使う
        req.session.user = { uid: userRef.id, username: newUser.username, handle: newUser.handle };
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Register Error:", error);
        res.render('register', { error: '登録中にエラーが発生しました。', user: req.session.user });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { handle, password } = req.body;
        const handleWithAt = handle.startsWith('@') ? handle : '@' + handle;
        const snapshot = await db.collection('users').where('handle', '==', handleWithAt).limit(1).get();
        if (snapshot.empty) {
            return res.render('login', { error: 'ハンドル名またはパスワードが正しくありません。', user: req.session.user });
        }
        
        // ★ 修正点: ドキュメントのIDとデータを別々に取得
        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();
        
        const validPassword = await bcrypt.compare(password, userData.password);
        if (!validPassword) {
            return res.render('login', { error: 'ハンドル名またはパスワードが正しくありません。', user: req.session.user });
        }
        
        // セッションには userDoc.id を使う
        req.session.user = { uid: userDoc.id, username: userData.username, handle: userData.handle };
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Login Error:", error);
        res.render('login', { error: 'ログイン中にエラーが発生しました。', user: req.session.user });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

module.exports = router;