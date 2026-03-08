// api/chart.js - Yahoo Finance v8 chart API로 OHLCV 데이터 가져오기
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ success: false, error: 'ticker required' });

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

  try {
    // 60일 일봉 데이터 (MA20 + 여유분)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`;
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('no result');

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const opens   = q.open   || [];
    const highs   = q.high   || [];
    const lows    = q.low    || [];
    const closes  = q.close  || [];
    const volumes = q.volume || [];

    const candles = timestamps.map((ts, i) => ({
      t: ts * 1000,
      o: opens[i]   ? parseFloat(opens[i].toFixed(0))   : null,
      h: highs[i]   ? parseFloat(highs[i].toFixed(0))   : null,
      l: lows[i]    ? parseFloat(lows[i].toFixed(0))    : null,
      c: closes[i]  ? parseFloat(closes[i].toFixed(0))  : null,
      v: volumes[i] || 0,
    })).filter(c => c.o && c.c);

    return res.status(200).json({ success: true, ticker, candles });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
