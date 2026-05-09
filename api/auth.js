// api/auth.js — user creation for passkey auth
// No magic links needed — passkey handles identity on-device

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, action } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  if (action === 'create_user') {
    try {
      // Check if user already exists
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        return res.json({ success: true, user: existing[0] });
      }

      // Create new user
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ name: name || email.split('@')[0], email })
      });

      if (!createRes.ok) throw new Error(await createRes.text());
      const created = await createRes.json();
      return res.json({ success: true, user: Array.isArray(created) ? created[0] : created });

    } catch (e) {
      console.error('Create user error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
