# Disci — Setup Instructions

## Files in this project
- `index.html` — The app UI
- `app.js` — Frontend logic
- `sw.js` — Service worker (push notifications)
- `manifest.json` — Makes it installable as a PWA
- `api/groq.js` — AI nudge generation
- `api/create-reminder.js` — Saves reminders + schedules notifications
- `api/notify.js` — Cron: runs every minute, sends due notifications
- `api/monthly-report.js` — Cron: runs 1st of month, generates reports
- `vercel.json` — Tells Vercel about the cron schedule
- `package.json` — Project dependencies

## Environment Variables to add in Vercel
Go to Vercel → Your Project → Settings → Environment Variables and add:

| Name | Value |
|------|-------|
| SUPABASE_URL | Your Supabase project URL |
| SUPABASE_ANON_KEY | Your Supabase anon/public key |
| SUPABASE_SERVICE_KEY | Your Supabase service_role key |
| GROQ_API_KEY | Your Groq API key |
| VAPID_PUBLIC_KEY | Generated VAPID key (see below) |
| VAPID_PRIVATE_KEY | Generated VAPID key (see below) |
| CRON_SECRET | Any random string you make up |

## Generating VAPID Keys
VAPID keys are what allow your server to send push notifications.
Run this once in any Node.js environment or use: https://vapidkeys.com
Copy the public and private keys into Vercel environment variables.

## Files to update before deploying
1. `app.js` line 2-3: Replace YOUR_SUPABASE_URL and YOUR_SUPABASE_ANON_KEY
2. `app.js` line 110: Replace YOUR_VAPID_PUBLIC_KEY
3. `api/notify.js` line 16: Replace with your email address
