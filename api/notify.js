// api/notify.js
// Called hourly by Vercel cron OR manually via GET /api/notify?secret=CRON_SECRET
// Finds all unsent notifications that are due (scheduled_for <= now) and sends them

import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

webpush.setVapidDetails(
  'mailto:abhijitsuresh99@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // Allow Vercel cron (Authorization header) OR manual trigger via ?secret= query param
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret;
  const isVercelCron = authHeader === `Bearer ${CRON_SECRET}`;
  const isManualTrigger = querySecret === CRON_SECRET;

  if (!isVercelCron && !isManualTrigger) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();

  try {
    // Find all unsent notifications due up to now (past-due included)
    const due = await db(
      `scheduled_notifications?scheduled_for=lte.${now.toISOString()}&sent=eq.false&select=*,reminders(*),users(*)`
    );

    if (!due || due.length === 0) {
      return res.json({ sent: 0, message: 'No notifications due' });
    }

    let sent = 0;
    const errors = [];

    for (const notification of due) {
      try {
        const reminder = notification.reminders;
        const user = notification.users;

        if (!reminder || !user) continue;

        // Calculate days left (negative = overdue)
        const deadline = new Date(reminder.deadline);
        const daysLeft = Math.floor((deadline - now) / 86400000);

        // Generate nudge message via Groq
        const nudgeRes = await fetch(`https://${req.headers.host}/api/groq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate_nudge',
            reminder: {
              title: reminder.title,
              priority: reminder.priority,
              deadline: reminder.deadline,
              daysLeft,
              notifNum: notification.notification_number || 1,
              totalNotifs: notification.total_notifications || 1
            },
            context: { userName: user.name }
          })
        });

        let nudge = { title: reminder.title, body: `Reminder: ${reminder.title}` };
        if (nudgeRes.ok) {
          try { nudge = await nudgeRes.json(); } catch(e) {}
        }

        // Get user's push subscriptions
        const subs = await db(`push_subscriptions?user_id=eq.${user.id}`);
        console.log(`[notify] user ${user.id} subs found: ${subs ? subs.length : 0}`);
        if (!subs || subs.length === 0) {
          // DO NOT mark as sent — user may not have subscribed yet on this device
          console.warn(`[notify] no push subscription for user ${user.id}, skipping`);
          continue;
        }

        // Send push to all user devices
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              sub.subscription,
              JSON.stringify({
                title: nudge.title || reminder.title,
                body: nudge.body || `Reminder: ${reminder.title}`,
                priority: reminder.priority,
                reminderId: reminder.id
              })
            );
          } catch (pushErr) {
            console.error('Push send error:', JSON.stringify({
              status: pushErr.statusCode,
              body: pushErr.body,
              message: pushErr.message
            }));
            errors.push({ sub: sub.id, status: pushErr.statusCode, error: pushErr.message, body: pushErr.body });
            // Remove expired/invalid subscriptions
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              await db(`push_subscriptions?id=eq.${sub.id}`, { method: 'DELETE' });
            }
          }
        }

        // Mark as sent
        await markSent(notification.id, now, nudge.body);

        // Log for monthly reports
        await db('notification_logs', {
          method: 'POST',
          body: {
            reminder_id: reminder.id,
            user_id: user.id,
            message: nudge.body,
            priority: reminder.priority,
            was_completed: reminder.completed || false
          }
        });

        sent++;
      } catch (itemErr) {
        errors.push({ id: notification.id, error: itemErr.message });
        console.error('Notification error:', itemErr);
      }
    }

    return res.json({ sent, errors, total_found: due.length });

  } catch (e) {
    console.error('Notify error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function markSent(id, now, message) {
  await db(`scheduled_notifications?id=eq.${id}`, {
    method: 'PATCH',
    body: { sent: true, sent_at: now.toISOString(), message }
  });
}

async function db(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation'
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
