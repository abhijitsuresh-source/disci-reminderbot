// ── CONFIG (replace these with your actual values) ──────────────────────────
const SUPABASE_URL = 'https://qiutfwyrdjyobtuqyblb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpdXRmd3lyZGp5b2J0dXF5YmxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNDExMTgsImV4cCI6MjA5MzcxNzExOH0.AHB6S7M1OukNrkWNW0q6K3_wG2ib7ybfK9gG7Zv5m20';

// ── PRIORITY COLOURS ─────────────────────────────────────────────────────────
const P_COLOR = {
  10:'#ff4747',9:'#ff4747',8:'#ff6b35',7:'#ff6b35',
  6:'#ffb347',5:'#ffb347',4:'#e8ff47',3:'#e8ff47',
  2:'#47ffb2',1:'#47b2ff'
};
const P_LABEL = {
  10:'Absolute Critical',9:'Absolute Critical',8:'Very High',7:'Very High',
  6:'High',5:'High',4:'Medium',3:'Medium',2:'Low',1:'Chill'
};

// ── STATE ────────────────────────────────────────────────────────────────────
let currentUser = null;
let pendingReminder = null; // reminder awaiting confirmation
let mediaRecorder = null;
let isRecording = false;
let audioChunks = [];

// ── SUPABASE ─────────────────────────────────────────────────────────────────
// Always use the session token if available so RLS can identify the user
function getAuthToken() {
  const session = localStorage.getItem('disci_session');
  if (session) {
    try { return JSON.parse(session).access_token; } catch(e) {}
  }
  return SUPABASE_ANON_KEY;
}

