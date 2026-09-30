// ---------- Progress tracker (localStorage, single-user, per-section) ----------
// Defined before `state` since its initial value is computed from these.
const PROGRESS_KEY = 'quiz_seen_ids_v1';

function loadSeenIds() {
    try {
        return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
    } catch {
        return {};
    }
}

function saveSeenIds() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.seenIds));
}

function markSeen(category, id) {
    const set = new Set(state.seenIds[category] || []);
    set.add(id);
    state.seenIds[category] = [...set];
    saveSeenIds();
}

function resetSectionProgress(category) {
    delete state.seenIds[category];
    saveSeenIds();
}

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
    isEvaluating: false,
    // Ask AI chat: lives only in memory for the current question, never persisted
    aiChatMessages: [],
    isChatting: false,
    // Progress tracker: which question IDs have been seen, per section (category).
    // Persisted to localStorage since this is a single-user app with no login.
    seenIds: loadSeenIds(),
    // Optional topic/subsection filter within the active category (e.g. just
    // "Two Pointers" + "Sliding Window" within LeetCode). Empty = all topics.
    selectedTopics: [],
    // This run's answer log, used only to build the end-of-section AI summary.
    // Never persisted - cleared every time a new section run starts.
    sessionLog: []
};

const TUTOR_SYSTEM_PROMPT = `You are a friendly, concise CS interview tutor helping someone study data structures, algorithms, and interview patterns on their phone. Keep answers mobile-friendly: short paragraphs, bullet points where useful, no walls of text. When relevant, mention time/space complexity and WHEN to use one approach/data structure over another. If the user pastes their own attempted answer, briefly evaluate it (what's right, what's missing) rather than just giving the solution outright. Be direct and skip filler.`;

const COACH_SYSTEM_PROMPT = `You are a concise study coach reviewing a practice quiz session for someone prepping for software engineering interviews (DSA + system design). You'll get a log of questions with their topic and whether the user got them right or wrong. Identify weak topics/patterns (don't just restate the log), and give focused, actionable advice on what to review next. Keep it mobile-friendly: short paragraphs and bullet points, no walls of text.`;

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

// Generalized chat call for the "Ask AI" panel (multi-turn, in-memory only)
async function chatWithAI(messages) {
    if (!state.openaiKey) {
        return { error: 'No API key set. Click "🔑 API Key" above to add your OpenAI key.' };
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
                messages,
                temperature: 0.5,
                max_tokens: 700
            })
        });

        if (!response.ok) {
            const error = await response.json();
            return { error: error.error?.message || 'API request failed' };
        }

        const data = await response.json();
        return { reply: data.choices[0].message.content };
    } catch (err) {
        return { error: `Network error: ${err.message}` };
    }
}

