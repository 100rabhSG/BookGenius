import { useState, useEffect } from 'react'
import { moodOptions, readingPurposeOptions, genreOptions, readingStyleOptions, lengthOptions} from './data/options.js'
import './App.css'

const DEFAULT_ANSWERS = {
	mood: 'Motivational',
	goals: 'Learn a skill',
	genre: 'Fiction',
	readingStyle: 'Simple & easy to follow',
	length: 'Short',
}

export default function App(){
	const [answers, setAnswers] = useState(DEFAULT_ANSWERS)
	const [loading, setLoading] = useState(false)
	const [recs, setRecs] = useState([])
	const [anonymousId, setAnonymousId] = useState(null)
	const [showSaved, setShowSaved] = useState(false)

	// saved items state
	const [savedItems, setSavedItems] = useState([])
	const [loadingSaved, setLoadingSaved] = useState(false)

  useEffect(() => {
	// ensure anonymousId in localStorage
	let id = localStorage.getItem('anonymousId')
	if (!id) {
	  id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()
	  localStorage.setItem('anonymousId', id)
	}
	setAnonymousId(id)
  }, [])

  async function getRecommendations(){
	if (!anonymousId) return alert('anonymousId missing')

	setLoading(true)
	setRecs([])
	const payload = { anonymousId, answers, mode: 'concise' }

	try {
	  const res = await fetch('https://bookgenius-server-gaqvrurloq-uc.a.run.app/api/recommend', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	  })
	  const json = await res.json()
	  setRecs(json.recommendations || [])
	} catch (err) {
	  console.error(err)
	  setRecs([{ title: 'Error', summary: 'Could not fetch recommendations. Check server.' }])
	} finally {
	  setLoading(false)
	}
  }

  // fetch saved items from backend
  async function fetchSaved(){
	if (!anonymousId) return alert('anonymousId missing')

	setLoadingSaved(true)
	try {
	  const url = `https://bookgenius-server-gaqvrurloq-uc.a.run.app/api/list?anonymousId=${encodeURIComponent(anonymousId)}`
	  const res = await fetch(url)
	  const json = await res.json()
	  setSavedItems(json.items || [])
	} catch (err) {
	  console.error('fetchSaved error', err)
	  alert('Failed to fetch saved items')
	} finally {
	  setLoadingSaved(false)
	}
  }

  // refresh saved list after saving
  async function handleSave(recommendation){
	try{
	  const res = await fetch('https://bookgenius-server-gaqvrurloq-uc.a.run.app/api/save', {
		method: 'POST',
		headers: {'Content-Type':'application/json'},
		body: JSON.stringify({ anonymousId, recommendation })
	  })
	  const j = await res.json()
	  if (j.savedId) {
		// refresh saved list
		fetchSaved()
		alert('Saved!')
	  } else {
		console.warn('save response', j)
		alert('Save response unexpected')
	  }
	} catch(e){
	  console.error(e)
	  alert('Save failed')
	}
  }

  return (
	<div className="app">
	  <header>
		<h1>BookGenius - AI Book Recommender</h1>
	  </header>

	  <main>
		<section className="questionnaire">
			<h2>Quick questionnaire</h2>
			<label>
			Mood:
			<select value={answers.mood} onChange={(e)=>setAnswers({...answers, mood: e.target.value})}>
				{moodOptions.map((mood) => (
					<option key={mood} value={mood}>{mood}</option>
				))}
			</select>
			</label>

			<label>
			Goal:
			<select value={answers.goals} onChange={(e)=>setAnswers({...answers, goals: e.target.value})}>
				{readingPurposeOptions.map((goal) => (
					<option key={goal} value={goal}>{goal}</option>
				))}
			</select>
			</label>

			<label>
			Genre:
			<select value={answers.genre} onChange={(e)=>setAnswers({...answers, genre: e.target.value})}>
				{genreOptions.map((genre) => (
					<option key={genre} value={genre}>{genre}</option>
				))}
			</select>
			</label>

			<label>
			Reading Style:
			<select value={answers.readingStyle} onChange={(e)=>setAnswers({...answers, readingStyle: e.target.value})}>
				{readingStyleOptions.map((style) => (
					<option key={style} value={style}>{style}</option>
				))}
			</select>
			</label>

			<label>
			Length Preference:
			<select value={answers.length} onChange={(e)=>setAnswers({...answers, length: e.target.value})}>
				{lengthOptions.map((length) => (
					<option key={length} value={length}>{length}</option>
				))}
			</select>
			</label>

			<div className="buttons">
			<button onClick={()=>getRecommendations()} disabled={loading}>
				{loading ? 'Loading…' : 'Get Recommendations'}
			</button>
			<button
				onClick={async () => {
					await fetchSaved();
					setShowSaved(true);
				}}
				disabled={loadingSaved}
				style={{ background: '#065f46' }}
				>
				{loadingSaved ? 'Loading saved…' : 'My Saved Books'}
				</button>
			</div>
		</section>

		<section className="results" style={{backgroundColor: '#e0dedeff'}}>
		  <h2>Recommendations</h2>
		  {loading && <div className="skeleton">Loading recommendations…</div>}
		  {!loading && recs.length===0 && <div>No recommendations yet.</div>}
		  <div className="cards">
			{recs.map((r, i) => (
			  <article key={i} className="card">
				<h3>{r.title}</h3>
				<p className="author">{r.author}</p>
				<p className="summary">{r.summary}</p>
				{r.reason && <p className="why"><strong>Why:</strong> {r.reason}</p>}
				{r.tags && (
					<p className="takeaway">
						<strong>Tags:</strong> {Array.isArray(r.tags) ? r.tags.join(', ') : r.tags}
					</p>
				)}
				<div className="card-actions">
				  <button onClick={()=>handleSave(r)}>Save</button>
				</div>
			  </article>
			))}
		  </div>
		</section>

		{/* new: reading list section */}
		{showSaved && (
			<section className="results">
				<h2>Reading List</h2>
				{loadingSaved && <div>Loading saved books…</div>}
				{!loadingSaved && savedItems.length===0 && (
					<div>No saved books yet. Click "Save" on a recommendation.</div>
				)}
				<div className="cards">
				{savedItems.map((s) => (
					<article key={s.id} className="card">
					<h3>{s.recommendation?.title}</h3>
					<p className="author">{s.recommendation?.author}</p>
					<p className="summary">{s.recommendation?.reason}</p>
					{s.recommendation?.tags && (
						<p className="takeaway">
							<strong>Tags:</strong> {Array.isArray(s.recommendation?.tags) ? s.recommendation?.tags.join(', ') : s.recommendation?.tags}
						</p>
					)}
					<p style={{fontSize:12,color:'#6b7280'}}>
						Saved at: {new Date(s.createdAt).toLocaleString()}
					</p>
					</article>
				))}
				</div>
			</section>
		)}
	  </main>
	</div>
  )
}
