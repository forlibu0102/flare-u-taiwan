import { parse } from 'csv-parse/sync';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/14tiEetP0tHCHhnK7RO3L3Ub-VGJckTe9v_ZhjM9Xj20/export?format=csv&gid=0';

function parseDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!match) return null;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  return {
    year,
    month,
    day,
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: Date.UTC(year, month - 1, day),
  };
}

function isNo(value) {
  return ['否', 'no', 'false', '0'].includes(String(value || '').trim().toLowerCase());
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

    const milestones = rows
      .filter((row) => !isNo(row['顯示']))
      .map((row) => {
        const start = parseDate(row['日期']);
        const end = parseDate(row['結束日期']) || start;
        const title = String(row['標題'] || '').trim();
        if (!start || !end || !title || end.timestamp < start.timestamp) return null;
        return {
          startDate: start.iso,
          endDate: end.iso,
          year: start.year,
          startMonth: start.month,
          startDay: start.day,
          endMonth: end.month,
          endDay: end.day,
          title,
          description: String(row['說明'] || '').trim(),
          highlight: ['是', 'yes', 'true', '1'].includes(String(row['是否重點'] || '').trim().toLowerCase()),
          sortAt: start.timestamp,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.sortAt - b.sortAt)
      .map(({ sortAt, ...item }) => item);

    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    response.status(200).json(milestones);
  } catch (error) {
    console.error('Unable to load milestones', error);
    response.status(503).json({ error: '大事記資料暫時無法載入' });
  }
}
