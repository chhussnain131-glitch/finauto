import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

print("=" * 50)
print("SUPABASE DIAGNOSTICS")
print("=" * 50)

if not SUPABASE_URL:
    print("❌ SUPABASE_URL missing in .env file!")
elif not SUPABASE_URL.startswith("https://"):
    print(f"❌ SUPABASE_URL looks wrong: {SUPABASE_URL}")
else:
    print(f"✅ SUPABASE_URL found: {SUPABASE_URL[:40]}...")

if not SUPABASE_KEY:
    print("❌ SUPABASE_KEY missing in .env file!")
elif len(SUPABASE_KEY) < 100:
    print(f"❌ SUPABASE_KEY too short, might be wrong: {SUPABASE_KEY[:20]}...")
else:
    print(f"✅ SUPABASE_KEY found: {SUPABASE_KEY[:30]}...")

print()

try:
    from supabase import create_client
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Supabase client created successfully")
except Exception as e:
    print(f"❌ Supabase client creation failed: {e}")
    exit()

print()
print("Testing tables...")
print("-" * 30)

tables = ["transactions", "cars", "reminders"]
for table in tables:
    try:
        res = supabase.table(table).select("*").limit(1).execute()
        print(f"✅ Table '{table}' — OK (rows found: {len(res.data)})")
    except Exception as e:
        print(f"❌ Table '{table}' — ERROR: {e}")

print()
print("=" * 50)
print("Diagnostic complete.")
print("=" * 50)
