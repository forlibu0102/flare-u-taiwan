import ical from 'node-ical';

const CALENDAR_URL = 'https://calendar.google.com/calendar/ical/forlibu0102%40gmail.com/public/basic.ics';
const ONE_YEAR = 366 * 24 * 60 * 60 * 1000;

function toCandidate(event) {
  return {
    title: event.summary?.trim() || '未命名行程',
    start: event.start,
    end: event.end,
    allDay: event.isFullDay ?? event.datetype === 'date',
  };
}

export default async function handler(_request, response) {
  try {
    const calendarResponse = await fetch(CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'FLARE-U-Taiwan/1.0' },
    });

    if (!calendarResponse.ok) {
      throw new Error(`Calendar request failed: ${calendarResponse.status}`);
    }

    const now = new Date();
    const rangeEnd = new Date(now.getTime() + ONE_YEAR);
    const calendar = ical.sync.parseICS(await calendarResponse.text());
    const candidates = [];

    for (const event of Object.values(calendar)) {
      if (event.type !== 'VEVENT' || event.status === 'CANCELLED') continue;

      if (event.rrule) {
        const instances = ical.expandRecurringEvent(event, {
          from: now,
          to: rangeEnd,
          expandOngoing: true,
        });
        candidates.push(...instances.map(toCandidate));
      } else if (event.start && event.end && event.end > now && event.start <= rangeEnd) {
        candidates.push(toCandidate(event));
      }
    }

    candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
    const nextEvent = candidates[0];

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    response.status(200).json(nextEvent ? {
      title: nextEvent.title,
      start: nextEvent.start.toISOString(),
      end: nextEvent.end.toISOString(),
      allDay: nextEvent.allDay,
    } : null);
  } catch (error) {
    console.error('Unable to load the next calendar event', error);
    response.status(503).json({ error: '行程暫時無法載入' });
  }
}
