"""
Ledger — Personal Finance Dashboard v3
Features: CRUD transactions, month filter, monthly comparison chart,
          bill reminders, Supabase backend.
"""

import os
import calendar
from collections import defaultdict
from datetime import date, datetime

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .env file."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
TABLE_TX   = "transactions"
TABLE_REM  = "reminders"
VALID_TYPES = ("Income", "Expense")

app = Flask(__name__)


# --------------------------------------------------------------------------
# Validation helpers
# --------------------------------------------------------------------------
def validate_payload(data: dict, partial: bool = False):
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object"
    clean, errors = {}, []

    if "amount" in data or not partial:
        try:
            amount = float(data.get("amount"))
            if amount <= 0:
                errors.append("amount must be > 0")
            else:
                clean["amount"] = round(amount, 2)
        except (TypeError, ValueError):
            errors.append("amount must be a valid number")

    if "type" in data or not partial:
        tx_type = data.get("type")
        if tx_type not in VALID_TYPES:
            errors.append(f"type must be one of {VALID_TYPES}")
        else:
            clean["type"] = tx_type

    if "category" in data or not partial:
        category = (data.get("category") or "").strip()
        if not category:
            errors.append("category is required")
        else:
            clean["category"] = category[:80]

    if data.get("date"):
        clean["date"] = data["date"]

    if "note" in data:
        clean["note"] = (data.get("note") or "").strip()[:500]

    return (None, "; ".join(errors)) if errors else (clean, None)


def get_date_range():
    month = request.args.get("month", type=int)
    year  = request.args.get("year",  type=int)
    if month and year:
        last_day = calendar.monthrange(year, month)[1]
        return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"
    return None, None


# --------------------------------------------------------------------------
# Page
# --------------------------------------------------------------------------
@app.route("/")
def dashboard():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Transactions CRUD
# --------------------------------------------------------------------------
@app.route("/api/transactions", methods=["GET"])
def list_transactions():
    start, end = get_date_range()
    try:
        q = supabase.table(TABLE_TX).select("*")
        if start and end:
            q = q.gte("date", start).lte("date", end)
        result = q.order("date", desc=True).order("id", desc=True).execute()
        return jsonify(success=True, data=result.data), 200
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@app.route("/api/transactions", methods=["POST"])
def create_transaction():
    payload = request.get_json(silent=True) or {}
    clean, error = validate_payload(payload)
    if error:
        return jsonify(success=False, error=error), 400
    try:
        result = supabase.table(TABLE_TX).insert(clean).execute()
        return jsonify(success=True, data=result.data), 201
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@app.route("/api/transactions/<int:tid>", methods=["PUT"])
def update_transaction(tid):
    payload = request.get_json(silent=True) or {}
    clean, error = validate_payload(payload, partial=True)
    if error:
        return jsonify(success=False, error=error), 400
    if not clean:
        return jsonify(success=False, error="No valid fields to update"), 400
    try:
        result = supabase.table(TABLE_TX).update(clean).eq("id", tid).execute()
        if not result.data:
            return jsonify(success=False, error="Not found"), 404
        return jsonify(success=True, data=result.data), 200
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@app.route("/api/transactions/<int:tid>", methods=["DELETE"])
def delete_transaction(tid):
    try:
        result = supabase.table(TABLE_TX).delete().eq("id", tid).execute()
        if not result.data:
            return jsonify(success=False, error="Not found"), 404
        return jsonify(success=True), 200
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
@app.route("/api/summary", methods=["GET"])
def summary():
    start, end = get_date_range()
    try:
        q = supabase.table(TABLE_TX).select("amount, type, category")
        if start and end:
            q = q.gte("date", start).lte("date", end)
        rows = q.execute().data or []
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500

    total_income = total_expense = 0.0
    cat_totals = defaultdict(float)
    for row in rows:
        amt = float(row.get("amount") or 0)
        t   = row.get("type")
        cat = row.get("category") or "Uncategorized"
        if t == "Income":
            total_income += amt
        elif t == "Expense":
            total_expense += amt
            cat_totals[cat] += amt

    return jsonify(success=True, data={
        "total_income":       round(total_income, 2),
        "total_expense":      round(total_expense, 2),
        "surplus":            round(total_income - total_expense, 2),
        "category_breakdown": {k: round(v, 2) for k, v in cat_totals.items()},
        "transaction_count":  len(rows),
    }), 200


# --------------------------------------------------------------------------
# Available months dropdown
# --------------------------------------------------------------------------
@app.route("/api/months", methods=["GET"])
def available_months():
    try:
        rows = supabase.table(TABLE_TX).select("date").execute().data or []
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500
    seen = {r["date"][:7] for r in rows if r.get("date") and len(r["date"]) >= 7}
    return jsonify(success=True, data=sorted(seen, reverse=True)), 200


