const path = require('path');
const fs = require('fs');
const envPath = path.resolve(__dirname, '..', '.env');
// console.log('Loading env from:', envPath, 'exists:', fs.existsSync(envPath));
require('dotenv').config({ path: envPath });

// console.log('GEMINI_API_KEY present?', !!process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.slice(0,4)}...${process.env.GEMINI_API_KEY.slice(-4)}` : null);

const express = require('express');
const cors = require('cors');
const { z } = require('zod');
const admin = require('firebase-admin');
const serviceAccount = require('../firestore-service-account.json');
const fetch = require('node-fetch');

const loadedKey = process.env.GEMINI_API_KEY || '(none)';
const loadedUrl = process.env.GEMINI_API_URL || '(none)';
console.log('ENV: GEMINI_API_KEY set?', !!loadedKey && loadedKey !== '(none)' ? 'YES' : 'NO');
// console.log('ENV: GEMINI_API_URL =', loadedUrl);


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
	'https://api.example.com/v1/generate';

	
// Zod schemas for validating the model output
const RecommendationSchema = z.object({
	title: z.string(),
	author: z.string().optional().or(z.literal('')).optional(),
	why: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

const ModelResponseSchema = z.object({
	recommendations: z.array(RecommendationSchema).max(3)
});


//Simple static fallback recommendations (used if model fails)
const FALLBACK_RECS = [
	{
		title: 'Atomic Habits',
		author: 'James Clear',
		why: 'Proven, actionable advice for habit formation.',
		tags: ['habits', 'productivity']
	},
	{
		title: 'Clean Code',
		author: 'Robert C. Martin',
		why: 'Great for engineers focusing on code quality and craftsmanship.',
		tags: ['software', 'engineering']
	},
	{
		title: 'Deep Work',
		author: 'Cal Newport',
		why: 'Useful for people seeking better concentration and productivity.',
		tags: ['focus', 'productivity']
	}
];


//Health check
app.get('/', (req, res) => {
	res.status(200).json({ status: 'ok' });
});

/**
 * Build the prompt string for Gemini.
 * We use a SYSTEM + USER style prompt and require JSON-only output.
 */
function buildPrompt(answers) {
	const userBlock = JSON.stringify(
		{
			mood: answers.mood || '',
			goals: answers.goals || '',
			genres: answers.genres || [],
			readingStyle: answers.readingStyle || '',
			length: answers.length || '',	
		},
		null,
		2
	);

	// We force JSON-only output, give a compact schema and a minimal example.
	return `SYSTEM:
	You are BookGenius, an expert AI that recommends books based strictly on user preferences. 
	Respond ONLY with valid JSON that matches the exact schema below. No explanations, no prose, no intro/outro text.

	STRICT OUTPUT SCHEMA (must follow exactly):
	{
		"recommendations": [
			{
			"title": "string",
			"author": "string",
			"reason": "string (max 120 characters)",
			"tags": ["string"]
			}
		]
	}

	RESPONSE RULES:
	- Return an object with a "books" array.
	- Include a maximum of 3 books.
	- Each book must include: "title", "author", "reason", "short summary".
	- "reason" must be concise (max 100 characters).
	- "summary" must be brief (max 120 characters).
	- Total response must be under 1200 characters.
	- Recommendations must strongly match mood, purpose, style, and genres.

	USER PREFERENCES:
	${userBlock}

	INSTRUCTIONS: Recommend books that best match the user's preferences and return them in the exact JSON schema above.`;
}

async function callModelAPI(promptText, options = {}) {
	const key = process.env.GEMINI_API_KEY;
	if (!key) throw new Error('GEMINI_API_KEY not set in environment');

	const primaryUrl = process.env.GEMINI_API_URL;
	if (!primaryUrl) throw new Error('GEMINI_API_URL not set in environment');

	const failoverUrl = process.env.GEMINI_FAILOVER_URL || null;
	const maxAttempts = parseInt(process.env.GEMINI_RETRY_ATTEMPTS || '2', 10);
	const baseDelayMs = 800; // larger base delay to reduce hammering
	const jitter = (n) => Math.floor(Math.random() * (n * 200)); // jitter scale

	const makeBody = () => ({
		contents: [{ role: 'user', parts: [{ text: promptText }] }],
		generationConfig: {
			temperature: options.temperature ?? 0.12, // lower for deterministic JSON
			candidateCount: options.candidateCount ?? 1,
			maxOutputTokens: options.maxOutputTokens ?? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '1200', 10)
		}
	});

	const extract = (json) => {
		if (!json) return null;

		if (json.candidates && Array.isArray(json.candidates) && json.candidates[0]) {
			const cand = json.candidates[0];
			if (typeof cand.content === 'string') return cand.content;
			if (cand.content && typeof cand.content === 'object') {
				if (Array.isArray(cand.content.parts)) return cand.content.parts.map(p => (p.text || p)).join('\n');
				return JSON.stringify(cand.content);
			}
			if (Array.isArray(cand.output) && cand.output[0] && cand.output[0].content) return cand.output[0].content;
		}
		if (typeof json.output === 'string') return json.output;
		if (typeof json.content === 'string') return json.content;
		if (json.choices && Array.isArray(json.choices) && json.choices[0]?.message?.content) return json.choices[0].message.content;
		return JSON.stringify(json);
	};

	async function postToUrl(url) {
		const body = makeBody();
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
			body: JSON.stringify(body)
		});
		const text = await res.text().catch(() => null);
		const ok = res.ok;
		let parsed = null;
		try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* leave parsed null */ }

		if (!ok) {
			const err = new Error(`Model API error: ${res.status} ${res.statusText}`);
			err.status = res.status;
			err.details = text;
			throw err;
		}
		return parsed ?? text;
	}

	// Try primary
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			console.log(`callModelAPI: primary POST attempt ${attempt}`);
			const raw = await postToUrl(primaryUrl);
			// after calling postToUrl(...) and computing `text`:
			const parsedText = (typeof raw === 'string') ? raw : extract(raw);

			// consider tiny/empty responses transient
			if (!parsedText || (typeof parsedText === 'string' && parsedText.trim().length < 50)) {
				const err = new Error('Model returned empty/insufficient content');
				err.status = 0; // mark as transient
				err.details = typeof parsedText === 'string' ? parsedText : JSON.stringify(parsedText);
				throw err; // trigger retry/failover logic
			}

			// otherwise return
			return parsedText;
		} catch (err) {
			const status = err.status || 0;
			console.warn(`callModelAPI: primary attempt ${attempt} failed: ${err.message}`);
			const isTransient = [429, 500, 502, 503].includes(status) || !status;
			if (!isTransient) throw err;
			if (attempt === maxAttempts) break;
			const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter(attempt);
			console.log(`callModelAPI: waiting ${delay}ms before retry`);
			await new Promise(r => setTimeout(r, delay));
		}
	}

	// Try failover once
	if (failoverUrl) {
		try {
			console.log('callModelAPI: trying failover model');
			const raw2 = await postToUrl(failoverUrl);
			const text2 = (typeof raw2 === 'string') ? raw2 : extract(raw2);
			console.log('callModelAPI: failover success');
			return text2;
		} catch (err2) {
			console.error('callModelAPI: failover failed:', err2.message);
			const finalErr = new Error('Model request failed on primary and failover');
			finalErr.details = `failover error: ${err2.details || err2.message}`;
			throw finalErr;
		}
	}

	throw new Error('Model request failed after retries (no failover configured)');
}


