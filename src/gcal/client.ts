import type { GoogleAuth } from '../google/auth.ts';

/**
 * Google Calendar API — faqat kerakli to'rt amal.
 * SDK ishlatilmaydi: bu REST chaqiruvlar oddiy va bog'liqlik qo'shmaydi.
 */

export type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string }[];
  htmlLink?: string;
};

export type GcalClient = {
  id: string;
  enabled: boolean;
  list: (fromIso: string, toIso: string) => Promise<GEvent[]>;
  create: (event: NewEvent) => Promise<GEvent>;
  update: (id: string, event: Partial<NewEvent>) => Promise<GEvent>;
  remove: (id: string) => Promise<void>;
  /** Ulanishni tekshirish — kalendar nomini qaytaradi. */
  check: () => Promise<string>;
};

export type NewEvent = {
  title: string;
  startIso: string;
  endIso: string;
  location?: string;
  description?: string;
  timeZone: string;
};

const API = 'https://www.googleapis.com/calendar/v3';

/** Hodisani API kutadigan ko'rinishga o'giradi. */
function toGoogle(e: Partial<NewEvent>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (e.title !== undefined) body['summary'] = e.title;
  if (e.location !== undefined) body['location'] = e.location;
  if (e.description !== undefined) body['description'] = e.description;
  if (e.startIso) body['start'] = { dateTime: e.startIso, timeZone: e.timeZone };
  if (e.endIso) body['end'] = { dateTime: e.endIso, timeZone: e.timeZone };
  return body;
}

/** apiBase — faqat sinov uchun almashtiriladi. */
export function gcalClient(auth: GoogleAuth, calendarId: string, apiBase: string = API): GcalClient {
  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const token = await auth.accessToken();
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 204) return {} as T;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      const hint =
        res.status === 404
          ? ` (kalendar "${calendarId}" topilmadi${auth.mode === 'service' ? ' — kalendarni xizmat hisobiga ulashdingizmi?' : ''})`
          : res.status === 403
            ? ' (ruxsat yetarli emas — yozish huquqi berilganmi?)'
            : '';
      throw new Error(`Google Calendar: ${msg}${hint}`);
    }
    return data as T;
  };

  const enc = encodeURIComponent(calendarId);

  return {
    id: `gcal:${calendarId}`,
    enabled: true,

    list: async (fromIso, toIso) => {
      const params = new URLSearchParams({
        timeMin: fromIso,
        timeMax: toIso,
        singleEvents: 'true', // takrorlanuvchilar alohida hodisa bo'lib keladi
        orderBy: 'startTime',
        maxResults: '250',
      });
      const data = await call<{ items?: GEvent[] }>(`/calendars/${enc}/events?${params}`);
      return data.items ?? [];
    },

    create: (event) =>
      call<GEvent>(`/calendars/${enc}/events`, { method: 'POST', body: JSON.stringify(toGoogle(event)) }),

    update: (id, event) =>
      call<GEvent>(`/calendars/${enc}/events/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(toGoogle(event)),
      }),

    remove: async (id) => {
      await call(`/calendars/${enc}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    check: async () => {
      const data = await call<{ summary?: string; id?: string }>(`/calendars/${enc}`);
      return data.summary ?? data.id ?? calendarId;
    },
  };
}

export function disabledGcal(): GcalClient {
  const fail = (): never => {
    throw new Error(
      [
        'Google Calendar ulanmagan (HAMROH_GCAL=off).',
        '',
        'Shaxsiy hisob uchun:',
        '  hamroh kalendar auth',
        '',
        'Server uchun (brauzersiz):',
        '  HAMROH_GCAL=service',
        '  GOOGLE_SERVICE_ACCOUNT_FILE=/opt/hamroh/gcal-key.json',
        '',
        'Batafsil: docs/GCALENDAR.md',
      ].join('\n'),
    );
  };
  return {
    id: 'off',
    enabled: false,
    list: () => Promise.reject(new Error(fail())),
    create: () => Promise.reject(new Error(fail())),
    update: () => Promise.reject(new Error(fail())),
    remove: () => Promise.reject(new Error(fail())),
    check: () => Promise.reject(new Error(fail())),
  };
}
