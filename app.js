// Quiz App State
const state = {
    allQuestions: [],
    queue: [],
    currentQuestion: null,
    correctCount: 0,
    incorrectCount: 0,
    answered: false,
    currentCategory: 'all',
    openaiKey: localStorage.getItem('openai_api_key') || '',
    isEvaluating: false
};

// Tesla Interviewer System Prompt
const INTERVIEWER_PROMPT = `You are a Senior Staff Project Manager at Tesla conducting the FINAL interview for the Service Systems Integration Engineer Internship. The candidate has already passed 2 technical rounds with a Staff Software Engineer and Staff Service Systems Integration Engineer.

Your job is to evaluate their response like a real Tesla interviewer would. Be direct and constructive.

Scoring (provide all):
- Technical Communication (1-10): Can they explain technical concepts clearly?
- Ownership (1-10): Do they take responsibility and show initiative?
- Business Thinking (1-10): Do they connect technical work to business outcomes?
- Customer Focus (1-10): Do they consider end-user (technician/advisor) impact?
- Clarity (1-10): Is the answer structured and easy to follow?
- Confidence (1-10): Do they sound certain without being arrogant?

Overall Hire Signal: Strong Hire / Hire / Lean Hire / Lean No Hire / No Hire

Format your response as:
## Scores
[scores listed]

## What Was Strong
[1-2 bullet points]

## What Was Weak
[1-2 bullet points]

## Follow-up Questions I'd Ask
[2-3 probing questions a Tesla interviewer would ask next]

## How to Improve This Answer
[Specific, actionable advice]

Be tough but fair. Challenge vague answers. Push for specifics, metrics, and ownership.`;

// OpenAI API call function
async function evaluateWithAI(question, userAnswer) {
    if (!state.openaiKey) {
        return { error: 'No API key set. Click "Set API Key" to add your OpenAI key.' };
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.openaiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: INTERVIEWER_PROMPT },
                    { role: 'user', content: `Interview Question: ${question}\n\nCandidate's Response:\n${userAnswer}` }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            return { error: error.error?.message || 'API request failed' };
        }

        const data = await response.json();
        return { feedback: data.choices[0].message.content };
    } catch (err) {
        return { error: `Network error: ${err.message}` };
    }
}