async function db(path, opts = {}) {
  const token = getAuthToken();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
      ...opts.headers
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ── TIME HELPERS ──────────────────────────────────────────────────────────────
function timeStr(date) {
  return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function daysLeft(deadline) {
  const d = Math.floor((new Date(deadline) - new Date()) / 86400000);
  if (d < 0) return `${Math.abs(d)} days overdue`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d < 30) return `${d} days left`;
  if (d < 365) return `${Math.floor(d/30)} months left`;
  return `${Math.floor(d/365)} years left`;
}

// ── CHAT RENDERING ────────────────────────────────────────────────────────────
function addMessage(from, content, opts = {}) {
  const area = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = `bubble-row ${from}`;
  if (opts.id) row.id = opts.id;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (typeof content === 'string') {
    bubble.innerHTML = content;
  } else {
    bubble.appendChild(content);
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'bubble-time';
  timeEl.textContent = timeStr(new Date());

  bubble.appendChild(timeEl);
  row.appendChild(bubble);
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
  return row;
}

function showTyping() {
  const area = document.getElementById('chat-area');
  const row = document.createElement('div');
  row.className = 'bubble-row bot';
  row.id = 'typing-indicator';
  row.innerHTML = `<div class="typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function setQuickReplies(replies) {
  const qr = document.getElementById('quick-replies');
  qr.innerHTML = '';
  replies.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'qr-btn';
    btn.textContent = r.label;
    btn.onclick = () => {
      clearQuickReplies();
      if (r.action) r.action();
      else handleUserMessage(r.label);
    };
    qr.appendChild(btn);
  });
}

function clearQuickReplies() {
  document.getElementById('quick-replies').innerHTML = '';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── ONBOARDING + PASSKEY AUTH ────────────────────────────────────────────────

// Helper: encode ArrayBuffer to base64url
function bufToBase64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Helper: decode base64url to Uint8Array
function base64urlToBuf(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

// Step 1: Collect name + email, then show passkey UI
async function handleOnboard() {
  const name = document.getElementById('ob-name').value.trim();
  const email = document.getElementById('ob-email').value.trim().toLowerCase();
  if (!name) { showToast('Please enter your name'); return; }
  if (!email) { showToast('Please enter your email'); return; }
  if (!/\S+@\S+\.\S+/.test(email)) { showToast('Please enter a valid email'); return; }

  localStorage.setItem('disci_pending_name', name);
  localStorage.setItem('disci_pending_email', email);

  // Check if user already has a passkey stored (returning user)
  const stored = localStorage.getItem('disci_passkey_id_' + email);

  document.getElementById('ob-step-1').style.display = 'none';
  document.getElementById('ob-step-2').style.display = 'block';

  if (stored) {
    // Returning user — show sign in button
    document.getElementById('ob-icon').textContent = '👋';
    document.getElementById('ob-step2-title').textContent = `Welcome back, ${name}`;
    document.getElementById('ob-step2-sub').textContent = 'Use your passkey to sign in.';
    document.getElementById('ob-passkey-btn').style.display = 'none';
    document.getElementById('ob-passkey-login-btn').style.display = 'block';
  }
}

// Step 2a: Register a new passkey (new user)
async function handlePasskeyRegister() {
  const name = localStorage.getItem('disci_pending_name');
  const email = localStorage.getItem('disci_pending_email');
  const btn = document.getElementById('ob-passkey-btn');
  btn.textContent = 'Waiting for biometric...';
  btn.disabled = true;

  try {
    // Generate challenge locally (no server needed)
    const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
    const userIdBytes = new TextEncoder().encode(email);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challengeBytes,
        rp: { name: 'Disci', id: window.location.hostname },
        user: {
          id: userIdBytes,
          name: email,
          displayName: name
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // device biometric only
          userVerification: 'required',
          residentKey: 'required'
        },
        timeout: 60000
      }
    });

    // Store credential ID so we can use it for future logins
    const credId = bufToBase64url(credential.rawId);
    localStorage.setItem('disci_passkey_id_' + email, credId);

    // Create/load user in our DB
    await createOrLoadUser(name, email);
    document.getElementById('screen-onboard').classList.add('hidden');
    startChat();

  } catch (e) {
    console.error('Passkey register error:', e);
    if (e.name === 'NotAllowedError') {
      showToast('Biometric cancelled. Try again.');
    } else if (e.name === 'NotSupportedError') {
      showToast('Passkeys not supported on this device/browser.');
    } else {
      showToast('Could not set up passkey. Try again.');
    }
    btn.textContent = '🔐 Set up passkey';
    btn.disabled = false;
  }
}

// Step 2b: Sign in with existing passkey (returning user)
async function handlePasskeyLogin() {
  const email = localStorage.getItem('disci_pending_email');
  const name = localStorage.getItem('disci_pending_name');
  const btn = document.getElementById('ob-passkey-login-btn');
  btn.textContent = 'Waiting for biometric...';
  btn.disabled = true;

  try {
    const challengeBytes = crypto.getRandomValues(new Uint8Array(32));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBytes,
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60000
      }
    });

    // Biometric passed — load user
    await createOrLoadUser(name, email);
    document.getElementById('screen-onboard').classList.add('hidden');
    startChat();

  } catch (e) {
    console.error('Passkey login error:', e);
    if (e.name === 'NotAllowedError') {
      showToast('Biometric cancelled. Try again.');
    } else {
      showToast('Sign in failed. Try again.');
    }
    btn.textContent = 'Sign in with passkey';
    btn.disabled = false;
  }
}

// Create or load user from Supabase (using service key since no session yet)
async function createOrLoadUser(name, email) {
  // Check localStorage — but skip if it's a local-only (non-DB) user
  const cached = localStorage.getItem('disci_user');
  if (cached) {
    const parsed = JSON.parse(cached);
    if (!parsed.local) {
      currentUser = parsed;
      return;
    }
    // local user — try to upgrade to a real DB user
    console.log('[createOrLoadUser] local user found, attempting DB sync');
  }

  try {
    // Try to find existing user in DB
    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`DB lookup failed: ${res.status}`);
    const existing = await res.json();
    console.log('[createOrLoadUser] DB lookup result:', existing);

    if (existing && existing.length > 0) {
      currentUser = existing[0];
    } else {
      // Create new user via service key API route
      const createRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, action: 'create_user' })
      });
      const data = await createRes.json();
      console.log('[createOrLoadUser] create user result:', data);
      if (!data.user) throw new Error('User creation returned no user');
      currentUser = data.user;
    }

    localStorage.setItem('disci_user', JSON.stringify(currentUser));
    localStorage.removeItem('disci_pending_name');
    localStorage.removeItem('disci_pending_email');
    console.log('[createOrLoadUser] user set:', currentUser);

  } catch(e) {
    console.error('[createOrLoadUser] error:', e);
    // Only fall back to local if we have no other option
    // local users can still use the app but reminders won't persist
    if (!currentUser || currentUser.local) {
      currentUser = { id: crypto.randomUUID(), name, email, local: true };
      localStorage.setItem('disci_user', JSON.stringify(currentUser));
      console.warn('[createOrLoadUser] falling back to local user — reminders will not persist');
    }
  }
}

// Handle magic link callback — Supabase puts token in URL hash
async function handleAuthCallback() {
  const hash = window.location.hash;
  if (!hash.includes('access_token')) return false;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) return false;

  try {
    // Save session so all subsequent db() calls use it for RLS
    localStorage.setItem('disci_session', JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken
    }));

    // Get user info from Supabase using the access token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const authUser = await userRes.json();
    if (!authUser.email) return false;

    // Get or create user in our users table
    // Use accessToken directly here so RLS allows the insert
    const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(authUser.email)}&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      // Update auth_id if missing (for existing users before this fix)
      if (!existing[0].auth_id) {
        await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ auth_id: authUser.id })
        });
      }
      currentUser = { ...existing[0], auth_id: authUser.id };
    } else {
      const name = localStorage.getItem('disci_pending_name') || authUser.email.split('@')[0];
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ name, email: authUser.email, auth_id: authUser.id })
      });
      const created = await createRes.json();
      currentUser = Array.isArray(created) ? created[0] : created;
    }

    localStorage.setItem('disci_user', JSON.stringify(currentUser));
    localStorage.removeItem('disci_pending_name');
    localStorage.removeItem('disci_pending_email');

    // Clean URL
    window.history.replaceState(null, '', '/');
    return true;
  } catch(e) {
    console.error('Auth callback error:', e);
    return false;
  }
}

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Always request permission — if already granted it returns immediately
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      botSay("⚠️ Notifications are off. You won't receive reminders without them. Enable them in your phone settings → Chrome → Notifications.");
      return;
    }

    const VAPID_PUBLIC_KEY = 'BBHQv_asX5iHEmrf_nLVwgXVwQuWNz94UPNl4hsKRHe4cTxYIfhcyDNg_BrzD-IjdmSb3Q-LSK8fBWn2UoGeeso';

    // Always get a fresh subscription
    let sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe(); // clear old one
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY)
    });

    // Save to Supabase — delete old ones first then insert fresh
    await db(`push_subscriptions?user_id=eq.${currentUser.id}`, {
      method: 'DELETE',
      prefer: 'return=minimal'
    });
    await db('push_subscriptions', {
      method: 'POST',
      body: { user_id: currentUser.id, subscription: sub.toJSON() }
    });

    console.log('Push registered successfully');
  } catch(e) { console.log('Push setup failed:', e); }
}

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g,'+').replace(/_/g,'/');
  return new Uint8Array([...atob(base64)].map(c => c.charCodeAt(0)));
}

// ── CHAT START ────────────────────────────────────────────────────────────────
function startChat() {
  const isNew = !localStorage.getItem('disci_chatted');
  const notifGranted = localStorage.getItem('disci_notif_granted');
  const greeting = isNew
    ? `Hey ${currentUser.name} 👋 I'm Disci. Tell me what you need to remember — just type it like you'd text a friend. Or send a voice note. Or a photo of something.\n\nI'll handle the rest.`
    : `Welcome back ${currentUser.name} 👋`;
  if (isNew) localStorage.setItem('disci_chatted', '1');

  setTimeout(async () => {
    await botSay(greeting);

    // Ask for notification permission via a tap — browsers block auto-prompts
    if (!notifGranted && Notification.permission !== 'granted') {
      await botSay(`🔔 One thing — I need permission to send you reminders. Without it I can\'t nudge you when it matters.`);
      setQuickReplies([
        {
          label: '🔔 Enable notifications',
          action: async () => {
            clearQuickReplies();
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
              localStorage.setItem('disci_notif_granted', '1');
              await registerPush();
              await botSay('✅ Notifications on. I\'ve got you covered.');
            } else {
              await botSay('⚠️ Notifications blocked. You can enable them in Settings → Chrome → Notifications anytime.');
            }
            setQuickReplies([
              { label: '📝 Add a reminder' },
              { label: '📋 Show my reminders' },
              { label: '❓ How does this work?' }
            ]);
          }
        },
        {
          label: 'Maybe later',
          action: async () => {
            clearQuickReplies();
            await botSay('No worries — you can enable them in Settings → Chrome → Notifications when ready.');
            setQuickReplies([
              { label: '📝 Add a reminder' },
              { label: '📋 Show my reminders' },
              { label: '❓ How does this work?' }
            ]);
          }
        }
      ]);
    } else {
      // Already granted — register push silently and go straight to menu
      if (Notification.permission === 'granted') registerPush();
      setQuickReplies([
        { label: '📝 Add a reminder' },
        { label: '📋 Show my reminders' },
        { label: '❓ How does this work?' }
      ]);
    }
  }, 400);
}

// ── BOT REPLY ─────────────────────────────────────────────────────────────────
function botSay(text, delay = 600) {
  return new Promise(resolve => {
    showTyping();
    setTimeout(() => {
      removeTyping();
      addMessage('bot', text.replace(/\n/g, '<br/>'));
      resolve();
    }, delay);
  });
}

// ── HANDLE USER MESSAGE ───────────────────────────────────────────────────────
async function handleUserMessage(text, imageData = null) {
  if (!text && !imageData) return;
  clearQuickReplies();

  // Show user bubble
  if (imageData) {
    const img = document.createElement('img');
    img.src = imageData;
    const wrap = document.createElement('div');
    wrap.appendChild(img);
    if (text) { const t = document.createElement('div'); t.textContent = text; wrap.appendChild(t); }
    addMessage('user', wrap);
  } else {
    addMessage('user', text);
  }

  document.getElementById('msg-input').value = '';
  autoResize();

  const lower = text ? text.toLowerCase().trim() : '';

  // ── INTENT DETECTION ──
  if (lower.includes('show') && (lower.includes('reminder') || lower.includes('task'))) {
    return handleShowReminders();
  }
  const confirmWords = ['yes','confirm','looks good','yep','yeah','yup','ok','okay','sure','works','perfect','great','sounds good','do it','save it','correct','right','go ahead','absolutely','cool','k'];
  if (confirmWords.some(w => lower === w || lower === w + '.' || lower === w + '!')) {
    return handleConfirm();
  }
  if (lower.startsWith('priority') || lower.match(/^change.*to\s+\d/) || lower.match(/^set.*\d$/) || lower.match(/^p\d$/)) {
    return handlePriorityChange(lower);
  }
  if (lower.includes("don't remind") || lower.includes("dont remind") || lower.includes("stop reminding") || lower.includes("stop reminder")) {
    showTyping();
    const reminders = await db(`reminders?user_id=eq.${currentUser.id}&completed=eq.false&order=deadline.asc`) || [];
    removeTyping();
    if (reminders.length === 0) return botSay("No active reminders to stop.");
    if (reminders.length === 1) {
      await handleStopReminder(reminders[0].id);
      return;
    }
    await botSay("Which reminder should I stop nudging you about?");
    setQuickReplies(reminders.map((r, i) => ({
      label: `${i+1}. ${r.title.slice(0,30)}`,
      action: () => handleStopReminder(r.id)
    })));
    return;
  }

  if (lower.includes('done') || lower.includes('complete') || lower.includes('finished') || lower === '✅ mark as done') {
    return handleMarkDone(lower);
  }
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('cancel')) {
    return handleDelete(lower);
  }
  if (lower === 'how does this work?' || lower.includes('how') && lower.includes('work')) {
    return handleHelp();
  }
  if (lower === '📝 add a reminder' || lower === 'add a reminder') {
    return botSay("Sure — just tell me what you need to remember. Mention the deadline and I'll figure out the rest. e.g. 'Renew car insurance before June 15' or 'Save ₹20k by end of year'");
  }

  // ── DEFAULT: treat as new reminder ──
  return handleNewReminder(text, imageData);
}

