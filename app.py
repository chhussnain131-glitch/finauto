"""
FinAuto – Flask + Supabase Backend
"""

import io
import os
from datetime import datetime

from flask import Flask, jsonify, request, send_file, render_template
from flask_cors import CORS
from supabase import create_client, Client

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle,
    Paragraph, Spacer, HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://YOUR_PROJECT.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "YOUR_SERVICE_ROLE_OR_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.route("/")
def index():
    return render_template("index.html")

# =============================================================================
# CARS – CRUD
# =============================================================================

@app.route("/api/cars", methods=["GET"])
def get_cars():
    data = supabase.table("cars").select("*").order("created_at", desc=True).execute()
    return jsonify(data.data), 200


@app.route("/api/cars", methods=["POST"])
def add_car():
    body = request.get_json() or {}
    required = ["chassis_number", "make", "model"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400
    body.setdefault("status", "Available")
    data = supabase.table("cars").insert(body).execute()
    return jsonify(data.data[0]), 201


@app.route("/api/cars/<chassis_number>", methods=["GET"])
def get_car(chassis_number: str):
    result = (
        supabase.table("cars")
        .select("*")
        .eq("chassis_number", chassis_number)
        .single()
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Car not found"}), 404
    return jsonify(result.data), 200


@app.route("/api/cars/<chassis_number>", methods=["PUT"])
def edit_car(chassis_number: str):
    body = request.get_json() or {}
    allowed = {"make", "model", "year", "purchase_price", "purchase_date"}
    payload = {k: v for k, v in body.items() if k in allowed}
    if not payload:
        return jsonify({"error": "No valid fields"}), 400
    result = (
        supabase.table("cars")
        .update(payload)
        .eq("chassis_number", chassis_number)
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Car not found"}), 404
    return jsonify(result.data[0]), 200


@app.route("/api/cars/<chassis_number>", methods=["DELETE"])
def delete_car(chassis_number: str):
    result = (
        supabase.table("cars")
        .delete()
        .eq("chassis_number", chassis_number)
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Car not found"}), 404
    return jsonify({"message": "Car deleted"}), 200


# =============================================================================
# FEATURE 1 – Customer Management: mark a car as Sold
# =============================================================================

@app.route("/api/cars/<chassis_number>/mark_sold", methods=["PATCH"])
def mark_car_as_sold(chassis_number: str):
    body = request.get_json() or {}

    required = ["customer_name", "customer_phone"]
    missing = [f for f in required if not str(body.get(f, "")).strip()]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    existing = (
        supabase.table("cars")
        .select("chassis_number, status")
        .eq("chassis_number", chassis_number)
        .single()
        .execute()
    )
    if not existing.data:
        return jsonify({"error": "Car not found"}), 404
    if existing.data.get("status") == "Sold":
        return jsonify({"error": "Car is already marked as Sold"}), 409

    update_payload = {
        "status":         "Sold",
        "customer_name":  body["customer_name"].strip(),
        "customer_phone": body["customer_phone"].strip(),
        "sold_at":        datetime.utcnow().isoformat(),
    }

    if body.get("sale_price") is not None:
        try:
            update_payload["sale_price"] = float(body["sale_price"])
        except (ValueError, TypeError):
            return jsonify({"error": "sale_price must be a number"}), 400

    if body.get("advance_payment") is not None:
        try:
            update_payload["advance_payment"] = float(body["advance_payment"])
        except (ValueError, TypeError):
            return jsonify({"error": "advance_payment must be a number"}), 400

    if body.get("advance_date"):
        update_payload["advance_date"] = body["advance_date"]

    result = (
        supabase.table("cars")
        .update(update_payload)
        .eq("chassis_number", chassis_number)
        .execute()
    )
    return jsonify({"message": "Car marked as Sold", "car": result.data[0]}), 200


# =============================================================================
# FEATURE 2 – PDF Export
# =============================================================================

BRAND_DARK  = colors.HexColor("#1a237e")
BRAND_MID   = colors.HexColor("#283593")
BRAND_LIGHT = colors.HexColor("#e8eaf6")


def _build_pdf_buffer(month_str: str) -> io.BytesIO:
    year, month = map(int, month_str.split("-"))
    month_start = f"{year}-{month:02d}-01"
    month_end   = (
        f"{year + 1}-01-01" if month == 12
        else f"{year}-{month + 1:02d}-01"
    )

    sold_result = (
        supabase.table("cars")
        .select("chassis_number, make, model, year, sale_price, purchase_price, customer_name, sold_at")
        .eq("status", "Sold")
        .gte("sold_at", month_start)
        .lt("sold_at", month_end)
        .order("sold_at")
        .execute()
    )
    sold_cars     = sold_result.data or []
    total_revenue = sum(c.get("sale_price") or 0 for c in sold_cars)
    total_costs   = sum(c.get("purchase_price") or 0 for c in sold_cars)
    net_profit    = total_revenue - total_costs

    buffer = io.BytesIO()
    doc    = SimpleDocTemplate(buffer, pagesize=A4,
                leftMargin=2*cm, rightMargin=2*cm,
                topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle("BrandTitle", parent=styles["Title"],
                                  fontSize=20, textColor=BRAND_DARK, spaceAfter=4)
    sub_style   = ParagraphStyle("BrandSub", parent=styles["Normal"],
                                  fontSize=10, textColor=colors.grey, spaceAfter=12)
    h2_style    = ParagraphStyle("BrandH2", parent=styles["Heading2"],
                                  fontSize=12, textColor=BRAND_DARK, spaceBefore=14, spaceAfter=6)
    footer_style = ParagraphStyle("Footer", parent=styles["Normal"],
                                   fontSize=8, textColor=colors.grey, alignment=TA_RIGHT)

    elements    = []
    month_label = datetime(year, month, 1).strftime("%B %Y")
    elements.append(Paragraph("FinAuto", title_style))
    elements.append(Paragraph(f"Business Summary — {month_label}", sub_style))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=BRAND_DARK, spaceAfter=10))

    kpi_data  = [
        ["Metric", "Amount (PKR)"],
        ["Cars Sold", str(len(sold_cars))],
        ["Total Revenue", f"PKR {total_revenue:>15,.0f}"],
        ["Total Purchase Costs", f"PKR {total_costs:>15,.0f}"],
        ["Net Profit", f"PKR {net_profit:>15,.0f}"],
    ]
    kpi_table = Table(kpi_data, colWidths=[10*cm, 6*cm])
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0),  BRAND_DARK),
        ("TEXTCOLOR",      (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",       (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",       (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, BRAND_LIGHT]),
        ("ALIGN",          (1, 0), (1, -1),  "RIGHT"),
        ("FONTNAME",       (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR",      (0, -1), (-1, -1),
         colors.HexColor("#1b5e20") if net_profit >= 0 else colors.red),
        ("GRID",           (0, 0), (-1, -1), 0.5, colors.grey),
        ("TOPPADDING",     (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING",  (0, 0), (-1, -1), 6),
        ("LEFTPADDING",    (0, 0), (-1, -1), 8),
    ]))
    elements.append(kpi_table)

    if sold_cars:
        elements.append(Paragraph("Sold Vehicles Detail", h2_style))
        headers = ["#", "Chassis", "Make / Model", "Customer",
                   "Purchase (PKR)", "Sale (PKR)", "Profit (PKR)"]
        rows = [headers]
        for idx, c in enumerate(sold_cars, 1):
            profit     = (c.get("sale_price") or 0) - (c.get("purchase_price") or 0)
            make_model = f"{c.get('make','')} {c.get('model','')} {c.get('year') or ''}".strip()
            rows.append([str(idx), c.get("chassis_number","—"), make_model,
                         c.get("customer_name","—"),
                         f"{c.get('purchase_price') or 0:,.0f}",
                         f"{c.get('sale_price') or 0:,.0f}",
                         f"{profit:,.0f}"])
        detail_table = Table(rows,
            colWidths=[0.8*cm, 2.8*cm, 3.5*cm, 3*cm, 2.4*cm, 2.4*cm, 2.4*cm],
            repeatRows=1)
        detail_table.setStyle(TableStyle([
            ("BACKGROUND",     (0, 0), (-1, 0),  BRAND_MID),
            ("TEXTCOLOR",      (0, 0), (-1, 0),  colors.white),
            ("FONTNAME",       (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",       (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_LIGHT]),
            ("ALIGN",          (4, 0), (-1, -1), "RIGHT"),
            ("ALIGN",          (0, 0), (0, -1),  "CENTER"),
            ("GRID",           (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ("TOPPADDING",     (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 4),
            ("LEFTPADDING",    (0, 0), (-1, -1), 5),
        ]))
        elements.append(detail_table)
    else:
        elements.append(Spacer(1, 0.5*cm))
        elements.append(Paragraph("No vehicles were sold in this period.", styles["Normal"]))

    elements.append(Spacer(1, 1*cm))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.lightgrey))
    elements.append(Spacer(1, 0.2*cm))
    elements.append(Paragraph(
        f"Generated by FinAuto on {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC  |  Confidential",
        footer_style))

    doc.build(elements)
    buffer.seek(0)
    return buffer


@app.route("/api/export-pdf/<month>", methods=["GET"])
def export_pdf(month: str):
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        return jsonify({"error": "Invalid month. Use YYYY-MM format"}), 400
    try:
        buffer   = _build_pdf_buffer(month)
        filename = f"FinAuto_Summary_{month}.pdf"
        return send_file(buffer, mimetype="application/pdf",
                         as_attachment=True, download_name=filename)
    except Exception as exc:
        return jsonify({"error": f"PDF generation failed: {str(exc)}"}), 500


@app.route("/reports/business_summary_pdf", methods=["GET"])
def business_summary_pdf_legacy():
    month = request.args.get("month", datetime.utcnow().strftime("%Y-%m"))
    return export_pdf(month)


# =============================================================================
# FEATURE 3 – Installment CRUD
# =============================================================================

@app.route("/api/installments/add", methods=["POST"])
def create_installment():
    body    = request.get_json() or {}
    required = ["chassis_number", "installment_amount", "due_date"]
    missing  = [f for f in required if body.get(f) is None]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        amount = float(body["installment_amount"])
        if amount <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "installment_amount must be a positive number"}), 400

    try:
        datetime.strptime(body["due_date"], "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "due_date must be YYYY-MM-DD"}), 400

    status = body.get("payment_status", "Pending")
    if status not in ("Pending", "Paid", "Overdue"):
        return jsonify({"error": "payment_status must be 'Pending' or 'Paid'"}), 400

    payload = {
        "chassis_number":     body["chassis_number"],
        "installment_amount": amount,
        "due_date":           body["due_date"],
        "payment_status":     status,
        "created_at":         datetime.utcnow().isoformat(),
    }
    result = supabase.table("installments").insert(payload).execute()
    return jsonify(result.data[0]), 201


@app.route("/api/installments/<chassis_number>", methods=["GET"])
def get_installments(chassis_number: str):
    result = (
        supabase.table("installments")
        .select("*")
        .eq("chassis_number", chassis_number)
        .order("due_date")
        .execute()
    )
    rows  = result.data or []
    today = datetime.utcnow().date()
    overdue_ids = []

    for r in rows:
        if r.get("payment_status") == "Pending" and r.get("due_date"):
            due = datetime.strptime(r["due_date"], "%Y-%m-%d").date()
            if due < today:
                r["payment_status"] = "Overdue"
                overdue_ids.append(r["id"])

    if overdue_ids:
        supabase.table("installments").update({"payment_status": "Overdue"}).in_("id", overdue_ids).execute()

    return jsonify(rows), 200

@app.route("/api/installments/<int:installment_id>", methods=["PATCH"])
def update_installment(installment_id: int):
    body    = request.get_json() or {}
    allowed = {"payment_status", "installment_amount", "due_date"}
    payload = {k: v for k, v in body.items() if k in allowed}
    if not payload:
        return jsonify({"error": "No valid fields to update"}), 400

    if "payment_status" in payload:
        if payload["payment_status"] not in ("Pending", "Paid"):
            return jsonify({"error": "payment_status must be 'Pending' or 'Paid'"}), 400
        if payload["payment_status"] == "Paid":
            payload["paid_at"] = datetime.utcnow().isoformat()
        else:
            payload["paid_at"] = None

    result = (
        supabase.table("installments")
        .update(payload)
        .eq("id", installment_id)
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Installment not found"}), 404
    return jsonify(result.data[0]), 200


@app.route("/api/installments/<int:installment_id>", methods=["DELETE"])
def delete_installment(installment_id: int):
    result = (
        supabase.table("installments")
        .delete()
        .eq("id", installment_id)
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Installment not found"}), 404
    return jsonify({"message": "Installment deleted"}), 200


@app.route("/api/installments/<chassis_number>/summary", methods=["GET"])
def installment_summary(chassis_number: str):
    car_result = (
        supabase.table("cars")
        .select("sale_price, advance_payment")
        .eq("chassis_number", chassis_number)
        .single()
        .execute()
    )
    car_data    = car_result.data or {}
    sale_price  = car_data.get("sale_price") or 0
    advance     = car_data.get("advance_payment") or 0

    result = (
        supabase.table("installments")
        .select("installment_amount, payment_status")
        .eq("chassis_number", chassis_number)
        .execute()
    )
    rows            = result.data or []
    total_paid_inst = sum(r["installment_amount"] for r in rows if r["payment_status"] == "Paid")
    total_paid_all  = advance + total_paid_inst
    balance         = max(0, sale_price - total_paid_all)

    return jsonify({
        "chassis_number":     chassis_number,
        "total_installments": len(rows),
        "total_owed":         sale_price,
        "advance":            advance,
        "total_paid":         total_paid_inst,
        "total_paid_all":     total_paid_all,
        "balance_remaining":  balance,
    }), 200


# =============================================================================
# PARTIAL PAYMENTS – CRUD
# =============================================================================

@app.route("/api/installments/<int:installment_id>/payments", methods=["GET"])
def get_payments(installment_id: int):
    result = (
        supabase.table("payments")
        .select("*")
        .eq("installment_id", installment_id)
        .order("payment_date")
        .execute()
    )
    return jsonify(result.data), 200


@app.route("/api/installments/<int:installment_id>/payments", methods=["POST"])
def add_partial_payment(installment_id: int):
    body = request.get_json() or {}

    try:
        amount_paid = float(body.get("amount_paid", 0))
        if amount_paid <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "amount_paid must be a positive number"}), 400

    inst_result = (
        supabase.table("installments")
        .select("*")
        .eq("id", installment_id)
        .single()
        .execute()
    )
    if not inst_result.data:
        return jsonify({"error": "Installment not found"}), 404

    inst_amount  = float(inst_result.data["installment_amount"])
    payment_date = body.get("payment_date") or datetime.utcnow().strftime("%Y-%m-%d")

    try:
        datetime.strptime(payment_date, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "payment_date must be YYYY-MM-DD"}), 400

    prev_payments = (
        supabase.table("payments")
        .select("amount_paid")
        .eq("installment_id", installment_id)
        .execute()
    )
    already_paid = sum(float(p["amount_paid"]) for p in (prev_payments.data or []))
    remaining    = inst_amount - already_paid

    if amount_paid > remaining:
        return jsonify({"error": f"Amount exceeds remaining. Max allowed: {remaining:,.0f}"}), 400

    supabase.table("payments").insert({
        "installment_id": installment_id,
        "amount_paid":    amount_paid,
        "payment_date":   payment_date,
        "notes":          body.get("notes", ""),
    }).execute()

    new_total  = already_paid + amount_paid
    new_status = "Paid" if new_total >= inst_amount else "Pending"
    update_pl  = {"payment_status": new_status}
    if new_status == "Paid":
        update_pl["paid_at"] = datetime.utcnow().isoformat()

    supabase.table("installments").update(update_pl).eq("id", installment_id).execute()

    return jsonify({
        "message":     "Payment added",
        "amount_paid": amount_paid,
        "total_paid":  new_total,
        "remaining":   max(0, inst_amount - new_total),
        "status":      new_status,
    }), 201


@app.route("/api/payments/<int:payment_id>", methods=["DELETE"])
def delete_payment(payment_id: int):
    pay_result = (
        supabase.table("payments")
        .select("*")
        .eq("id", payment_id)
        .single()
        .execute()
    )
    if not pay_result.data:
        return jsonify({"error": "Payment not found"}), 404

    installment_id = pay_result.data["installment_id"]
    supabase.table("payments").delete().eq("id", payment_id).execute()

    remaining_payments = (
        supabase.table("payments")
        .select("amount_paid")
        .eq("installment_id", installment_id)
        .execute()
    )
    inst_result = (
        supabase.table("installments")
        .select("installment_amount")
        .eq("id", installment_id)
        .single()
        .execute()
    )
    inst_amount = float(inst_result.data["installment_amount"])
    total_paid  = sum(float(p["amount_paid"]) for p in (remaining_payments.data or []))
    new_status  = "Paid" if total_paid >= inst_amount else "Pending"
    paid_at     = datetime.utcnow().isoformat() if new_status == "Paid" else None

    supabase.table("installments").update({
        "payment_status": new_status,
        "paid_at":        paid_at,
    }).eq("id", installment_id).execute()

    return jsonify({"message": "Payment deleted", "installment_status": new_status}), 200


# =============================================================================
# Entry point
# =============================================================================
if __name__ == "__main__":
    app.run(debug=True, port=5000)