// api/market.js - 코스피·코스닥 지수 + 환율

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const indices = [
    { name: 'KOSPI',   ticker: '^KS11' },
    { name: 'KOSDAQ',  ticker: '^KQ11' },
    { name: 'USD/KRW', ticker: 'KRW=X'  },
  ];

  try {
    const results = await Promise.allSettled(
      indices.map(async ({ name, ticker }) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error('No data');

        const price = meta.regularMarketPrice;
        const prev = meta.previousClose;
        const chg = ((price - prev) / prev * 100);

        return {
          name,
          price: parseFloat(price.toFixed(2)),
          change: parseFloat((price - prev).toFixed(2)),
          changePct: parseFloat(chg.toFixed(2)),
          status: 'ok'
        };
      })
    );

    const market = {};
    results.forEach((r, i) => {
      market[indices[i].name] = r.status === 'fulfilled'
        ? r.value
        : { name: indices[i].name, price: null, status: 'error' };
    });

    res.status(200).json({ success: true, updatedAt: new Date().toISOString(), market });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
