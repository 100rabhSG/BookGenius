const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Temporary mock endpoint for recommendations
app.post('/api/recommend', (req, res) => {
  res.json({
    recommendations: [
      {
        title: "Atomic Habits",
        author: "James Clear",
        summary: "A practical guide to building effective habits.",
        why: "Mocked recommendation to validate UI flow.",
        tags: ["productivity"]
      }
    ],
    debug: { mocked: true }
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