// ── NEW REMINDER FLOW ─────────────────────────────────────────────────────────
async function handleNewReminder(text, imageData = null) {
  showTyping();
  document.getElementById('header-status').textContent = 'thinking...';

  try {
    const payload = { action: 'parse_reminder', text, imageData };
    const res = await fetch('/api/groq', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Log raw response for debugging
    const rawText = await res.text();
    console.log('[Groq raw response]', rawText);

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch(parseErr) {
      console.error('[Groq JSON parse error]', parseErr, rawText);
      removeTyping();
      document.getElementById('header-status').textContent = 'online';
      await botSay("My brain glitched parsing that. Try again in a second.");
      return;
    }

    removeTyping();
    document.getElementById('header-status').textContent = 'online';

    // If Groq returned an error object
    if (parsed.error) {
      console.error('[Groq API error]', parsed.error);
      await botSay("I hit an error processing that. Try again.");
      return;
    }

    // If the model wasn't confident this is a real reminder request, don't hallucinate one
    if (parsed.confident === false) {
      await botSay("I'm not sure what you'd like me to remind you about. Try something like:\n\n<i>\"Remind me to take medicine at 4pm\"</i>\nor\n<i>\"Exam on June 20th\"</i>");
      return;
    }

    // If deadline is null but title is there, use 7 days from now as fallback
    if (!parsed.deadline && parsed.title) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() + 7);
      parsed.deadline = fallback.toISOString();
      parsed.notif_count = parsed.notif_count || 3;
      parsed.priority = parsed.priority || 5;
      parsed.priority_reason = parsed.priority_reason || "I set a default deadline of 7 days — let me know if you want to change it.";
    }

    if (!parsed.title) {
      await botSay("Hmm, I couldn't figure out the task or deadline from that. Try something like:\n\n<i>\"Remind me to pay rent by the 5th of every month\"</i>\nor\n<i>\"Get the car serviced before December\"</i>");
      return;
    }

    pendingReminder = parsed;

    const color = P_COLOR[parsed.priority];
    const label = P_LABEL[parsed.priority];
    const deadlineFormatted = new Date(parsed.deadline).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

    await botSay(
      `Got it. Here's what I've set up:\n\n` +
      `<div class="reminder-card-bubble">` +
      `<div class="rcb-title">${parsed.title}</div>` +
      `<div class="rcb-meta">` +
      `<span>📅 ${deadlineFormatted}</span>` +
      `<span>🎯 Priority <span class="p-chip" style="background:${color}">${parsed.priority} — ${label}</span></span>` +
      `<span>🔔 ${parsed.notif_count} nudges scheduled</span>` +
      `</div></div>\n\n` +
      `${parsed.priority_reason}\n\nDoes that look right?`
    );

    setQuickReplies([
      { label: '✅ Yes, save it', action: handleConfirm },
      { label: '🔺 Higher priority', action: () => handlePriorityChange('higher') },
      { label: '🔻 Lower priority', action: () => handlePriorityChange('lower') },
      { label: '❌ Cancel', action: () => { pendingReminder = null; botSay("No problem, cancelled. What else?"); } }
    ]);

  } catch(e) {
    removeTyping();
    document.getElementById('header-status').textContent = 'online';
    console.error(e);
    await botSay("Something went wrong on my end. Try again in a sec.");
  }
}