// DOM Elements
const elements = {
    loadingScreen: document.getElementById('loading-screen'),
    errorScreen: document.getElementById('error-screen'),
    quizScreen: document.getElementById('quiz-screen'),
    completionScreen: document.getElementById('completion-screen'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    remaining: document.getElementById('remaining'),
    correctCount: document.getElementById('correct-count'),
    incorrectCount: document.getElementById('incorrect-count'),
    categoryTag: document.getElementById('category-tag'),
    questionText: document.getElementById('question-text'),
    choicesContainer: document.getElementById('choices-container'),
    feedback: document.getElementById('feedback'),
    feedbackText: document.getElementById('feedback-text'),
    explanation: document.getElementById('explanation'),
    nextBtn: document.getElementById('next-btn'),
    filterBtns: document.querySelectorAll('.filter-btn'),
    finalCorrect: document.getElementById('final-correct'),
    finalIncorrect: document.getElementById('final-incorrect'),
    restartBtn: document.getElementById('restart-btn'),
    // API Key elements
    apiKeyBtn: document.getElementById('api-key-btn'),
    apiKeyModal: document.getElementById('api-key-modal'),
    apiKeyInput: document.getElementById('api-key-input'),
    saveApiKey: document.getElementById('save-api-key'),
    cancelApiKey: document.getElementById('cancel-api-key')
};

// Utility: Shuffle array in place (Fisher-Yates)
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Show a specific screen, hide others
function showScreen(screenId) {
    [elements.loadingScreen, elements.errorScreen, elements.quizScreen, elements.completionScreen]
        .forEach(screen => screen.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// Load questions from JSON
async function loadQuestions() {
    showScreen('loading-screen');
    try {
        const response = await fetch('questions.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.allQuestions = await response.json();
        startQuiz();
    } catch (error) {
        elements.errorMessage.textContent = `Could not load questions: ${error.message}`;
        showScreen('error-screen');
    }
}

// Filter questions by category
function filterQuestions(category) {
    if (category === 'all') {
        return [...state.allQuestions];
    }
    return state.allQuestions.filter(q => q.category === category);
}

// Start or restart the quiz
function startQuiz() {
    const filtered = filterQuestions(state.currentCategory);
    state.queue = shuffle([...filtered]);
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.answered = false;

    updateStats();
    showScreen('quiz-screen');
    nextQuestion();
}

// Display next question
function nextQuestion() {
    if (state.queue.length === 0) {
        showCompletion();
        return;
    }

    state.currentQuestion = state.queue.shift();
    state.answered = false;

    // Update UI
    elements.categoryTag.textContent = getCategoryLabel(state.currentQuestion.category);
    elements.questionText.textContent = state.currentQuestion.question;
    elements.feedback.classList.add('hidden');

    // Shuffle and render choices
    const shuffledChoices = shuffle([...state.currentQuestion.choices]);
    elements.choicesContainer.innerHTML = '';

    shuffledChoices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = choice;
        btn.addEventListener('click', () => selectAnswer(choice, btn));
        elements.choicesContainer.appendChild(btn);
    });

    updateStats();
}

// Get human-readable category label
function getCategoryLabel(category) {
    const labels = {
        'leetcode': 'LeetCode',
        'ml': 'ML Fundamentals',
        'ml-systems': 'ML Systems',
        'system-design': 'System Design',
        'tesla-resume': 'Tesla Resume Grill',
        'tesla-behavioral': 'Tesla Behavioral',
        'tesla-product': 'Tesla Product/Ops',
        'tesla-crossfunctional': 'Tesla Cross-Functional',
        'tesla-motivation': 'Tesla Motivation'
    };
    return labels[category] || category;
}

// Handle answer selection
function selectAnswer(choice, btn) {
    if (state.answered) return;
    state.answered = true;

    const correct = choice === state.currentQuestion.answer;
    const allBtns = elements.choicesContainer.querySelectorAll('.choice-btn');

    // Disable all buttons
    allBtns.forEach(b => b.disabled = true);

    // Highlight correct answer
    allBtns.forEach(b => {
        if (b.textContent === state.currentQuestion.answer) {
            b.classList.add('correct');
        }
    });

    if (correct) {
        state.correctCount++;
        elements.feedbackText.textContent = 'Correct!';
        elements.feedbackText.className = 'correct';
    } else {
        state.incorrectCount++;
        btn.classList.add('incorrect');
        elements.feedbackText.textContent = 'Incorrect';
        elements.feedbackText.className = 'incorrect';
        // Re-add question near end of queue
        readdQuestion(state.currentQuestion);
    }

    elements.explanation.textContent = state.currentQuestion.explanation;
    elements.feedback.classList.remove('hidden');
    updateStats();
}

// Re-add wrong question near end of queue (not always last)
function readdQuestion(question) {
    const minPos = Math.max(0, state.queue.length - 3);
    const pos = minPos + Math.floor(Math.random() * (state.queue.length - minPos + 1));
    state.queue.splice(pos, 0, question);
}

// Update stats display
function updateStats() {
    elements.remaining.textContent = state.queue.length + (state.answered ? 0 : 1);
    elements.correctCount.textContent = state.correctCount;
    elements.incorrectCount.textContent = state.incorrectCount;
}

// Show completion screen
function showCompletion() {
    elements.finalCorrect.textContent = state.correctCount;
    elements.finalIncorrect.textContent = state.incorrectCount;
    showScreen('completion-screen');
}

// Handle category filter selection
function handleFilterClick(e) {
    const category = e.target.dataset.category;
    if (!category) return;

    // Update active state
    elements.filterBtns.forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

    state.currentCategory = category;
    startQuiz();
}

// Event listeners
elements.retryBtn.addEventListener('click', loadQuestions);
elements.nextBtn.addEventListener('click', nextQuestion);
elements.restartBtn.addEventListener('click', startQuiz);
elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', handleFilterClick);
});

// API Key modal handlers
elements.apiKeyBtn.addEventListener('click', () => {
    elements.apiKeyInput.value = state.openaiKey;
    elements.apiKeyModal.classList.remove('hidden');
});

elements.cancelApiKey.addEventListener('click', () => {
    elements.apiKeyModal.classList.add('hidden');
});

elements.saveApiKey.addEventListener('click', () => {
    const key = elements.apiKeyInput.value.trim();
    state.openaiKey = key;
    localStorage.setItem('openai_api_key', key);
    elements.apiKeyModal.classList.add('hidden');
});

// Close modal on backdrop click
elements.apiKeyModal.addEventListener('click', (e) => {
    if (e.target === elements.apiKeyModal) {
        elements.apiKeyModal.classList.add('hidden');
    }
});

// Initialize
loadQuestions();
