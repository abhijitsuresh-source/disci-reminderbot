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
- CRITICAL: Only return {"confident": false} if the input has NO time or deadline whatsoever, or is clearly unrelated chat (e.g. "hello", "how are you", "what is 2+2"). 
- If the input has a time/date but no task (e.g. "remind me at 7pm", "set a reminder for 4pm today"), set the title to "Reminder" — do not invent a task.
- If the input has both a task and a time, extract both as normal
- Extract the date and time verbatim from what the user said.
- Extract the task title verbatim from what the user said (max 80 chars). Do NOT invent or infer a task the user did not mention. If they said "take medicine", the title is "Take medicine". Do NOT change it to "Doctor appointment" or anything else.
- Parse the deadline as an ISO date. If no year given, assume current year. If the date has already passed this year, use next year. If "end of year" use Dec 31. If month only use last day of that month. Always return a full ISO datetime string.
- Priority is STRICTLY determined by category — do not vary it:
    * Medicine / health / medical appointments = 8
    * Exams / legal deadlines / financial deadlines = 9
    * Work meetings / professional tasks = 6
    * Personal errands / chores = 4
    * Optional / low-stakes = 2
  Use exactly these values. Do not adjust based on phrasing or wording.
- Write a short priority_reason (1 sentence, conversational tone). If the title is generic (no specific task mentioned), set priority_reason to "I set a default priority — let me know if you'd like to change it." Do NOT invent a category.
- If you cannot determine a deadline at all, return deadline as null
- If the input is not a reminder request (greeting, question, random text), return {"confident": false}

Respond ONLY with valid JSON, no markdown:
{
  "confident": true,
  "title": "task title",
  "deadline": "ISO date string or null",
  "priority": 7,
  "priority_reason": "I set a default priority — let me know if you'd like to change it."
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
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 400 })
  });
  if (!r.ok) throw new Error(`Groq ${r.status}`);
  return r.json();
}
