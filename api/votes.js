import { parse } from 'csv-parse/sync';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1JkuheRKxlEpAjgWZ_BMa5KOpt3Y1gm3rzjfC0m29zk0/export?format=csv&gid=0';

function parseTaipeiDate(value, currentYear) {
  const match = String(value || '').match(/(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})[^\d]+(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const [, suppliedYear, month, day, hour, minute] = match;
  const year = Number(suppliedYear || currentYear);
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+08:00`);
}

function splitPlatforms(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^[\s•·・-]+/, '').trim())
    .filter(Boolean);
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
    const currentYear = Number(new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
    }).format(now));

    const votes = rows
      .filter((row) => !['否', 'no', 'false', '0'].includes(String(row['顯示'] || '').toLowerCase()))
      .map((row) => {
        const start = parseTaipeiDate(row['開始時間'], currentYear);
        const end = parseTaipeiDate(row['截止時間'], currentYear);
        if (!end) return null;

        return {
          title: row['投票名稱'] || '未命名投票',
          platforms: splitPlatforms(row['投票平台']),
          start: start?.toISOString() || null,
          end: end.toISOString(),
          rank: row['目前名次'] || '',
          votes: row['目前票數'] || '',
          gap: row['與第一名票數差距'] || '',
          updatedAt: row['資料更新時間'] || '',
          voteUrl: row['投票連結'] || '',
          appStoreUrl: row['App Store'] || '',
          googlePlayUrl: row['Google Play'] || '',
          method: row['投票方式'] || '',
          note: row['注意事項'] || '',
        };
      })
      .filter(Boolean)
      .filter((vote) => new Date(vote.end) > now)
      .sort((a, b) => new Date(a.end) - new Date(b.end));

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(votes);
  } catch (error) {
    console.error('Unable to load voting data', error);
    response.status(503).json({ error: '投票資料暫時無法載入' });
  }
}
