import { parse } from 'csv-parse/sync';

const SHEET_ID = '1OzRLnxWBvdxebT9zIRZ2FfRhTtmn_bZ7_XCEzuKnXP4';
const SHEET_NAME = '新聞';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

const falseValues = new Set(['否', 'no', 'false', '0', '隱藏']);
const trueValues = new Set(['是', 'yes', 'true', '1', '置頂']);

function isVisible(value) {
  return !falseValues.has(String(value || '').trim().toLowerCase());
}

function isPinned(value) {
  return trueValues.has(String(value || '').trim().toLowerCase());
}

function dateValue(value) {
  const parts = String(value || '').trim().match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!parts) return 0;
  const year = Number(parts[1]) < 100 ? 2000 + Number(parts[1]) : Number(parts[1]);
  return Date.UTC(year, Number(parts[2]) - 1, Number(parts[3]));
}

function displayDate(value) {
  const parts = String(value || '').trim().match(/^(\d{2,4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!parts) return String(value || '').trim();
  const year = Number(parts[1]) < 100 ? 2000 + Number(parts[1]) : Number(parts[1]);
  return `${year}.${String(parts[2]).padStart(2, '0')}.${String(parts[3]).padStart(2, '0')}`;
}

function inferMedia(urlValue) {
  try {
    const hostname = new URL(urlValue).hostname.replace(/^www\./, '');
    const names = {
      'm.entertain.naver.com': 'NAVER 娛樂',
      'entertain.naver.com': 'NAVER 娛樂',
      'slist.kr': 'Single List',
      'sports.donga.com': '體育東亞',
      'mydaily.co.kr': 'MyDaily',
      'enews.imbc.com': 'iMBC 娛樂',
    };
    return names[hostname] || hostname;
  } catch {
    return '新聞媒體';
  }
}

export default async function handler(_request, response) {
  try {
    const sheetResponse = await fetch(SHEET_URL, { signal: AbortSignal.timeout(8000) });
    if (!sheetResponse.ok) throw new Error(`Sheet request failed: ${sheetResponse.status}`);
    const rows = parse(await sheetResponse.text(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    const news = rows
      .filter((row) => isVisible(row['顯示']) && (row['新聞標題'] || row['中文摘要']) && row['原文連結'])
      .map((row, index) => {
        const summary = String(row['中文摘要'] || '').trim();
        return {
          date: displayDate(row['發布日期']),
          media: String(row['媒體名稱'] || '').trim() || inferMedia(row['原文連結']),
          category: String(row['新聞分類'] || '').trim() || '新聞',
          title: String(row['新聞標題'] || '').trim() || summary,
          summary: String(row['新聞標題'] || '').trim() ? summary : '',
          coverUrl: String(row['封面網址'] || '').trim(),
          originalUrl: String(row['原文連結'] || '').trim(),
          linkText: String(row['連結文字'] || '').trim() || '閱讀原文',
          pinned: isPinned(row['置頂']),
          dateOrder: dateValue(row['發布日期']),
          sourceOrder: index,
        };
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.dateOrder - a.dateOrder || a.sourceOrder - b.sourceOrder)
      .map(({ dateOrder, sourceOrder, ...item }) => item);

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(news);
  } catch (error) {
    console.error('Unable to load news', error);
    response.status(503).json({ error: '新聞資料暫時無法載入' });
  }
}
