const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');

// --- 初期設定 ---
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Multer設定 (メモリに画像を一時保存)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MBまで

// --- 認証ミドルウェア ---
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// --- ヘルパー関数: 画像をGoogle AIが扱える形式に変換 ---
function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    },
  };
}

// =================================================================
// ★★★ 1. 新機能：画像からのクイズ作成 ★★★
// =================================================================

// a. 画像アップロードページの表示
router.get('/create-from-image', requireLogin, (req, res) => {
    res.render('create-from-image', { user: req.session.user, error: null });
});

// b. 画像をアップロードしてクイズを生成
router.post('/generate-from-image', requireLogin, upload.single('textbookImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.render('create-from-image', { user: req.session.user, error: "画像ファイルが選択されていません。" });
        }

        const { subject, difficulty, num_questions } = req.body;
        const imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);

        const prompt = `あなたは、提供された画像の内容を正確に読み取り、教育的なクイズを作成する専門家です。
# 画像の内容
この画像は教科書の一部です。この内容に基づいて問題を作成してください。
# 作成条件
- 科目: ${subject}
- 対象学年（目安）: ${difficulty}
- 問題数: 約${num_questions}問
# 絶対的な指示
1. **画像から読み取れる情報のみを基に問題を作成してください。**
2. **最重要：解答形式の制約を厳守すること。** 解答方法は「選択肢を選ぶ」「短い単語/数式をテキスト入力する」「文章を記述する」の3種類のみです。作図や描画が必要な問題は絶対に出題しないでください。
3. 問題形式は「選択式(multiple_choice)」「短答式(short_answer)」「記述式(descriptive)」を、テーマに応じて最も効果的な配分で組み合わせてください。
4. 各問題に、難易度に応じた配点(points)を割り振ってください。
5. **必ず、以下のJSON形式の配列のみを返してください。** 前後に説明文や\`\`\`jsonは絶対に含めないでください。
# JSON出力形式 (解説は不要)
[{"type": "multiple_choice", "question": "問題文", "options": ["選択肢1", "選択肢2"], "answer": "正解の文字列", "points": 10}]`;

        const result = await model.generateContent([prompt, imagePart]);
        const jsonText = result.response.text().match(/\[[\s\S]*\]/)[0];
        const questions = JSON.parse(jsonText);

        const draftQuiz = {
            title: `${subject}のテスト (画像から生成)`,
            subject, difficulty, questions,
            visibility: 'private',
        };

        res.render('solve-quiz', { user: req.session.user, quiz: draftQuiz, isDraft: true });

    } catch (error) {
        console.error("画像からのクイズ作成エラー:", error);
        res.render('create-from-image', { user: req.session.user, error: "問題の生成中にエラーが発生しました。もう一度お試しください。" });
    }
});


// =================================================================
// 2. 既存のクイズ機能
// =================================================================

// テキストベースのクイズ作成ページ
router.get('/create', requireLogin, (req, res) => {
    res.render('create-quiz', { user: req.session.user });
});

// テキストベースのクイズ作成処理
router.post('/create', requireLogin, async (req, res) => {
    try {
        const { title, subject, topic, difficulty, num_questions, example } = req.body;
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
5. 問題文は、他の問題文や選択肢から答えが推測できないように設計してください。
6. 問題の重複を避けるため、同じ単語を問う問題は一つのテスト内で作成しないでください。
7. 解答設定の徹底: 全ての問題に、必ず正解の答えを設定してください。設定漏れは絶対にしません。
8. 解答と問題を見て、その問題・答えがあっているか再度確認し、間違っていたら必ず修正してください。
9. **必ず、以下のJSON形式の配列のみを返してください。** 前後に説明文や\`\`\`jsonは絶対に含めないでください。
# JSON出力形式 (解説は不要)
[{"type": "multiple_choice", "question": "問題文", "options": ["選択肢1", "選択肢2"], "answer": "正解の文字列", "points": 10}]`;

        const result = await model.generateContent(prompt);
        const jsonText = result.response.text().match(/\[[\s\S]*\]/)[0];
        const questions = JSON.parse(jsonText);

        const draftQuiz = {
            title: title && title.trim() !== '' ? title.trim() : `${topic}のテスト`,
            subject, difficulty, questions,
            visibility: 'private',
        };

        res.render('solve-quiz', { user: req.session.user, quiz: draftQuiz, isDraft: true });

    } catch (error) {
        console.error("クイズの作成中にエラー:", error);
        res.status(500).send("問題の作成に失敗しました。");
    }
});

