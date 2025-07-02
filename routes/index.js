const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

const db = admin.firestore();

// 認証ミドルウェア
function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
}

router.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('index', { user: req.session.user });
});

router.get('/dashboard', requireLogin, (req, res) => {
    res.render('dashboard', { user: req.session.user });
});

router.get('/my-history', requireLogin, async (req, res) => {
    try {
        // ★★★ ここを修正: req.session.user.id を req.session.user.uid に変更 ★★★
        const attemptsSnapshot = await db.collection('quiz_attempts')
            .where('userId', '==', req.session.user.uid)
            .orderBy('attemptedAt', 'desc')
            .get();
            
        const attempts = attemptsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            attemptedAt: doc.data().attemptedAt.toDate()
        }));
        res.render('my-history', { user: req.session.user, attempts: attempts });
    } catch (error) {
        console.error("History Error:", error);
        res.status(500).send("サーバーエラー");
    }
});

router.get('/public-quizzes', async (req, res) => {
    try {
        const quizzesSnapshot = await db.collection('quizzes')
            .where('visibility', '==', 'public')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('public-quizzes', { user: req.session.user, quizzes: quizzes });
    } catch (error) {
        console.error("Public Quizzes Error:", error);
        res.status(500).send("サーバーエラー");
    }
});


module.exports = router;