// ── CONFIRM SAVE ──────────────────────────────────────────────────────────────
async function handleConfirm() {
  if (!pendingReminder) {
    return botSay("Nothing pending to confirm. Want to add a new reminder?");
  }

  // If still a local user, try to sync to DB before saving
  if (currentUser.local) {
    console.warn('[handleConfirm] user is local, attempting DB sync before save');
    await createOrLoadUser(currentUser.name, currentUser.email);
    if (currentUser.local) {
      await botSay("⚠️ I couldn't connect to save your reminder right now. Check your connection and try again.");
      return;
    }
  }

  clearQuickReplies();
  showTyping();

  try {
    const res = await fetch('/api/create-reminder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        title: pendingReminder.title,
        priority: pendingReminder.priority,
        deadline: pendingReminder.deadline,
        input_type: 'text'
      })
    });
    const data = await res.json();
    removeTyping();

    if (!data.success) throw new Error(data.error);

    pendingReminder = null;
    await botSay(`Done ✅ Saved. I've scheduled ${data.notifications_scheduled} nudges leading up to the deadline.\n\nYou can lie to me — but you already know what this one means.`);
    setQuickReplies([
      { label: '📝 Add another' },
      { label: '📋 Show my reminders' },
        { label: '❓ How does this work?' }
    ]);
  } catch(e) {
    removeTyping();
    console.error(e);
    await botSay("Couldn't save that. Try again?");
  }
}