//  Try to parse & validate model text into our schema. Returns parsed object on success, null on failure.
function tryParseModelOutput(text) {
	console.log('text: ', text);
  if (!text || typeof text !== 'string') return null;
  const raw = text.replace(/\r\n/g, '\n');

  // 1) If there's a fenced JSON block, prefer it.
  const fenced = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/```\s*([\s\S]*?)```/);
  let candidate = fenced ? fenced[1].trim() : raw;

  // 2) If candidate contains explicit JSON object(s), try to extract the longest balanced JSON object.
  const firstBrace = candidate.indexOf('{');
  if (firstBrace !== -1) {
    const balanced = extractLongestBalancedJson(candidate, firstBrace);
    if (balanced) {
      const parsed = tryParseJsonWithCleaning(balanced);
      if (parsed) return validateAndNormalize(parsed);
    }
  }

  // 3) If no braces, but candidate looks like JSON array, try extracting first balanced array
  const firstBracket = candidate.indexOf('[');
  if (firstBracket !== -1) {
    const balancedArr = extractLongestBalancedJson(candidate, firstBracket, '[', ']');
    if (balancedArr) {
      const parsedArr = tryParseJsonWithCleaning(balancedArr);
      if (parsedArr) {
        // wrap into object if necessary
        const wrapped = Array.isArray(parsedArr) ? { recommendations: parsedArr } : parsedArr;
        return validateAndNormalize(wrapped);
      }
    }
  }

  // 4) Last attempt: try to parse the whole candidate with cleaning
  const parsedWhole = tryParseJsonWithCleaning(candidate);
  if (parsedWhole) return validateAndNormalize(parsedWhole);

  return null;

  // === helpers ===
  function tryParseJsonWithCleaning(s) {
    try {
      return JSON.parse(s);
    } catch (e) {
      // try some forgiving cleanups
      let cleaned = s
        .replace(/[“”]/g, '"')                 // smart quotes
        .replace(/\,(?=\s*[\]\}])/g, '')       // trailing commas before ] or }
        .replace(/,\s*}/g, '}')
        .replace(/,\s*\]/g, ']');
      // add basic quoting for unquoted keys (best-effort)
      cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      try {
        return JSON.parse(cleaned);
      } catch (err) {
        return null;
      }
    }
  }

  function validateAndNormalize(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const items = parsed.recommendations && Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : (Array.isArray(parsed) ? parsed : null);
    if (!items || items.length === 0) return null;
    const valid = items
      .filter(it => it && typeof it.title === 'string' && typeof it.author === 'string')
      .slice(0, 3);
    if (valid.length === 0) return null;
    return { recommendations: valid };
  }

  // Extracts the longest balanced JSON substring starting at startIdx.
  // Handles braces or brackets depending on openChar/closeChar.
  function extractLongestBalancedJson(s, startIdx = 0, openChar = '{', closeChar = '}') {
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastBalancedIdx = -1;

    for (let i = startIdx; i < s.length; i++) {
      const ch = s[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          lastBalancedIdx = i;
          // don't break — keep scanning to find possibly larger balanced JSON later
        }
      }
    }

    if (lastBalancedIdx !== -1 && startIdx <= lastBalancedIdx) {
      return s.slice(startIdx, lastBalancedIdx + 1);
    }
    return null;
  }
}



