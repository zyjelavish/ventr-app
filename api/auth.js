const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const SECRET = process.env.VENTR_PASSWORD;
  if (!SECRET) return res.status(500).json({ error: 'Server niet geconfigureerd' });

  const { password, token } = req.body || {};

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (password !== undefined) {
    if (password !== SECRET) return res.status(401).json({ ok: false });
    const ts  = Date.now();
    const sig = crypto.createHmac('sha256', SECRET).update(String(ts)).digest('hex');
    const tok = Buffer.from(`${ts}:${sig}`).toString('base64url');
    return res.json({ ok: true, token: tok });
  }

  // ── VERIFY TOKEN ───────────────────────────────────────────────────────────
  if (token !== undefined) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString();
      const [ts, sig] = decoded.split(':');
      const expected = crypto.createHmac('sha256', SECRET).update(ts).digest('hex');
      const age = Date.now() - parseInt(ts);
      const valid = sig === expected && age < 30 * 24 * 60 * 60 * 1000; // 30 dagen
      return res.json({ ok: valid });
    } catch {
      return res.json({ ok: false });
    }
  }

  return res.status(400).json({ error: 'Ongeldig verzoek' });
};
