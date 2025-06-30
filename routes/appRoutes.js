const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 1. 初期設定 ---
const db = admin.firestore();
const saltRounds = 10;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- 2. 認証ミドルウェア ---
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// =================================================================
// --- 3. ページ表示ルート (GET) ---
// =================================================================
// (変更のないルートは省略)
router.get('/', (req, res) => { if (req.session.user) return res.redirect('/dashboard'); res.render('index', { user: req.session.user }); });
router.get('/register', (req, res) => { if (req.session.user) return res.redirect('/dashboard'); res.render('register', { error: null, user: req.session.user }); });
router.get('/login', (req, res) => { if (req.session.user) return res.redirect('/dashboard'); res.render('login', { error: null, user: req.session.user }); });
router.get('/dashboard', requireLogin, (req, res) => res.render('dashboard', { user: req.session.user }));
router.get('/create-quiz', requireLogin, (req, res) => res.render('create-quiz', { user: req.session.user }));
router.get('/my-quizzes', requireLogin, async (req, res) => { try { const quizzesSnapshot = await db.collection('quizzes').where('ownerId', '==', req.session.user.id).orderBy('createdAt', 'desc').get(); const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt.toDate() })); res.render('my-quizzes', { user: req.session.user, quizzes: quizzes }); } catch (error) { res.status(500).send("サーバーエラー"); } });
router.get('/public-quizzes', async (req, res) => { try { const quizzesSnapshot = await db.collection('quizzes').where('visibility', '==', 'public').orderBy('createdAt', 'desc').limit(50).get(); const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); res.render('public-quizzes', { user: req.session.user, quizzes: quizzes }); } catch (error) { res.status(500).send("サーバーエラー"); } });
router.get('/my-history', requireLogin, async (req, res) => { try { const attemptsSnapshot = await db.collection('quiz_attempts').where('userId', '==', req.session.user.id).orderBy('attemptedAt', 'desc').get(); const attempts = attemptsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), attemptedAt: doc.data().attemptedAt.toDate() })); res.render('my-history', { user: req.session.user, attempts: attempts }); } catch (error) { res.status(500).send("サーバーエラー"); } });
router.get('/quiz/:quizId', async (req, res) => { try { const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get(); if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。"); const quiz = quizDoc.data(); if (quiz.visibility === 'private' && (!req.session.user || quiz.ownerId !== req.session.user.id)) return res.status(403).send("アクセス権限がありません。"); res.render('solve-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz } }); } catch (error) { res.status(500).send("サーバーエラー"); } });
router.get('/quiz/:quizId/edit', requireLogin, async (req, res) => { try { const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get(); if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。"); const quiz = quizDoc.data(); if (quiz.ownerId !== req.session.user.id) return res.status(403).send("編集権限がありません。"); res.render('edit-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz } }); } catch (error) { res.status(500).send("サーバーエラー"); } });
router.get('/quiz/:quizId/delete', requireLogin, async (req, res) => { try { const quizRef = db.collection('quizzes').doc(req.params.quizId); const doc = await quizRef.get(); if (!doc.exists || doc.data().ownerId !== req.session.user.id) return res.status(403).send("削除権限がありません。"); await quizRef.delete(); res.redirect('/my-quizzes'); } catch (error) { res.status(500).send("サーバーエラー"); } });

// =================================================================
// --- 4. 機能ルート (POST) ---
// =================================================================
// (認証機能は変更なし)
router.post('/register', async (req, res) => { try { const { username, handle, password } = req.body; const fullHandle = '@' + handle.trim(); const handleSnapshot = await db.collection('users').where('handle', '==', fullHandle).get(); if (!handleSnapshot.empty) return res.render('register', { error: 'このハンドル名は既に使用されています。' }); const hashedPassword = await bcrypt.hash(password, saltRounds); const userRef = db.collection('users').doc(); const newUser = { id: userRef.id, username, handle: fullHandle, password: hashedPassword, createdAt: new Date() }; await userRef.set(newUser); req.session.user = { id: newUser.id, username: newUser.username, handle: newUser.handle }; res.redirect('/dashboard'); } catch (error) { res.render('register', { error: '登録中にエラーが発生しました。' }); } });
router.post('/login', async (req, res) => { try { const { handle, password } = req.body; const handleWithAt = handle.startsWith('@') ? handle : '@' + handle; const snapshot = await db.collection('users').where('handle', '==', handleWithAt).limit(1).get(); if (snapshot.empty) return res.render('login', { error: 'ハンドル名またはパスワードが正しくありません。' }); const user = snapshot.docs[0].data(); const validPassword = await bcrypt.compare(password, user.password); if (!validPassword) return res.render('login', { error: 'ハンドル名またはパスワードが正しくありません。' }); req.session.user = { id: user.id, username: user.username, handle: user.handle }; res.redirect('/dashboard'); } catch (error) { res.render('login', { error: 'ログイン中にエラーが発生しました。' }); } });
router.get('/logout', (req, res) => { req.session.destroy(err => { if (err) return res.redirect('/dashboard'); res.clearCookie('connect.sid'); res.redirect('/'); }); });

// ★★★ REVISED: クイズ作成 (下書きとして挑戦ページへ) ★★★
router.post('/create-quiz', requireLogin, async (req, res) => {
    try {
        const { title, subject, topic, difficulty, num_questions, example } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `あなたは、システムの制約を深く理解している、極めて優秀な教育専門AIです。
# 作成条件
- 科目: ${subject}
- 分野・テーマ: ${topic}
- 対象学年（目安）: ${difficulty}
- 問題数: 約${num_questions}問
- 参考情報: ${example || '特になし'}
# 絶対的な指示
1. **最重要：解答形式の制約を厳守すること。** 解答方法は「選択肢を選ぶ」「短い単語/数式をテキスト入力する」「文章を記述する」の3種類のみです。作図や描画が必要な問題は絶対に出題しないでください。
2. 数学・英語において参考情報がある場合は参考情報の形式の問題を多く出題してください。難易度も参考情報をもとにしてください。
3. 問題形式は「選択式(multiple_choice)」「短答式(short_answer)」「記述式(descriptive)」を、テーマに応じて最も効果的な配分で組み合わせてください。
4. 各問題に、難易度に応じた配点(points)を割り振ってください。
5. **必ず、以下のJSON形式の配列のみを返してください。** 前後に説明文や\`\`\`jsonは絶対に含めないでください。
# JSON出力形式 (解説は不要)
[{"type": "multiple_choice", "question": "問題文", "options": ["選択肢1", "選択肢2"], "answer": "正解の文字列", "points": 10}]`;
        
        const result = await model.generateContent(prompt);
        const jsonText = result.response.text().match(/\[[\s\S]*\]/)[0];
        const questions = JSON.parse(jsonText);

        // ★★★ 下書きクイズオブジェクトを作成 (DBには保存しない) ★★★
        const draftQuiz = {
            title: title && title.trim() !== '' ? title.trim() : `${topic}のテスト`,
            subject, difficulty, questions,
            visibility: 'private', // 保存時のデフォルト値
        };
        
        // ★★★ DBに保存せず、直接解答ページに渡す ★★★
        res.render('solve-quiz', { user: req.session.user, quiz: draftQuiz });

    } catch (error) {
        console.error("クイズの作成中にエラー:", error);
        res.status(500).send("問題の作成に失敗しました。");
    }
});

// ★★★ REVISED: 解答提出 (下書き/保存済み 両対応) ★★★
router.post('/submit-quiz', requireLogin, async (req, res) => {
    try {
        const { quizId, draftQuiz, answers } = req.body;
        let quiz, isDraft = false;

        if (draftQuiz) {
            // 下書きクイズの場合
            quiz = JSON.parse(draftQuiz);
            isDraft = true;
        } else {
            // 保存済みクイズの場合
            const quizDoc = await db.collection('quizzes').doc(quizId).get();
            if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
            quiz = quizDoc.data();
            quiz.id = quizId; // IDをオブジェクトに含める
        }

        const questions = quiz.questions;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `あなたは公平で優秀な教師です。生徒が解いたテストの採点を行ってください。
# テスト問題と正解
${JSON.stringify(questions, null, 2)}
# 生徒の解答
${JSON.stringify(answers, null, 2)}
#絶対的ルール
厳格な採点: スペルミス、無回答、スペースのみの解答は部分点なしの0点とします。(英作文や記述中のスペルミスは1点減点等の処理)
問題の重複禁止: 一つのテスト内で、同じ単語を問う問題は作成しません。
問題の独立性: 他の問題文や選択肢から答えが推測できないように、問題を設計します。
解答設定の徹底: 全ての問題に、必ず正解の答えを設定します。設定漏れは絶対にしません。
# 指示
1. 各問題について、生徒の解答が正解かを判定してください。
2. 記述問題では、完全一致でなくても意図が合っていれば部分点を与えてください。
3. 単語問題において、スペルミスと単語が答えであるのに熟語(2語以上)で答えられている場合などは0点としてください。
4. 生徒の解答が空文字列 "" の場合は0点にしてください。
5. 以下のJSON形式の配列のみを返してください。
# JSON出力形式
[{"is_correct": boolean, "score": number, "feedback": "生徒への具体的で役立つフィードバック(string)"}]`;

        const result = await model.generateContent(prompt);
        const jsonText = result.response.text().match(/\[[\s\S]*\]/)[0];
        const gradingResults = JSON.parse(jsonText);

        let totalScore = 0;
        let maxScore = 0;
        const finalResults = questions.map((q, i) => {
            const r = gradingResults[i] || { score: 0, is_correct: false, feedback: '採点エラー' };
            totalScore += r.score;
            maxScore += q.points;
            return { question: q.question, points: q.points, user_answer: answers[i] || "", is_correct: r.is_correct, score: r.score, feedback: r.feedback };
        });

        // ★★★ 挑戦履歴は自動的に保存 ★★★
        const attemptRef = db.collection('quiz_attempts').doc();
        await attemptRef.set({
            id: attemptRef.id,
            userId: req.session.user.id,
            quizId: quiz.id || null, // 下書きの場合はnull
            quizTitle: quiz.title,
            totalScore, maxScore,
            attemptedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // 結果表示ページへ
        res.render('quiz-result', { user: req.session.user, quiz, results: finalResults, totalScore, maxScore, isDraft });

    } catch (error) {
        console.error("クイズの採点中にエラー:", error);
        res.status(500).send("クイズの採点に失敗しました。");
    }
});

// ★★★ NEW: 下書きクイズを「作成一覧」に保存するルート ★★★
router.post('/save-quiz-from-draft', requireLogin, async (req, res) => {
    try {
        const quizData = JSON.parse(req.body.quizData);
        const quizRef = db.collection('quizzes').doc();
        
        const newQuiz = {
            id: quizRef.id,
            ownerId: req.session.user.id,
            ownerUsername: req.session.user.username,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            ...quizData
        };

        await quizRef.set(newQuiz);
        res.redirect('/my-quizzes');
    } catch (error) {
        console.error("下書きクイズの保存中にエラー:", error);
        res.status(500).send("サーバーエラーが発生しました。");
    }
});

// (クイズ更新ルートは変更なし)
router.post('/quiz/:quizId/edit', requireLogin, async (req, res) => { try { const quizId = req.params.quizId; const userId = req.session.user.id; const { title, visibility, questions } = req.body; const quizRef = db.collection('quizzes').doc(quizId); const doc = await quizRef.get(); if (!doc.exists || doc.data().ownerId !== userId) return res.status(403).send("編集権限がありません。"); const updatedQuestions = questions.map(q => ({ ...q, points: parseInt(q.points, 10) || 0 })); await quizRef.update({ title, visibility, questions: updatedQuestions, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); res.redirect('/my-quizzes'); } catch (error) { res.status(500).send("サーバーエラー"); } });

module.exports = router;