// api/stocks.js - Vercel Serverless Function
// Yahoo Finance를 통해 한국 주식 실시간 데이터 제공

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  try {
    // 1. Yahoo Finance 스크리너를 통해 '한국 시장 내 상승 모멘텀/거래량 상위' 종목 동적 추출
    // 이 API는 'day_gainers' (상승률 상위)나 'most_actives' (거래 활발) 종목을 가져옵니다.
    const screenerUrl = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=10&region=KR`;
    
    const screenerRes = await fetch(screenerUrl, { headers: { 'User-Agent': UA } });
    const screenerData = await screenerRes.json();
    
    // 한국 종목(.KS, .KQ)만 필터링하여 ticker 리스트 생성
    const dynamicTickers = screenerData?.finance?.result?.[0]?.quotes
      .filter(q => q.symbol.endsWith('.KS') || q.symbol.endsWith('.KQ'))
      .map(q => ({
        name: q.shortName || q.symbol,
        ticker: q.symbol,
        code: q.symbol.split('.')[0],
        market: q.symbol.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ',
        sector: '실시간 트렌드 상위' // 스크리너 특성상 섹터는 수동 매핑이 필요함
      })) || [];

    // 만약 동적 추출에 실패하면 기존 백업 데이터를 사용 (안정성 확보)
    const finalTickers = dynamicTickers.length > 0 ? dynamicTickers : [
      { name: '삼성전자', ticker: '005930.KS', code: '005930', market: 'KOSPI', sector: '반도체' }
    ];

    // 2. 개별 종목 상세 데이터 페치 함수
    async function fetchStock(stock) {
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${stock.ticker}&_=${Date.now()}`;
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        const data = await r.json();
        const q = data?.quoteResponse?.result?.[0];

        if (!q) return { ...stock, status: 'error' };

        // 수급/성장성 지표 대용 (Yahoo 제공 지표 활용)
        // EPS 성장률이나 기관 보유 비율 등을 제공하는 경우도 있으나 한국 종목은 제한적
        return {
          ...stock,
          price: Math.round(q.regularMarketPrice),
          changePct: parseFloat((q.regularMarketChangePercent ?? 0).toFixed(2)),
          volume: q.regularMarketVolume ?? 0,
          marketCap: q.marketCap ?? 0,
          // 외국인/기관 수급 대신 '거래량 강도'와 '52주 고가 대비 위치'로 트렌드 판단
          trendScore: q.regularMarketVolume / q.averageDailyVolume3Month, 
          status: 'ok',
          updatedAt: new Date().toISOString(),
        };
      } catch (e) {
        return { ...stock, status: 'error' };
      }
    }

    const results = await Promise.all(finalTickers.map(fetchStock));
    res.status(200).json(results);

  } catch (error) {
    res.status(500).json({ error: error.message });
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
