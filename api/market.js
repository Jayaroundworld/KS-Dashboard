// api/market.js - 한국 지수 + 미국 주요 지수 + 선물 + 환율
// Yahoo Finance v7 → v8 fallback, 주말 왜곡 자동 보정

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const KR_INDICES = [
    { name: 'KOSPI',   ticker: '^KS11',    group: 'kr' },
    { name: 'KOSDAQ',  ticker: '^KQ11',    group: 'kr' },
    { name: 'USD/KRW', ticker: 'KRW=X',    group: 'kr' },
  ];

  const US_INDICES = [
    { name: 'S&P500',   ticker: '^GSPC',     group: 'us', unit: '' },
    { name: '나스닥',    ticker: '^IXIC',     group: 'us', unit: '' },
    { name: '다우',      ticker: '^DJI',      group: 'us', unit: '' },
    { name: 'S&P선물',  ticker: 'ES=F',      group: 'us_futures', unit: '' },
    { name: '나스닥선물', ticker: 'NQ=F',     group: 'us_futures', unit: '' },
    { name: 'VIX',      ticker: '^VIX',      group: 'us_vix', unit: '' },
    { name: '달러인덱스', ticker: 'DX-Y.NYB', group: 'us', unit: '' },
  ];

  const ALL = [...KR_INDICES, ...US_INDICES];
  const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36';

  function getMarketStatus() {
    const kst   = new Date(Date.now() + 9 * 3600 * 1000);
    const day   = kst.getUTCDay();
    const total = kst.getUTCHours() * 60 + kst.getUTCMinutes();
    if (day === 0 || day === 6) return 'weekend';
    if (total >= 9*60 && total < 15*60+30) return 'open';
    if (total >= 8*60+30 && total < 9*60)  return 'pre';
    if (total >= 15*60+30 && total < 18*60) return 'after';
    return 'closed';
  }

  async function fetchV8(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const r    = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No v8 data');
    const meta   = result.meta;
    const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(v => v != null);
    const price  = meta.regularMarketPrice ?? closes.at(-1) ?? 0;
    const prev   = meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2) ?? price;
    const chg    = price - prev;
    const pct    = prev !== 0 ? (chg / prev) * 100 : 0;
    return {
      price:     parseFloat(price.toFixed(2)),
      change:    parseFloat(chg.toFixed(2)),
      changePct: parseFloat(pct.toFixed(2)),
      prevClose: parseFloat(prev.toFixed(2)),
    };
  }

  async function fetchOne({ name, ticker, group }) {
    // 1차: v7 quote
    try {
      const url  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
      const r    = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (!r.ok) throw new Error(`v7 ${r.status}`);
      const data = await r.json();
      const q    = data?.quoteResponse?.result?.[0];
      if (!q || q.regularMarketPrice == null) throw new Error('empty');
      return {
        name, group,
        price:     parseFloat((q.regularMarketPrice).toFixed(2)),
        change:    parseFloat((q.regularMarketChange ?? 0).toFixed(2)),
        changePct: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
        prevClose: parseFloat((q.regularMarketPreviousClose ?? 0).toFixed(2)),
        // 선물/VIX 추가 필드
        marketState: q.marketState ?? null,
        status: 'ok',
      };
    } catch (_) {}

    // 2차: v8 fallback
    try {
      const nums = await fetchV8(ticker);
      return { name, group, ...nums, status: 'ok' };
    } catch (e) {
      return { name, group, price: null, change: null, changePct: null, status: 'error', error: e.message };
    }
  }

  try {
    const marketStatus = getMarketStatus();
    const isWeekend    = marketStatus === 'weekend';

    const items = await Promise.all(ALL.map(fetchOne));

    // 주말 왜곡 보정: 한국 지수만 ±8% 필터 (미국 선물은 장중이므로 제외)
    const sanitized = items.map(item => {
      if (isWeekend && item.group === 'kr' && item.changePct !== null && Math.abs(item.changePct) > 8) {
        return { ...item, change: null, changePct: null, dataNote: 'cross_day_distortion' };
      }
      return item;
    });

    // group별로 분류
    const result = {
      kr:         sanitized.filter(i => i.group === 'kr'),
      us:         sanitized.filter(i => i.group === 'us'),
      us_futures: sanitized.filter(i => i.group === 'us_futures'),
      us_vix:     sanitized.filter(i => i.group === 'us_vix'),
      // 기존 market 키 호환성 유지
      market: Object.fromEntries(sanitized.filter(i => i.group === 'kr').map(i => [i.name, i])),
    };

    res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),
      marketStatus,
      ...result,
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
