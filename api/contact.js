/**
 * POST /api/contact
 * Delivers contact-form submissions to the site owner's inbox via Resend.
 *
 * Required Vercel environment variables:
 *   RESEND_API_KEY    - API key from https://resend.com
 *   CONTACT_TO_EMAIL  - the Gmail/inbox address that receives messages
 *
 * Note: with the free Resend plan and no verified domain, emails are sent
 * from "onboarding@resend.dev" and can only be delivered to the email
 * address registered on the Resend account. Verify a domain to send from
 * your own address (then update CONTACT_FROM_EMAIL).
 */

const esc = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'missing-fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    return res.status(400).json({ error: 'invalid-email' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  if (!apiKey || !to) {
    return res.status(503).json({ error: 'not-configured' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || 'HP INTEL SYSTEM Website <onboarding@resend.dev>',
        to: [to],
        reply_to: String(email),
        subject: `[Website Message] ${String(subject).slice(0, 200)}`,
        html:
          `<p><b>New message from the HP INTEL SYSTEM website</b></p>` +
          `<p><b>Name:</b> ${esc(name)}</p>` +
          `<p><b>Email:</b> ${esc(email)}</p>` +
          `<p><b>Subject:</b> ${esc(subject)}</p>` +
          `<blockquote style="border-left:3px solid #00c2d8;padding-left:12px;margin:12px 0;">` +
          esc(message).replace(/\n/g, '<br>') +
          `</blockquote>`
      })
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('Resend error', r.status, detail);
      return res.status(502).json({ error: 'send-failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Contact endpoint error', e);
    return res.status(502).json({ error: 'send-failed' });
  }
}
