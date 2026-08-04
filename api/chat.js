/**
 * POST /api/chat
 * Secure backend for "Rupayan AI". The OpenAI key lives ONLY in server
 * environment variables (OPENAI_API_KEY) and is never exposed to clients.
 *
 * Retrieval-Augmented Generation: the website content is indexed below as
 * chunks; the user's latest message is scored against them and the best
 * matches are injected into the system prompt so the AI answers from the
 * site's own content. Unrelated questions fall through to the plain model.
 *
 * Environment variables (set in Vercel -> Project -> Settings -> Environment):
 *   OPENAI_API_KEY  - secret OpenAI key (used first when present)
 *   OPENAI_MODEL    - optional OpenAI model override (default: gpt-4o)
 *   GEMINI_API_KEY  - Google AI Studio key (also accepts GOOGLE_API_KEY);
 *                     used when OpenAI is missing or failing
 *   GEMINI_MODEL    - optional Gemini model override
 *                     (default: auto-fallback chain gemini-flash-latest -> 2.5 -> 2.0)
 */

/* ---------------- website knowledge index (RAG corpus) ---------------- */
const SITE_CORPUS = [
  {
    title: 'The Laptop - HP 15 FD 1099 TU',
    keywords: ['laptop', 'machine', 'hp', '15', 'fd', '1099', 'tu', 'about', 'overview', 'display', 'screen', 'memory', 'ram', 'ssd', 'storage', 'specs', 'specification', 'weight'],
    content:
      'The site showcases the HP 15 FD 1099 TU laptop. Key specifications: Intel Core processor (Intel Core Ultra 5 Series-2 class), 16 GB memory, 512 GB NVMe SSD storage, 15.6-inch FHD (1080p) display at 60 Hz, integrated Intel Arc graphics. The page tagline is "HP INTEL SYSTEM" and the hero welcomes visitors to "HP WORLD" with a 123-frame cinematic scroll animation of the laptop.'
  },
  {
    title: 'Processor & Chipset - Intel Core Ultra 5',
    keywords: ['processor', 'cpu', 'chipset', 'core', 'ultra', 'intel', 'series', 'discrete', 'graphics', 'required', 'compare', 'i5', 'gen'],
    content:
      'The featured chipset is the Intel Core Ultra 5, SERIES-2, marked "Discrete Graphics Required". The website has a dedicated interactive 3D chipset showcase (below the Machine section): a hyper-realistic Three.js model inside an Intel retail box. Clicking the box opens the lid, the chip rises out and the box fades away; clicking the chip packs it back inside. It supports full 360-degree mouse rotation with premium PBR-style lighting. The IHS label reads "intel CORE ULTRA 5 SERIES-2 DISCRETE GRAPHICS REQUIRED".'
  },
  {
    title: 'Cooling System - Cryo-Core',
    keywords: ['cooling', 'fan', 'cryo', 'core', 'rpm', 'temperature', 'thermal', 'heat', 'turbo', 'fire'],
    content:
      'Cooling is branded "Cryo-Core Cooling". The site features an interactive cooling fan that spins faster when hovered/clicked, a live RPM meter, and a 10-second fire/turbo mode where the whole UI switches to an orange flame theme. Thermal telemetry cards display CPU load, temperature and fan RPM with animated rings and graphs.'
  },
  {
    title: 'Performance & Benchmarks',
    keywords: ['performance', 'benchmark', 'telemetry', 'multitasking', 'parallel', 'threads', 'cores', 'speed', 'fast', 'gpu', 'arc', 'xe'],
    content:
      'The "Tactical Telemetry" section shows live animated performance graphs (CPU, GPU, NET I/O, core threads). The "Fluid Multitasking" section describes parallel processing with nanosecond context switching. An "Intel Arc" section visualizes Xe-cores with animated clocks and utilization bars. All widgets animate continuously to simulate live system monitoring.'
  },
  {
    title: 'Gallery & Visual Effects',
    keywords: ['gallery', 'animation', 'scroll', 'particles', 'background', 'sphere', 'frames', 'visual', 'effects', '3d'],
    content:
      'Visual highlights: a 123-frame scroll-driven laptop reveal that completes within the first 5% of page scroll; a neon cyan+magenta perspective plexus grid background; an Antigravity-style WebGL particle sphere (Three.js GLSL) that follows the cursor with spring physics and performs an energy blast when the mouse is idle; a mouse-controlled 3D laptop lab page; and a React particle playground page. Sections use glassmorphism panels with cyan glow accents.'
  },
  {
    title: 'Rupayan AI Assistant',
    keywords: ['rupayan', 'ai', 'assistant', 'chat', 'bot', 'rai', 'ask', 'help'],
    content:
      'Rupayan AI (RAI) is the built-in assistant of this website, opened from the floating purple star button at the bottom-right corner of every page. It knows the site content via retrieval-augmented generation and answers questions about the laptop, chipset, cooling and features. For non-site questions it answers generally via OpenAI.'
  },
  {
    title: 'Contact Information',
    keywords: ['contact', 'email', 'message', 'reach', 'rupayan', 'form', 'inbox', 'support'],
    content:
      'Visitors can reach the owner through the Contact section (below the Chipset section) with a form for Name, Email, Subject and Message. Submissions are delivered to the owner inbox via the /api/contact endpoint (Resend). The contact owner is Rupayan, the creator of this HP INTEL SYSTEM showcase website.'
  },
  {
    title: 'FAQ',
    keywords: ['faq', 'question', 'questions', 'frequently', 'asked'],
    content:
      'Frequently asked: (1) What laptop is featured? - HP 15 FD 1099 TU with Intel Core, 16 GB RAM, 512 GB NVMe SSD, 15.6-inch FHD 60 Hz. (2) Which chipset? - Intel Core Ultra 5 Series-2 (discrete graphics required), viewable in an interactive 3D unboxing showcase. (3) How to contact? - Use the Contact form; messages go to the owner inbox. (4) Who built the site? - Rupayan, who also built the embedded Rupayan AI assistant.'
  }
];