app.post('/api/recommend', async (req, res) => {
    const { v4: uuidv4 } = await import('uuid');
	const { anonymousId = uuidv4(), answers = {}, mode = 'concise' } = req.body || {};

	// Build main prompt from existing function
	const prompt = buildPrompt(answers);

	// small helper to attempt model call + parse
	async function attemptModelCall(promptText, temperature = 0.0) {
		try {
			const raw = await callModelAPI(promptText, { temperature, maxOutputTokens: 800 }); // getting successful response from here (raw)
			// log for debugging (first 1200 chars)
			// console.log('Model raw response preview:', (raw || '').slice(0, 1200));
			const parsed = tryParseModelOutput(raw);
			return { parsed, raw };
		} catch (err) {
			console.error('Model call error:', err?.message || err, err?.details || '');
			return { parsed: null, raw: err?.details || String(err) };
		}
	}

	// If no API key present, immediate fallback (keeps previous behavior)
	if (!GEMINI_API_KEY) {
		console.warn('GEMINI_API_KEY not set, returning fallback recommendations (no model).');
		return res.json({
			recommendations: FALLBACK_RECS,
			debug: { mocked: true, reason: 'no_api_key' }
		});
	}

	try {
		// 1) First attempt - very low temperature for deterministic JSON
		const { parsed: parsed1, raw: raw1 } = await attemptModelCall(prompt, 0.20);

		if (parsed1) {
			return res.json({
				recommendations: parsed1.recommendations,
				debug: { anon: anonymousId, attempt: 1, rawPreview: String(raw1).slice(0, 1000) }
			});
		}

		// 2) Second attempt (corrective): explicit instruction to return valid JSON only
		const correctivePrompt = [
			'IMPORTANT: Your previous output was invalid. Return ONLY valid JSON matching the schema EXACTLY (no commentary, no markdown).',
			'Schema: {"recommendations": [{"title": "string","author": "string","reason": "string (max 120 characters)","tags": ["string"]}]}',
			'Return an object with up to 3 recommendations that match the schema above.',
			'Now produce the JSON only:'
		].join(' ');

		// We combine corrective instruction + the original user block to keep context
		const retryPrompt = `${correctivePrompt}\n\nUSER_CONTEXT:\n${JSON.stringify({
			mood: answers.mood || '',
			goals: answers.goals || '',
			genres: answers.genres || [],
			readingStyle: answers.readingStyle || '',
			length: answers.length || '',
		}, null, 2)}`;

		const { parsed: parsed2, raw: raw2 } = await attemptModelCall(retryPrompt, 0.0);

		if (parsed2) {
			return res.json({
				recommendations: parsed2.recommendations,
				debug: { anon: anonymousId, attempt: 2, rawPreview: String(raw2).slice(0, 1000) }
			});
		}

		// both attempts failed — return fallback with debug info
		console.warn('Model returned invalid JSON on both attempts; returning fallback recommendations.');
		return res.json({
			recommendations: FALLBACK_RECS,
			debug: {
				anon: anonymousId,
				note: 'fallback used',
				rawAttempt1: String(raw1).slice(0, 2000),
				rawAttempt2: String(raw2).slice(0, 2000)
			}
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
	// console.log('List request received with query:', req.query);
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

// Start
app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});
