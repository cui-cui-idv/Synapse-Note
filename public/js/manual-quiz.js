let questions = [];

function renderQuestions() {
  const area = document.getElementById('questionsArea');
  area.innerHTML = '';
  questions.forEach((q, i) => {
    area.innerHTML += `
      <div class="question-editor-card">
        <label>問題文 <input type="text" value="${q.question || ''}" onchange="updateQuestion(${i}, 'question', this.value)"></label>
        <label>タイプ
          <select onchange="updateQuestion(${i}, 'type', this.value)">
            <option value="multiple_choice" ${q.type==='multiple_choice'?'selected':''}>選択式</option>
            <option value="short_answer" ${q.type==='short_answer'?'selected':''}>短答式</option>
            <option value="descriptive" ${q.type==='descriptive'?'selected':''}>記述式</option>
          </select>
        </label>
        <label>配点 <input type="number" value="${q.points||10}" min="1" onchange="updateQuestion(${i}, 'points', this.value)"></label>
        ${q.type === 'multiple_choice' ? renderOptions(i, q) : ''}
        <label>正解 <input type="text" value="${q.answer||''}" onchange="updateQuestion(${i}, 'answer', this.value)"></label>
        <button type="button" onclick="removeQuestion(${i})">削除</button>
      </div>
    `;
  });
  document.getElementById('questionsInput').value = JSON.stringify(questions);
}
function renderOptions(idx, q) {
  return `<div>選択肢:
    ${(q.options||["",""]).map((opt,j)=>`
      <input type="text" value="${opt}" onchange="updateOption(${idx},${j},this.value)">
      <button type="button" onclick="removeOption(${idx},${j})">×</button>
    `).join('')}
    <button type="button" onclick="addOption(${idx})">選択肢追加</button>
  </div>`;
}
function addQuestion() {
  questions.push({question:"",type:"multiple_choice",options:["",""],answer:"",points:10});
  renderQuestions();
}
function removeQuestion(idx) {
  questions.splice(idx,1);
  renderQuestions();
}
function updateQuestion(idx, key, val) {
  if(key==="points") val = Number(val)||10;
  questions[idx][key]=val;
  if(key==="type" && val==="multiple_choice" && !questions[idx].options) questions[idx].options=["",""];
  renderQuestions();
}
function addOption(qIdx) {
  if(!questions[qIdx].options) questions[qIdx].options=[];
  questions[qIdx].options.push("");
  renderQuestions();
}
function removeOption(qIdx, oIdx) {
  questions[qIdx].options.splice(oIdx,1);
  renderQuestions();
}
function updateOption(qIdx, oIdx, val) {
  questions[qIdx].options[oIdx]=val;
  renderQuestions();
}
document.getElementById('addQuestionBtn').onclick = addQuestion;
renderQuestions();