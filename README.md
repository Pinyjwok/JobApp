# JobApp — CV Optimization System

A multi-agent AI pipeline that transforms a raw CV and job description into a tailored, ATS-compliant application package. Built on KEMU with a React + Express frontend.

## What it does

1. Extracts and profiles your CV
2. Researches the target company
3. Enhances and analyses the job description
4. Runs a gap analysis and evidence review
5. Assembles a tailored CV section by section
6. Writes a cover letter matched to your tone
7. Runs a style and integrity check before delivering the final output

## Stack

| Layer | Tech |
|---|---|
| Agent pipeline | KEMU Edge Runtime |
| Backend | Node.js + Express |
| Frontend | React + Vite + Tailwind |
| LLMs | Gemini 2.5 Pro / Gemini 3 Flash (via OpenRouter) |
| Research | Tavily Search API |

## Project structure

```
JobApp/
├── client/       # React frontend (Vite + Tailwind)
├── server/       # Express server + SSE streaming
├── recipe/       # KEMU Edge export (recipe + services)
├── docs/         # Agent instructions and test docs
└── workspace/    # Runtime state files (gitignored — written by agents)
```

## Setup

### Prerequisites
- Node.js 22.2.0+
- API keys for OpenRouter and Tavily (add to `recipe/.env`)

### Install

```bash
# Install recipe dependencies
cd recipe && npm install

# Install server dependencies
cd ../server && npm install

# Install client dependencies
cd ../client && npm install
```

### Run

```bash
# Terminal 1 — start the Express server (also starts the KEMU recipe)
cd server && npm start

# Terminal 2 — start the React dev server
cd client && npm run dev
```

Open `http://localhost:5173`.

## Environment variables

Create `recipe/.env`:

```
OPENROUTER_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
KEMU_API_KEY=your_key_here
KEMU_CONFIG=your_config_here
```
