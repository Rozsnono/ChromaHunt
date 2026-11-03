import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface ColorPaletteDoc {
  _id: Types.ObjectId;
  name: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
  /** Precomputed CIELAB (D65) coordinates [L, a, b]. */
  lab: [number, number, number];
  isActive: boolean;
}

const paletteSchema = new Schema<ColorPaletteDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    hex: { type: String, required: true, unique: true, match: /^#[0-9a-f]{6}$/ },
    lab: { type: [Number], required: true, validate: (v: number[]) => v.length === 3 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const ColorPalette: Model<ColorPaletteDoc> =
  (models.ColorPalette as Model<ColorPaletteDoc>) ?? model<ColorPaletteDoc>('ColorPalette', paletteSchema);

export interface DailyAssignmentDoc {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  /** Local calendar date (YYYY-MM-DD) in the group timezone at draw time. */
  date: string;
  colorId: Types.ObjectId;
  /** Snapshot so palette edits never rewrite history. */
  colorHex: string;
  colorName: string;
  colorLab: [number, number, number];
  drawnAt: Date;
  deadlineAt: Date;
  /** Settings snapshot used for this day's validation and scoring. */
  requiredPhotos: number;
  acceptanceThreshold: number;
  scoringEnabled: boolean;
  missingPhotoPenalty: number;
  minDailyPoints: number;
  timezone: string;
  retentionDays: number;
  cooldownRelaxed: boolean;
  reminderSentAt: Date | null;
  /** Set once daily points were computed after the deadline. */
  scoredAt: Date | null;
}

const assignmentSchema = new Schema<DailyAssignmentDoc>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    colorId: { type: Schema.Types.ObjectId, ref: 'ColorPalette', required: true },
    colorHex: { type: String, required: true },
    colorName: { type: String, required: true },
    colorLab: { type: [Number], required: true },
    drawnAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    requiredPhotos: { type: Number, required: true, min: 1 },
    acceptanceThreshold: { type: Number, required: true, min: 0, max: 100 },
    scoringEnabled: { type: Boolean, required: true },
    missingPhotoPenalty: { type: Number, required: true },
    minDailyPoints: { type: Number, required: true },
    timezone: { type: String, required: true },
    retentionDays: { type: Number, required: true },
    cooldownRelaxed: { type: Boolean, default: false },
    reminderSentAt: { type: Date, default: null },
    scoredAt: { type: Date, default: null },
  },
  { timestamps: true },
);
assignmentSchema.index({ groupId: 1, date: 1 }, { unique: true });
assignmentSchema.index({ groupId: 1, deadlineAt: -1 });
assignmentSchema.index({ scoredAt: 1, deadlineAt: 1 });

export const DailyAssignment: Model<DailyAssignmentDoc> =
  (models.DailyAssignment as Model<DailyAssignmentDoc>) ??
  model<DailyAssignmentDoc>('DailyAssignment', assignmentSchema);
