// test_gemini_full.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

(async ()=>{
  const url = process.env.GEMINI_API_URL;
  const key = process.env.GEMINI_API_KEY;
  if(!url || !key){ console.error('Set GEMINI_API_URL and GEMINI_API_KEY in this shell'); process.exit(1); }

  const body = {
    contents: [
      { role: "user", parts: [{ text: 'Return JSON: {\"hello\":\"world\"}. Also include any metadata you would normally return.' }] }
    ],
    generationConfig: { temperature: 0.0, candidateCount: 1, maxOutputTokens: 200 }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body)
  });

  console.log('STATUS:', res.status, res.statusText);
  const txt = await res.text().catch(()=>null);
  console.log('RAW RESPONSE >>>\n', txt);
})();
