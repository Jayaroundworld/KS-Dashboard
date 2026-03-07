// api/stocks.js - Vercel Serverless Function
// Yahoo Finance를 통해 한국 주식 실시간 데이터 제공

export default async function handler(req, res) {
  // CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const tickers = [
    { name: '테크윙',           code: '089030', ticker: '089030.KQ', market: 'KOSDAQ', sector: 'HBM 검사장비' },
    { name: 'HPSP',            code: '403870', ticker: '403870.KQ', market: 'KOSDAQ', sector: '고압수소 어닐링' },
    { name: '한화시스템',        code: '272210', ticker: '272210.KS', market: 'KOSPI',  sector: '방산·AI전장' },
    { name: 'SK',              code: '034730', ticker: '034730.KS', market: 'KOSPI',  sector: '지주사 NAV' },
    { name: 'HD현대에너지솔루션', code: '322000', ticker: '322000.KS', market: 'KOSPI',  sector: '태양광' },
    { name: '현대로템',          code: '064350', ticker: '064350.KS', market: 'KOSPI',  sector: 'K2전차·수소' },
    { name: 'KAI',             code: '047810', ticker: '047810.KS', market: 'KOSPI',  sector: '항공우주·방산' },
    { name: 'SK스퀘어',         code: '402340', ticker: '402340.KS', market: 'KOSPI',  sector: 'SK하이닉스 지분' },
    { name: '서진시스템',        code: '178320', ticker: '178320.KQ', market: 'KOSDAQ', sector: '방산·배터리케이스' },
    { name: '에이비엘바이오',     code: '298380', ticker: '298380.KQ', market: 'KOSDAQ', sector: '이중항체 플랫폼' },
  ];

  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

    async function fetchStock(stock) {
      // 1차: v7 quote (등락률 직접 포함)
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${stock.ticker}`;
        const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (!r.ok) throw new Error(`v7 HTTP ${r.status}`);
        const data = await r.json();
        const q = data?.quoteResponse?.result?.[0];
        if (!q || q.regularMarketPrice == null) throw new Error('No v7 quote');
        return {
          ...stock,
          price:     Math.round(q.regularMarketPrice),
          prevClose: Math.round(q.regularMarketPreviousClose ?? q.regularMarketPrice),
          change:    Math.round(q.regularMarketChange ?? 0),
          changePct: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
          volume:    q.regularMarketVolume ?? 0,
          high52:    Math.round(q.fiftyTwoWeekHigh ?? 0),
          low52:     Math.round(q.fiftyTwoWeekLow ?? 0),
          marketCap: q.marketCap ?? 0,
          status: 'ok',
          updatedAt: new Date().toISOString(),
        };
      } catch(_) {}

      // 2차: v8 chart fallback
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${stock.ticker}?interval=1d&range=5d`;
      const response = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) throw new Error('No data');
      const meta = result.meta;
      const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(v => v != null);
      const price     = meta.regularMarketPrice ?? closes.at(-1) ?? 0;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2) ?? price;
      const change    = price - prevClose;
      const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
      return {
        ...stock,
        price:     Math.round(price),
        prevClose: Math.round(prevClose),
        change:    Math.round(change),
        changePct: parseFloat(changePct.toFixed(2)),
        volume:    meta.regularMarketVolume ?? 0,
        high52:    Math.round(meta.fiftyTwoWeekHigh ?? 0),
        low52:     Math.round(meta.fiftyTwoWeekLow ?? 0),
        marketCap: meta.marketCap ?? 0,
        status: 'ok',
        updatedAt: new Date().toISOString(),
      };
    }

    const results = await Promise.allSettled(tickers.map(fetchStock));

    const stocks = results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        ...tickers[i],
        price: null,
        change: null,
        changePct: null,
        status: 'error',
        error: result.reason?.message,
      };
    });

    res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      marketStatus: getMarketStatus(),
      stocks,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

function getMarketStatus() {
  const now = new Date();
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hours = kst.getUTCHours();
  const minutes = kst.getUTCMinutes();
  const day = kst.getUTCDay(); // 0=일, 6=토
  const totalMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) return 'closed'; // 주말
  if (totalMinutes >= 9 * 60 && totalMinutes < 15 * 60 + 30) return 'open';
  if (totalMinutes >= 8 * 60 + 30 && totalMinutes < 9 * 60) return 'pre';
  if (totalMinutes >= 15 * 60 + 30 && totalMinutes < 18 * 60) return 'after';
  return 'closed';
}