// ── PRIORITY CHANGE ───────────────────────────────────────────────────────────
async function handlePriorityChange(input) {
  if (!pendingReminder) return botSay("No reminder pending. Add one first.");

  let newP = pendingReminder.priority;
  if (input === 'higher' || input === '🔺 higher priority') newP = Math.min(10, newP + 1);
  else if (input === 'lower' || input === '🔻 lower priority') newP = Math.max(1, newP - 1);
  else {
    const match = input.match(/\d+/);
    if (match) newP = Math.max(1, Math.min(10, parseInt(match[0])));
  }

  pendingReminder.priority = newP;
  const color = P_COLOR[newP];
  const label = P_LABEL[newP];

  await botSay(`Updated to <span class="p-chip" style="background:${color};color:#000">${newP} — ${label}</span>. Want to save it now?`);
  setQuickReplies([
    { label: '✅ Yes, save it', action: handleConfirm },
    { label: '🔺 Higher priority', action: () => handlePriorityChange('higher') },
    { label: '🔻 Lower priority', action: () => handlePriorityChange('lower') }
  ]);
}

// ── SHOW REMINDERS ────────────────────────────────────────────────────────────
async function handleShowReminders() {
  showTyping();
  try {
    const reminders = await db(`reminders?user_id=eq.${currentUser.id}&completed=eq.false&order=deadline.asc`) || [];
    removeTyping();

    if (reminders.length === 0) {
      await botSay("You have no active reminders right now. Want to add one?");
      setQuickReplies([{ label: '📝 Add a reminder' }]);
      return;
    }

    const list = reminders.map((r, i) => {
      const color = P_COLOR[r.priority];
      return `${i+1}. <strong>${r.title}</strong>\n   <span class="p-chip" style="background:${color};color:#000">P${r.priority}</span> · ${daysLeft(r.deadline)}`;
    }).join('\n\n');

    await botSay(`Here are your ${reminders.length} active reminder${reminders.length > 1 ? 's' : ''}:\n\n${list}`);
    setQuickReplies([
      { label: '✅ Mark one as done' },
      { label: '📝 Add another' }
    ]);
  } catch(e) {
    removeTyping();
    await botSay("Couldn't fetch your reminders. Try again.");
  }
}

