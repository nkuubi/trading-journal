# Trading Journal (Rh + Elder, v10)

Data is stored in Supabase (Postgres), scoped per signed-in user via Row
Level Security — syncs across devices once you're logged in on each.

## 1. Create the Supabase project
1. https://supabase.com → New project.
2. Project Settings → API → copy the **Project URL** and **anon public key**.
3. SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run.
   This creates the `kv` table and its RLS policies.
4. (Optional) Authentication → Providers → Email: if you don't want email
   confirmation for a personal single-user app, turn off "Confirm email".

## 2. Local dev
    cp .env.example .env.local
    # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
    npm install
    npm run dev
Sign up once (Sign Up tab in the app), confirm the email if required, sign in.

## 3. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. Import the repo at https://vercel.com/new — Vercel auto-detects Vite.
3. Project Settings → Environment Variables, add:
     VITE_SUPABASE_URL
     VITE_SUPABASE_ANON_KEY
     ANTHROPIC_API_KEY
4. Deploy (redeploy once after adding env vars if you added them post-deploy).

## Notes
- The AI Coach calls `/api/ai-review` (a Vercel serverless function), never
  Anthropic directly, so your Anthropic key never reaches the browser.
- `src/App.jsx`'s `load()`/`sv()` talk to the Supabase `kv` table — one row
  per (user, key), value stored as jsonb. Every existing account/page's data
  (trades, deposits, checklists, etc.) is unaffected in shape, just synced
  server-side now instead of sitting in localStorage.
- RLS means even if someone else got your anon key, they still cannot read
  or write another user's rows — only their own authenticated session's.
