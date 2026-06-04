require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_BASE = 'https://api.reportingninja.com/v1';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.REPORTING_NINJA_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function rnPost(endpoint, body) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// List all connections for a given integration
app.post('/api/connections', async (req, res) => {
  try {
    const data = await rnPost('/connections', req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query data
app.post('/api/query', async (req, res) => {
  try {
    const data = await rnPost('/query', req.body);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all connections for meta, google ads and pinterest at once
app.get('/api/overview', async (req, res) => {
  try {
    const [meta, google, pinterestAds, pinterestOrganic] = await Promise.all([
      rnPost('/connections', { integration_id: 'facebook_ads' }),
      rnPost('/connections', { integration_id: 'google_ads' }),
      rnPost('/connections', { integration_id: 'pinterest_ads' }),
      rnPost('/connections', { integration_id: 'pinterest_organic' }),
    ]);
    res.json({ meta, google, pinterestAds, pinterestOrganic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Rapportage server draait op http://localhost:${PORT}`);
});
