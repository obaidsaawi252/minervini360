// api/prices.js — Vercel Serverless
// يجلب الأسعار مباشرة من موقع تداول السعودية

const https = require('https');

function get(url, headers={}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8',
        'Referer': 'https://www.saudiexchange.sa/',
        ...headers
      },
      timeout: 15000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// جلب سعر سهم واحد من تداول
async function fetchFromTadawul(symbol) {
  const sym = symbol.replace('.SR','').replace('^','');
  
  // تداول API الرسمي
  const url = `https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTR3NDIw8TAz8DR0tXA0CLUMdnQyDjA0MjIEKIoEKnN0dPUzcDfQLsh0VAY3OBgE!/`;
  
  try {
    // نجرب أولاً API تداول المباشر
    const apiUrl = `https://www.saudiexchange.sa/wps/portal/saudiexchange/trading/market-services/market-information-services/company-quote?company=${sym}`;
    const r = await get(apiUrl);
    if (r.status === 200) {
      const data = JSON.parse(r.body);
      if (data && data.lastTradePrice) {
        return {
          symbol: sym,
          price: parseFloat(data.lastTradePrice),
          change: parseFloat(data.priceChange || 0),
          change_percent: parseFloat(data.priceChangePercent || 0),
          open: parseFloat(data.openPrice || 0),
          high: parseFloat(data.highPrice || 0),
          low: parseFloat(data.lowPrice || 0),
          volume: parseInt(data.tradedVolume || 0),
          source: 'tadawul'
        };
      }
    }
  } catch(e) {}

  // جرب endpoint آخر من تداول
  try {
    const url2 = `https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch/!ut/p/z1/stocks?symbol=${sym}`;
    const r2 = await get(url2, {'Accept': 'application/json'});
    if (r2.status === 200 && r2.body.includes('lastPrice')) {
      const data = JSON.parse(r2.body);
      return {
        symbol: sym,
        price: parseFloat(data.lastPrice || data.closePrice || 0),
        change_percent: parseFloat(data.percentChange || 0),
        change: parseFloat(data.priceChange || 0),
        open: parseFloat(data.openPrice || 0),
        high: parseFloat(data.highPrice || 0),
        low: parseFloat(data.lowPrice || 0),
        volume: parseInt(data.volume || 0),
        source: 'tadawul2'
      };
    }
  } catch(e) {}

  return null;
}

// جلب جميع أسعار السوق من صفحة تداول الرئيسية
async function fetchAllFromTadawul() {
  const prices = {};
  
  try {
    // صفحة مراقبة السوق من تداول
    const r = await get('https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch', {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ar-SA,ar;q=0.9'
    });
    
    if (r.status === 200) {
      const html = r.body;
      
      // استخرج بيانات تاسي
      const tasiMatch = html.match(/تاسي[^0-9]*([\d,]+\.?\d*)[^%]*([\d.]+)%/);
      if (tasiMatch) {
        prices['TASI'] = {
          price: parseFloat(tasiMatch[1].replace(',','')),
          change_percent: parseFloat(tasiMatch[2]),
          source: 'tadawul-html'
        };
      }

      // استخرج أسعار الأسهم من الجدول
      const rows = html.matchAll(/(\d{4})\t[^\t]*\t([\d.]+)\t[\d]+\t([+-]?[\d.]+)\t([+-]?[\d.]+)/g);
      for (const row of rows) {
        const sym = row[1];
        prices[sym] = {
          symbol: sym,
          price: parseFloat(row[2]),
          change_percent: parseFloat(row[4]),
          change: parseFloat(row[3]),
          source: 'tadawul-table'
        };
      }
    }
  } catch(e) {
    console.error('Tadawul fetch error:', e.message);
  }

  // إذا ما جبنا شي - نجرب JavaScript API من تداول
  if (Object.keys(prices).length < 3) {
    try {
      const r = await get('https://www.saudiexchange.sa/wps/portal/saudiexchange/ourmarkets/main-market-watch', {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json'
      });
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        (data.stocks || data.data || []).forEach(s => {
          prices[s.symbol || s.code] = {
            symbol: s.symbol || s.code,
            price: parseFloat(s.lastPrice || s.price || 0),
            change_percent: parseFloat(s.percentChange || s.change_percent || 0),
            change: parseFloat(s.priceChange || s.change || 0),
            open: parseFloat(s.openPrice || 0),
            high: parseFloat(s.highPrice || 0),
            low: parseFloat(s.lowPrice || 0),
            volume: parseInt(s.tradedVolume || s.volume || 0),
            name: s.nameAr || s.name || s.symbol,
            source: 'tadawul-json'
          };
        });
        
        if (data.index) {
          prices['TASI'] = {
            price: parseFloat(data.index.value || 0),
            change_percent: parseFloat(data.index.changePercent || 0),
            source: 'tadawul-index'
          };
        }
      }
    } catch(e) {}
  }

  return prices;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const { type = 'all', symbol } = req.query;

  try {
    if (type === 'quote' && symbol) {
      // سعر سهم واحد
      const q = await fetchFromTadawul(symbol);
      if (q && q.price > 0) {
        return res.json({ ok: true, data: q, source: 'tadawul', ts: Date.now() });
      }
      return res.json({ ok: false, error: 'No data from Tadawul', ts: Date.now() });
    }

    // كل الأسعار
    const prices = await fetchAllFromTadawul();
    const count = Object.keys(prices).length;
    
    res.json({
      ok: true,
      prices,
      count,
      source: 'tadawul',
      ts: Date.now(),
      time: new Date().toLocaleTimeString('ar-SA')
    });

  } catch(e) {
    res.status(500).json({ ok: false, error: e.message, ts: Date.now() });
  }
};
