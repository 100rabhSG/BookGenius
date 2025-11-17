/**
 * src/index.js
 * - Integrates with Gemini-like API (configurable via GEMINI_API_URL + GEMINI_API_KEY)
 * - Builds a strict JSON-only prompt
 * - Validates model output using zod
 * - Retries once if output is invalid, falls back to static recommendations on error
 *
 * Environment:
 * - GEMINI_API_KEY: required
 * - GEMINI_API_URL: optional (default uses a placeholder). Set to your provider endpoint.
 * - PORT: optional (default 8080)
 *
 * NOTE: Replace GEMINI_API_URL with the real Gemini endpoint you intend to use.
 */

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const admin = require('firebase-admin');
const serviceAccount = require('../firestore-service-account.json');

const app = express();
app.use(cors());
app.use(express.json());
const RECS_COLLECTION = 'recommendations';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const PORT = process.env.PORT || 8080;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  // Keep this a placeholder so you configure the real endpoint in env.
  'https://api.example.com/v1/generate';

  
// Zod schemas for validating the model output
const RecommendationSchema = z.object({
  title: z.string(),
  author: z.string().optional().or(z.literal('')).optional(),
  summary: z.string(),
  why: z.string().optional(),
  takeaway: z.string().optional(),
  estimated_reading_time: z.string().optional(),
  tags: z.array(z.string()).optional()
});

const ModelResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema).max(3)
});


//Simple static fallback recommendations (used if model fails)
const FALLBACK_RECS = [
  {
    title: 'Atomic Habits',
    author: 'James Clear',
    summary: 'Practical guide to habit building and incremental improvement.',
    why: 'Proven, actionable advice for habit formation.',
    takeaway: 'Small daily changes compound into major improvements.',
    estimated_reading_time: '6-8 hours',
    tags: ['habits', 'productivity']
  },
  {
    title: 'Clean Code',
    author: 'Robert C. Martin',
    summary: 'Best practices and principles for writing maintainable code.',
    why: 'Great for engineers focusing on code quality and craftsmanship.',
    takeaway: 'Write readable code; design for maintainability.',
    estimated_reading_time: '8-10 hours',
    tags: ['software', 'engineering']
  },
  {
    title: 'Deep Work',
    author: 'Cal Newport',
    summary: 'Techniques to focus deeply and produce high-quality output.',
    why: 'Useful for people seeking better concentration and productivity.',
    takeaway: 'Block distraction; schedule focused work sessions.',
    estimated_reading_time: '6-8 hours',
    tags: ['focus', 'productivity']
  }
];


//Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Build the prompt string for Gemini.
 * We use a SYSTEM + USER style prompt and require JSON-only output.
 */
function buildPrompt(answers) {
  const userBlock = JSON.stringify(
    {
      goals: answers.goals || '',
      genres: answers.genres || [],
      mood: answers.mood || '',
      context: answers.context || '',
      booksLoved: answers.booksLoved || [],
      formatPref: answers.formatPref || ''
    },
    null,
    2
  );

  return `SYSTEM:
You are a helpful expert book recommender. ALWAYS respond with valid JSON ONLY and nothing else.

USER:
${userBlock}

INSTRUCTIONS:
Return a single JSON object with a "recommendations" array (length up to 3). Each item must have these fields:
{
  "title": string,
  "author": string,
  "summary": string,            // max ~50 words
  "why": string,                // 1-2 sentences referencing user's inputs
  "takeaway": string,           // one-line actionable takeaway
  "estimated_reading_time": string, // e.g. "6–8 hours"
  "tags": [string]
}
Do not include any commentary outside the JSON. If you are not sure about a detail, omit it rather than invent it.`;

}

/**
 * Call the Gemini-like API.
 * - Assumes the model returns text content which is JSON (we try to parse)
 * - This wrapper performs a single HTTP POST and returns the raw text content
 */
