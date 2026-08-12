import { parse } from 'csv-parse/sync';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1uzxwYFdSjCII6OYoumPTrAuoBbaGC09TDXRX2LcpysE/export?format=csv&gid=0';

function parseDateParts(value) {
  const match = String(value || '').trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return { year, month: month.padStart(2, '0'), day: day.padStart(2, '0') };
}

function parseTaipeiDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour = '23', minute = '59'] = match;
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+08:00`);
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
    const now = new Date();

    const announcements = rows
      .filter((row) => !['否', 'no', 'false', '0'].includes(String(row['顯示'] || '').toLowerCase()))
      .map((row, rowIndex) => {
        const date = parseDateParts(row['發布日期'] || row['顯示日期']);
        const expiresAt = parseTaipeiDateTime(row['下架時間']);
        if (!date || !row['公告標題']) return null;
        return {
          category: row['公告分類'] || 'LATEST UPDATE',
          title: row['公告標題'],
          description: row['公告說明'] || '',
          year: date.year,
          monthDay: `${date.month}.${date.day}`,
          dateTime: `${date.year}-${date.month}-${date.day}`,
          url: row['外部連結'] || '#',
          linkText: row['連結文字'] || '了解更多',
          expiresAt,
          order: String(row['排序'] || '').trim() === '' ? Number.MAX_SAFE_INTEGER : Number(row['排序']),
          rowIndex,
        };
      })
      .filter(Boolean)
      .filter((item) => !item.expiresAt || item.expiresAt > now)
      .sort((a, b) => a.order - b.order || a.rowIndex - b.rowIndex)
      .map(({ expiresAt, order, rowIndex, ...item }) => item);

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(announcements);
  } catch (error) {
    console.error('Unable to load announcements', error);
    response.status(503).json({ error: '公告資料暫時無法載入' });
  }
}
