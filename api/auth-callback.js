// api/auth/callback.js
// Supabase redirects here after magic link is clicked
// Exchanges the token for a session and redirects to the app

export default async function handler(req, res) {
  // Redirect to app — the token is in the URL hash, handled client-side
  res.redirect(302, '/?auth=callback');
}
