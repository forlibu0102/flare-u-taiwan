import { parse } from 'csv-parse/sync';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/17B0IQM7ffaonREBhSuVN0PneBzoOOY1y61DSl9j5QzU/export?format=csv&gid=0';
const CATEGORY_ORDER = ['works', 'vlog', 'behind', 'live', 'music-shows', 'fancams', 'shows', 'radio', 'stage'];
const CATEGORY_DEFAULTS = {
  works: ['作品相關', 'MUSIC & RELEASES'],
  'music-shows': ['打歌舞台', 'MUSIC SHOWS'],
  fancams: ['個人直拍', 'MEMBER FANCAMS'],
  shows: ['綜藝／訪談', 'SHOWS & INTERVIEWS'],
  radio: ['電台節目', 'RADIO'],
  behind: ['幕後花絮', 'BEHIND THE SCENES'],
  stage: ['舞台表演', 'PERFORMANCES'],
  vlog: ['VLOG', 'VLOG'],
  live: ['直播', 'LIVE'],
};

function getYouTubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.endsWith('youtube.com')) {
      return url.searchParams.get('v')
        || url.pathname.match(/^\/shorts\/([^/?]+)/)?.[1]
        || url.pathname.match(/^\/embed\/([^/?]+)/)?.[1]
        || null;
    }
  } catch {}
  return null;
}

function parsePublishedDate(value) {
  const match = String(value || '').trim().match(/^(\d{2}|\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const [, rawYear, rawMonth, rawDay] = match;
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return Date.UTC(year, Number(rawMonth) - 1, Number(rawDay));
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
    const groups = new Map();

    rows.forEach((row, rowIndex) => {
      if (['否', 'no', 'false', '0'].includes(String(row['顯示'] || '').toLowerCase())) return;
      const id = String(row['分類代碼'] || '').trim();
      const videoId = getYouTubeId(String(row['影片網址'] || '').trim());
      const title = String(row['影片標題'] || '').trim();
      if (!id || !videoId || !title) return;

      if (!groups.has(id)) {
        const fallback = CATEGORY_DEFAULTS[id] || [id, id.toUpperCase()];
        groups.set(id, {
          id,
          label: String(row['分類名稱'] || fallback[0]).trim(),
          eyebrow: String(row['英文分類名'] || fallback[1]).trim(),
          videos: [],
        });
      }

      groups.get(id).videos.push({
        id: videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: String(row['來源頻道'] || 'YOUTUBE').trim(),
        order: String(row['排序'] || '').trim() === '' ? null : Number(row['排序']),
        publishedAt: parsePublishedDate(row['發布日期']),
        rowIndex,
      });
    });

    const result = Array.from(groups.values())
      .map((group) => ({
        ...group,
        videos: group.videos
          .sort((a, b) => {
            const aHasOrder = Number.isFinite(a.order);
            const bHasOrder = Number.isFinite(b.order);
            if (aHasOrder && bHasOrder) return a.order - b.order || a.rowIndex - b.rowIndex;
            if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1;
            return b.publishedAt - a.publishedAt || a.rowIndex - b.rowIndex;
          })
          .map(({ order, publishedAt, rowIndex, ...video }) => video),
      }))
      .sort((a, b) => {
        const aIndex = CATEGORY_ORDER.indexOf(a.id);
        const bIndex = CATEGORY_ORDER.indexOf(b.id);
        return (aIndex === -1 ? CATEGORY_ORDER.length : aIndex)
          - (bIndex === -1 ? CATEGORY_ORDER.length : bIndex);
      });

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(result);
  } catch (error) {
    console.error('Unable to load media data', error);
    response.status(503).json({ error: '影音資料暫時無法載入' });
  }
}
