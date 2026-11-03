/**
 * Push notifications through the Expo push service. Message texts are localized here
 * (hu/en) because the notification text is rendered by the OS, not by the app.
 * Sending never throws: failures are logged and the caller continues.
 */
import { Types } from 'mongoose';
import { env } from './env';
import { errorFields, log } from './logger';
import { PushTicket, User } from './models';

type Locale = 'hu' | 'en';

export type NotificationKey =
  | 'daily_color'
  | 'deadline_reminder'
  | 'photo_accepted'
  | 'photo_rejected'
  | 'join_request'
  | 'join_approved'
  | 'join_rejected'
  | 'admin_transferred'
  | 'group_archived';

type Params = Record<string, string | number>;

const TEMPLATES: Record<NotificationKey, Record<Locale, (p: Params) => { title: string; body: string }>> = {
  daily_color: {
    hu: (p) => ({ title: `${p.group}: új napi szín`, body: `Mai szín: ${p.color}. Fotózz valami ${p.color} színűt!` }),
    en: (p) => ({ title: `${p.group}: new daily color`, body: `Today's color is ${p.color}. Go find something ${p.color}!` }),
  },
  deadline_reminder: {
    hu: (p) => ({ title: `${p.group}: közeleg a határidő`, body: `${p.hours} órád van hátra a(z) ${p.color} fotóra.` }),
    en: (p) => ({ title: `${p.group}: deadline approaching`, body: `${p.hours} hours left for your ${p.color} photo.` }),
  },
  photo_accepted: {
    hu: (p) => ({ title: 'Fotó elfogadva', body: `A(z) ${p.group} csoportba küldött fotód elfogadva (${p.score} pont egyezés).` }),
    en: (p) => ({ title: 'Photo accepted', body: `Your photo in ${p.group} was accepted (${p.score} match).` }),
  },
  photo_rejected: {
    hu: (p) => ({ title: 'Fotó elutasítva', body: `A(z) ${p.group} csoportba küldött fotó nem elég közel a színhez. Próbáld újra!` }),
    en: (p) => ({ title: 'Photo rejected', body: `Your photo in ${p.group} is not close enough to the color. Try again!` }),
  },
  join_request: {
    hu: (p) => ({ title: `${p.group}: új csatlakozási kérelem`, body: `${p.name} csatlakozna a csoporthoz.` }),
    en: (p) => ({ title: `${p.group}: new join request`, body: `${p.name} would like to join the group.` }),
  },
  join_approved: {
    hu: (p) => ({ title: 'Csatlakozás jóváhagyva', body: `Beléphetsz a(z) ${p.group} csoportba.` }),
    en: (p) => ({ title: 'Join request approved', body: `You are now a member of ${p.group}.` }),
  },
  join_rejected: {
    hu: (p) => ({ title: 'Csatlakozás elutasítva', body: `A(z) ${p.group} csoport elutasította a kérelmedet.` }),
    en: (p) => ({ title: 'Join request rejected', body: `${p.group} rejected your request.` }),
  },
  admin_transferred: {
    hu: (p) => ({ title: 'Csoportadmin lettél', body: `Mostantól te vagy a(z) ${p.group} csoport adminja.` }),
    en: (p) => ({ title: 'You are the group admin', body: `You are now the admin of ${p.group}.` }),
  },
  group_archived: {
    hu: (p) => ({ title: 'Csoport archiválva', body: `A(z) ${p.group} csoport archiválva lett.` }),
    en: (p) => ({ title: 'Group archived', body: `${p.group} has been archived.` }),
  },
};

const EXPO_URL = 'https://exp.host/--/api/v2/push';
const CHUNK = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (env().EXPO_ACCESS_TOKEN) h.Authorization = `Bearer ${env().EXPO_ACCESS_TOKEN}`;
  return h;
}

async function dropToken(userId: Types.ObjectId, token: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $pull: { pushTokens: { token } } });
}

/** Sends a localized notification to every push token of the given users. */
export async function notify(
  userIds: Array<Types.ObjectId | string>,
  key: NotificationKey,
  params: Params,
  data: Record<string, unknown> = {},
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    const users = await User.find({ _id: { $in: userIds.map((id) => new Types.ObjectId(String(id))) } })
      .select('locale pushTokens isDisabled')
      .lean();
    const messages: Array<{ to: string; title: string; body: string; data: Record<string, unknown>; userId: Types.ObjectId }> = [];
    for (const user of users) {
      if (user.isDisabled) continue;
      const { title, body } = TEMPLATES[key][user.locale](params);
      for (const t of user.pushTokens) messages.push({ to: t.token, title, body, data: { type: key, ...data }, userId: user._id });
    }
    for (let i = 0; i < messages.length; i += CHUNK) await sendChunk(messages.slice(i, i + CHUNK));
  } catch (error) {
    log.warn('push notification failed', { notification: key, ...errorFields(error) });
  }
}

async function sendChunk(chunk: Array<{ to: string; title: string; body: string; data: Record<string, unknown>; userId: Types.ObjectId }>) {
  const response = await fetch(`${EXPO_URL}/send`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(chunk.map(({ to, title, body, data }) => ({ to, title, body, data, sound: 'default' }))),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Expo push responded with ${response.status}`);
  const json = (await response.json()) as { data?: ExpoTicket[] };
  const tickets = json.data ?? [];
  for (const [index, ticket] of tickets.entries()) {
    const message = chunk[index];
    if (!message) continue;
    if (ticket.status === 'ok' && ticket.id) {
      await PushTicket.create({ ticketId: ticket.id, userId: message.userId, token: message.to });
    } else if (ticket.details?.error === 'DeviceNotRegistered') {
      await dropToken(message.userId, message.to);
    }
  }
}

/** Polls Expo receipts and removes tokens reported as `DeviceNotRegistered`. Called by the cron tick. */
export async function processPushReceipts(): Promise<number> {
  const tickets = await PushTicket.find({}).limit(300).lean();
  if (tickets.length === 0) return 0;
  try {
    const response = await fetch(`${EXPO_URL}/getReceipts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ids: tickets.map((t) => t.ticketId) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Expo receipts responded with ${response.status}`);
    const json = (await response.json()) as { data?: Record<string, { status: string; details?: { error?: string } }> };
    const receipts = json.data ?? {};
    const done: string[] = [];
    for (const ticket of tickets) {
      const receipt = receipts[ticket.ticketId];
      if (!receipt) continue;
      done.push(ticket.ticketId);
      if (receipt.details?.error === 'DeviceNotRegistered') await dropToken(ticket.userId, ticket.token);
    }
    if (done.length > 0) await PushTicket.deleteMany({ ticketId: { $in: done } });
    return done.length;
  } catch (error) {
    log.warn('push receipt processing failed', errorFields(error));
    return 0;
  }
}
