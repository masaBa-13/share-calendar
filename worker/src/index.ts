export interface Env {
  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  CALENDAR_IDS: string;
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  OWNER_CALENDAR: string;
}

type ErrorCode =
  | 'NETWORK_ERROR'
  | 'UPSTREAM_ERROR'
  | 'AUTH_ERROR'
  | 'CALENDAR_ERROR'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

const WORK_START = 9 * 60;
const WORK_END   = 17 * 60;
const DAY_JP = ['日', '月', '火', '水', '木', '金', '土'];
const INPERSON_BUFFER = 30;

function getJapaneseHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fixed = [
    `${year}-01-01`, `${year}-02-11`, `${year}-02-23`, `${year}-04-29`,
    `${year}-05-03`, `${year}-05-04`, `${year}-05-05`, `${year}-08-11`,
    `${year}-11-03`, `${year}-11-23`,
  ];
  for (const d of fixed) holidays.add(d);
  holidays.add(nthMonday(year, 1, 2));
  holidays.add(nthMonday(year, 7, 3));
  holidays.add(nthMonday(year, 9, 3));
  holidays.add(nthMonday(year, 10, 2));
  holidays.add(vernalEquinox(year));
  holidays.add(autumnalEquinox(year));

  const result = new Set<string>(holidays);
  for (const h of holidays) {
    const d = new Date(h + 'T00:00:00');
    if (d.getDay() === 0) {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      result.add(next.toISOString().slice(0, 10));
    }
  }
  return result;
}

