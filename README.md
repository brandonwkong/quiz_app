# Interview Quiz

A minimal, mobile-first quiz app for practicing interview pattern recognition. Works offline once loaded and can be added to your iPhone home screen.

## Categories

- **LeetCode** - Blind 75 style algorithm patterns (data structures, techniques)
- **ML Fundamentals** - Machine learning concepts (metrics, training, regularization)
- **ML Systems** - AI infrastructure (batching, caching, monitoring, GPUs)
- **System Design** - Distributed systems basics (caching, scaling, databases)

## Features

- 60+ curated questions
- Wrong answers get re-queued for practice
- Shuffle questions and answer choices
- Category filters
- Session tracking (correct/incorrect/remaining)
- Mobile-first design with large tap targets
- PWA support for home screen installation

## Run Locally

Start a local server in the project directory:

```bash
python3 -m http.server 8000
```

Or on Windows:

```bash
python -m http.server 8000
```

Then open: http://localhost:8000

## Deploy to GitHub Pages

1. Create a new GitHub repository

2. Push your code:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

3. Enable GitHub Pages:
   - Go to repository Settings > Pages
   - Source: Deploy from a branch
   - Branch: main, folder: / (root)
   - Save

4. Your app will be live at:
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`

## Add to iPhone Home Screen

1. Open the quiz URL in Safari on your iPhone

2. Tap the Share button (square with arrow pointing up)

3. Scroll down and tap "Add to Home Screen"

4. Name it (e.g., "Interview Quiz") and tap "Add"

The app will appear on your home screen and run in fullscreen mode.

## Edit Questions

Open `questions.json` to add, edit, or remove questions. Each question has this format:

```json
{
  "category": "leetcode",
  "tags": ["hash-map", "two-pointer"],
  "question": "Your question text here?",
  "choices": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "Option B",
  "explanation": "Why this answer is correct."
}
```

Categories must be one of:
- `leetcode`
- `ml`
- `ml-systems`
- `system-design`

## File Structure

```
quiz_app/
├── index.html      # Main HTML
├── style.css       # Mobile-first styles
├── app.js          # Quiz logic
├── questions.json  # Question bank
├── manifest.json   # PWA manifest
└── README.md       # This file
```
