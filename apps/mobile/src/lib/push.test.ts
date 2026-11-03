import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-notifications', () => ({ setNotificationHandler: vi.fn(), AndroidImportance: {} }));
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-device', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./api', () => ({ api: {} }));
vi.mock('./storage', () => ({ getDeviceId: vi.fn(), prefs: {} }));

// eslint-disable-next-line import/first -- vi.mock calls are hoisted above this import
import { routeForNotification } from './push';

describe('routeForNotification', () => {
  it('opens the group for admin related notifications', () => {
    expect(routeForNotification({ type: 'join_request', groupId: 'g1' })).toEqual({ pathname: '/group/[id]', params: { id: 'g1' } });
    expect(routeForNotification({ type: 'admin_transferred' })).toEqual({ pathname: '/groups' });
  });
  it('opens Today for daily notifications and ignores unknown types', () => {
    for (const type of ['daily_color', 'deadline_reminder', 'photo_accepted', 'photo_rejected']) expect(routeForNotification({ type })).toEqual({ pathname: '/' });
    expect(routeForNotification({ type: 'whatever' })).toBeNull();
    expect(routeForNotification(undefined)).toBeNull();
  });
});
