import { parse } from 'csv-parse/sync';

const SHEET_ID = '1sb0nrk4etYMRe_gP9iE5fCRU1RagvYn3o6raQRwQnY0';
const sheetUrl = (name) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
const hidden = (value) => ['否', 'no', 'false', '0'].includes(String(value || '').trim().toLowerCase());
const orderOf = (value, fallback) => String(value || '').trim() === '' ? fallback : Number(value);

async function loadSheet(name) {
  const result = await fetch(sheetUrl(name), { signal: AbortSignal.timeout(8000) });
  if (!result.ok) throw new Error(`${name} sheet request failed: ${result.status}`);
  return parse(await result.text(), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

export default async function handler(_request, response) {
  try {
    const [albumRows, trackRows] = await Promise.all([loadSheet('專輯'), loadSheet('曲目')]);
    const albums = albumRows
      .filter((row) => !hidden(row['顯示']) && row['專輯名稱'])
      .map((row, index) => {
        const name = row['專輯名稱'].trim();
        const links = [
          ['Official MV', row['官方MV']],
          ['YouTube Music', row['YouTube Music']],
          ['Spotify', row['Spotify']],
          ['Apple Music', row['Apple Music']],
          ['KKBOX', row['KKBOX']],
          ['Melon', row['Melon']],
        ].filter(([, url]) => url);
        const tracks = trackRows
          .filter((track) => String(track['所屬專輯'] || '').trim() === name && track['歌名'])
          .map((track, trackIndex) => ({
            number: String(track['曲序'] || trackIndex + 1).padStart(2, '0'),
            title: track['歌名'], badge: track['標籤'] || '', description: track['歌曲介紹'] || '',
            order: orderOf(track['曲序'], trackIndex),
          }))
          .sort((a, b) => a.order - b.order)
          .map(({ order, ...track }) => track);
        return {
          name, releaseDate: row['發行日期'] || '', coverUrl: row['封面網址'] || '',
          description: String(row['專輯簡介'] || '').split(/\n+/).filter(Boolean),
          links, tracks, order: orderOf(row['排序'], index),
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ order, ...album }) => album);

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(albums);
  } catch (error) {
    console.error('Unable to load albums', error);
    response.status(503).json({ error: '專輯資料暫時無法載入' });
  }
}
