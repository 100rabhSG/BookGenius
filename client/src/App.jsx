import { useState, useEffect } from 'react'
import './App.css'

const DEFAULT_ANSWERS = {
  goals: 'Learn a skill',
  genres: ['Non-fiction'],
  mood: 'Motivational',
  context: 'Junior engineer',
  booksLoved: ['Atomic Habits']
}

export default function App(){
  const [answers, setAnswers] = useState(DEFAULT_ANSWERS)
  const [loading, setLoading] = useState(false)
  const [recs, setRecs] = useState([])
  const [anonymousId, setAnonymousId] = useState(null)
  const [debug, setDebug] = useState(null)

  useEffect(() => {
    // ensure anonymousId in localStorage
    let id = localStorage.getItem('anonymousId')
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()
      localStorage.setItem('anonymousId', id)
    }
    setAnonymousId(id)
  }, [])

  async function getRecommendations(usePrefill=false){
    setLoading(true)
    setRecs([])
    setDebug(null)
    const payload = {
      anonymousId,
      answers: answers,
      mode: 'concise'
    }
    try {
      const res = await fetch('http://localhost:8080/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const json = await res.json()
      setRecs(json.recommendations || [])
      setDebug(json.debug || null)
    } catch (err) {
      console.error(err)
      setRecs([{ title: 'Error', author: '', summary: 'Could not fetch recommendations. Check server.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>BookGenius — AI Book Recommender (Mock)</h1>
      </header>

      <main>
        <section className="questionnaire">
          <h2>Quick questionnaire</h2>
          <label>
            Goal:
            <select value={answers.goals} onChange={(e)=>setAnswers({...answers, goals: e.target.value})}>
              <option>Learn a skill</option>
              <option>Career growth</option>
              <option>Improve mindset</option>
              <option>Relax/entertainment</option>
            </select>
          </label>

          <label>
            Mood:
            <select value={answers.mood} onChange={(e)=>setAnswers({...answers, mood: e.target.value})}>
              <option>Motivational</option>
              <option>Calm & reflective</option>
              <option>Fast & entertaining</option>
              <option>Deep & thought-provoking</option>
            </select>
          </label>

          <label>
            Context (one line):
            <input type="text" value={answers.context} onChange={(e)=>setAnswers({...answers, context: e.target.value})} />
          </label>

          <div className="buttons">
            <button onClick={()=>getRecommendations()} disabled={loading}>
              {loading ? 'Loading…' : 'Get Recommendations'}
            </button>
            <button onClick={()=>{ setAnswers(DEFAULT_ANSWERS); getRecommendations(true) }} disabled={loading}>
              Prefill Demo
            </button>
          </div>
        </section>

        <section className="results">
          <h2>Recommendations</h2>
          {loading && <div className="skeleton">Loading recommendations…</div>}
          {!loading && recs.length===0 && <div>No recommendations yet.</div>}
          <div className="cards">
            {recs.map((r, i) => (
              <article key={i} className="card">
                <h3>{r.title}</h3>
                <p className="author">{r.author}</p>
                <p className="summary">{r.summary}</p>
                {r.why && <p className="why"><strong>Why:</strong> {r.why}</p>}
                {r.takeaway && <p className="takeaway"><strong>Takeaway:</strong> {r.takeaway}</p>}
                <div className="card-actions">
                  <button onClick={async ()=>{
                    try{
                      await fetch('http://localhost:8080/api/save', {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ anonymousId, recommendation: r })
                      })
                      alert('Saved!')
                    }catch(e){ alert('Save failed') }
                  }}>Save</button>
                </div>
              </article>
            ))}
          </div>

          {debug && (
            <details style={{marginTop:12}}>
              <summary>Debug (mock)</summary>
              <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(debug, null, 2)}</pre>
            </details>
          )}
        </section>
      </main>

      <footer>
        <small>Local demo — Frontend calls local server at <code>http://localhost:8080</code></small>
      </footer>
    </div>
  )
}
