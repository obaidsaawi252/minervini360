const https = require('https');

function get(url, headers={}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent':'Mozilla/5.0', 'Accept':'application/json', ...headers },
      timeout: 12000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({status: res.statusCode, body: d}));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const KEY = 'shmk_test_f91fa1b81c551850b82b02360300131ec075b4f03fdec743';
  const BASE = 'https://app.sahmk.sa/api/v1';
  const { type = 'all', symbol } = req.query;

  try {
    if (type === 'quote' && symbol) {
      const ep = (symbol === 'TASI' || symbol === 'NOMU')
        ? `${BASE}/market/summary/?index=${symbol}`
        : `${BASE}/quote/${symbol}/`;
      const r = await get(ep, {'X-API-Key': KEY});
      return res.json({ok:true, data: JSON.parse(r.body), ts: Date.now()});
    }

    const [tasi, nomu, gainers, losers, active] = await Promise.all([
      get(`${BASE}/market/summary/?index=TASI`, {'X-API-Key': KEY}),
      get(`${BASE}/market/summary/?index=NOMU`, {'X-API-Key': KEY}),
      get(`${BASE}/market/gainers/?limit=60&index=TASI`, {'X-API-Key': KEY}),
      get(`${BASE}/market/losers/?limit=60&index=TASI`, {'X-API-Key': KEY}),
      get(`${BASE}/market/most-active/?limit=60&index=TASI`, {'X-API-Key': KEY}),
    ]);

    res.json({
      ok: true,
      tasi: JSON.parse(tasi.body),
      nomu: JSON.parse(nomu.body),
      gainers: JSON.parse(gainers.body),
      losers: JSON.parse(losers.body),
      active: JSON.parse(active.body),
      ts: Date.now()
    });
  } catch(e) {
    res.status(500).json({ok: false, error: e.message});
  }
};
