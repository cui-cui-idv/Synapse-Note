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
        const attemptsSnapshot = await db.collection('quiz_attempts')
            .where('userId', '==', req.session.user.uid)
            .orderBy('attemptedAt', 'desc')
            .get();
            
        const attempts = attemptsSnapshot.docs.map(doc => {
            const data = doc.data();
            // attemptedAt フィールドが存在し、かつ null でないことを確認
            const attemptedAtDate = data.attemptedAt && typeof data.attemptedAt.toDate === 'function' 
                ? data.attemptedAt.toDate() 
                : new Date(); // 存在しない場合は現在時刻を仮で入れる

            return {
                id: doc.id,
                ...data,
                attemptedAt: attemptedAtDate
            };
        });

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