# Ledger — Personal Finance Dashboard

A mobile-first, dark-mode personal finance dashboard. Flask + Supabase on the
backend, Tailwind CSS (CDN) + Chart.js on the frontend. No build step.

## Project structure

```
money-manager/
├── app.py                  # Flask app + Supabase integration + API routes
├── requirements.txt
├── schema.sql               # Run once in the Supabase SQL editor
├── .env.example             # Copy to .env and fill in your credentials
├── .gitignore
├── templates/
│   └── index.html           # Dashboard page (Tailwind CDN + Chart.js)
└── static/
    ├── css/style.css        # Small extras Tailwind's CDN doesn't cover
    └── js/app.js             # API calls, chart rendering, CRUD modal logic
```

## 1. Create the Supabase table

In your Supabase project, open **SQL Editor** and run the contents of
`schema.sql`. It creates the `transactions` table:

| column     | type      | notes                              |
|------------|-----------|-------------------------------------|
| id         | bigint    | primary key, auto-generated         |
| amount     | numeric   | must be > 0                         |
| category   | text      | e.g. "Food", "Salary", "Rent"       |
| type       | text      | `'Income'` or `'Expense'`           |
| date       | date      | defaults to today                   |
| note       | text      | optional                            |
| created_at | timestamptz | row insert timestamp              |

## 2. Configure credentials

```bash
cp .env.example .env
```

Open `.env` and fill in, from **Supabase Dashboard → Project Settings → API**:

- `SUPABASE_URL` — your project URL
- `SUPABASE_SERVICE_KEY` — the **service role** key (not the anon/public key —
  this app talks to Supabase only from the Flask server, so the key is never
  exposed to the browser)

## 3. Install & run

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

Open **http://localhost:5000**.

To preview the mobile layout: open DevTools (F12) → toggle the device
toolbar (the phone/tablet icon) → pick a phone preset.

## 4. Production deployment

Run with debug off behind gunicorn instead of the dev server:

```bash
export FLASK_DEBUG=0
gunicorn -w 2 -b 0.0.0.0:8000 app:app
```

Keep `.env` (or your host's secret manager) out of version control — `.env`
is already in `.gitignore`.

## Notes

- **Currency symbol**: change the `CURRENCY` constant at the top of
  `static/js/app.js` (defaults to `Rs`).
- **Row Level Security**: `schema.sql` disables RLS, since the table is only
  ever accessed through the trusted service-role key on the server. If you
  later query Supabase directly from client-side JS with the anon key,
  re-enable RLS and add policies first.
- **Surplus** is calculated server-side in `app.py` (`/api/summary`) as
  `Total Income - Total Expense`, alongside the category breakdown used for
  the "Spending by Category" chart.
