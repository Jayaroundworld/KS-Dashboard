// api/market.js - 코스피·코스닥 지수 + 환율
// Yahoo Finance v7 quote → v8 chart fallback
// 주말/장외 등락률 왜곡 자동 보정

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const indices = [
    { name: 'KOSPI',   ticker: '^KS11'  },
    { name: 'KOSDAQ',  ticker: '^KQ11'  },
    { name: 'USD/KRW', ticker: 'KRW=X'  },
  ];

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

  // 한국시간 기준 장 상태
  function getMarketStatus() {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const day = kst.getUTCDay();
    const total = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    if (day === 0 || day === 6) return 'weekend';
    if (total >= 9 * 60 && total < 15 * 60 + 30) return 'open';
    if (total >= 8 * 60 + 30 && total < 9 * 60) return 'pre';
    if (total >= 15 * 60 + 30 && total < 18 * 60) return 'after';
    return 'closed';
  }

  async function fetchV8(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No v8 data');
    const meta = result.meta;
    const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(v => v != null);
    const price     = meta.regularMarketPrice ?? closes.at(-1) ?? 0;
    const prev      = meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2) ?? price;
    const change    = price - prev;
    const pct       = prev !== 0 ? (change / prev) * 100 : 0;
    return {
      price:     parseFloat(price.toFixed(2)),
      change:    parseFloat(change.toFixed(2)),
      changePct: parseFloat(pct.toFixed(2)),
      prevClose: parseFloat(prev.toFixed(2)),
    };
  }

  async function fetchOne({ name, ticker }) {
    // 1차: v7 quote
    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (!r.ok) throw new Error(`v7 HTTP ${r.status}`);
      const data = await r.json();
      const q = data?.quoteResponse?.result?.[0];
      if (!q || q.regularMarketPrice == null) throw new Error('No v7 quote');
      return {
        name,
        price:     parseFloat((q.regularMarketPrice).toFixed(2)),
        change:    parseFloat((q.regularMarketChange ?? 0).toFixed(2)),
        changePct: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
        prevClose: parseFloat((q.regularMarketPreviousClose ?? 0).toFixed(2)),
        status: 'ok',
      };
    } catch (_) {}

    // 2차: v8 fallback
    try {
      const nums = await fetchV8(ticker);
      return { name, ...nums, status: 'ok' };
    } catch (e) {
      return { name, price: null, change: null, changePct: null, status: 'error', error: e.message };
    }
  }

  try {
    const marketStatus = getMarketStatus();
    const items = await Promise.all(indices.map(fetchOne));

    const market = Object.fromEntries(items.map(item => {
      // 주말/장외: 등락률 ±8% 초과는 Yahoo 크로스데이 왜곡 → null 처리
      if (item.changePct !== null && Math.abs(item.changePct) > 8) {
        return [item.name, { ...item, change: null, changePct: null, dataNote: 'cross_day_distortion' }];
      }
      return [item.name, item];
    }));

    res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      marketStatus,
      market
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