# --------------------------------------------------------------------------
# Monthly comparison (last 6 months bar chart)
# --------------------------------------------------------------------------
@app.route("/api/monthly-comparison", methods=["GET"])
def monthly_comparison():
    """
    Returns income & expense totals for the last 6 months so the
    frontend can draw a grouped bar chart.
    """
    today = date.today()
    months = []
    for i in range(5, -1, -1):   # 5 months ago → this month
        m = (today.month - i - 1) % 12 + 1
        y = today.year - ((today.month - i - 1) // 12 + (1 if today.month - i <= 0 else 0))
        # simpler calculation
        import datetime as dt
        target = dt.date(today.year, today.month, 1)
        # subtract i months properly
        month_num = today.month - i
        year_num  = today.year
        while month_num <= 0:
            month_num += 12
            year_num  -= 1
        months.append((year_num, month_num))

    labels, incomes, expenses = [], [], []

    for yr, mo in months:
        last_day = calendar.monthrange(yr, mo)[1]
        start = f"{yr:04d}-{mo:02d}-01"
        end   = f"{yr:04d}-{mo:02d}-{last_day:02d}"
        try:
            rows = (supabase.table(TABLE_TX)
                    .select("amount, type")
                    .gte("date", start)
                    .lte("date", end)
                    .execute().data or [])
        except Exception:
            rows = []

        inc = sum(float(r["amount"]) for r in rows if r.get("type") == "Income")
        exp = sum(float(r["amount"]) for r in rows if r.get("type") == "Expense")

        month_names = ["Jan","Feb","Mar","Apr","May","Jun",
                       "Jul","Aug","Sep","Oct","Nov","Dec"]
        labels.append(f"{month_names[mo-1]} {yr}")
        incomes.append(round(inc, 2))
        expenses.append(round(exp, 2))

    return jsonify(success=True, data={
        "labels":   labels,
        "incomes":  incomes,
        "expenses": expenses,
    }), 200


# --------------------------------------------------------------------------
# Bill Reminders CRUD
# --------------------------------------------------------------------------
@app.route("/api/reminders", methods=["GET"])
def list_reminders():
    try:
        rows = (supabase.table(TABLE_REM)
                .select("*")
                .eq("is_active", True)
                .order("due_day")
                .execute().data or [])

        # Enrich each reminder with paid/unpaid status for current month
        today     = date.today()
        yr, mo    = today.year, today.month
        last_day  = calendar.monthrange(yr, mo)[1]
        start     = f"{yr:04d}-{mo:02d}-01"
        end       = f"{yr:04d}-{mo:02d}-{last_day:02d}"

        paid_cats = set()
        try:
            tx_rows = (supabase.table(TABLE_TX)
                       .select("category, type")
                       .gte("date", start)
                       .lte("date", end)
                       .eq("type", "Expense")
                       .execute().data or [])
            paid_cats = {r["category"].lower() for r in tx_rows}
        except Exception:
            pass

        for r in rows:
            due_day = r.get("due_day", 1)
            r["due_date_this_month"] = f"{yr:04d}-{mo:02d}-{min(due_day, last_day):02d}"
            r["paid_this_month"]     = r["category"].lower() in paid_cats
            r["overdue"] = (not r["paid_this_month"]) and (today.day > due_day)

        return jsonify(success=True, data=rows), 200
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@app.route("/api/reminders", methods=["POST"])
def create_reminder():
    data = request.get_json(silent=True) or {}
    name     = (data.get("name") or "").strip()
    category = (data.get("category") or "").strip()
    due_day  = data.get("due_day")
    amount   = data.get("amount")

    errors = []
    if not name:     errors.append("name is required")
    if not category: errors.append("category is required")
    try:
        due_day = int(due_day)
        if not (1 <= due_day <= 31): raise ValueError
    except (TypeError, ValueError):
        errors.append("due_day must be 1–31")
    if errors:
        return jsonify(success=False, error="; ".join(errors)), 400

    payload = {"name": name[:100], "category": category[:80],
               "due_day": due_day, "is_active": True}
    if amount:
        try: payload["amount"] = round(float(amount), 2)
        except (TypeError, ValueError): pass

    try:
        result = supabase.table(TABLE_REM).insert(payload).execute()
        return jsonify(success=True, data=result.data), 201
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


@app.route("/api/reminders/<int:rid>", methods=["DELETE"])
def delete_reminder(rid):
    try:
        supabase.table(TABLE_REM).update({"is_active": False}).eq("id", rid).execute()
        return jsonify(success=True), 200
    except Exception as exc:
        return jsonify(success=False, error=str(exc)), 500


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode, host="0.0.0.0", port=5000)
