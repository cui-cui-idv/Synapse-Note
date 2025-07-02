/**
 * quiz.js - クイズ関連のルーティング
 *
 * - 画像からクイズ作成（AI）
 * - テキスト入力からクイズ作成（AI）
 * - 手動クイズ作成（AI不使用）
 * - クイズ一覧・提出・編集・削除等
 */

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const multer = require('multer');

// --- Firebase/AI初期化 ---
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- Multer: 画像ファイルはメモリに一時保存 ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MBまで

// --- ログイン必須ミドルウェア ---
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect('/login');
    next();
}

// --- Google AI画像入力用変換 ---
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType
        },
    };
}

// ===================== 画像からクイズ作成（AI利用） =====================

/**
 * 画像からクイズ作成ページ表示
 */
router.get('/create-from-image', requireLogin, (req, res) => {
    res.render('create-from-image', { user: req.session.user, error: null });
});

/**
 * 画像アップロード&クイズ自動生成
 */
router.post('/generate-from-image', requireLogin, upload.single('textbookImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.render('create-from-image', { user: req.session.user, error: "画像ファイルが選択されていません。" });
        }

        const { subject, difficulty, num_questions, topic, example } = req.body;
        const imagePart = fileToGenerativePart(req.file.buffer, req.file.mimetype);

        // STEP 1: クイズ自動生成プロンプト
        const generationPrompt = `あなたは、提供された画像内容をもとに、正確かつ教育的価値の高いクイズを作成する専門家です。

# 画像の内容
この画像は教科書やノートの一部です。その内容を正確に読み取り、以下の条件に従って問題を作成してください。

# 作成条件
- 科目: ${subject}
- 分野・テーマ: ${topic || '画像から推定、または空欄可'}
- 参考情報・補足: ${example || '特になし'}
- 対象学年（目安）: ${difficulty}
- 問題数: 約${num_questions}問

# 絶対的な指示
1. **画像から読み取れる情報および分野・テーマ・参考情報（もし指定されていれば）をもとに、問題を作成してください。**
2. **最重要：解答形式の制約を厳守すること。** 解答方法は「選択肢を選ぶ」「短い単語/数式を入力」「文章を記述する」の3種類のみです。作図や描画を要する問題は絶対に出題しないこと。
3. 問題形式は「選択式(multiple_choice)」「短答式(short_answer)」「記述式(descriptive)」を、テーマや画像内容に応じて最も効果的な配分で組み合わせてください。
4. 各問題に、難易度や内容に応じて適切な配点(points)を必ず割り振ってください。
5. **同じ単語や内容を問う問題はテスト内に1問まで（重複出題禁止）。**
6. **必ず全ての問題に、画像・情報から正しく導かれる唯一の答え（answer）を1つ設定し、解答漏れ・誤答がないか作成後に再チェックしてください。** 答えが画像から読み取れない場合、その問題は作成・出題しないでください。
7. 問題文や選択肢から他の問題の答えが推測できないよう、独立性を保つこと。
8. **出力は下記のJSON配列「のみ」。前後に説明文や\`\`\`json、補足など余計な文字列は絶対に含めないでください。**

# JSON出力形式（解説は不要）
[{"type": "multiple_choice", "question": "問題文", "options": ["選択肢1", "選択肢2"], "answer": "正解の文字列", "points": 10}]`;

        const generationResult = await model.generateContent([generationPrompt, imagePart]);
        const initialJsonText = generationResult.response.text().match(/\[[\s\S]*\]/)[0];
        const initialQuestions = JSON.parse(initialJsonText);

        // STEP 2: 自動生成クイズの検証＆修正
        const verificationPrompt = `あなたは、極めて厳格で正確な校正担当AIです。あなたの唯一の任務は、提示された画像に基づき、AIが生成したクイズの間違いを検出・修正することです。
# 状況
あるAIが画像からクイズを生成しましたが、読み間違えによる誤りが含まれている可能性があります。
# あなたのタスク
1. 提示された「生成済みクイズ(JSON)」の各問題と解答を、画像の内容と一つ一つ、厳密に照合してください。
2. **解答が間違っている場合：** 画像から読み取れる正しい答えに「answer」フィールドを修正してください。
3. **問題が画像から解答不能な場合：** その問題オブジェクト全体を配列から削除してください。
4. **問題文や選択肢は、原則として変更しないでください。** あなたの最優先事項は「解答の正確性」を保証することです。
5. **最終出力：** 修正が完了した、完璧なJSON配列「のみ」を出力してください。説明や\`\`\`jsonなどの余計な文字列は絶対に含めないでください。

# 生成済みクイズ(JSON) - これを検証・修正する
${JSON.stringify(initialQuestions, null, 2)}
`;

        const verificationResult = await model.generateContent([verificationPrompt, imagePart]);
        const verifiedJsonText = verificationResult.response.text().match(/\[[\s\S]*\]/)[0];
        const verifiedQuestions = JSON.parse(verifiedJsonText);

        const draftQuiz = {
            title: `${subject}のテスト (画像から生成)`,
            subject,
            difficulty,
            questions: verifiedQuestions,
            visibility: 'private',
        };

        res.render('solve-quiz', { user: req.session.user, quiz: draftQuiz, isDraft: true });

    } catch (error) {
        console.error("画像からのクイズ作成エラー:", error);
        res.render('create-from-image', { user: req.session.user, error: "問題の生成中にエラーが発生しました。AIが画像を正しく読み取れなかった可能性があります。画像の角度や明るさを変えて、もう一度お試しください。" });
    }
});