/* ---------------- tiny keyword RAG retriever ---------------- */
function retrieve(query) {
  const q = String(query).toLowerCase();
  const words = new Set(q.split(/[^a-z0-9]+/).filter(w => w.length > 2));
  const scored = SITE_CORPUS.map(chunk => {
    let score = 0;
    for (const kw of chunk.keywords) {
      if (q.includes(kw)) score += kw.length > 4 ? 3 : 2;
    }
    for (const w of words) {
      if (chunk.keywords.some(k => k.includes(w) || w.includes(k))) score += 1;
    }
    return { chunk, score };
  });
  return scored
    .filter(s => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(s => s.chunk);
}

/* ---------------- provider calls ---------------- */
async function askOpenAI(apiKey, system, clean) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  /* reasoning-style models (o1/o3/o4/gpt-5...) reject temperature + max_tokens */
  const isReasoning = /^(o[134]|gpt-5)/i.test(model);
  const reqBody = {
    model,
    messages: [{ role: 'system', content: system }, ...clean]
  };
  if (isReasoning) reqBody.max_completion_tokens = 600;
  else { reqBody.temperature = 0.6; reqBody.max_tokens = 600; }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(reqBody)
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('OpenAI error', r.status, detail);
    const err = new Error('openai-failed');
    err.upstream = r.status;
    try { const j = JSON.parse(detail); err.oaiType = (j.error && j.error.type) || ''; err.oaiCode = (j.error && j.error.code) || ''; } catch (e) { /* non-JSON detail */ }
    throw err;
  }
  const data = await r.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function askGemini(apiKey, system, clean) {
  /* preferred model first, then alternates — quotas are per-model */
  const preferred = process.env.GEMINI_MODEL;
  const models = preferred
    ? [preferred]
    : ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastErr = null;
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: clean.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature: 0.6, maxOutputTokens: 1800, thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error('Gemini error', model, r.status, detail);
        const err = new Error('gemini-failed');
        err.upstream = r.status;
        try { const j = JSON.parse(detail); err.gType = (j.error && j.error.status) || ''; } catch (e) { /* non-JSON detail */ }
        /* only fall through to the next model when it is unavailable for this one */
        if (r.status === 404 || r.status === 400 || r.status === 429) { lastErr = err; continue; }
        throw err;
      }
      const data = await r.json();
      const cand = data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      const text = parts ? parts.map(p => p.text || '').join('') : '';
      const meta = { finishReason: (cand && cand.finishReason) || '', model };
      if (text) return { text, meta };
      lastErr = new Error('gemini-empty');
      lastErr.meta = meta;
    } catch (e) {
      if (e.upstream) { lastErr = e; continue; }
      throw e;
    }
  }
  throw lastErr || new Error('gemini-failed');
}

/* ---------------- handler ---------------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'invalid-request' });
    }
    const clean = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    if (!clean.length) return res.status(400).json({ error: 'invalid-request' });

    const lastUser = [...clean].reverse().find(m => m.role === 'user');
    const ctx = retrieve(lastUser ? lastUser.content : '');

    const system = ctx.length
      ? 'You are Rupayan AI, the built-in assistant of the HP INTEL SYSTEM website (an HP 15 FD 1099 TU laptop showcase by Rupayan). ' +
        'Answer using the WEBSITE CONTEXT below. Be concise, friendly and premium in tone; use markdown sparingly (bold, short lists). ' +
        'If the context does not fully cover the question, say what the site shows and stay honest.\n\nWEBSITE CONTEXT:\n' +
        ctx.map(c => `## ${c.title}\n${c.content}`).join('\n\n')
      : 'You are Rupayan AI, the friendly built-in assistant of the HP INTEL SYSTEM website, which showcases the HP 15 FD 1099 TU laptop ' +
        '(Intel Core Ultra 5 Series-2 chipset, 16 GB RAM, 512 GB NVMe SSD, 15.6" FHD 60 Hz display, Cryo-Core cooling, interactive 3D showcases). ' +
        'Answer general questions helpfully and concisely. If asked about this website or the laptop, mention what the site showcases. ' +
        'Use light markdown (bold, lists) when it helps.';

    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!openaiKey && !geminiKey) {
      return res.status(503).json({ error: 'not-configured' });
    }

    /* OpenAI first when configured; Gemini as the alternate/fallback provider */
    if (openaiKey) {
      try {
        const reply = await askOpenAI(openaiKey, system, clean);
        if (reply) return res.status(200).json({ reply, provider: 'openai' });
      } catch (err) {
        if (!geminiKey) {
          return res.status(502).json({ error: 'unavailable', upstream: err.upstream || 0, oaiType: err.oaiType || '', oaiCode: err.oaiCode || '' });
        }
        console.error('OpenAI failed, falling back to Gemini:', err.message);
      }
    }
    if (geminiKey) {
      try {
        const out = await askGemini(geminiKey, system, clean);
        if (out && out.text) return res.status(200).json({ reply: out.text, provider: 'gemini', gModel: out.meta && out.meta.model, gFinish: out.meta && out.meta.finishReason });
        return res.status(502).json({ error: 'empty-response' });
      } catch (err) {
        return res.status(502).json({ error: 'unavailable', upstream: err.upstream || 0, gType: err.gType || '' });
      }
    }
    return res.status(502).json({ error: 'empty-response' });
  } catch (e) {
    console.error('Chat endpoint error', e);
    return res.status(502).json({ error: 'unavailable' });
  }
}