// Build context describing the current question for the AI, without spoiling
// the correct answer unless the user has already answered.
function buildQuestionContext() {
    const q = state.currentQuestion;
    if (!q) return '';
    let context = `Interview question (category: ${getCategoryLabel(q.category)}):\n${q.question}`;
    if (q.choices && q.choices.length) {
        context += `\n\nChoices: ${q.choices.join(' | ')}`;
    }
    if (state.answered) {
        context += `\n\nCorrect answer: ${q.answer}\nReference explanation: ${q.explanation}`;
    }
    return context;
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
    topicTag: document.getElementById('topic-tag'),
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
    completionTitle: document.getElementById('completion-title'),
    sectionProgressText: document.getElementById('section-progress-text'),
    finalStatsRow: document.getElementById('final-stats-row'),
    aiSummaryBtn: document.getElementById('ai-summary-btn'),
    aiSummaryLoading: document.getElementById('ai-summary-loading'),
    aiSummaryResult: document.getElementById('ai-summary-result'),
    // Topic/subsection picker elements
    topicPickerBtn: document.getElementById('topic-picker-btn'),
    topicPickerCount: document.getElementById('topic-picker-count'),
    topicPickerModal: document.getElementById('topic-picker-modal'),
    topicPickerList: document.getElementById('topic-picker-list'),
    topicPickerApply: document.getElementById('topic-picker-apply'),
    topicPickerClear: document.getElementById('topic-picker-clear'),
    // API Key elements
    apiKeyBtn: document.getElementById('api-key-btn'),
    apiKeyModal: document.getElementById('api-key-modal'),
    apiKeyInput: document.getElementById('api-key-input'),
    saveApiKey: document.getElementById('save-api-key'),
    cancelApiKey: document.getElementById('cancel-api-key'),
    // Open-ended question elements
    openContainer: document.getElementById('open-container'),
    userResponse: document.getElementById('user-response'),
    submitResponse: document.getElementById('submit-response'),
    evaluatingIndicator: document.getElementById('evaluating-indicator'),
    aiFeedback: document.getElementById('ai-feedback'),
    aiFeedbackContent: document.getElementById('ai-feedback-content'),
    nextBtnAi: document.getElementById('next-btn-ai'),
    // Ask AI panel elements
    askAiToggle: document.getElementById('ask-ai-toggle'),
    askAiPanel: document.getElementById('ask-ai-panel'),
    aiChatLog: document.getElementById('ai-chat-log'),
    aiChatLoading: document.getElementById('ai-chat-loading'),
    aiExplainBtn: document.getElementById('ai-explain-btn'),
    aiChatInput: document.getElementById('ai-chat-input'),
    aiChatSend: document.getElementById('ai-chat-send')
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

// Filter questions by category, optionally narrowed to selected topics
function filterQuestions(category) {
    let pool = category === 'all'
        ? [...state.allQuestions]
        : state.allQuestions.filter(q => q.category === category);

    if (category !== 'all' && state.selectedTopics.length > 0) {
        pool = pool.filter(q => state.selectedTopics.includes(q.topic));
    }
    return pool;
}

// Full category pool minus questions already seen in that section (progress tracker)
function getUnseenPool(category) {
    const seen = new Set(state.seenIds[category] || []);
    return filterQuestions(category).filter(q => !seen.has(q.id));
}

// Distinct topics available within a category, for the subsection picker
function getTopicsForCategory(category) {
    if (category === 'all') return [];
    const topics = new Set(
        state.allQuestions.filter(q => q.category === category).map(q => q.topic)
    );
    return [...topics].sort();
}

// Start or restart the quiz, pulling only unanswered questions for this section
function startQuiz() {
    const pool = getUnseenPool(state.currentCategory);
    state.queue = shuffle([...pool]);
    state.correctCount = 0;
    state.incorrectCount = 0;
    state.answered = false;
    state.sessionLog = [];

    updateStats();
    updateTopicPickerUI();

    if (state.queue.length === 0) {
        showCompletion();
        return;
    }

    showScreen('quiz-screen');
    nextQuestion();
}

// Check if question is open-ended (Tesla categories use AI evaluation)
function isOpenEndedQuestion(question) {
    return question.category && question.category.startsWith('tesla-');
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
    elements.topicTag.textContent = state.currentQuestion.topic || '';
    elements.questionText.textContent = state.currentQuestion.question;
    elements.feedback.classList.add('hidden');
    elements.aiFeedback.classList.add('hidden');
    elements.userResponse.value = '';

    // Reset the ephemeral Ask AI chat for the new question (no persistence)
    state.aiChatMessages = [];
    elements.aiChatLog.innerHTML = '';
    elements.askAiPanel.classList.add('hidden');
    elements.aiChatInput.value = '';

    const isOpenEnded = isOpenEndedQuestion(state.currentQuestion);

    if (isOpenEnded) {
        // Show open-ended container, hide multiple choice
        elements.choicesContainer.classList.add('hidden');
        elements.openContainer.classList.remove('hidden');
        elements.evaluatingIndicator.classList.add('hidden');
    } else {
        // Show multiple choice, hide open-ended
        elements.choicesContainer.classList.remove('hidden');
        elements.openContainer.classList.add('hidden');

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
    }

    updateStats();
}

// Get human-readable category label
function getCategoryLabel(category) {
    const labels = {
        'leetcode': 'LeetCode',
        'ds-concepts': 'DS Concepts',
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

    markSeen(state.currentCategory, state.currentQuestion.id);
    state.sessionLog.push({
        topic: state.currentQuestion.topic,
        question: state.currentQuestion.question,
        correct
    });

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

// Show completion screen: either "just finished a run" or "section already fully seen"
function showCompletion() {
    elements.finalCorrect.textContent = state.correctCount;
    elements.finalIncorrect.textContent = state.incorrectCount;

    const sectionPool = filterQuestions(state.currentCategory);
    const totalInSection = sectionPool.length;
    const seenSet = new Set(state.seenIds[state.currentCategory] || []);
    const seenCount = sectionPool.filter(q => seenSet.has(q.id)).length;
    const justFinishedRun = state.sessionLog.length > 0;

    elements.completionTitle.textContent = justFinishedRun ? 'Section Complete!' : 'Already Complete';
    elements.sectionProgressText.textContent =
        `${seenCount} / ${totalInSection} question${totalInSection === 1 ? '' : 's'} completed in this section.`;
    elements.finalStatsRow.classList.toggle('hidden', !justFinishedRun);
    elements.aiSummaryBtn.classList.toggle('hidden', !justFinishedRun);
    elements.aiSummaryResult.classList.add('hidden');
    elements.aiSummaryResult.textContent = '';
    elements.restartBtn.textContent = 'Reset & Practice Again';

    showScreen('completion-screen');
}

// Show/hide and populate the topic picker button for the active category
function updateTopicPickerUI() {
    const topics = getTopicsForCategory(state.currentCategory);
    elements.topicPickerBtn.classList.toggle('hidden', topics.length <= 1);
    elements.topicPickerCount.textContent = state.selectedTopics.length > 0
        ? `(${state.selectedTopics.length})`
        : '';
}

// Handle category filter selection
function handleFilterClick(e) {
    const category = e.target.dataset.category;
    if (!category) return;

    // Update active state
    elements.filterBtns.forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');

    state.currentCategory = category;
    state.selectedTopics = []; // reset topic narrowing when switching sections
    updateTopicPickerUI();
    startQuiz();
}

// Event listeners
elements.retryBtn.addEventListener('click', loadQuestions);
elements.nextBtn.addEventListener('click', nextQuestion);
elements.restartBtn.addEventListener('click', () => {
    // If this section's unseen pool is empty, "restart" means starting the
    // section over from scratch rather than pulling an empty queue again.
    if (getUnseenPool(state.currentCategory).length === 0) {
        resetSectionProgress(state.currentCategory);
    }
    startQuiz();
});
elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', handleFilterClick);
});

// ---------- Topic/Subsection picker ----------
elements.topicPickerBtn.addEventListener('click', () => {
    const topics = getTopicsForCategory(state.currentCategory);
    elements.topicPickerList.innerHTML = '';
    topics.forEach(topic => {
        const label = document.createElement('label');
        label.className = 'topic-chip';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = topic;
        checkbox.checked = state.selectedTopics.includes(topic);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(topic));
        elements.topicPickerList.appendChild(label);
    });
    elements.topicPickerModal.classList.remove('hidden');
});