// ── MARK DONE ─────────────────────────────────────────────────────────────────
async function handleMarkDone(input) {
  showTyping();
  try {
    const reminders = await db(`reminders?user_id=eq.${currentUser.id}&completed=eq.false&order=deadline.asc`) || [];
    removeTyping();

    if (reminders.length === 0) {
      return botSay("No active reminders to mark done.");
    }
    if (reminders.length === 1) {
      await db(`reminders?id=eq.${reminders[0].id}`, {
        method: 'PATCH', body: { completed: true, completed_at: new Date().toISOString() }
      });
      return botSay(`✅ Marked "${reminders[0].title}" as done. That's what I'm talking about.`);
    }

    const list = reminders.map((r, i) => `${i+1}. ${r.title}`).join('\n');
    await botSay(`Which one did you complete?\n\n${list}\n\nReply with the number.`);
    setQuickReplies(reminders.map((r, i) => ({
      label: `${i+1}. ${r.title.slice(0,30)}`,
      action: async () => {
        await db(`reminders?id=eq.${r.id}`, {
          method: 'PATCH', body: { completed: true, completed_at: new Date().toISOString() }
        });
        botSay(`✅ Done. "${r.title}" crossed off. Well played.`);
      }
    })));
  } catch(e) {
    removeTyping();
    await botSay("Couldn't update that. Try again.");
  }
}

