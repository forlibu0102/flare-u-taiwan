import ical from 'node-ical';

const CALENDAR_URL = 'https://calendar.google.com/calendar/ical/forlibu0102%40gmail.com/public/basic.ics';
const ONE_YEAR = 366 * 24 * 60 * 60 * 1000;

const taipeiDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toCandidate(event) {
  return {
    title: event.summary?.trim() || '未命名行程',
    start: event.start,
    end: event.end,
    allDay: event.isFullDay ?? event.datetype === 'date',
  };
}

function serializeEvent(event) {
  return {
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    allDay: event.allDay,
  };
}

function taipeiDateKey(value) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function occursOnTaipeiDate(event, dateKey) {
  const startDate = taipeiDateKey(event.start);
  const finalMoment = new Date(event.end.getTime() - 1);
  const endDate = taipeiDateKey(finalMoment);

  return startDate <= dateKey && endDate >= dateKey;
}

function isValidDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getTaipeiDateRange(dateKey) {
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { start, end };
}

export default async function handler(request, response) {
  try {
    const calendarResponse = await fetch(CALENDAR_URL, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'FLARE-U-Taiwan/1.0',
      },
    });

    if (!calendarResponse.ok) {
      throw new Error(
        `Calendar request failed: ${calendarResponse.status}`
      );
    }

    const now = new Date();

    const url = new URL(
      request.url,
      'https://flare-u-taiwan.vercel.app'
    );

    const dateParam = url.searchParams.get('date');
    const scope = url.searchParams.get('scope');

    let rangeStart = now;
    let rangeEnd = new Date(now.getTime() + ONE_YEAR);
    let targetDate = null;

    if (dateParam) {
      if (!isValidDateKey(dateParam)) {
        return response.status(400).json({
          error: '日期格式錯誤，請使用 YYYY-MM-DD',
        });
      }

      targetDate = dateParam;

      const range = getTaipeiDateRange(dateParam);
      rangeStart = range.start;
      rangeEnd = range.end;
    }

    const calendar = ical.sync.parseICS(
      await calendarResponse.text()
    );

    const candidates = [];

    for (const event of Object.values(calendar)) {
      if (
        event.type !== 'VEVENT' ||
        event.status === 'CANCELLED'
      ) {
        continue;
      }

      if (event.rrule) {
        const instances = ical.expandRecurringEvent(event, {
          from: rangeStart,
          to: rangeEnd,
          expandOngoing: true,
        });

        candidates.push(...instances.map(toCandidate));
      } else if (
        event.start &&
        event.end &&
        event.end > rangeStart &&
        event.start < rangeEnd
      ) {
        candidates.push(toCandidate(event));
      }
    }

    candidates.sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );

    if (targetDate) {
      const events = candidates
        .filter((event) => occursOnTaipeiDate(event, targetDate))
        .map(serializeEvent);

      response.setHeader(
        'Cache-Control',
        's-maxage=300, stale-while-revalidate=600'
      );

      response.status(200).json({ events });
      return;
    }

    if (scope === 'today') {
      const today = taipeiDateKey(now);

      const events = candidates
        .filter((event) => occursOnTaipeiDate(event, today))
        .map(serializeEvent);

      response.setHeader(
        'Cache-Control',
        's-maxage=300, stale-while-revalidate=600'
      );

      response.status(200).json({ events });
      return;
    }

    const nextEvent = candidates[0];
    const nextEventDate =
      nextEvent && taipeiDateFormatter.format(nextEvent.start);

    const eventsOnNextDate = nextEvent
      ? candidates.filter(
          (event) =>
            taipeiDateFormatter.format(event.start) ===
            nextEventDate
        )
      : [];

    response.setHeader(
      'Cache-Control',
      's-maxage=300, stale-while-revalidate=600'
    );

    response.status(200).json(
      nextEvent
        ? {
            ...serializeEvent(nextEvent),
            events: eventsOnNextDate.map(serializeEvent),
          }
        : null
    );
  } catch (error) {
    console.error(
      'Unable to load the next calendar event',
      error
    );

    response.status(503).json({
      error: '行程暫時無法載入',
    });
  }
}