// 作成したクイズ一覧
router.get('/my-quizzes', requireLogin, async (req, res) => {
    try {
        // ★ 修正点: req.session.user.id を req.session.user.uid に変更
        const quizzesSnapshot = await db.collection('quizzes').where('ownerId', '==', req.session.user.uid).orderBy('createdAt', 'desc').get();
        const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt.toDate() }));
        res.render('my-quizzes', { user: req.session.user, quizzes: quizzes });
    } catch (error) {
        console.error("クイズ一覧の取得エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// 解答提出 (下書き/保存済み 両対応)
router.post('/submit', requireLogin, async (req, res) => {
    try {
        const { quizId, draftQuizData, answers } = req.body;
        let quiz, isDraft = false;

        if (draftQuizData) {
            quiz = JSON.parse(draftQuizData);
            isDraft = true;
        } else {
            const quizDoc = await db.collection('quizzes').doc(quizId).get();
            if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
            quiz = { id: quizDoc.id, ...quizDoc.data() };
        }

        const questions = quiz.questions;
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
5. 仮に答えが存在しないことに気づいたら、フィードバックでその旨を伝えてください。
6. 以下のJSON形式の配列のみを返してください。
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
            
            // ★★★ ここを修正 ★★★
            // 返すデータに correct_answer (正解) を追加
            return {
                question: q.question,
                points: q.points,
                user_answer: answers[i] || "",
                correct_answer: q.answer, // 正解を追加！
                is_correct: r.is_correct,
                score: r.score,
                feedback: r.feedback
            };
        });

        const attemptRef = db.collection('quiz_attempts').doc();
        await attemptRef.set({
            userId: req.session.user.uid,
            quizId: quiz.id || null,
            quizTitle: quiz.title,
            totalScore, maxScore,
            attemptedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.render('quiz-result', { user: req.session.user, quiz, results: finalResults, totalScore, maxScore, isDraft });

    } catch (error) {
        console.error("クイズの採点中にエラー:", error);
        res.status(500).send("クイズの採点に失敗しました。");
    }
});

// 下書きクイズをDBに保存するアクション
router.post('/save-draft', requireLogin, async (req, res) => {
    try {
        const { quizData } = req.body;
        if (!quizData) {
            throw new Error('保存するクイズデータが見つかりません。');
        }

        const quiz = JSON.parse(quizData);

        const newQuiz = {
            title: quiz.title,
            subject: quiz.subject,
            difficulty: quiz.difficulty,
            questions: quiz.questions,
            visibility: quiz.visibility || 'private',
            author: req.session.user.username,
            // ★ 修正点: この部分は元々正しかったですが、統一性を確認
            ownerId: req.session.user.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await db.collection('quizzes').add(newQuiz);
        res.redirect('/quiz/my-quizzes');

    } catch (error) {
        console.error("下書きクイズの保存エラー:", error);
        res.status(500).send("クイズの保存中にエラーが発生しました。");
    }
});

// 特定のクイズを解くページ
router.get('/:quizId', async (req, res) => {
    try {
        const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get();
        if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
        
        const quiz = quizDoc.data();
        // ★ 修正点: req.session.user.id を req.session.user.uid に変更
        if (quiz.visibility === 'private' && (!req.session.user || quiz.ownerId !== req.session.user.uid)) {
            return res.status(403).send("アクセス権限がありません。");
        }
        
        res.render('solve-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz }, isDraft: false });
    } catch (error) {
        console.error("クイズ表示エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// クイズ編集ページ
router.get('/:quizId/edit', requireLogin, async (req, res) => {
    try {
        const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get();
        if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
        
        const quiz = quizDoc.data();
        // ★ 修正点: req.session.user.id を req.session.user.uid に変更
        if (quiz.ownerId !== req.session.user.uid) return res.status(403).send("編集権限がありません。");
        
        res.render('edit-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz } });
    } catch (error) {
        console.error("編集ページ表示エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// クイズ更新処理
router.post('/:quizId/edit', requireLogin, async (req, res) => {
    try {
        const { title, visibility, questions } = req.body;
        const quizRef = db.collection('quizzes').doc(req.params.quizId);
        const doc = await quizRef.get();
        
        // ★ 修正点: req.session.user.id を req.session.user.uid に変更
        if (!doc.exists || doc.data().ownerId !== req.session.user.uid) return res.status(403).send("編集権限がありません。");
        
        const updatedQuestions = questions.map(q => ({ ...q, points: parseInt(q.points, 10) || 0 }));
        await quizRef.update({
            title,
            visibility,
            questions: updatedQuestions,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.redirect('/quiz/my-quizzes');
    } catch (error) {
        console.error("クイズ更新エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// クイズ削除
router.get('/:quizId/delete', requireLogin, async (req, res) => {
    try {
        const quizRef = db.collection('quizzes').doc(req.params.quizId);
        const doc = await quizRef.get();
        
        // ★ 修正点: req.session.user.id を req.session.user.uid に変更
        if (!doc.exists || doc.data().ownerId !== req.session.user.uid) return res.status(403).send("削除権限がありません。");
        
        await quizRef.delete();
        res.redirect('/quiz/my-quizzes');
    } catch (error) {
        console.error("クイズ削除エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});


module.exports = router;