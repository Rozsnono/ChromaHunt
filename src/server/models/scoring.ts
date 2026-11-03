import { Schema, model, models, type Model, type Types } from 'mongoose';

/** One row per user, group and day (the "point ledger"). */
export interface DailyPointDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  date: string;
  weekKey: string;
  points: number;
  completionRatio: number;
  avgCloseness: number;
  acceptedCount: number;
  required: number;
  /** ms between the draw and the photo that completed the day; null if not completed. */
  completionDelayMs: number | null;
}

const dailyPointSchema = new Schema<DailyPointDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    assignmentId: { type: Schema.Types.ObjectId, required: true },
    date: { type: String, required: true },
    weekKey: { type: String, required: true },
    points: { type: Number, required: true },
    completionRatio: { type: Number, required: true },
    avgCloseness: { type: Number, required: true },
    acceptedCount: { type: Number, required: true },
    required: { type: Number, required: true },
    completionDelayMs: { type: Number, default: null },
  },
  { timestamps: true },
);
dailyPointSchema.index({ groupId: 1, userId: 1, assignmentId: 1 }, { unique: true });
dailyPointSchema.index({ groupId: 1, weekKey: 1 });
dailyPointSchema.index({ userId: 1 });

export const DailyPoint: Model<DailyPointDoc> =
  (models.DailyPoint as Model<DailyPointDoc>) ?? model<DailyPointDoc>('DailyPoint', dailyPointSchema);

/** Persisted weekly aggregate, written when the ISO week (in the group timezone) closes. */
export interface WeeklyScoreDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  weekKey: string;
  points: number;
  daysCompleted: number;
  avgCompletionDelayMs: number | null;
  breakdown: Array<{ date: string; points: number }>;
  finalizedAt: Date;
}

const weeklyScoreSchema = new Schema<WeeklyScoreDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    weekKey: { type: String, required: true },
    points: { type: Number, required: true },
    daysCompleted: { type: Number, required: true },
    avgCompletionDelayMs: { type: Number, default: null },
    breakdown: { type: [new Schema({ date: String, points: Number }, { _id: false })], default: [] },
    finalizedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
weeklyScoreSchema.index({ groupId: 1, userId: 1, weekKey: 1 }, { unique: true });
weeklyScoreSchema.index({ groupId: 1, weekKey: 1 });
weeklyScoreSchema.index({ userId: 1 });

export const WeeklyScore: Model<WeeklyScoreDoc> =
  (models.WeeklyScore as Model<WeeklyScoreDoc>) ?? model<WeeklyScoreDoc>('WeeklyScore', weeklyScoreSchema);

/** Marks a (group, week) pair as aggregated, even when nobody scored. */
export interface WeeklyCloseDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  weekKey: string;
  closedAt: Date;
}

const weeklyCloseSchema = new Schema<WeeklyCloseDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    weekKey: { type: String, required: true },
    closedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
weeklyCloseSchema.index({ groupId: 1, weekKey: 1 }, { unique: true });

export const WeeklyClose: Model<WeeklyCloseDoc> =
  (models.WeeklyClose as Model<WeeklyCloseDoc>) ?? model<WeeklyCloseDoc>('WeeklyClose', weeklyCloseSchema);