async function callModelAPI(prompt, options = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set in environment');
  }
  const body = {
    // This is generalized — adapt this object shape to the exact Gemini REST API you're using.
    prompt,
    temperature: options.temperature ?? 0.25,
    max_tokens: options.max_tokens ?? 800
  };

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GEMINI_API_KEY}`
    },
    body: JSON.stringify(body),
    // Timeout not built-in for fetch here; keep model call relatively short elsewhere.
  });

  if (!res.ok) {
    const txt = await res.text();
    const err = new Error(`Model API error: ${res.status} ${res.statusText}`);
    err.details = txt;
    throw err;
  }

  // Model response may be text with JSON inside. Expect the response JSON to include a `content` or `output` field,
  // but since providers differ, we try to parse helpful fields first, falling back to raw text.
  const json = await res.json().catch(() => null);
  if (json) {
    // attempt to locate an obvious content field
    if (json.output || json.content || json.choices || json.responses) {
      // Different providers structure this differently — try to extract human-readable text
      // 1) google-like: json.candidates[0].content
      if (json.candidates && Array.isArray(json.candidates) && json.candidates[0]?.content) {
        return json.candidates[0].content;
      }
      // 2) openai-like: json.choices[0].message.content
      if (json.choices && Array.isArray(json.choices) && json.choices[0]?.message?.content) {
        return json.choices[0].message.content;
      }
      // 3) common: json.output or json.content
      if (typeof json.output === 'string') return json.output;
      if (typeof json.content === 'string') return json.content;
      // 4) As last resort, return the entire JSON stringified
      return JSON.stringify(json);
    }
  }

  // If provider returned plain text body, return that
  const text = await res.text().catch(() => null);
  return text;
}

/**
 * Try to parse & validate model text into our schema. Returns parsed object on success, null on failure.
 */
function tryParseModelOutput(text) {
  if (!text || typeof text !== 'string') return null;

  // Some models may return markdown fenced JSON. Try to extract the first JSON block.
  const jsonMatch = text.match(/```json([\s\S]*?)```/i) || text.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0].replace(/```json/i, '').replace(/```/g, '') : null;
  let parsed;
  try {
    parsed = candidate ? JSON.parse(candidate) : JSON.parse(text);
  } catch (e) {
    // failed to parse JSON
    return null;
  }

  // Validate schema
  const result = ModelResponseSchema.safeParse(parsed);
  if (!result.success) {
    // invalid shape
    return null;
  }
  return result.data;
}

/**
 * POST /api/recommend
 * - builds prompt
 * - calls model
 * - validates and retries once on failure
 * - returns recommendations (or fallback)
 */
app.post('/api/recommend', async (req, res) => {
  const { anonymousId = uuidv4(), answers = {}, mode = 'concise' } = req.body || {};
  const prompt = buildPrompt(answers);

  // If API key not present, immediately return helpful error and fallback data
  if (!GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set, returning fallback recommendations (no model).');
    return res.json({
      recommendations: FALLBACK_RECS,
      debug: { mocked: true, reason: 'no_api_key' }
    });
  }

  try {
    // First attempt
    const raw = await callModelAPI(prompt, { temperature: mode === 'detailed' ? 0.35 : 0.2 });
    let parsed = tryParseModelOutput(raw);

    // Retry once with corrective instruction if parse failed
    if (!parsed) {
      const retryPrompt = `${prompt}\n\nIf your previous output was not valid JSON, return ONLY valid JSON now matching the schema exactly.`;
      const raw2 = await callModelAPI(retryPrompt, { temperature: 0.15 });
      parsed = tryParseModelOutput(raw2);
      // for debug, attach raw responses
      if (parsed) {
        return res.json({
          recommendations: parsed.recommendations,
          debug: { anon: anonymousId, retry: true, raw, raw2 }
        });
      }

      // both attempts failed — fall through to fallback
      console.warn('Model returned invalid JSON on both attempts; returning fallback recommendations.');
      return res.json({
        recommendations: FALLBACK_RECS,
        debug: { anon: anonymousId, raw, raw2, note: 'fallback used' }
      });
    }

    // Success
    return res.json({
      recommendations: parsed.recommendations,
      debug: { anon: anonymousId, rawResponsePreview: String(raw).slice(0, 200) }
    });
  } catch (err) {
    console.error('Error calling model:', err?.message || err, err?.details || '');
    return res.json({
      recommendations: FALLBACK_RECS,
      debug: { anon: anonymousId, error: err?.message || 'unknown', details: err?.details || '' }
    });
  }
});


// ---- Save endpoint using Firestore ----
app.post('/api/save', async (req, res) => {
  try {
    const { anonymousId = 'anon', recommendation } = req.body || {};
    if (!recommendation || !anonymousId) {
      return res.status(400).json({ error: 'missing anonymousId or recommendation' });
    }
    const docRef = await db.collection(RECS_COLLECTION).add({
      anonymousId,
      recommendation,
      createdAt: new Date().toISOString()
    });
    return res.json({ savedId: docRef.id, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error('Firestore save error:', err);
    return res.status(500).json({ error: 'save_failed', details: String(err) });
  }
});

// ---- List endpoint using Firestore ----
app.get('/api/list', async (req, res) => {
  try {
    const { anonymousId } = req.query || {};
    if (!anonymousId) return res.status(400).json({ error: 'missing anonymousId' });

    const snap = await db.collection(RECS_COLLECTION)
      .where('anonymousId', '==', anonymousId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ items });
  } catch (err) {
    console.error('Firestore list error:', err);
    return res.status(500).json({ error: 'list_failed', details: String(err) });
  }
});


/**
 * Start
 */
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