elements.topicPickerApply.addEventListener('click', () => {
    const checked = [...elements.topicPickerList.querySelectorAll('input[type=checkbox]:checked')]
        .map(cb => cb.value);
    state.selectedTopics = checked;
    updateTopicPickerUI();
    elements.topicPickerModal.classList.add('hidden');
    startQuiz();
});

elements.topicPickerClear.addEventListener('click', () => {
    elements.topicPickerList.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.checked = false;
    });
});

elements.topicPickerModal.addEventListener('click', (e) => {
    if (e.target === elements.topicPickerModal) {
        elements.topicPickerModal.classList.add('hidden');
    }
});

// ---------- AI Summary (end of section) ----------
elements.aiSummaryBtn.addEventListener('click', async () => {
    if (state.sessionLog.length === 0) return;

    elements.aiSummaryBtn.disabled = true;
    elements.aiSummaryLoading.classList.remove('hidden');
    elements.aiSummaryResult.classList.add('hidden');

    const logText = state.sessionLog
        .map(l => {
            const label = l.correct === null ? 'AI-GRADED' : (l.correct ? 'CORRECT' : 'WRONG');
            return `[${label}] (${l.topic || 'unknown topic'}) ${l.question}`;
        })
        .join('\n');
    const messages = [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user', content: `Section: ${getCategoryLabel(state.currentCategory)}\nResults: ${state.correctCount} correct, ${state.incorrectCount} wrong\n\n${logText}` }
    ];

    const result = await chatWithAI(messages);

    elements.aiSummaryLoading.classList.add('hidden');
    elements.aiSummaryBtn.disabled = false;
    elements.aiSummaryResult.textContent = result.error ? 'Error: ' + result.error : result.reply;
    elements.aiSummaryResult.classList.remove('hidden');
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

// Open-ended question submission
elements.submitResponse.addEventListener('click', async () => {
    const userAnswer = elements.userResponse.value.trim();
    if (!userAnswer) {
        alert('Please enter your response before submitting.');
        return;
    }

    if (state.isEvaluating) return;
    state.isEvaluating = true;

    // Show loading state
    elements.submitResponse.disabled = true;
    elements.evaluatingIndicator.classList.remove('hidden');

    // Call AI evaluation
    const result = await evaluateWithAI(state.currentQuestion.question, userAnswer);

    // Hide loading state
    elements.evaluatingIndicator.classList.add('hidden');
    elements.submitResponse.disabled = false;
    state.isEvaluating = false;

    if (result.error) {
        elements.aiFeedbackContent.textContent = 'Error: ' + result.error;
    } else {
        elements.aiFeedbackContent.textContent = result.feedback;
    }

    markSeen(state.currentCategory, state.currentQuestion.id);
    state.sessionLog.push({
        topic: state.currentQuestion.topic,
        question: state.currentQuestion.question,
        correct: null // open-ended AI-graded, not a binary right/wrong
    });

    elements.openContainer.classList.add('hidden');
    elements.aiFeedback.classList.remove('hidden');
    state.answered = true;
    updateStats();
});

// Next button for AI feedback
elements.nextBtnAi.addEventListener('click', nextQuestion);

// ---------- Ask AI panel (ephemeral chat, no persistence) ----------

function appendChatBubble(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `ai-bubble ai-bubble-${role}`;
    bubble.textContent = text;
    elements.aiChatLog.appendChild(bubble);
    elements.aiChatLog.scrollTop = elements.aiChatLog.scrollHeight;
}

async function sendChatMessage(userText) {
    if (!userText || state.isChatting) return;
    state.isChatting = true;

    appendChatBubble('user', userText);

    // Seed with the tutor system prompt + question context on the first message
    if (state.aiChatMessages.length === 0) {
        state.aiChatMessages.push({ role: 'system', content: TUTOR_SYSTEM_PROMPT });
        state.aiChatMessages.push({ role: 'user', content: buildQuestionContext() });
        state.aiChatMessages.push({ role: 'assistant', content: 'Got it, I have the question context. What would you like to know?' });
    }
    state.aiChatMessages.push({ role: 'user', content: userText });

    elements.aiChatSend.disabled = true;
    elements.aiExplainBtn.disabled = true;
    elements.aiChatLoading.classList.remove('hidden');

    const result = await chatWithAI(state.aiChatMessages);

    elements.aiChatLoading.classList.add('hidden');
    elements.aiChatSend.disabled = false;
    elements.aiExplainBtn.disabled = false;
    state.isChatting = false;

    if (result.error) {
        appendChatBubble('assistant', 'Error: ' + result.error);
        state.aiChatMessages.pop(); // don't keep a failed turn in context
    } else {
        appendChatBubble('assistant', result.reply);
        state.aiChatMessages.push({ role: 'assistant', content: result.reply });
    }
}

elements.askAiToggle.addEventListener('click', () => {
    elements.askAiPanel.classList.toggle('hidden');
});

elements.aiExplainBtn.addEventListener('click', () => {
    sendChatMessage('Explain this question and the underlying pattern/data structure clearly. If it helps, briefly compare it to a similar approach and note when I should use one vs. the other.');
});

elements.aiChatSend.addEventListener('click', () => {
    const text = elements.aiChatInput.value.trim();
    if (!text) return;
    elements.aiChatInput.value = '';
    sendChatMessage(text);
});

elements.aiChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        elements.aiChatSend.click();
    }
});

// Initialize
loadQuestions();
