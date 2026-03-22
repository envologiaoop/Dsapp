import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  name: string;
  username: string;
  email: string;
  password: string;
  age?: number;
  gender?: string;
  department: string;
  year: string;
  avatarUrl?: string;
  bio?: string;
  website?: string;
  location?: string;
  isVerified?: boolean;
  badgeType?: 'none' | 'blue' | 'gold';
  verificationStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  verificationRealName?: string;
  verificationPhotoUrl?: string;
  verificationNote?: string;
  verificationRequestedAt?: Date;
  verificationReviewedAt?: Date;
  verificationReviewedBy?: mongoose.Types.ObjectId;
  telegramChatId?: string;
  telegramAuthCode?: string;
  telegramAuthCodeExpiresAt?: Date;
  telegramNotificationsEnabled?: boolean;
  notificationSettings?: {
    messages?: boolean;
    comments?: boolean;
    likes?: boolean;
    follows?: boolean;
    mentions?: boolean;
    shares?: boolean;
  };
  followingIds: mongoose.Types.ObjectId[];
  followerIds: mongoose.Types.ObjectId[];
  role: 'user' | 'admin';
  isBanned: boolean;
  bannedAt?: Date;
  bannedBy?: mongoose.Types.ObjectId;
  banReason?: string;
  passwordResetCode?: string;
  passwordResetExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** Stored as scrypt hash (salt:derivedKey). Never store plaintext passwords. */
    password: { type: String, required: true },
    age: { type: Number },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    department: { type: String, required: true },
    year: { type: String, required: true, enum: ['remedial', '1', '2', '3', '4', '5', '6', '7'] },
    avatarUrl: { type: String },
    bio: { type: String, maxlength: 150 },
    website: { type: String },
    location: { type: String },
    isVerified: { type: Boolean, default: false },
    badgeType: { type: String, enum: ['none', 'blue', 'gold'], default: 'none' },
    verificationStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    verificationRealName: { type: String },
    verificationPhotoUrl: { type: String },
    verificationNote: { type: String },
    verificationRequestedAt: { type: Date },
    verificationReviewedAt: { type: Date },
    verificationReviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    telegramChatId: { type: String },
    telegramAuthCode: { type: String },
    telegramAuthCodeExpiresAt: { type: Date },
    telegramNotificationsEnabled: { type: Boolean, default: false },
    notificationSettings: {
      messages: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      likes: { type: Boolean, default: true },
      follows: { type: Boolean, default: true },
      mentions: { type: Boolean, default: true },
      shares: { type: Boolean, default: true },
    },
    followingIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    followerIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date },
    bannedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    banReason: { type: String },
    passwordResetCode: { type: String },
    passwordResetExpiresAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for performance optimization
UserSchema.index({ username: 1 }); // Already unique, but explicit for lookups
UserSchema.index({ email: 1 }); // Already unique, but explicit for lookups
UserSchema.index({ telegramChatId: 1 }); // For Telegram bot integration
UserSchema.index({ telegramAuthCode: 1 }); // For fast Telegram linking/verification
UserSchema.index({ role: 1 }); // For admin queries
UserSchema.index({ isBanned: 1 }); // For filtering banned users
UserSchema.index({ verificationStatus: 1 }); // For pending verification queries
UserSchema.index({ createdAt: -1 }); // For sorting by registration date

export const User = mongoose.model<IUser>('User', UserSchema);
