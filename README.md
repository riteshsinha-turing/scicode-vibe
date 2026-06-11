# SciCode Dataset Builder

A browser-based canvas for creating and evaluating scientific coding datasets. You define a problem from a research paper, write sub-problems with golden solutions and unit tests, then generate model outputs and run unit tests against them — all in the browser.

## Features

- **Problem Editor** — define a scientific problem with title, description, and paper reference
- **Sub-problems** — break the problem into 1–4 sub-problems, each with a function signature, prompt, golden solution, and unit tests
- **In-browser Python execution** — unit tests run via [Pyodide](https://pyodide.org) (Python compiled to WebAssembly); no backend needed
- **Model Outputs** — generate solutions from Claude models (Opus 4, Sonnet 4, Haiku 4.5) with configurable pass@N
- **Side-by-side comparison** — view golden solution vs. model outputs with per-test pass/fail for each iteration
- **Export** — download the dataset as JSON or Markdown

## Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- An [Anthropic API key](https://console.anthropic.com/) (only needed to generate model outputs)

## Getting Started

```bash
# 1. Clone the repository
git clone <repo-url>
cd scicode-vibe

# 2. Install dependencies
npm install

# 3. Set your Anthropic API key
#    Create a .env file in the project root:
echo "VITE_ANTHROPIC_API_KEY=sk-ant-..." > .env

# 4. Start the dev server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

> **Note:** The API key is read from the `.env` file at build time by Vite and is never stored server-side. The `.env` file is gitignored — do not commit your key.

## Project Structure

```
scicode-vibe/
├── scicode_canvas.jsx   # Main React component (entire app)
├── src/
│   └── main.jsx         # React entry point
├── index.html           # HTML shell
├── vite.config.js       # Vite configuration
├── package.json
└── .env                 # Your API key (not committed)
```

## Usage

### 1. Problem Editor tab

Fill in the problem title, paper reference, and description. Then for each sub-problem:

- **Function Signature** — the exact Python function signature models will implement (e.g. `def compute_energy(psi: np.ndarray, dx: float) -> float:`)
- **Prompt** — the natural-language prompt sent to each model
- **Golden Solution** — your reference implementation; click **▶ Run** to verify it executes without errors
- **Unit Tests** — one tab per test; click **▶ Run** on a test to execute it against the golden solution, or **▶▶ Run All** to run all tests

### 2. Model Outputs tab

Configure the run:

| Setting | Description |
|---|---|
| **Models** | Select which Claude models to run (multi-select dropdown) |
| **Sub-problems** | Choose which sub-problems to include |
| **pass@n** | Number of independent solutions to generate per model; use presets (1, 3, 5, 10) or type a custom value |

Click **▶ Generate Model Outputs**. When the run completes the comparison table populates automatically.

The table shows one column per model alongside the **Golden Reference**. Each column contains:
- The generated code for the selected iteration
- Per-test pass ✓ / fail ✗ results (click a failing test to expand the traceback)

Use the **Iteration** selector to step through each of the N generated solutions.

### 3. Export tab

Download the full dataset (problem definition + all model outputs + test results) as:

- **JSON** — structured data suitable for further processing
- **Markdown** — human-readable problem spec with golden solution and unit tests

## Adding a `.gitignore`

Make sure your `.env` file is not committed:

```
node_modules/
dist/
.env
```

## Python packages

Pyodide ships the Python standard library. Scientific packages like `numpy`, `scipy`, and `matplotlib` can be loaded at runtime inside your golden solution or tests:

```python
import micropip
await micropip.install("numpy")
import numpy as np
```