// ===================== テキスト入力からクイズ作成（AI利用） =====================

/**
 * テキストからクイズ作成ページ
 */
router.get('/create', requireLogin, (req, res) => {
    res.render('create-quiz', { user: req.session.user });
});

/**
 * テキストからクイズ自動生成
 */
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
        res.render('create-quiz', { user: req.session.user, error: "問題の作成に失敗しました。AIの応答が不正か、通信エラーの可能性があります。時間をおいてもう一度お試しください。", old: req.body});
    }
});

// ===================== 手動でクイズ作成（AI不使用） =====================

/**
 * 手動クイズ作成ページ
 */
router.get('/manual-create', requireLogin, (req, res) => {
    res.render('manual-create', { user: req.session.user, error: null });
});

/**
 * 手動クイズ保存
 */
router.post('/manual-create', requireLogin, async (req, res) => {
    try {
        const { title, subject, difficulty, questions } = req.body;
        // questionsはJSON文字列 → パース
        const questionsArr = JSON.parse(questions);

        // 保存処理
        await db.collection('quizzes').add({
            title,
            subject,
            difficulty,
            questions: questionsArr,
            visibility: 'private',
            author: req.session.user.username,
            ownerId: req.session.user.uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.redirect('/quiz/my-quizzes');
    } catch (error) {
        res.render('manual-create', {
            user: req.session.user,
            error: 'クイズの保存中にエラーが発生しました。'
        });
    }
});

// ===================== クイズ一覧・履歴 =====================

/**
 * 自分の作成したクイズ一覧
 */
router.get('/my-quizzes', requireLogin, async (req, res) => {
    try {
        const quizzesSnapshot = await db.collection('quizzes').where('ownerId', '==', req.session.user.uid).orderBy('createdAt', 'desc').get();
        const quizzes = quizzesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt.toDate() }));
        res.render('my-quizzes', { user: req.session.user, quizzes: quizzes });
    } catch (error) {
        console.error("クイズ一覧の取得エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// ===================== クイズ解答・採点 =====================

/**
 * 解答提出（下書き/保存済み 両対応, AI採点 or 自動採点）
 */
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
        let gradingResults;
        let aiError = false;

        try {
            // AI採点
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
2. 記述問題では、完全一致でなくても意図が合っていれば部分点を与えてください。(スペースだけ、空欄だけの回答に部分点を与えないこと。しっかりと解答の意図を汲み取って採点してください。)
3. 単語問題において、スペルミスと単語が答えであるのに熟語(2語以上)で答えられている場合などは0点としてください。
4. 生徒の解答が空文字列 "" の場合は0点にしてください。
5. 仮に答えが存在しないことに気づいたら、フィードバックでその旨を伝えてください。
6. 部分点は厳しく採点してください。スペルミス、無回答、スペースのみの解答は部分点なしの0点とします。(英作文や記述中のスペルミスは1点減点等の処理)
7. 以下のJSON形式の配列のみを返してください。
# JSON出力形式
[{"is_correct": boolean, "score": number, "feedback": "生徒への具体的で役立つフィードバック(string)"}]`;

            const result = await model.generateContent(prompt);
            const jsonText = result.response.text().match(/\[[\s\S]*\]/)[0];
            gradingResults = JSON.parse(jsonText);

        } catch (error) {
            // AI採点失敗時は選択肢/短答のみ自動採点、記述式は未採点
            aiError = true;
            gradingResults = questions.map((q, i) => {
                const userAns = (answers[i] || "").trim();
                const correctAns = (q.answer || "").trim();

                if (q.type === "multiple_choice" || q.type === "short_answer") {
                    const isCorrect = userAns === correctAns;
                    return {
                        is_correct: isCorrect,
                        score: isCorrect ? q.points : 0,
                        feedback: isCorrect
                            ? "正解です！"
                            : `不正解です。正しい答え: ${q.answer}`
                    };
                } else if (q.type === "descriptive") {
                    return {
                        is_correct: null,
                        score: null,
                        feedback: "AIによる採点に失敗したため、記述式問題は採点できませんでした。"
                    };
                } else {
                    return {
                        is_correct: null,
                        score: 0,
                        feedback: "未対応の問題形式です。"
                    };
                }
            });
        }

        // スコア集計
        let totalScore = 0;
        let maxScore = 0;
        const finalResults = questions.map((q, i) => {
            const r = gradingResults[i] || { score: 0, is_correct: false, feedback: '採点エラー' };
            if (typeof r.score === "number") totalScore += r.score;
            if (typeof q.points === "number") maxScore += q.points;
            return {
                question: q.question,
                points: q.points,
                user_answer: answers[i] || "",
                correct_answer: q.answer,
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

        res.render('quiz-result', {
            user: req.session.user,
            quiz,
            results: finalResults,
            totalScore,
            maxScore,
            isDraft,
            aiError
        });

    } catch (error) {
        console.error("クイズの採点中にエラー:", error);
        res.render('solve-quiz', {
            user: req.session.user,
            quiz,
            isDraft,
            error: "クイズの採点に失敗しました。"
        });
    }
});

// ===================== クイズ保存・編集・削除 =====================

/**
 * クイズ下書き保存
 */
router.post('/save-draft', requireLogin, async (req, res) => {
    try {
        const { quizData } = req.body;
        if (!quizData) throw new Error('保存するクイズデータが見つかりません。');
        const quiz = JSON.parse(quizData);

        const newQuiz = {
            title: quiz.title,
            subject: quiz.subject,
            difficulty: quiz.difficulty,
            questions: quiz.questions,
            visibility: quiz.visibility || 'private',
            author: req.session.user.username,
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

/**
 * クイズ編集ページ
 */
router.get('/:quizId/edit', requireLogin, async (req, res) => {
    try {
        const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get();
        if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
        const quiz = quizDoc.data();
        if (quiz.ownerId !== req.session.user.uid) return res.status(403).send("編集権限がありません。");
        res.render('edit-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz } });
    } catch (error) {
        console.error("編集ページ表示エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

/**
 * クイズ更新
 */
router.post('/:quizId/edit', requireLogin, async (req, res) => {
    try {
        const { title, visibility, questions } = req.body;
        const quizRef = db.collection('quizzes').doc(req.params.quizId);
        const doc = await quizRef.get();
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

/**
 * クイズ削除
 */
router.get('/:quizId/delete', requireLogin, async (req, res) => {
    try {
        const quizRef = db.collection('quizzes').doc(req.params.quizId);
        const doc = await quizRef.get();
        if (!doc.exists || doc.data().ownerId !== req.session.user.uid) return res.status(403).send("削除権限がありません。");
        await quizRef.delete();
        res.redirect('/quiz/my-quizzes');
    } catch (error) {
        console.error("クイズ削除エラー:", error);
        res.status(500).send("サーバーエラー");
    }
});

// ===================== クイズ詳細表示（catch-all: 必ず一番下！） =====================

/**
 * クイズ詳細/解答ページ
 * ※ /manual-create のような具体的なパスより下に書くこと！
 */
router.get('/:quizId', async (req, res) => {
    try {
        const quizDoc = await db.collection('quizzes').doc(req.params.quizId).get();
        if (!quizDoc.exists) return res.status(404).send("クイズが見つかりません。");
        const quiz = quizDoc.data();
        if (quiz.visibility === 'private' && (!req.session.user || quiz.ownerId !== req.session.user.uid)) {
            return res.status(403).send("アクセス権限がありません。");
        }
        res.render('solve-quiz', { user: req.session.user, quiz: { id: quizDoc.id, ...quiz }, isDraft: false });
    } catch (error) {
        console.error("クイズ表示エラー:", error);
        res.render('solve-quiz', {
            user: req.session.user,
            quiz: null,
            isDraft: false,
            error: "クイズの表示中にエラーが発生しました。時間をおいて再度お試しください。"
        });
    }
});

module.exports = router;