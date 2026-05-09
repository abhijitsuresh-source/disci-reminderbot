// api/stop-reminder.js
// Called when user taps "Stop reminding" on a push notification
// Cancels all future unsent notifications for that reminder

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { reminderId } = req.body;
  if (!reminderId) return res.status(400).json({ error: 'reminderId required' });

  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_notifications?reminder_id=eq.${reminderId}&sent=eq.false`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          sent: true,
          sent_at: new Date().toISOString(),
          message: 'Stopped by user'
        })
      }
    );
    return res.json({ success: true });
  } catch(e) {
    console.error('Stop reminder error:', e);
    return res.status(500).json({ error: e.message });
  }
}
