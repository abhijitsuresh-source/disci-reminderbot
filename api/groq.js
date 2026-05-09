const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.1-8b-instant';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { action, text, imageData, reminder, context } = req.body;

  try {
    if (action === 'parse_reminder') return res.json(await parseReminder(text));
    if (action === 'generate_nudge') return res.json(await generateNudge(reminder, context));
    if (action === 'generate_report') return res.json(await generateReport(context));
    return res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

async function parseReminder(text) {
  const now = new Date();
  const prompt = `You are Disci, a reminder assistant. Parse this reminder request and return structured data.

TODAY: ${now.toISOString()}
USER INPUT: "${text}"

Rules:
- Extract the task title (concise, max 80 chars). If the user says "I have an exam", the title is "Exam". If they say "meeting with John", the title is "Meeting with John". Always infer a clear action-oriented title even if not explicitly stated.
- Parse the deadline as an ISO date. If no year given, assume current year. If the date has already passed this year, use next year. If "end of year" use Dec 31. If month only use last day of that month. Always return a full ISO datetime string.
- Assign priority 1-10 based on: exams/health/legal/financial = 7-10, professional tasks = 5-6, personal errands = 3-4, optional = 1-2
- Calculate how many notifications will be sent based on priority and days until deadline: priority 9-10 = every 2 days + daily last 14 days, priority 7-8 = twice a week + daily last 7 days, priority 5-6 = 4-5 total, priority 3-4 = 2-3 total, priority 1-2 = 1 total
- Write a short priority_reason (1 sentence, conversational tone)
- If you cannot determine a deadline at all, return deadline as null

Respond ONLY with valid JSON, no markdown:
{
  "title": "task title",
  "deadline": "ISO date string or null",
  "priority": 7,
  "notif_count": 12,
  "priority_reason": "I'm rating this a 7 — exams are high stakes."
}`;

  const data = await groq(prompt);
  return extractJSON(data.choices[0].message.content);
}

async function generateNudge(reminder, context) {
  const { title, priority, deadline, daysLeft, notifNum, totalNotifs } = reminder;
  const { userName } = context;
  const phase = daysLeft <= 1 ? 'final' : daysLeft <= 7 ? 'closing' : daysLeft <= 30 ? 'mid' : 'early';
  const tone = priority >= 9 ? 'intense and direct, no jokes'
    : priority >= 7 ? 'firm and honest like a trusted friend'
    : priority >= 5 ? 'clear and encouraging'
    : priority >= 3 ? 'chill and friendly, light emoji ok'
    : 'super relaxed, zero pressure';

  const prompt = `You are Disci, a reminder bot. Write a push notification for a reminder.

USER: ${userName}
TASK: "${title}"
PRIORITY: ${priority}/10
DAYS LEFT: ${daysLeft}
PHASE: ${phase} (nudge ${notifNum} of ${totalNotifs})
TONE: ${tone}

Rules:
- Max 2 sentences
- Reference the actual task, not generic "don't forget"
- Priority 7+ mid/final phase: occasionally use "You can lie to me — but can you lie to yourself?"
- Never start with "Hey" or "Hi"

Respond ONLY with valid JSON:
{"title": "max 6 word title", "body": "nudge message"}`;

  const data = await groq(prompt);
  return extractJSON(data.choices[0].message.content);
}

async function generateReport(context) {
  const { userName, month, completionRate, total, completed, missed, topMissed, topCompleted } = context;
  const prompt = `Write a 3-4 sentence monthly reminder report for ${userName}.
Month: ${month}, Completion: ${completionRate}%, Total: ${total}, Done: ${completed}, Missed: ${missed}.
Top missed: ${topMissed || 'none'}. Top completed: ${topCompleted || 'none'}.
Be honest. Use "You can lie to me, but can you lie to yourself?" if rate < 50%.
Respond ONLY with valid JSON: {"narrative": "..."}`;

  const data = await groq(prompt);
  return extractJSON(data.choices[0].message.content);
}


// Robustly extract JSON from model output regardless of markdown wrapping
function extractJSON(raw) {
  let text = raw.trim();
  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  // Find the first { and last } to extract just the JSON object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in response');
  text = text.slice(start, end + 1);
  return JSON.parse(text);
}

async function groq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 400 })
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  return r.json();
}
