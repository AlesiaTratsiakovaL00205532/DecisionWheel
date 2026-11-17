import { ANSWERS, MAX_QUESTION_LENGTH, targetRotation } from './wheel.js';

const form = document.querySelector('#question-form');
const input = document.querySelector('#question');
const button = document.querySelector('#spin-button');
const buttonLabel = document.querySelector('#button-label');
const wheel = document.querySelector('#wheel');
const errorText = document.querySelector('#question-error');
const result = document.querySelector('#result');
const resultText = document.querySelector('#result-text');
const historyList = document.querySelector('#history-list');
const historyCount = document.querySelector('#history-count');
const history = [];
let rotation = 0;
let spinning = false;

const warnBeforeLeaving = (event) => {
  event.preventDefault();
  event.returnValue = '';
};

function spinTo(index) {
  return new Promise((resolve) => {
    let timer;
    const finish = (event) => {
      if (event && (event.target !== wheel || event.propertyName !== 'transform')) {
        return;
      }
      clearTimeout(timer);
      wheel.removeEventListener('transitionend', finish);
      resolve();
    };
    wheel.addEventListener('transitionend', finish);
    const duration = Number.parseFloat(getComputedStyle(wheel).transitionDuration) * 1000;
    timer = setTimeout(finish, duration + 200);
    rotation = targetRotation(rotation, index);
    wheel.style.transform = `rotate(${rotation}deg)`;
  });
}

function addHistory(question, answer) {
  history.push({ question, answer });
  const entry = document.createElement('li');
  entry.className = 'history-entry';
  const heading = document.createElement('div');
  heading.className = 'history-entry-heading';
  const text = document.createElement('p');
  text.className = 'history-question';
  text.textContent = question;
  const badge = document.createElement('span');
  badge.className = 'answer-badge';
  badge.dataset.answer = answer;
  badge.textContent = answer;
  const number = document.createElement('p');
  number.className = 'history-number';
  number.textContent = `Question ${history.length}`;
  heading.append(text, badge);
  entry.append(heading, number);
  historyList.prepend(entry);
  historyList.scrollTop = 0;
  document.querySelector('#empty-history').hidden = true;
  historyCount.textContent = history.length;
  historyCount.setAttribute('aria-label', `${history.length} questions`);
  if (history.length === 1) {
    window.addEventListener('beforeunload', warnBeforeLeaving);
  }
}

input.addEventListener('input', () => {
  errorText.textContent = '';
  input.removeAttribute('aria-invalid');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (spinning) return;
  const question = input.value.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    errorText.textContent = `Enter a question between 1 and ${MAX_QUESTION_LENGTH} characters.`;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }

  spinning = true;
  button.disabled = true;
  input.disabled = true;
  buttonLabel.textContent = 'Spinning...';
  errorText.textContent = '';
  input.removeAttribute('aria-invalid');
  const previousResult = resultText.textContent;
  const previousAnswer = result.dataset.answer;
  delete result.dataset.answer;
  resultText.textContent = 'A few turns. A little possibility.';

  try {
    const response = await fetch('/api/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) throw new Error('The wheel could not answer. Please try again.');
    const { index, answer } = await response.json();
    if (!Number.isInteger(index) || index < 0 || index >= ANSWERS.length || answer !== ANSWERS[index]) {
      throw new Error('The wheel returned an invalid answer. Please try again.');
    }
    await spinTo(index);
    result.dataset.answer = answer;
    resultText.textContent = answer;
    addHistory(question, answer);
    input.value = '';
  } catch {
    errorText.textContent = 'Could not reach the wheel. Please try again.';
    resultText.textContent = previousResult;
    if (previousAnswer) result.dataset.answer = previousAnswer;
  } finally {
    spinning = false;
    button.disabled = false;
    input.disabled = false;
    buttonLabel.textContent = 'Spin the wheel';
    input.focus();
  }
});