// ── STOP REMINDERS ───────────────────────────────────────────────────────────
async function handleStopReminder(reminderId) {
  try {
    // Cancel all future unsent notifications for this reminder
    await db(`scheduled_notifications?reminder_id=eq.${reminderId}&sent=eq.false`, {
      method: 'PATCH',
      body: { sent: true, sent_at: new Date().toISOString(), message: 'Cancelled by user' }
    });
    await botSay("Got it — I'll stop nudging you about that one.");
  } catch(e) {
    console.error('Stop reminder error:', e);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
async function handleDelete(input) {
  showTyping();
  try {
    const reminders = await db(`reminders?user_id=eq.${currentUser.id}&completed=eq.false&order=deadline.asc`) || [];
    removeTyping();
    if (reminders.length === 0) return botSay("Nothing to delete.");

    const list = reminders.map((r, i) => `${i+1}. ${r.title}`).join('\n');
    await botSay(`Which reminder do you want to delete?\n\n${list}`);
    setQuickReplies(reminders.map((r, i) => ({
      label: `${i+1}. ${r.title.slice(0,30)}`,
      action: async () => {
        await db(`reminders?id=eq.${r.id}`, { method: 'DELETE', prefer: 'return=minimal' });
        botSay(`Deleted "${r.title}". Gone.`);
      }
    })));
  } catch(e) {
    removeTyping();
    await botSay("Couldn't delete that. Try again.");
  }
}

// ── HELP ──────────────────────────────────────────────────────────────────────
async function handleHelp() {
  await botSay(
    `Here's how I work:\n\n` +
    `<strong>Adding reminders</strong>\nJust type naturally:\n"Pay rent by 5th June"\n"Save ₹50k by end of year"\nOr send a voice note or photo 📷\n\n` +
    `<strong>Priority scale</strong>\n1 = totally chill\n10 = this defines your life\nI'll suggest one — you can change it.\n\n` +
    `<strong>Nudges</strong>\nI'll message you before deadlines — how often depends on priority. A P10 gets daily nudges. A P2 gets one gentle reminder.\n\n` +
    `<strong>Commands you can type</strong>\n"show my reminders"\n"mark [task] as done"\n"delete [task]"`
  );
}

// ── VOICE INPUT ───────────────────────────────────────────────────────────────
async function toggleRecording() {
  const btn = document.getElementById('mic-btn');

  // If already recording, stop it
  if (isRecording) {
    if (mediaRecorder) mediaRecorder.stop();
    isRecording = false;
    btn.classList.remove('recording');
    btn.textContent = '🎤';
    return;
  }

  // Check if SpeechRecognition is supported
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Voice not supported on this browser. Try Chrome.');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.lang = 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    btn.classList.add('recording');
    btn.textContent = '⏹';
    mediaRecorder = recognition; // store ref so stop button works
  };

  recognition.onresult = e => {
    const transcript = e.results[0][0].transcript;
    isRecording = false;
    btn.classList.remove('recording');
    btn.textContent = '🎤';
    addMessage('user', `🎤 "${transcript}"`);
    handleNewReminder(transcript);
  };

  recognition.onerror = e => {
    isRecording = false;
    btn.classList.remove('recording');
    btn.textContent = '🎤';
    if (e.error === 'not-allowed') {
      showToast('Microphone access denied');
    } else {
      botSay("Couldn't catch that. Could you type it out?");
    }
  };

  recognition.onend = () => {
    isRecording = false;
    btn.classList.remove('recording');
    btn.textContent = '🎤';
  };

  recognition.start();
}

// ── PHOTO INPUT ───────────────────────────────────────────────────────────────
async function handlePhoto(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const imageData = e.target.result;
    await handleUserMessage('📷 Photo sent', imageData);
  };
  reader.readAsDataURL(file);
}

// ── INPUT BAR LOGIC ───────────────────────────────────────────────────────────
function autoResize() {
  const ta = document.getElementById('msg-input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  const sendBtn = document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');
  if (ta.value.trim().length > 0) {
    sendBtn.classList.add('visible');
    micBtn.style.display = 'none';
  } else {
    sendBtn.classList.remove('visible');
    micBtn.style.display = 'flex';
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────────
function init() {
  // Check if user is already logged in via passkey (saved in localStorage)
  const saved = localStorage.getItem('disci_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    document.getElementById('screen-onboard').classList.add('hidden');
    startChat();
  }

  // PWA install prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(() => {
      if (currentUser && deferredPrompt) {
        botSay('💡 Tip: Install Disci on your home screen for the full app experience. Tap the share button in your browser → "Add to Home Screen".');
        deferredPrompt = null;
      }
    }, 30000);
  });

  // Onboarding — button handlers set inline in HTML, but also wire keyboard
  document.getElementById('ob-name').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('ob-email').focus(); });
  document.getElementById('ob-email').addEventListener('keydown', e => { if(e.key==='Enter') handleOnboard(); });

  // Input
  const input = document.getElementById('msg-input');
  input.addEventListener('input', autoResize);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (text) handleUserMessage(text);
    }
  });

  // Send button
  document.getElementById('send-btn').addEventListener('click', () => {
    const text = document.getElementById('msg-input').value.trim();
    if (text) handleUserMessage(text);
  });

  // Mic
  document.getElementById('mic-btn').addEventListener('click', toggleRecording);

  // Attach / photo
  document.getElementById('attach-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handlePhoto(file);
    e.target.value = '';
  });
}

window.addEventListener('DOMContentLoaded', init);
