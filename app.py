"""
Ledger — Personal Budget & Savings Planner
Flask backend: serves the frontend and a small JSON API backed by SQLite.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000
"""

import os
import sqlite3
import csv
import io
from datetime import datetime
from flask import Flask, jsonify, request, g, render_template, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "ledger.db")
DEFAULT_CATEGORIES = ["Investment", "Food", "Travel", "Bills", "Groceries"]

app = Flask(__name__)


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS categories (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS budgets (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            month   TEXT UNIQUE NOT NULL,      -- e.g. "2026-08"
            income  REAL NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS expenses (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
            category  TEXT NOT NULL,
            amount    REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            target      REAL NOT NULL,
            saved       REAL NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        );
        """
    )
    existing = {r[0] for r in conn.execute("SELECT name FROM categories")}
    for cat in DEFAULT_CATEGORIES:
        if cat not in existing:
            conn.execute("INSERT INTO categories (name) VALUES (?)", (cat,))
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Frontend
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Categories
# --------------------------------------------------------------------------

@app.route("/api/categories", methods=["GET"])
def list_categories():
    db = get_db()
    rows = db.execute("SELECT id, name FROM categories ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/categories", methods=["POST"])
def add_category():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Category name is required."}), 400
    db = get_db()
    try:
        db.execute("INSERT INTO categories (name) VALUES (?)", (name,))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "That category already exists."}), 409
    return jsonify({"ok": True}), 201


# --------------------------------------------------------------------------
# Budgets / Expenses
# --------------------------------------------------------------------------

@app.route("/api/months", methods=["GET"])
def list_months():
    db = get_db()
    rows = db.execute(
        "SELECT month, income FROM budgets ORDER BY month DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


def _budget_payload(db, month):
    budget = db.execute(
        "SELECT * FROM budgets WHERE month = ?", (month,)
    ).fetchone()
    if not budget:
        return None
    expenses = db.execute(
        "SELECT category, amount FROM expenses WHERE budget_id = ? ORDER BY amount DESC",
        (budget["id"],),
    ).fetchall()
    total_expenses = sum(e["amount"] for e in expenses)
    return {
        "month": budget["month"],
        "income": budget["income"],
        "expenses": [dict(e) for e in expenses],
        "total_expenses": total_expenses,
        "balance": budget["income"] - total_expenses,
    }


@app.route("/api/budget/<month>", methods=["GET"])
def get_budget(month):
    payload = _budget_payload(get_db(), month)
    if payload is None:
        return jsonify({"error": "No record for that month."}), 404
    return jsonify(payload)


@app.route("/api/budget", methods=["POST"])
def save_budget():
    """Create or overwrite the budget + expenses for a given month."""
    data = request.get_json(force=True) or {}
    month = (data.get("month") or "").strip()
    income = data.get("income")
    expenses = data.get("expenses") or []

    if not month:
        return jsonify({"error": "Month is required (format YYYY-MM)."}), 400
    try:
        income = float(income)
    except (TypeError, ValueError):
        return jsonify({"error": "Income must be a number."}), 400
    if income < 0:
        return jsonify({"error": "Income can't be negative."}), 400

    clean_expenses = []
    for item in expenses:
        cat = (item.get("category") or "").strip()
        try:
            amt = float(item.get("amount", 0))
        except (TypeError, ValueError):
            amt = 0.0
        if cat and amt > 0:
            clean_expenses.append((cat, amt))

    db = get_db()
    existing = db.execute(
        "SELECT id FROM budgets WHERE month = ?", (month,)
    ).fetchone()

    if existing:
        db.execute("DELETE FROM expenses WHERE budget_id = ?", (existing["id"],))
        db.execute(
            "UPDATE budgets SET income = ? WHERE id = ?", (income, existing["id"])
        )
        budget_id = existing["id"]
    else:
        cur = db.execute(
            "INSERT INTO budgets (month, income, created_at) VALUES (?, ?, ?)",
            (month, income, datetime.utcnow().isoformat()),
        )
        budget_id = cur.lastrowid

    for cat, amt in clean_expenses:
        db.execute(
            "INSERT INTO expenses (budget_id, category, amount) VALUES (?, ?, ?)",
            (budget_id, cat, amt),
        )
        # keep the category list in sync so it shows up in future forms
        db.execute(
            "INSERT OR IGNORE INTO categories (name) VALUES (?)", (cat,)
        )
    db.commit()

    return jsonify(_budget_payload(db, month)), 200


@app.route("/api/budget/<month>", methods=["DELETE"])
def delete_budget(month):
    db = get_db()
    row = db.execute("SELECT id FROM budgets WHERE month = ?", (month,)).fetchone()
    if not row:
        return jsonify({"error": "No record for that month."}), 404
    db.execute("DELETE FROM budgets WHERE id = ?", (row["id"],))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/export/<month>", methods=["GET"])
def export_month(month):
    payload = _budget_payload(get_db(), month)
    if payload is None:
        return jsonify({"error": "No record for that month."}), 404

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Month", month])
    writer.writerow(["Income", f"{payload['income']:.2f}"])
    writer.writerow([])
    writer.writerow(["Category", "Amount"])
    for e in payload["expenses"]:
        writer.writerow([e["category"], f"{e['amount']:.2f}"])
    writer.writerow([])
    writer.writerow(["Total Expenses", f"{payload['total_expenses']:.2f}"])
    writer.writerow(["Remaining Balance", f"{payload['balance']:.2f}"])

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=ledger-{month}.csv"},
    )


# --------------------------------------------------------------------------
# Trend summary across all recorded months
# --------------------------------------------------------------------------

@app.route("/api/summary", methods=["GET"])
def summary():
    db = get_db()
    budgets = db.execute(
        "SELECT id, month, income FROM budgets ORDER BY month ASC"
    ).fetchall()

    trend = []
    category_totals = {}
    for b in budgets:
        exp_rows = db.execute(
            "SELECT category, amount FROM expenses WHERE budget_id = ?", (b["id"],)
        ).fetchall()
        total = sum(r["amount"] for r in exp_rows)
        for r in exp_rows:
            category_totals[r["category"]] = category_totals.get(r["category"], 0) + r["amount"]
        trend.append(
            {
                "month": b["month"],
                "income": b["income"],
                "expenses": total,
                "balance": b["income"] - total,
            }
        )

    avg_balance = (
        sum(t["balance"] for t in trend) / len(trend) if trend else 0
    )

    return jsonify(
        {
            "trend": trend,
            "category_totals": [
                {"category": k, "amount": v} for k, v in sorted(
                    category_totals.items(), key=lambda kv: kv[1], reverse=True
                )
            ],
            "average_monthly_balance": avg_balance,
        }
    )


# --------------------------------------------------------------------------
# Savings goals
# --------------------------------------------------------------------------

@app.route("/api/goals", methods=["GET"])
def list_goals():
    db = get_db()
    rows = db.execute("SELECT * FROM goals ORDER BY created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/goals", methods=["POST"])
def add_goal():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    try:
        target = float(data.get("target"))
    except (TypeError, ValueError):
        return jsonify({"error": "Target amount must be a number."}), 400
    if not name or target <= 0:
        return jsonify({"error": "Goal needs a name and a target above zero."}), 400

    db = get_db()
    db.execute(
        "INSERT INTO goals (name, target, saved, created_at) VALUES (?, ?, 0, ?)",
        (name, target, datetime.utcnow().isoformat()),
    )
    db.commit()
    return jsonify({"ok": True}), 201


@app.route("/api/goals/<int:goal_id>", methods=["PATCH"])
def update_goal(goal_id):
    data = request.get_json(force=True) or {}
    db = get_db()
    goal = db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not goal:
        return jsonify({"error": "Goal not found."}), 404

    if "add_amount" in data:
        try:
            add = float(data["add_amount"])
        except (TypeError, ValueError):
            return jsonify({"error": "Amount must be a number."}), 400
        new_saved = max(0.0, goal["saved"] + add)
        db.execute("UPDATE goals SET saved = ? WHERE id = ?", (new_saved, goal_id))
        db.commit()

    return jsonify(dict(db.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()))


@app.route("/api/goals/<int:goal_id>", methods=["DELETE"])
def delete_goal(goal_id):
    db = get_db()
    db.execute("DELETE FROM goals WHERE id = ?", (goal_id,))
    db.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
else:
    init_db()
