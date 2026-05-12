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
          notification_number: idx + 1,
          total_notifications: schedule.length,
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

  // ── ALWAYS: 5-minute-before notification for ALL priorities ──────────────
  const fiveMinBefore = addMinutes(deadlineDate, -5);

  // ── SAME-DAY: spacing based on minutes available until event ─────────────
  const minutesUntilEvent = Math.floor((deadlineDate - now) / 60000);

  if (totalDays === 0) {
    const t = new Date(deadlineDate);

    if (priority >= 9) {
      // P9-10: up to 8 nudges, scaled to available time
      if (minutesUntilEvent >= 240) dates.push(addMinutes(t, -240));
      if (minutesUntilEvent >= 120) dates.push(addMinutes(t, -120));
      if (minutesUntilEvent >= 60)  dates.push(addMinutes(t, -60));
      if (minutesUntilEvent >= 30)  dates.push(addMinutes(t, -30));
      if (minutesUntilEvent >= 15)  dates.push(addMinutes(t, -15));
      if (minutesUntilEvent >= 10)  dates.push(addMinutes(t, -10));
    } else if (priority >= 7) {
      // P7-8: up to 4 nudges
      if (minutesUntilEvent >= 120) dates.push(addMinutes(t, -120));
      if (minutesUntilEvent >= 60)  dates.push(addMinutes(t, -60));
      if (minutesUntilEvent >= 30)  dates.push(addMinutes(t, -30));
    } else if (priority >= 5) {
      // P5-6: up to 2 nudges
      if (minutesUntilEvent >= 60)  dates.push(addMinutes(t, -60));
      if (minutesUntilEvent >= 15)  dates.push(addMinutes(t, -15));
    } else if (priority >= 3) {
      // P3-4: 1 nudge
      if (minutesUntilEvent >= 30)  dates.push(addMinutes(t, -30));
    }
    // P1-2: only the 5-min + at-time nudge (added below)

    // Always add 5-min-before and at-time
    dates.push(fiveMinBefore);
    dates.push(t);

    const unique = [...new Set(dates.map(d => d.toISOString()))].map(d => new Date(d));
    return unique.filter(d => d > now).sort((a, b) => a - b);
  }

  // ── MULTI-DAY: spacing proportional to gap ────────────────────────────────
  if (priority >= 9) {
    dates.push(addHours(now, 1));
    if (totalDays > 14) {
      // Space every-2-days nudges evenly across the non-final window
      for (let d = 2; d <= totalDays - 14; d += 2) dates.push(addDays(now, d));
    }
    const finalStart = Math.max(totalDays - 14, 1);
    for (let d = finalStart; d <= totalDays; d++) dates.push(addDays(now, d));

  } else if (priority >= 7) {
    if (totalDays >= 1) dates.push(addDays(now, 1));
    if (totalDays > 7) {
      // Space bi-weekly nudges evenly across mid window
      const midWindow = totalDays - 7;
      const step = Math.max(3, Math.floor(midWindow / 4));
      for (let d = Math.ceil(midWindow / 4); d <= midWindow; d += step) dates.push(addDays(now, d));
    }
    const finalStart = Math.max(totalDays - 7, 2);
    for (let d = finalStart; d <= totalDays; d++) dates.push(addDays(now, d));

  } else if (priority >= 5) {
    // 4-5 total, evenly spaced across the full window
    const slots = [
      totalDays >= 14 ? totalDays - 14 : null,
      totalDays >= 7  ? totalDays - 7  : null,
      totalDays >= 3  ? totalDays - 3  : null,
      totalDays >= 1  ? totalDays - 1  : null,
      totalDays
    ];
    slots.forEach(d => d !== null && dates.push(addDays(now, d)));

  } else if (priority >= 3) {
    // 2-3 total
    if (totalDays >= 4) dates.push(addDays(now, Math.floor(totalDays / 2)));
    if (totalDays >= 2) dates.push(addDays(now, totalDays - 1));
    dates.push(addDays(now, totalDays));

  } else {
    // P1-2: single reminder on the day
    dates.push(addDays(now, totalDays));
  }

  // Always add 5-minute-before notification for multi-day reminders too
  if (fiveMinBefore > now) dates.push(fiveMinBefore);

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
