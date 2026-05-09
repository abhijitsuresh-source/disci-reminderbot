// api/create-reminder.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, title, priority, deadline, input_type } = req.body;

  if (!user_id || !title || !priority || !deadline) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 1. Save the reminder
    const reminder = await db('reminders', {
      method: 'POST',
      body: { user_id, title, priority, deadline, input_type: input_type || 'text' }
    });
    const reminderId = reminder[0].id;

    // 2. Calculate notification schedule
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const totalDays = Math.floor((deadlineDate - now) / 86400000);
    const schedule = calculateSchedule(priority, totalDays, now, deadlineDate);

    // 3. Store all scheduled notifications
    if (schedule.length > 0) {
      await db('scheduled_notifications', {
        method: 'POST',
        body: schedule.map((date, idx) => ({
          reminder_id: reminderId,
          user_id,
          scheduled_for: date.toISOString(),
          sent: false
        }))
      });
    }

    return res.json({
      success: true,
      reminder_id: reminderId,
      notifications_scheduled: schedule.length
    });

  } catch (e) {
    console.error('Create reminder error:', e);
    return res.status(500).json({ error: e.message });
  }
}

function calculateSchedule(priority, totalDays, now, deadlineDate) {
  const dates = [];

  // Same-day reminder: escalating frequency based on priority
  if (totalDays === 0) {
    const t = new Date(deadlineDate); // exact reminder time

    if (priority >= 9) {
      // P9-10: 8 nudges — 4h, 2h, 1h, 30m, 15m, 10m, 5m, at time
      dates.push(addMinutes(t, -240));
      dates.push(addMinutes(t, -120));
      dates.push(addMinutes(t, -60));
      dates.push(addMinutes(t, -30));
      dates.push(addMinutes(t, -15));
      dates.push(addMinutes(t, -10));
      dates.push(addMinutes(t, -5));
      dates.push(t);
    } else if (priority >= 7) {
      // P7-8: 5 nudges — 2h, 1h, 30m, 10m, at time
      dates.push(addMinutes(t, -120));
      dates.push(addMinutes(t, -60));
      dates.push(addMinutes(t, -30));
      dates.push(addMinutes(t, -10));
      dates.push(t);
    } else if (priority >= 5) {
      // P5-6: 3 nudges — 1h, 15m, at time
      dates.push(addMinutes(t, -60));
      dates.push(addMinutes(t, -15));
      dates.push(t);
    } else if (priority >= 3) {
      // P3-4: 2 nudges — 30m, at time
      dates.push(addMinutes(t, -30));
      dates.push(t);
    } else {
      // P1-2: just at the time
      dates.push(t);
    }

    const unique = [...new Set(dates.map(d => d.toISOString()))].map(d => new Date(d));
    return unique.filter(d => d > now).sort((a, b) => a - b);
  }

  if (priority >= 9) {
    dates.push(addHours(now, 1));
    if (totalDays > 14) {
      for (let d = 3; d <= totalDays - 14; d += 2) dates.push(addDays(now, d));
    }
    const finalStart = Math.max(totalDays - 14, 1);
    for (let d = finalStart; d <= totalDays; d++) dates.push(addDays(now, d));

  } else if (priority >= 7) {
    if (totalDays >= 1) dates.push(addDays(now, 1));
    if (totalDays >= 4) dates.push(addDays(now, 4));
    if (totalDays > 7) {
      for (let d = 7; d <= totalDays - 7; d += 3) dates.push(addDays(now, d));
    }
    const finalStart = Math.max(totalDays - 7, 2);
    for (let d = finalStart; d <= totalDays; d++) dates.push(addDays(now, d));

  } else if (priority >= 5) {
    if (totalDays >= 14) dates.push(addDays(now, totalDays - 14));
    if (totalDays >= 7) dates.push(addDays(now, totalDays - 7));
    if (totalDays >= 3) dates.push(addDays(now, totalDays - 3));
    if (totalDays >= 1) dates.push(addDays(now, totalDays - 1));
    dates.push(addDays(now, totalDays));

  } else if (priority >= 3) {
    if (totalDays >= 4) dates.push(addDays(now, Math.floor(totalDays / 2)));
    if (totalDays >= 2) dates.push(addDays(now, totalDays - 2));
    dates.push(addDays(now, totalDays));

  } else {
    dates.push(addDays(now, totalDays));
  }

  const unique = [...new Set(dates.map(d => d.toISOString()))].map(d => new Date(d));
  return unique.filter(d => d > now).sort((a, b) => a - b);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

function addHours(date, hours) {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
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