function nthMonday(year: number, month: number, n: number): string {
  const d = new Date(year, month - 1, 1);
  const diff = (8 - d.getDay()) % 7;
  d.setDate(1 + diff + (n - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function vernalEquinox(year: number): string {
  const day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return `${year}-03-${String(day).padStart(2, '0')}`;
}

function autumnalEquinox(year: number): string {
  const day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  return `${year}-09-${String(day).padStart(2, '0')}`;
}

async function getGoogleAccessToken(env: Env, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = btoa(JSON.stringify({
    iss: env.GOOGLE_CLIENT_EMAIL,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const privateKey = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const pemBody = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sigInput = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, sigInput);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${header}.${payload}.${sigB64}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token fetch failed: ${resp.status} ${text}`);
  }
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

interface CalendarEvent {
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

async function fetchEvents(
  calendarId: string, token: string, timeMin: string, timeMax: string
): Promise<CalendarEvent[]> {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');
  const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return [];
  const data = await resp.json() as { items?: CalendarEvent[] };
  return data.items || [];
}

function getBusyMinutes(events: CalendarEvent[], dateStr: string): Set<number> {
  const busy = new Set<number>();
  for (const ev of events) {
    if (ev.transparency === 'transparent') continue;
    const start = ev.start?.dateTime || ev.start?.date;
    const end   = ev.end?.dateTime   || ev.end?.date;
    if (!start || !end) continue;

    if (ev.start?.dateTime) {
      const evDate = toJSTDateStr(ev.start.dateTime);
      if (evDate !== dateStr) continue;
      const s = toJSTMinutes(ev.start.dateTime);
      const e = toJSTMinutes(ev.end?.dateTime ?? '');
      for (let m = s; m < e; m++) busy.add(m);
    } else {
      const sd = new Date(start + 'T00:00:00+09:00');
      const ed = new Date(end   + 'T00:00:00+09:00');
      const td = new Date(dateStr + 'T00:00:00+09:00');
      if (td >= sd && td < ed) {
        for (let m = 0; m < 24 * 60; m++) busy.add(m);
      }
    }
  }
  return busy;
}

function toJSTDateStr(rfc: string): string {
  const jst = new Date(new Date(rfc).getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function toJSTMinutes(rfc: string): number {
  const jst = new Date(new Date(rfc).getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

function fmtTime(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

let oauthTokenCache: { value: string; expiresAt: number } | null = null;

async function getOAuthAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (oauthTokenCache && oauthTokenCache.expiresAt > now) {
    return oauthTokenCache.value;
  }

  let resp: Response;
  try {
    resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }).toString(),
    });
  } catch {
    throw new AppError('UPSTREAM_ERROR', 'Google認証サーバーへの接続に失敗しました。しばらくしてから再度お試しください');
  }

  if (!resp.ok) {
    const text = await resp.text();
    const isExpired = text.includes('invalid_grant');
    throw new AppError(
      'AUTH_ERROR',
      isExpired
        ? '認証トークンが無効です。管理者に連絡してください'
        : `認証に失敗しました（${resp.status}）`,
    );
  }

  const data = await resp.json() as { access_token: string; expires_in?: number };
  const ttlMs = ((data.expires_in ?? 3600) - 60) * 1000;
  oauthTokenCache = { value: data.access_token, expiresAt: now + ttlMs };
  return data.access_token;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function toErrorResponse(e: unknown, status = 500): Response {
  if (e instanceof AppError) {
    return new Response(JSON.stringify({ error: e.message, code: e.code }), {
      status: e.code === 'VALIDATION_ERROR' ? 400 : status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new Response(JSON.stringify({ error: msg, code: 'INTERNAL_ERROR' }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface EventBody {
  date: string;
  startTime: string;
  step: number;
  attendeeName: string;
  attendeeEmail: string;
}

function validateEventBody(body: unknown): EventBody {
  if (!body || typeof body !== 'object') {
    throw new AppError('VALIDATION_ERROR', 'リクエスト本文が不正です');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    throw new AppError('VALIDATION_ERROR', '日付の形式が不正です');
  }
  if (typeof b.startTime !== 'string' || !/^\d{1,2}:\d{2}$/.test(b.startTime)) {
    throw new AppError('VALIDATION_ERROR', '開始時刻の形式が不正です');
  }
  if (typeof b.step !== 'number' || b.step <= 0) {
    throw new AppError('VALIDATION_ERROR', '時間単位が不正です');
  }
  if (typeof b.attendeeName !== 'string' || !b.attendeeName.trim()) {
    throw new AppError('VALIDATION_ERROR', 'お名前を入力してください');
  }
  if (typeof b.attendeeEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.attendeeEmail)) {
    throw new AppError('VALIDATION_ERROR', 'メールアドレスの形式が不正です');
  }
  return b as unknown as EventBody;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (e: unknown) {
      return toErrorResponse(e);
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/' || url.pathname === '') {
      return Response.redirect('https://aima-ewj.pages.dev', 302);
    }

    // ---- GET /api/slots ----
    if (url.pathname === '/api/slots' && request.method === 'GET') {
      try {
        const stepParam = parseInt(url.searchParams.get('t') ?? '60');
        const step = stepParam === 30 ? 30 : 60;
        const inperson = url.searchParams.get('mode') === 'inperson';
        const buffer = inperson ? INPERSON_BUFFER : 0;

        const now = new Date();
        const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        const todayStr = jstNow.toISOString().slice(0, 10);
        const currentJSTMinutes = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes();

        const twoWeeksLater = new Date(jstNow);
        twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
        const timeMin = todayStr + 'T00:00:00+09:00';
        const timeMax = twoWeeksLater.toISOString().slice(0, 10) + 'T23:59:59+09:00';

        const token = await getGoogleAccessToken(env, 'https://www.googleapis.com/auth/calendar.readonly');
        const calIds = env.CALENDAR_IDS.split(',').map(s => s.trim()).filter(Boolean);
        const allEvents: CalendarEvent[] = [];
        await Promise.all(calIds.map(async id => {
          const evs = await fetchEvents(id, token, timeMin, timeMax);
          allEvents.push(...evs);
        }));

        const year = jstNow.getUTCFullYear();
        const holidays = new Set([...getJapaneseHolidays(year), ...getJapaneseHolidays(year + 1)]);

        const result: Array<{ date: string; label: string; slots: string[] }> = [];
        for (let i = 0; i < 14; i++) {
          const d = new Date(jstNow);
          d.setUTCDate(d.getUTCDate() + i);
          const dateStr = d.toISOString().slice(0, 10);
          // Workers は UTC 環境なので getDay() が前日を返す。
          // dateStr ("YYYY-MM-DD") を UTC 日付として扱い getUTCDay() で正確な曜日を取得する。
          const [, mmStr, ddStr] = dateStr.split('-');
          const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();

          if (dow === 0 || holidays.has(dateStr)) continue;

          const busy = getBusyMinutes(allEvents, dateStr);
          const slots: string[] = [];

          // スロット表示範囲: buffer分内側に絞る
          const slotMax = WORK_END - buffer;
          for (let m = WORK_START + buffer; m + step <= slotMax; m += step) {
            // 今日の過ぎたスロットはスキップ
            if (i === 0 && m < currentJSTMinutes) continue;

            // buffer込みの範囲が全て空きか確認
            let free = true;
            for (let j = m - buffer; j < m + step + buffer; j++) {
              if (busy.has(j)) { free = false; break; }
            }
            if (free) slots.push(fmtTime(m));
          }

          if (slots.length > 0) {
            result.push({
              date: dateStr,
              label: `${Number(mmStr)}/${Number(ddStr)}（${DAY_JP[dow]}）`,
              slots,
            });
          }
        }

        return new Response(JSON.stringify({ step, days: result }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch (e: unknown) {
        return toErrorResponse(e);
      }
    }

    // ---- POST /api/events ----
    if (url.pathname === '/api/events' && request.method === 'POST') {
      try {
        const raw = await request.json().catch(() => {
          throw new AppError('VALIDATION_ERROR', 'リクエスト本文のJSONが不正です');
        });
        const body = validateEventBody(raw);

        const [h, m] = body.startTime.split(':').map(Number);
        const startMin = h * 60 + m;
        const endMin = startMin + body.step;
        const startDT = `${body.date}T${pad2(h)}:${pad2(m)}:00+09:00`;
        const endDT   = `${body.date}T${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}:00+09:00`;

        const event = {
          summary: `${body.attendeeName}さんとのミーティング`,
          start: { dateTime: startDT, timeZone: 'Asia/Tokyo' },
          end:   { dateTime: endDT,   timeZone: 'Asia/Tokyo' },
          attendees: [{ email: body.attendeeEmail, displayName: body.attendeeName }],
          conferenceData: {
            createRequest: {
              requestId: `${body.date}-${body.startTime}-${body.attendeeEmail}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        };

        const writeToken = await getOAuthAccessToken(env);

        let calResp: Response;
        try {
          calResp = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.OWNER_CALENDAR)}/events?sendUpdates=all&conferenceDataVersion=1`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(event),
            },
          );
        } catch {
          throw new AppError('UPSTREAM_ERROR', 'Googleカレンダーへの接続に失敗しました。しばらくしてから再度お試しください');
        }

        if (!calResp.ok) {
          const isAuthError = calResp.status === 401 || calResp.status === 403;
          throw new AppError(
            isAuthError ? 'AUTH_ERROR' : 'CALENDAR_ERROR',
            isAuthError
              ? 'カレンダーへのアクセス権限がありません。管理者に連絡してください'
              : `カレンダーへの登録に失敗しました（${calResp.status}）`,
          );
        }

        const created = await calResp.json() as { id: string };
        return new Response(JSON.stringify({ ok: true, eventId: created.id }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch (e: unknown) {
        return toErrorResponse(e);
      }
    }

    return new Response('Not Found', { status: 404 });
}
