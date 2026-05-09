// api/monthly-report.js
// Vercel runs this on the 1st of every month at 8am
// It generates a report for each user and stores it in Supabase

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStart = lastMonth.toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthLabel = lastMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  try {
    // Get all users
    const users = await db('users');
    let reports = 0;

    for (const user of users) {
      try {
        // Get reminders that were due last month
        const monthReminders = await db(
          `reminders?user_id=eq.${user.id}&deadline=gte.${monthStart}&deadline=lt.${monthEnd}`
        );

        if (!monthReminders || monthReminders.length === 0) continue;

        const total = monthReminders.length;
        const completed = monthReminders.filter(r => r.completed).length;
        const missed = total - completed;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        // Find top missed and completed
        const missedReminders = monthReminders.filter(r => !r.completed).sort((a, b) => b.priority - a.priority);
        const completedReminders = monthReminders.filter(r => r.completed).sort((a, b) => b.priority - a.priority);

        // Generate narrative via Groq
        const narrativeRes = await fetch(`${process.env.VERCEL_URL}/api/groq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_report',
            context: {
              userName: user.name,
              month: monthLabel,
              completionRate,
              total,
              completed,
              missed,
              topMissed: missedReminders[0]?.title,
              topCompleted: completedReminders[0]?.title
            }
          })
        });

        const { narrative } = await narrativeRes.json();

        // Store the report
        await db('monthly_reports', {
          method: 'POST',
          body: {
            user_id: user.id,
            report_month: monthLabel,
            total_reminders: total,
            completed_reminders: completed,
            missed_reminders: missed,
            completion_rate: completionRate,
            narrative
          }
        });

        reports++;
      } catch (userErr) {
        console.error(`Report error for user ${user.id}:`, userErr);
      }
    }

    return res.json({ success: true, reports_generated: reports });
  } catch (e) {
    console.error('Monthly report error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function db(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
