// Quiz App State
const state = {
    allQuestions: [],
    queue: [],
    currentQuestion: null,
    correctCount: 0,
    incorrectCount: 0,
    answered: false,
    currentCategory: 'all'
};

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
    restartBtn: document.getElementById('restart-btn')
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
        'system-design': 'System Design'
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

// Initialize
loadQuestions();
