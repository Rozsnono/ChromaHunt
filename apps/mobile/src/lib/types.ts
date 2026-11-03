/** API shapes shared with the backend (`docs/api.md`). */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  locale: 'hu' | 'en';
  permissions: string[];
  mustChangePassword: boolean;
  privacyPolicyVersion: string;
  privacyReacceptanceRequired: boolean;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: PublicUser;
  tokens: Tokens;
}

export interface GroupSettings {
  requiredPhotosPerDay: number;
  dailyDrawTime: string;
  timezone: string;
  deadlineHours: number;
  retentionDays: number;
  scoringEnabled: boolean;
  colorCooldownDays: number;
  acceptanceThreshold: number;
  missingPhotoPenalty: number;
  minDailyPoints: number;
  deadlineReminderHours: number;
  notifyDailyColor: boolean;
  notifyDeadline: boolean;
}

export interface AssignmentSummary {
  id: string;
  date: string;
  colorHex: string;
  colorName: string;
  deadlineAt: string;
  requiredPhotos: number;
  isOpen: boolean;
}

export interface GroupSummary {
  id: string;
  name: string;
  role: 'admin' | 'member';
  isArchived: boolean;
  memberCount: number;
  settings: GroupSettings;
  latestAssignment: AssignmentSummary | null;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
  pendingJoinRequests?: number;
}

export interface JoinRequestItem {
  id: string;
  userId: string;
  displayName: string;
  createdAt: string;
}

export interface InviteResult {
  code: string;
  qrPayload: string;
  expiresAt: string;
  groupName: string;
}

export interface TodayResponse {
  assignment: (AssignmentSummary & { drawnAt: string }) | null;
  me: { accepted: number; pending: number; rejected: number; remaining: number; completed: boolean } | null;
  members: { userId: string; displayName: string; accepted: number; completed: boolean }[];
}
