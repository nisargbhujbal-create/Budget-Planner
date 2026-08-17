# Ledger — Personal Budget & Savings Planner

A small local web app for tracking monthly income and expenses, watching
spending by category, and planning savings goals. Built as an expansion of my first year
Codethon prototype (SDG 8 — Decent Work & Economic Growth, SDG 10 — Reduced
Inequalities).

## Features

- **Monthly budgets** — log income and expenses per month, with custom
  expense categories (not locked to a fixed list).
- **Dashboard** — remaining balance, a category breakdown chart, and a
  ledger-style table with each category's share of total spend.
- **History** — an income / expenses / balance trend line across every
  month you've recorded.
- **Savings goals** — create named goals, top up savings toward them, and
  estimate how many months a goal will take based on your average monthly
  balance.
- **CSV export** — download any month's record as a spreadsheet-ready file.
- **Local persistence** — everything is stored in a SQLite file on disk
  (`data/ledger.db`), so your history survives restarts.

## Getting started

Requires Python 3.9+.

```bash
git clone <this-repo-url>
cd budget-planner

python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000** in your browser.

The database is created automatically on first run at `data/ledger.db` — no
setup required.

## Project structure

```
budget-planner/
├── app.py                 # Flask app: routes + JSON API
├── requirements.txt
├── data/                  # SQLite database lives here (gitignored)
├── static/
│   ├── style.css
│   └── app.js
└── templates/
    └── index.html
```

## API overview

| Method | Route                    | Purpose                              |
|--------|---------------------------|---------------------------------------|
| GET    | `/api/months`             | List all recorded months              |
| GET    | `/api/budget/<month>`     | Get a month's income/expenses         |
| POST   | `/api/budget`              | Create or overwrite a month's record  |
| DELETE | `/api/budget/<month>`     | Delete a month's record               |
| GET    | `/api/export/<month>`     | Download a month as CSV               |
| GET    | `/api/summary`            | Trend data across all months          |
| GET    | `/api/categories`         | List expense categories               |
| POST   | `/api/categories`         | Add a new category                    |
| GET    | `/api/goals`              | List savings goals                    |
| POST   | `/api/goals`              | Create a savings goal                 |
| PATCH  | `/api/goals/<id>`         | Add to a goal's saved amount          |
| DELETE | `/api/goals/<id>`         | Delete a goal                         |

All routes return JSON except `/api/export/<month>`, which returns a CSV
file.

## Notes on the original prototype

The original script was a single-run CLI tool: it asked for income and a
fixed set of five expense categories, printed a summary, and offered a
simple "months to reach a goal" calculation assuming the entire remaining
balance is saved every month. This version keeps that same core idea but
adds persistence across months, a real interface, editable categories,
multiple concurrent savings goals, and trend visualization — while keeping
the underlying math transparent and easy to follow.

## License

MIT — do whatever you like with it.
