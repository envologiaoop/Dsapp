import express from 'express';
import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from './src/db.js';
import { initBot } from './bot/index.js';
import { User, type IUser } from './src/models/User.js';
import { Post } from './src/models/Post.js';
import { Message } from './src/models/Message.js';
import { Notification } from './src/models/Notification.js';
import { Share } from './src/models/Share.js';
import { Comment } from './src/models/Comment.js';
import { Ad } from './src/models/Ad.js';
import { Report } from './src/models/Report.js';
import { Story } from './src/models/Story.js';
import { SystemSettings } from './src/models/SystemSettings.js';
import { uploadImage, uploadMultipleImages, uploadStoryMedia } from './src/middleware/upload.js';
import { processImage } from './src/services/videoProcessor.js';
import { uploadToR2, generateUniqueFilename } from './src/services/r2Storage.js';
import { authenticate, requireAdmin, requirePostOwnership } from './src/middleware/auth.js';
import { extractHashtags, normalizeHashtagQuery } from './src/utils/socialText.js';
import { rankFeedPosts } from './src/utils/feedRanking.js';
import { buildUserSuggestions, getMutualFriendIds } from './src/utils/socialGraph.js';
import {
  getPasswordValidationMessage,
  getSignupValidationErrors,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeSignupInput,
  sanitizeSearchQuery,
} from './src/utils/validation.js';
import { getActorRateLimitKey, getRequestOrigin, isOriginAllowed, shouldBypassOriginCheck } from './src/utils/requestSecurity.js';
import { createAuthToken } from './src/utils/authToken.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);

const authBridgeOrigins = ['https://ddusocial.vercel.app', 'https://ddusocial.tech'];
const allowedOrigins = Array.from(
  new Set(
    (process.env.APP_URL ? [process.env.APP_URL] : ['http://localhost:3000', 'http://localhost:5173']).concat(
      authBridgeOrigins
    )
  )
);

const io = new SocketIOServer(httpServer, {
  cors: { origin: allowedOrigins },
});

const PORT = process.env.PORT || 3000;

function parseBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

// Enable gzip/deflate compression for all HTTP responses
app.use(compression());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use((req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const connectSources = ["'self'", ...allowedOrigins, 'https:', 'ws:', 'wss:'];
  const frameSources = ["'self'", ...allowedOrigins];
  const scriptSources = isDev ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] : ["'self'"];
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `connect-src ${connectSources.join(' ')}`,
    `frame-src ${frameSources.join(' ')}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${frameSources.join(' ')}`,
    "form-action 'self'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', policy);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/telegram/webhook',
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = req.body?.email || req.body?.username || req.body?.identifier;
    if (typeof identifier === 'string' && identifier.trim()) {
      return `auth:${identifier.trim().toLowerCase()}`;
    }
    return `auth:${getActorRateLimitKey(req)}`;
  },
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `search:${getActorRateLimitKey(req)}`,
  message: { error: 'Too many search requests. Please slow down.' },
});

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `mutation:${getActorRateLimitKey(req)}`,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase()),
  message: { error: 'Too many write requests. Please wait and try again.' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `upload:${getActorRateLimitKey(req)}`,
  message: { error: 'Upload limit reached. Please try again later.' },
});

app.use('/api/auth', authLimiter);
app.use('/api/search', searchLimiter);
app.use('/api/users/search/mentions', searchLimiter);
app.use(['/api/posts', '/api/comments', '/api/reports', '/api/notifications', '/api/stories'], mutationLimiter);
app.use('/api/users/:targetId/follow', mutationLimiter);
app.use('/api/users/:userId/profile', mutationLimiter);
app.use('/api/users/:userId/telegram-notifications', mutationLimiter);
app.use(['/api/images', '/api/stories'], uploadLimiter);

// Ensure MongoDB connection is ready before handling API requests
app.use('/api', async (req, res, next) => {
  try {
    // Skip connectDB() when Mongoose is already connected (readyState 1)
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    next();
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error('Database connection failed:', errorMessage);

    // Provide more helpful error response based on the error type
    const response: any = {
      error: 'Service temporarily unavailable. Please try again shortly.',
    };

    // In development, include more details
    if (process.env.NODE_ENV !== 'production') {
      response.details = errorMessage;
      response.hint = 'Check VERCEL_MONGODB_SETUP.md for MongoDB Atlas configuration';
    }

    // Add specific hints for known issues
    if (errorMessage.includes('whitelist') || errorMessage.includes('IP')) {
      response.hint = 'MongoDB Atlas IP whitelist issue. Check Network Access settings.';
    }

    res.status(503).json(response);
  }
});

const bot = initBot(io);
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const DEFAULT_NOTIFICATION_SETTINGS = {
  messages: true,
  comments: true,
  likes: true,
  follows: true,
  mentions: true,
  shares: true,
};

function getAppBaseUrl(req?: any): string {
  const explicit = (process.env.APP_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const origin = req?.headers?.origin?.toString?.();
  if (origin) return origin.replace(/\/$/, '');
  return '';
}

async function sendTelegramMessageNotification(input: {
  receiverUserId: string;
  senderUserId: string;
  messageId: string;
  textPreview: string;
  req?: any;
}) {
  try {
    if (!bot) return;
    const receiver = await User.findById(input.receiverUserId).select('telegramChatId telegramNotificationsEnabled notificationSettings').lean();
    if (!receiver?.telegramChatId) return;
    if (!receiver.telegramNotificationsEnabled) return;
    if (receiver.notificationSettings?.messages === false) return;

    const base = getAppBaseUrl(input.req);
    const link = base
      ? `${base}/?chatWith=${encodeURIComponent(input.senderUserId)}&messageId=${encodeURIComponent(input.messageId)}`
      : null;

    const safePreview = (input.textPreview || '').trim().slice(0, 140);
    const body =
      `💬 New message\n\n` +
      (safePreview ? `“${safePreview}”\n\n` : '') +
      (link ? `Open: ${link}` : 'Open the app to reply.');

    await bot.sendMessage(Number(receiver.telegramChatId), body, {
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error('Failed to send Telegram message notification:', e);
  }
}

function normalizeNotificationSettings(input: any) {
  return {
    messages: typeof input?.messages === 'boolean' ? input.messages : DEFAULT_NOTIFICATION_SETTINGS.messages,
    comments: typeof input?.comments === 'boolean' ? input.comments : DEFAULT_NOTIFICATION_SETTINGS.comments,
    likes: typeof input?.likes === 'boolean' ? input.likes : DEFAULT_NOTIFICATION_SETTINGS.likes,
    follows: typeof input?.follows === 'boolean' ? input.follows : DEFAULT_NOTIFICATION_SETTINGS.follows,
    mentions: typeof input?.mentions === 'boolean' ? input.mentions : DEFAULT_NOTIFICATION_SETTINGS.mentions,
    shares: typeof input?.shares === 'boolean' ? input.shares : DEFAULT_NOTIFICATION_SETTINGS.shares,
  };
}

function formatAuthUser(user: any) {
  return {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl || '',
    bio: user.bio || '',
    website: user.website || '',
    location: user.location || '',
    department: user.department,
    year: user.year,
    role: user.role,
    createdAt: user.createdAt,
    isVerified: Boolean(user.isVerified),
    badgeType: user.badgeType || 'none',
    verificationStatus: user.verificationStatus || 'none',
    verificationRealName: user.verificationRealName || '',
    verificationPhotoUrl: user.verificationPhotoUrl || '',
    verificationNote: user.verificationNote || '',
    verificationRequestedAt: user.verificationRequestedAt || null,
    verificationReviewedAt: user.verificationReviewedAt || null,
    telegramAuthCode: user.telegramAuthCode,
    telegramChatId: user.telegramChatId,
    telegramNotificationsEnabled: user.telegramNotificationsEnabled,
    notificationSettings: normalizeNotificationSettings(user.notificationSettings),
  };
}

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

function isStrongEnoughPassword(pw: string): boolean {
  return isValidPassword(pw);
}

function normalizeAuthIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function findUserByAuthIdentifier(identifier: string) {
  const normalized = normalizeAuthIdentifier(identifier);
  if (!normalized) return null;

  if (isValidEmail(normalized)) {
    return User.findOne({ email: normalized });
  }

  if (isValidUsername(normalized)) {
    return User.findOne({ username: normalized });
  }

  return null;
}

type AuthUserFields = Pick<
  IUser,
  '_id' |
  'name' |
  'username' |
  'email' |
  'avatarUrl' |
  'bio' |
  'website' |
  'location' |
  'department' |
  'year' |
  'telegramAuthCode' |
  'telegramChatId' |
  'telegramNotificationsEnabled' |
  'notificationSettings' |
  'role' |
  'createdAt' |
  'isVerified' |
  'badgeType' |
  'verificationStatus' |
  'verificationRealName' |
  'verificationPhotoUrl' |
  'verificationNote' |
  'verificationRequestedAt' |
  'verificationReviewedAt'
>;

async function ensureTelegramAuthCode(user: IUser): Promise<IUser> {
  if (!user.telegramChatId && !user.telegramAuthCode) {
    user.telegramAuthCode = crypto.randomInt(100000, 1000000).toString();
    await user.save();
  }
  return user;
}

// -- Socket.IO -----------------------------------------------------------------
// Track online users
const onlineUsers = new Map<string, string>(); // userId -> socketId

async function getMessagingAccess(senderId: string, receiverId: string) {
  const [sender, receiver] = await Promise.all([
    User.findById(senderId).select('name followingIds followerIds notificationSettings').lean(),
    User.findById(receiverId).select('followingIds followerIds').lean(),
  ]);

  if (!sender || !receiver) {
    return { allowed: false as const, error: 'Chat user not found.' };
  }

  const senderFollowsReceiver = sender.followingIds.some((id) => id.toString() === receiverId);
  const receiverFollowsSender = receiver.followingIds.some((id) => id.toString() === senderId);

  if (!senderFollowsReceiver || !receiverFollowsSender) {
    return { allowed: false as const, error: 'You can only message users after you both follow each other.' };
  }

  return { allowed: true as const, sender };
}

async function createAndBroadcastDirectMessage(data: {
  senderId: string;
  receiverId: string;
  text: string;
  imageUrl?: string;
  replyToId?: string;
  tempId?: string;
  req?: any;
}) {
  const trimmedText = typeof data.text === 'string' ? data.text.trim() : '';
  const hasImage = typeof data.imageUrl === 'string' && data.imageUrl.trim().length > 0;
  if (!data.senderId || !data.receiverId || (!trimmedText && !hasImage)) {
    return { ok: false as const, error: 'Message text or image is required.' };
  }

  const access = await getMessagingAccess(data.senderId, data.receiverId);
  if (!access.allowed) {
    return { ok: false as const, error: access.error };
  }

  const message = await Message.create({
    senderId: data.senderId,
    receiverId: data.receiverId,
    text: trimmedText,
    imageUrl: data.imageUrl,
    replyToId: data.replyToId,
    status: 'sent',
  });

  const populatedMessage = await Message.findById(message._id)
    .populate('replyToId', 'text senderId')
    .lean();

  io.to(`user_${data.receiverId}`).emit('receive_private_message', populatedMessage);
  io.to(`user_${data.senderId}`).emit('message_sent', {
    message: populatedMessage,
    tempId: data.tempId
  });
  io.to(`user_${data.senderId}`).emit('message_status', {
    messageId: message._id.toString(),
    status: 'delivered'
  });

  await Message.findByIdAndUpdate(message._id, { status: 'delivered' });

  if (access.sender.notificationSettings?.messages !== false) {
    const notification = await Notification.create({
      userId: data.receiverId,
      type: 'message',
      content: `${access.sender.name} sent you a message`,
      relatedUserId: data.senderId,
    });
    io.to(`user_${data.receiverId}`).emit('new_notification', { ...notification.toObject(), id: notification._id.toString() });
  }

  // Telegram push (only if receiver enabled Telegram notifications for messages)
  await sendTelegramMessageNotification({
    receiverUserId: data.receiverId,
    senderUserId: data.senderId,
    messageId: message._id.toString(),
    textPreview: trimmedText || 'Sent you a photo.',
    req: data.req,
  });

  return { ok: true as const, message: populatedMessage, messageId: message._id.toString() };
}

io.on('connection', (socket) => {
  socket.on('join_chat', (userId: string) => {
    socket.join(`user_${userId}`);
    onlineUsers.set(userId, socket.id);
    // Broadcast user online status
    io.emit('user_status', { userId, status: 'online' });
  });

  socket.on('disconnect', () => {
    // Find and remove user from online users
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        io.emit('user_status', { userId, status: 'offline' });
        break;
      }
    }
  });

  // Typing indicator
  socket.on('typing', (data: { senderId: string; receiverId: string; isTyping: boolean }) => {
    io.to(`user_${data.receiverId}`).emit('user_typing', {
      userId: data.senderId,
      isTyping: data.isTyping
    });
  });

  socket.on('send_private_message', async (
    data: { senderId: string; receiverId: string; text: string; imageUrl?: string; replyToId?: string; tempId?: string },
    callback?: (result: { ok: boolean; error?: string; messageId?: string }) => void
  ) => {
    try {
      const result = await createAndBroadcastDirectMessage(data);
      callback?.(result.ok ? { ok: true, messageId: result.messageId } : { ok: false, error: result.error });
    } catch (error) {
      console.error('Socket send_private_message error:', error);
      callback?.({ ok: false, error: 'Failed to send message.' });
    }
  });

  // Message read receipt
  socket.on('message_read', async (data: { messageIds: string[]; userId: string }) => {
    try {
      await Message.updateMany(
        { _id: { $in: data.messageIds }, receiverId: data.userId },
        { isRead: true, readAt: new Date(), status: 'seen' }
      );

      // Notify sender(s) about read status
      const messages = await Message.find({ _id: { $in: data.messageIds } }).lean();
      messages.forEach(msg => {
        io.to(`user_${msg.senderId}`).emit('message_status', {
          messageId: msg._id.toString(),
          status: 'seen',
          readAt: new Date()
        });
      });
    } catch (error) {
      console.error('Socket message_read error:', error);
    }
  });

  // Add reaction to message
  socket.on('add_reaction', async (data: { messageId: string; userId: string; emoji: string }) => {
    try {
      const message = await Message.findById(data.messageId);
      if (!message) return;

      // Remove existing reaction from this user
      message.reactions = message.reactions.filter(
        (r: any) => r.userId.toString() !== data.userId
      );

      // Add new reaction
      message.reactions.push({
        userId: data.userId as any,
        emoji: data.emoji,
        createdAt: new Date()
      });

      await message.save();

      const updatedMessage = await Message.findById(data.messageId).lean();

      // Notify both users
      io.to(`user_${message.senderId}`).emit('message_reaction', updatedMessage);
      io.to(`user_${message.receiverId}`).emit('message_reaction', updatedMessage);
    } catch (error) {
      console.error('Socket add_reaction error:', error);
    }
  });

  // Remove reaction from message
  socket.on('remove_reaction', async (data: { messageId: string; userId: string }) => {
    try {
      const message = await Message.findById(data.messageId);
      if (!message) return;

      message.reactions = message.reactions.filter(
        (r: any) => r.userId.toString() !== data.userId
      );

      await message.save();

      const updatedMessage = await Message.findById(data.messageId).lean();

      // Notify both users
      io.to(`user_${message.senderId}`).emit('message_reaction', updatedMessage);
      io.to(`user_${message.receiverId}`).emit('message_reaction', updatedMessage);
    } catch (error) {
      console.error('Socket remove_reaction error:', error);
    }
  });

  // Delete/unsend message
  socket.on('delete_message', async (data: { messageId: string; userId: string }) => {
    try {
      const message = await Message.findById(data.messageId);
      if (!message || message.senderId.toString() !== data.userId) return;

      message.deletedAt = new Date();
      message.deletedBy = data.userId as any;
      await message.save();

      // Notify both users
      io.to(`user_${message.senderId}`).emit('message_deleted', { messageId: data.messageId });
      io.to(`user_${message.receiverId}`).emit('message_deleted', { messageId: data.messageId });
    } catch (error) {
      console.error('Socket delete_message error:', error);
    }
  });
});

// -- Auth Routes ----------------------------------------------------------------

// Check username availability
app.get('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required' });
    }
    const existing = await User.findOne({ username: username.toLowerCase() });
    res.json({ available: !existing });
  } catch (error) {
    console.error('GET /api/auth/check-username error:', error);
    res.status(500).json({ error: 'Failed to check username' });
  }
});

app.post('/api/auth/signup', uploadImage.single('avatar'), async (req, res) => {
  try {
    const { age, gender } = req.body;
    const normalizedInput = normalizeSignupInput(req.body);
    const validationErrors = getSignupValidationErrors(normalizedInput);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0], details: validationErrors });
    }

    const existing = await User.findOne({
      $or: [{ email: normalizedInput.email }, { username: normalizedInput.username }],
    });
    if (existing) {
      if (existing.email === normalizedInput.email) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      return res.status(409).json({ error: 'Username already taken' });
    }

    let avatarUrl = '';
    if (req.file) {
      try {
        avatarUrl = await processImage(req.file.buffer, 'avatar.webp');
      } catch (uploadError) {
        console.error('Avatar upload error:', uploadError);
        return res.status(500).json({ error: 'Avatar upload failed' });
      }
    }

    const telegramAuthCode = crypto.randomInt(100000, 1000000).toString();
    const configuredAdminEmails = [
      ...(process.env.ADMIN_EMAILS || '').split(','),
      process.env.ADMIN_EMAIL || '',
    ]
      .map((e) => e.toLowerCase().trim())
      .filter(Boolean);
    const isAdminEmail = configuredAdminEmails.includes(normalizedInput.email);
    const user = await User.create({
      name: normalizedInput.name,
      username: normalizedInput.username,
      email: normalizedInput.email,
      password: await hashPassword(normalizedInput.password),
      age: age ? Number(age) : undefined,
      gender,
      department: normalizedInput.department,
      year: normalizedInput.year,
      avatarUrl,
      telegramAuthCode,
      ...(isAdminEmail ? { role: 'admin' } : {}),
    });
    const token = createAuthToken({ userId: user._id.toString(), role: user.role });
    res.status(201).json({ user: formatAuthUser(user), token });
  } catch (error) {
    console.error('POST /api/auth/signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Ensure the configured admin email is always promoted to admin.
    // This keeps admin access stable even if the user was created before seeding.
    const configuredAdminEmails = [
      ...(process.env.ADMIN_EMAILS || '').split(','),
      process.env.ADMIN_EMAIL || '',
    ]
      .map((e) => e.toLowerCase().trim())
      .filter(Boolean);
    if (configuredAdminEmails.includes(user.email.toLowerCase()) && user.role !== 'admin') {
      user.role = 'admin';
      await user.save();
    }

    await ensureTelegramAuthCode(user);

    const token = createAuthToken({ userId: user._id.toString(), role: user.role });
    res.json({
      user: formatAuthUser(user),
      token,
    });
  } catch (error) {
    console.error('POST /api/auth/login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Forgot password: request a 6-digit reset code
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const identifier = normalizeAuthIdentifier(req.body?.identifier ?? req.body?.email);
    if (!identifier) {
      return res.status(400).json({ error: 'Email or username is required' });
    }

    const user = await findUserByAuthIdentifier(identifier);
    // Always return success to avoid account enumeration
    if (!user) return res.json({ ok: true });

    const code = crypto.randomInt(100000, 1000000).toString();
    user.passwordResetCode = code;
    user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    // Recovery is Telegram-first for linked accounts.
    if (user.telegramChatId) {
      try {
        bot?.sendMessage?.(
          Number(user.telegramChatId),
          `DDU Social password reset code: *${code}*\n\nThis code expires in 15 minutes.`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        // ignore telegram send failures
      }
    }

    res.json({
      ok: true,
      delivery: user.telegramChatId ? 'telegram' : 'unavailable',
      maskedTelegram: user.telegramChatId ? 'linked' : 'not-linked',
    });
  } catch (error) {
    console.error('POST /api/auth/forgot-password error:', error);
    res.status(500).json({ error: 'Unable to send reset code right now. Please try again shortly.' });
  }
});

// Reset password using the 6-digit code
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const identifier = normalizeAuthIdentifier(req.body?.identifier ?? req.body?.email);
    const { code, newPassword, confirmPassword } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Email or username is required' });
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Valid 6-digit code is required' });
    }
    if (!isStrongEnoughPassword(newPassword)) {
      return res.status(400).json({ error: getPasswordValidationMessage() });
    }
    if (typeof confirmPassword === 'string' && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const user = await findUserByAuthIdentifier(identifier);
    if (!user || !user.passwordResetCode || user.passwordResetCode !== code) {
      return res.status(400).json({ error: 'Invalid code' });
    }
    if (user.passwordResetExpiresAt && user.passwordResetExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Code expired' });
    }

    user.password = await hashPassword(newPassword);
    user.passwordResetCode = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save({ validateBeforeSave: false });

    if (user.telegramChatId) {
      try {
        bot?.sendMessage?.(
          Number(user.telegramChatId),
          'Your DDU Social password was changed successfully.'
        );
      } catch (e) {
        // ignore telegram send failures
      }
    }

    // Auto-login the user after successful password reset
    await ensureTelegramAuthCode(user);
    const token = createAuthToken({ userId: user._id.toString(), role: user.role });
    res.json({
      ok: true,
      autoLogin: true,
      user: formatAuthUser(user),
      token
    });
  } catch (error) {
    console.error('POST /api/auth/reset-password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

app.post('/api/auth/telegram-code', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.telegramChatId) {
      return res.status(400).json({ error: 'Telegram is already connected for this account.' });
    }

    // Generate new code and set expiry (15 minutes)
    const telegramAuthCode = crypto.randomInt(100000, 1000000).toString();
    user.telegramAuthCode = telegramAuthCode;
    user.telegramAuthCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    res.json({ telegramAuthCode, expiresAt: user.telegramAuthCodeExpiresAt });
  } catch (error) {
    console.error('POST /api/auth/telegram-code error:', error);
    res.status(500).json({ error: 'Failed to generate Telegram code' });
  }
});

export async function handleVerifyTelegramRequest(req: any, res: any) {
  try {
    const { code } = req.params;
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';

    // Find user with matching code
    let user = await User.findOne({ telegramAuthCode: code });

    // Fallback: if the code was already consumed by the bot but the app still holds it,
    // verify using the provided userId when the Telegram chat is already linked.
    if (!user && userId && mongoose.Types.ObjectId.isValid(userId)) {
      const candidate = await User.findById(userId);
      if (candidate?.telegramChatId) {
        candidate.telegramAuthCode = undefined;
        candidate.telegramAuthCodeExpiresAt = undefined;
        await candidate.save();
        return res.json({
          verified: true,
          user: formatAuthUser(candidate),
        });
      }
    }

    if (!user) {
      return res.json({ verified: false, error: 'Invalid or expired code' });
    }

    // Check if code has expired
    if (user.telegramAuthCodeExpiresAt && user.telegramAuthCodeExpiresAt.getTime() < Date.now()) {
      return res.json({ verified: false, error: 'Code has expired. Please generate a new code.' });
    }

    // Check if telegram is already linked
    if (!user.telegramChatId) {
      return res.json({ verified: false, waiting: true, message: 'Code is valid but not yet linked. Please send the code to the Telegram bot.' });
    }

    // Success! Clear the code since it's been used
    user.telegramAuthCode = undefined;
    user.telegramAuthCodeExpiresAt = undefined;
    await user.save();

    res.json({
      verified: true,
      user: formatAuthUser(user),
    });
  } catch (error) {
    console.error('GET /api/auth/verify-telegram error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
}

app.get('/api/auth/verify-telegram/:code', handleVerifyTelegramRequest);

// -- Post Routes ----------------------------------------------------------------

app.get('/api/posts', async (req, res) => {
  try {
    const { userId } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const posts = await Post.find({
      isDeleted: { $ne: true },
      $or: [
        { approvalStatus: { $exists: false } },
        { approvalStatus: 'approved' },
      ],
    })
      .select('userId title content mediaUrl mediaUrls likedBy bookmarkedBy commentsCount sharesCount createdAt isAnonymous taggedUsers contentType groupId place eventTime approvalStatus')
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name username avatarUrl followerIds')
      .lean();

    let followingSet = new Set<string>();
    let connectionSet = new Set<string>();
    if (userId) {
      const currentUser = await User.findById(userId).select('followingIds followerIds').lean();
      if (currentUser) {
        followingSet = new Set(currentUser.followingIds.map((id) => id.toString()));
        connectionSet = new Set([
          ...currentUser.followingIds.map((id) => id.toString()),
          ...currentUser.followerIds.map((id) => id.toString()),
        ]);
      }
    }

    const enriched = posts.map((post: any) => ({
      ...post,
      userId: post.userId
        ? {
            _id: post.userId._id,
            name: post.userId.name,
            username: post.userId.username,
            avatarUrl: post.userId.avatarUrl || '',
          }
        : null,
      likesCount: post.likedBy.length,
      isLiked: userId ? post.likedBy.some((id: any) => id.toString() === userId.toString()) : false,
      isBookmarked: userId ? post.bookmarkedBy.some((id: any) => id.toString() === userId.toString()) : false,
      isFollowing: post.userId ? followingSet.has(post.userId._id.toString()) : false,
      mutualCount: post.userId
        ? post.userId.followerIds?.filter?.((id: any) => connectionSet.has(id.toString())).length || 0
        : 0,
    }));

    res.json(rankFeedPosts(enriched));
  } catch (error) {
    console.error('GET /api/posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/posts/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const viewerId = req.query.userId?.toString();
    const post = await Post.findOne({
      _id: postId,
      isDeleted: { $ne: true },
      $or: [
        { approvalStatus: { $exists: false } },
        { approvalStatus: 'approved' },
      ],
    })
      .select('userId title content mediaUrl mediaUrls likedBy bookmarkedBy commentsCount sharesCount createdAt isAnonymous taggedUsers contentType groupId place eventTime approvalStatus')
      .populate('userId', 'name username avatarUrl followerIds')
      .lean();

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const postOwner: any = post.userId;
    const enrichedPost: any = {
      ...post,
      userId: postOwner
        ? {
            _id: postOwner._id,
            name: postOwner.name,
            username: postOwner.username,
            avatarUrl: postOwner.avatarUrl || '',
          }
        : null,
      likesCount: post.likedBy?.length || 0,
      isLiked: viewerId ? post.likedBy?.some((id: any) => id.toString() === viewerId) : false,
      isBookmarked: viewerId ? post.bookmarkedBy?.some((id: any) => id.toString() === viewerId) : false,
    };

    res.json(enrichedPost);
  } catch (error) {
    console.error('GET /api/posts/:postId error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { userId, content, isAnonymous, mediaUrl, mediaUrls, taggedUsers, contentType, groupId, title, place, eventTime, creatingGhostPost } = req.body;
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    const hasMedia = Boolean(mediaUrl) || (Array.isArray(mediaUrls) && mediaUrls.length > 0);

    if (!userId || (!normalizedContent && !hasMedia)) {
      return res.status(400).json({ error: 'userId and either content or media are required' });
    }

    const author = await User.findById(userId).select('role').lean();
    if (!author) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedContentType =
      contentType === 'group' || contentType === 'event' || contentType === 'academic' || contentType === 'announcement'
        ? contentType
        : 'feed';

    if (normalizedContentType === 'group' && !groupId) {
      return res.status(400).json({ error: 'groupId is required for group posts' });
    }

    if (normalizedContentType === 'event') {
      let photoCount = 0;
      if (Array.isArray(mediaUrls)) {
        photoCount = mediaUrls.length;
      } else if (mediaUrl) {
        photoCount = 1;
      }

      if (!title || !place || !eventTime || !photoCount) {
        return res.status(400).json({ error: 'Events require title, description, photo, time, and place' });
      }
    }

    if ((normalizedContentType === 'academic' || normalizedContentType === 'announcement') && author.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can publish this content type' });
    }

    const approvalStatus = normalizedContentType === 'event' && author.role !== 'admin' ? 'pending' : 'approved';

    // Extract mentions from content
    const mentions = extractMentions(normalizedContent);
    const hashtags = extractHashtags(normalizedContent);

    const post = await Post.create({
      userId,
      content: normalizedContent,
      isAnonymous: parseBooleanFlag(isAnonymous),
      mediaUrl,
      mediaUrls: mediaUrls || [],
      contentType: normalizedContentType,
      groupId,
      place,
      eventTime: eventTime ? new Date(eventTime) : undefined,
      approvalStatus,
      taggedUsers: taggedUsers || [],
      mentions,
      hashtags,
    });

    if (creatingGhostPost) {
      await User.findByIdAndUpdate(userId, { $addToSet: { postsAsGhost: post._id } });
    }

    // Send mention notifications
    if (mentions.length > 0 && !isAnonymous) {
      await sendMentionNotifications(userId, mentions, 'post', post._id.toString());
    }

    // Send tag notifications to tagged users
    if (approvalStatus === 'approved' && taggedUsers && taggedUsers.length > 0 && !post.isAnonymous) {
      const tagger = await User.findById(userId).lean();
      if (tagger) {
        const filteredTaggedUsers = taggedUsers.filter((id: string) => id !== userId);
        if (filteredTaggedUsers.length > 0) {
          const tagNotifications = filteredTaggedUsers.map((taggedUserId: string) => ({
            userId: taggedUserId,
            type: 'tag',
            content: `${author.name} tagged you in a post`,
            relatedUserId: userId,
            relatedPostId: post._id,
          }));
          const createdTagNotifications = await Notification.insertMany(tagNotifications);
          createdTagNotifications.forEach((notif, idx) => {
            io.to(`user_${filteredTaggedUsers[idx]}`).emit('new_notification', {
              ...notif.toObject(),
              id: notif._id.toString(),
            });
          });
        }
      }
    }

    const populated = await Post.findById(post._id).populate('userId', 'name username avatarUrl').lean();
    res.status(201).json(populated);
  } catch (error) {
    console.error('POST /api/posts error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

app.post('/api/images/upload-r2', uploadImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const url = await processImage(req.file.buffer, req.file.originalname || 'chat-image.jpg');
    res.status(201).json({ url });
  } catch (error) {
    console.error('POST /api/images/upload-r2 error:', error);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

app.post('/api/images/upload-multiple-r2', uploadMultipleImages.array('images', 10), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    const urls = await Promise.all(
      files.map((file) => processImage(file.buffer, file.originalname || 'image.jpg'))
    );

    res.status(201).json({ urls });
  } catch (error) {
    console.error('POST /api/images/upload-multiple-r2 error:', error);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    const post = await Post.findByIdAndUpdate(postId, { $addToSet: { likedBy: userId } }, { new: true }).populate('userId', 'name');
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (!post.isAnonymous && post.userId && (post.userId as any)._id.toString() !== userId) {
      const liker = await User.findById(userId).lean();
      if (liker) {
        const notification = await Notification.create({
          userId: (post.userId as any)._id,
          type: 'like',
          content: `${liker.name} liked your post`,
          relatedUserId: userId,
          relatedPostId: postId,
        });
        io.to(`user_${(post.userId as any)._id.toString()}`).emit('new_notification', { ...notification.toObject(), id: notification._id.toString() });
      }
    }
    res.json({ postId, userId, liked: true, likesCount: post.likedBy.length });
  } catch (error) {
    console.error('POST /api/posts/:postId/like error:', error);
    res.status(500).json({ error: 'Failed to like post' });
  }
});

app.delete('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    const post = await Post.findByIdAndUpdate(postId, { $pull: { likedBy: userId } }, { new: true });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ postId, userId, liked: false, likesCount: post.likedBy.length });
  } catch (error) {
    console.error('DELETE /api/posts/:postId/like error:', error);
    res.status(500).json({ error: 'Failed to unlike post' });
  }
});

app.post('/api/posts/:postId/bookmark', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    await Post.findByIdAndUpdate(postId, { $addToSet: { bookmarkedBy: userId } });
    res.json({ postId, userId, bookmarked: true });
  } catch (error) {
    console.error('POST /api/posts/:postId/bookmark error:', error);
    res.status(500).json({ error: 'Failed to bookmark post' });
  }
});

app.delete('/api/posts/:postId/bookmark', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId } = req.body;
    await Post.findByIdAndUpdate(postId, { $pull: { bookmarkedBy: userId } });
    res.json({ postId, userId, bookmarked: false });
  } catch (error) {
    console.error('DELETE /api/posts/:postId/bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

app.post('/api/posts/:postId/share', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, receiverIds } = req.body;
    if (!Array.isArray(receiverIds) || receiverIds.length === 0) {
      return res.status(400).json({ error: 'receiverIds is required' });
    }
    const sender = await User.findById(userId).lean();
    if (!sender) return res.status(404).json({ error: 'User not found' });

    const shares = receiverIds.map((receiverId: string) => ({ postId, senderId: userId, receiverId }));
    await Share.insertMany(shares);
    await Post.findByIdAndUpdate(postId, { $inc: { sharesCount: receiverIds.length } });

    // Fetch the post to share with full content
    const post = await Post.findById(postId).populate('userId', 'name username avatarUrl').lean();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // Shares should arrive as chat messages with actual post content (not notifications)
    await Promise.all(
      receiverIds.map(async (receiverId: string) => {
        const message = await Message.create({
          senderId: userId,
          receiverId,
          text: post.content || '(Shared post)',
          imageUrl: post.mediaUrl || (post.mediaUrls && post.mediaUrls[0]) || undefined,
          sharedPostId: postId, // Store the original post ID for reference
          status: 'sent',
        });
        io.to(`user_${receiverId}`).emit('receive_private_message', message.toObject());
        io.to(`user_${userId}`).emit('message_sent', { message: message.toObject() });
      })
    );
    res.json({ postId, userId, receiverIds, shared: true });
  } catch (error) {
    console.error('POST /api/posts/:postId/share error:', error);
    res.status(500).json({ error: 'Failed to share post' });
  }
});

app.get('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const comments = await Comment.find({ postId })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('userId', 'name username avatarUrl')
      .lean();
    res.json(comments);
  } catch (error) {
    console.error('GET /api/posts/:postId/comments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { userId, content, isAnonymous } = req.body;
    if (!userId || !content) {
      return res.status(400).json({ error: 'userId and content are required' });
    }
    if (isAnonymous) {
      return res.status(400).json({ error: 'Anonymous comments are not allowed.' });
    }
    const comment = await Comment.create({ postId, userId, content, isAnonymous: false });
    await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });
    const populated = await Comment.findById(comment._id).populate('userId', 'name username avatarUrl').lean();

    const post = await Post.findById(postId).lean();
    if (post && !post.isAnonymous && post.userId.toString() !== userId) {
      const commenter = await User.findById(userId).lean();
      if (commenter) {
        const notification = await Notification.create({
          userId: post.userId,
          type: 'comment',
          content: `${commenter.name} commented on your post`,
          relatedUserId: userId,
          relatedPostId: postId,
        });
        io.to(`user_${post.userId.toString()}`).emit('new_notification', { ...notification.toObject(), id: notification._id.toString() });
      }
    }
    res.status(201).json(populated);
  } catch (error) {
    console.error('POST /api/posts/:postId/comments error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// -- Comment Replies Routes ----------------------------------------------------

// Get replies to a specific comment
app.get('/api/comments/:commentId/replies', async (req, res) => {
  try {
    const { commentId } = req.params;
    const replies = await Comment.find({ parentCommentId: commentId })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate('userId', 'name username avatarUrl')
      .lean();
    res.json(replies);
  } catch (error) {
    console.error('GET /api/comments/:commentId/replies error:', error);
    res.status(500).json({ error: 'Failed to fetch replies' });
  }
});

// Post a reply to a comment
app.post('/api/comments/:commentId/reply', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { userId, content, isAnonymous } = req.body;
    if (!userId || !content) {
      return res.status(400).json({ error: 'userId and content are required' });
    }
    if (isAnonymous) {
      return res.status(400).json({ error: 'Anonymous comments are not allowed.' });
    }

    const parentComment = await Comment.findById(commentId);
    if (!parentComment) {
      return res.status(404).json({ error: 'Parent comment not found' });
    }

    const reply = await Comment.create({
      postId: parentComment.postId,
      userId,
      content,
      isAnonymous: false,
      parentCommentId: commentId
    });

    // Increment reply count on parent comment
    await Comment.findByIdAndUpdate(commentId, { $inc: { replyCount: 1 } });

    const populated = await Comment.findById(reply._id)
      .populate('userId', 'name username avatarUrl')
      .lean();

    // Create notification for parent comment author
    if (parentComment.userId.toString() !== userId) {
      const replier = await User.findById(userId).lean();
      if (replier) {
        const notification = await Notification.create({
          userId: parentComment.userId,
          type: 'comment',
          content: `${replier.name} replied to your comment`,
          relatedUserId: userId,
          relatedPostId: parentComment.postId,
        });
        io.to(`user_${parentComment.userId.toString()}`).emit('new_notification', {
          ...notification.toObject(),
          id: notification._id.toString()
        });
      }
    }

    res.status(201).json(populated);
  } catch (error) {
    console.error('POST /api/comments/:commentId/reply error:', error);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

// -- Report Routes --------------------------------------------------------------

// Create a report (post, user, bug, or suggestion)
app.post('/api/reports', async (req, res) => {
  try {
    const { reporterId, type, targetId, reason, description } = req.body;
    if (!reporterId || !type || !reason) {
      return res.status(400).json({ error: 'reporterId, type, and reason are required' });
    }

    const report = await Report.create({
      reporterId,
      type,
      targetId,
      reason,
      description
    });

    res.status(201).json(report);
  } catch (error) {
    console.error('POST /api/reports error:', error);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// Get reports for a user (their own reports)
app.get('/api/reports/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const reports = await Report.find({ reporterId: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(reports);
  } catch (error) {
    console.error('GET /api/reports/:userId error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Update Telegram notification preference
app.put('/api/users/:userId/telegram-notifications', async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled, settings } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.telegramNotificationsEnabled = enabled;
    user.notificationSettings = normalizeNotificationSettings(settings ?? user.notificationSettings);
    await user.save();

    res.json({
      telegramNotificationsEnabled: user.telegramNotificationsEnabled,
      notificationSettings: normalizeNotificationSettings(user.notificationSettings),
    });
  } catch (error) {
    console.error('PUT /api/users/:userId/telegram-notifications error:', error);
    res.status(500).json({ error: 'Failed to update notification preference' });
  }
});

// User delete own post
app.delete('/api/posts/:postId', authenticate, requirePostOwnership, async (req, res) => {
  try {
    req.post.isDeleted = true;
    req.post.deletedAt = new Date();
    req.post.deletedBy = req.user._id;
    await req.post.save();

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/posts/:postId error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// User edit own post
app.put('/api/posts/:postId', authenticate, requirePostOwnership, async (req, res) => {
  try {
    const { content, mediaUrls } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    req.post.content = content;
    if (mediaUrls !== undefined) {
      req.post.mediaUrls = mediaUrls;
    }
    req.post.updatedAt = new Date();
    await req.post.save();

    const populated = await Post.findById(req.post._id)
      .populate('userId', 'name username avatarUrl')
      .lean();

    res.json(populated);
  } catch (error) {
    console.error('PUT /api/posts/:postId error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// -- User Routes ----------------------------------------------------------------

app.post('/api/users/:targetId/follow', async (req, res) => {
  try {
    const { targetId } = req.params;
    const { userId } = req.body;
    if (userId === targetId) return res.status(400).json({ error: 'Cannot follow yourself' });

    await User.findByIdAndUpdate(userId, { $addToSet: { followingIds: targetId } });
    await User.findByIdAndUpdate(targetId, { $addToSet: { followerIds: userId } });

    const follower = await User.findById(userId).lean();
    if (follower) {
      const notification = await Notification.create({
        userId: targetId,
        type: 'follow',
        content: `${follower.name} started following you`,
        relatedUserId: userId,
      });
      io.to(`user_${targetId}`).emit('new_notification', { ...notification.toObject(), id: notification._id.toString() });
    }
    res.json({ userId, targetId, following: true });
  } catch (error) {
    console.error('POST /api/users/:targetId/follow error:', error);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

app.delete('/api/users/:targetId/follow', async (req, res) => {
  try {
    const { targetId } = req.params;
    const { userId } = req.body;
    await User.findByIdAndUpdate(userId, { $pull: { followingIds: targetId } });
    await User.findByIdAndUpdate(targetId, { $pull: { followerIds: userId } });
    res.json({ userId, targetId, following: false });
  } catch (error) {
    console.error('DELETE /api/users/:targetId/follow error:', error);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

app.get('/api/users/:userId/mutuals', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const followingSet = new Set(user.followingIds.map((id) => id.toString()));
    const mutualIds = user.followerIds.filter((id) => followingSet.has(id.toString()));
    const mutuals = await User.find({ _id: { $in: mutualIds } }).select('name username avatarUrl').lean();

    res.json(mutuals.map((u) => ({ id: u._id.toString(), name: u.name, username: u.username, avatarUrl: u.avatarUrl || '' })));
  } catch (error) {
    console.error('GET /api/users/:userId/mutuals error:', error);
    res.status(500).json({ error: 'Failed to fetch mutuals' });
  }
});

app.get('/api/users/:userId/suggestions', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 6, 12);
    const user = await User.findById(userId).select('followingIds followerIds').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const excludedIds = new Set([userId, ...user.followingIds.map((id) => id.toString())]);

    const candidates = await User.find({ _id: { $nin: Array.from(excludedIds) } })
      .select('name username avatarUrl isVerified badgeType followerIds createdAt')
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();
    const connectionIds = new Set([
      ...user.followingIds.map((id) => id.toString()),
      ...user.followerIds.map((id) => id.toString()),
    ]);
    const previewIds = new Set<string>();
    candidates.forEach((candidate) => {
      getMutualFriendIds(candidate.followerIds, connectionIds, userId)
        .slice(0, 3)
        .forEach((id) => previewIds.add(id));
    });
    const previewUsers = previewIds.size > 0
      ? await User.find({ _id: { $in: Array.from(previewIds) } }).select('name username avatarUrl').lean()
      : [];
    const suggestions = buildUserSuggestions(
      userId,
      user.followingIds,
      user.followerIds,
      candidates.map((candidate) => ({
        id: candidate._id.toString(),
        name: candidate.name,
        username: candidate.username,
        avatarUrl: candidate.avatarUrl || '',
        isVerified: candidate.isVerified || false,
        badgeType: candidate.badgeType || 'none',
        followerIds: candidate.followerIds,
      })),
      previewUsers.map((preview) => ({
        id: preview._id.toString(),
        name: preview.name,
        username: preview.username,
        avatarUrl: preview.avatarUrl || '',
      })),
      limit
    );

    res.json(suggestions);
  } catch (error) {
    console.error('GET /api/users/:userId/suggestions error:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

app.get('/api/users/:userId/inbox', async (req, res) => {
  try {
    const { userId } = req.params;
    const shares = await Share.find({ receiverId: userId })
      .sort({ createdAt: -1 })
      .populate('senderId', 'name username avatarUrl')
      .populate({
        path: 'postId',
        select: 'content mediaUrl mediaUrls likedBy bookmarkedBy commentsCount sharesCount createdAt userId isAnonymous',
        populate: { path: 'userId', select: 'name username avatarUrl' },
      })
      .lean();

    const result = shares.map((share: any) => ({
      shareId: share._id.toString(),
      sender: {
        id: share.senderId._id.toString(),
        name: share.senderId.name,
        username: share.senderId.username,
        avatarUrl: share.senderId.avatarUrl || '',
      },
      post: {
        ...share.postId,
        likesCount: share.postId.likedBy?.length || 0,
        commentsCount: share.postId.commentsCount || 0,
        sharesCount: share.postId.sharesCount || 0,
        isLiked: share.postId.likedBy?.some((id: any) => id.toString() === userId) || false,
        isBookmarked: share.postId.bookmarkedBy?.some((id: any) => id.toString() === userId) || false,
      },
    }));
    res.json(result);
  } catch (error) {
    console.error('GET /api/users/:userId/inbox error:', error);
    res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

app.get('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentUserId } = req.query;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const normalizedCurrentUserId = typeof currentUserId === 'string' ? currentUserId : '';
    const currentUser = normalizedCurrentUserId
      ? await User.findById(normalizedCurrentUserId).select('followingIds followerIds department year').lean()
      : null;
    const isFollowing = normalizedCurrentUserId
      ? user.followerIds.some((id) => id.toString() === normalizedCurrentUserId)
      : false;
    const followsYou = normalizedCurrentUserId
      ? user.followingIds.some((id) => id.toString() === normalizedCurrentUserId)
      : false;
    const currentConnectionIds = currentUser
      ? new Set([
          ...currentUser.followingIds.map((id) => id.toString()),
          ...currentUser.followerIds.map((id) => id.toString()),
        ])
      : new Set<string>();
    const mutualFriendIds = getMutualFriendIds(user.followerIds, currentConnectionIds, normalizedCurrentUserId);
    const mutualFriends = mutualFriendIds.length > 0
      ? await User.find({ _id: { $in: mutualFriendIds.slice(0, 3) } }).select('name username avatarUrl').lean()
      : [];
    const sharedContexts = [
      currentUser?.department && user.department && currentUser.department === user.department
        ? `${user.department} department`
        : null,
      currentUser?.year && user.year && currentUser.year === user.year
        ? `Year ${user.year}`
        : null,
    ].filter(Boolean);

    res.json({
      id: user._id.toString(),
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl || '',
      bio: user.bio || '',
      website: user.website || '',
      location: user.location || '',
      department: user.department || '',
      year: user.year || '',
      isVerified: user.isVerified || false,
      badgeType: user.badgeType || 'none',
      followersCount: user.followerIds.length,
      followingCount: user.followingIds.length,
      isFollowing,
      followsYou,
      canMessage: isFollowing && followsYou,
      mutualFriendsCount: mutualFriendIds.length,
      mutualFriends: mutualFriends.map((mutual) => ({
        id: mutual._id.toString(),
        name: mutual.name,
        username: mutual.username,
        avatarUrl: mutual.avatarUrl || '',
      })),
      sharedContexts,
    });
  } catch (error) {
    console.error('GET /api/users/:userId/profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Get user followers
app.get('/api/users/:userId/followers', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate('followerIds', 'name username avatarUrl isVerified badgeType');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json(user.followerIds);
  } catch (error) {
    console.error('GET /api/users/:userId/followers error:', error);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

// Get user following
app.get('/api/users/:userId/following', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).populate('followingIds', 'name username avatarUrl isVerified badgeType');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json(user.followingIds);
  } catch (error) {
    console.error('GET /api/users/:userId/following error:', error);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});

app.put('/api/users/:userId/profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, username, bio, website, location, department } = req.body;

    if (name && String(name).trim().length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }
    if (department && String(department).trim().length < 2) {
      return res.status(400).json({ error: 'Department must be at least 2 characters.' });
    }

    if (username) {
      if (!isValidUsername(username.toLowerCase())) {
        return res.status(400).json({ error: 'Username must be 3-20 characters: lowercase letters, numbers, underscores, and periods only' });
      }

      // Check if username is taken (case-insensitive)
      const existingUser = await User.findOne({ username: username.toLowerCase() });
      if (existingUser && existingUser._id.toString() !== userId) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        name: name?.trim(),
        username: username?.toLowerCase(),
        bio,
        website,
        location,
        department: department?.trim(),
      },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ error: 'User not found' });

    res.json(formatAuthUser(updatedUser));
  } catch (error) {
    console.error('PUT /api/users/:userId/profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Avatar upload endpoint
app.put('/api/users/:userId/avatar', uploadImage.single('avatar'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const avatarUrl = await processImage(req.file.buffer, 'avatar.webp');

    const user = await User.findByIdAndUpdate(userId, { avatarUrl }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ avatarUrl: user.avatarUrl, user: formatAuthUser(user) });
  } catch (error) {
    console.error('PUT /api/users/:userId/avatar error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

app.get('/api/users/:userId/posts', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId?.toString();
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find({ userId, isAnonymous: false })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name username avatarUrl')
        .lean(),
      Post.countDocuments({ userId, isAnonymous: false }),
    ]);

    const enrichedPosts = posts.map((post: any) => ({
      ...post,
      likesCount: post.likedBy?.length || 0,
      isLiked: currentUserId ? post.likedBy?.some((id: any) => id.toString() === currentUserId) : false,
      isBookmarked: currentUserId ? post.bookmarkedBy?.some((id: any) => id.toString() === currentUserId) : false,
    }));

    res.json({ posts: enrichedPosts, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('GET /api/users/:userId/posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.get('/api/users/:userId/saved', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId?.toString();
    const limit = Math.min(parseInt(req.query.limit as string) || 24, 100);

    if (!currentUserId || currentUserId !== userId) {
      return res.status(403).json({ error: 'Saved content is private' });
    }

    const posts = await Post.find({
      bookmarkedBy: userId,
      isDeleted: { $ne: true },
      isAnonymous: false,
    })
      .populate('userId', 'name username avatarUrl')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      posts: posts.map((post: any) => ({
        ...post,
        type: 'post',
        likesCount: post.likedBy?.length || 0,
        isLiked: post.likedBy?.some((id: any) => id.toString() === userId) || false,
        isBookmarked: true,
      })),
    });
  } catch (error) {
    console.error('GET /api/users/:userId/saved error:', error);
    res.status(500).json({ error: 'Failed to fetch saved content' });
  }
});

app.get('/api/users/:userId/chats', async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await Message.find({ $or: [{ senderId: userId }, { receiverId: userId }] })
      .select('senderId receiverId text createdAt isRead status')
      .sort({ createdAt: -1 })
      .lean();

    // Collect last message per unique conversation partner (no N+1)
    const seen = new Map<string, { text: string; createdAt: Date; isRead: boolean; status?: string; unreadCount: number; isMine: boolean }>();
    for (const msg of messages) {
      const otherId = msg.senderId.toString() === userId ? msg.receiverId.toString() : msg.senderId.toString();
      if (!seen.has(otherId)) {
        seen.set(otherId, {
          text: msg.text,
          createdAt: msg.createdAt,
          isRead: Boolean(msg.isRead),
          status: msg.status,
          unreadCount: 0,
          isMine: msg.senderId.toString() === userId,
        });
      }

      if (msg.receiverId.toString() === userId && msg.senderId.toString() === otherId && !msg.isRead) {
        const conversation = seen.get(otherId);
        if (conversation) {
          conversation.unreadCount += 1;
        }
      }
    }

    const uniqueUserIds = Array.from(seen.keys());
    const users = await User.find({ _id: { $in: uniqueUserIds } }).select('name username avatarUrl').lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const conversations = uniqueUserIds
      .map((otherId) => {
        const u = userMap.get(otherId) as any;
        if (!u) return null;
        return {
          user: { id: otherId, name: u.name, username: u.username, avatarUrl: u.avatarUrl || '' },
          lastMessage: seen.get(otherId),
        };
      })
      .filter(Boolean);

    res.json(conversations);
  } catch (error) {
    console.error('GET /api/users/:userId/chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// -- Message Routes -------------------------------------------------------------

app.get('/api/messages/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId },
      ],
    })
      .select('text imageUrl senderId receiverId createdAt status isRead reactions')
      .sort({ createdAt: 1 })
      .lean();
    res.json(messages);
  } catch (error) {
    console.error('GET /api/messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { senderId, receiverId, text, imageUrl, replyToId, tempId } = req.body;
    const result = await createAndBroadcastDirectMessage({ senderId, receiverId, text, imageUrl, replyToId, tempId, req });

    if (!result.ok) {
      return res.status(result.error === 'Chat user not found.' ? 404 : 400).json({ error: result.error });
    }

    res.status(201).json({ message: result.message });
  } catch (error) {
    console.error('POST /api/messages error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.post('/api/messages/read', async (req, res) => {
  try {
    const { userId, otherUserId } = req.body;

    if (!userId || !otherUserId) {
      return res.status(400).json({ error: 'userId and otherUserId are required' });
    }

    const unreadMessages = await Message.find({
      senderId: otherUserId,
      receiverId: userId,
      isRead: false,
    })
      .select('_id senderId')
      .lean();

    if (unreadMessages.length === 0) {
      return res.json({ updated: 0 });
    }

    const ids = unreadMessages.map((message) => message._id);

    await Message.updateMany(
      { _id: { $in: ids } },
      { isRead: true, readAt: new Date(), status: 'seen' }
    );

    unreadMessages.forEach((message) => {
      io.to(`user_${message.senderId.toString()}`).emit('message_status', {
        messageId: message._id.toString(),
        status: 'seen',
        readAt: new Date(),
      });
    });

    res.json({ updated: unreadMessages.length });
  } catch (error) {
    console.error('POST /api/messages/read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// -- Notification Routes --------------------------------------------------------

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(notifications.map((n) => ({ ...n, id: n._id.toString() })));
  } catch (error) {
    console.error('GET /api/notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    await Notification.findByIdAndUpdate(id, { isRead: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/notifications/:id/read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// -- Telegram Webhook -----------------------------------------------------------
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    if (!bot) {
      return res.status(503).json({ error: 'Telegram bot not initialized' });
    }

    if (TELEGRAM_WEBHOOK_SECRET) {
      const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
      const secretMatches = Array.isArray(headerSecret)
        ? headerSecret.includes(TELEGRAM_WEBHOOK_SECRET)
        : headerSecret === TELEGRAM_WEBHOOK_SECRET;

      if (!secretMatches) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    bot.processUpdate(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/telegram/webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Global search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query, type = 'all', limit = 10 } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const queryString = sanitizeSearchQuery(query);
    if (!queryString) {
      return res.status(400).json({ error: 'Search query is invalid' });
    }
    const searchRegex = { $regex: queryString, $options: 'i' };
    const normalizedHashtag = normalizeHashtagQuery(queryString);
    const limitNum = Math.min(parseInt(limit as string) || 10, 50);

    const results: any = {
      users: [],
      posts: [],
    };

    // Search users
    if (type === 'all' || type === 'users') {
      results.users = await User.find({
        $or: [
          { name: searchRegex },
          { username: searchRegex },
        ],
      })
        .select('name username avatarUrl bio')
        .limit(limitNum)
        .lean();
    }

    // Search posts
    if (type === 'all' || type === 'posts') {
      results.posts = await Post.find({
        $or: [
          { content: searchRegex },
          ...(normalizedHashtag ? [{ hashtags: normalizedHashtag }] : []),
        ],
        isDeleted: { $ne: true },
      })
        .select('userId content mediaUrl mediaUrls likedBy bookmarkedBy commentsCount sharesCount createdAt isAnonymous')
        .populate('userId', 'name username avatarUrl')
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .lean();
    }

    res.json(results);
  } catch (error) {
    console.error('GET /api/search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// -- Helper Functions -----------------------------------------------------------

// Extract @mentions from text
function extractMentions(text: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return [...new Set(mentions)]; // Remove duplicates
}

// Send mention notifications
async function sendMentionNotifications(
  mentionerUserId: string,
  mentions: string[],
  contentType: 'post' | 'comment' | 'story',
  contentId: string
) {
  try {
    // Find all mentioned users and the mentioner in parallel
    const [mentionedUsers, mentioner] = await Promise.all([
      User.find({ username: { $in: mentions } }).lean(),
      User.findById(mentionerUserId).lean(),
    ]);

    if (!mentioner) return;

    const usersToNotify = mentionedUsers.filter(
      (user) => user._id.toString() !== mentionerUserId
    );

    if (usersToNotify.length === 0) return;

    // Bulk create notifications instead of one per user
    const mentionNotifications = usersToNotify.map((user) => ({
      userId: user._id,
      type: 'mention',
      content: `${mentioner.name} mentioned you in a ${contentType}`,
      relatedUserId: mentionerUserId,
      relatedPostId: contentType === 'post' ? contentId : undefined,
      relatedStoryId: contentType === 'story' ? contentId : undefined,
    }));
    const createdMentionNotifications = await Notification.insertMany(mentionNotifications);

    // Emit real-time notifications
    createdMentionNotifications.forEach((notif, idx) => {
      io.to(`user_${usersToNotify[idx]._id.toString()}`).emit('new_notification', {
        ...notif.toObject(),
        id: notif._id.toString(),
      });
    });
  } catch (error) {
    console.error('Error sending mention notifications:', error);
  }
}

// -- Story Routes ---------------------------------------------------------------

// Get active stories from followed users and own stories
app.get('/api/stories', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const currentUserId = userId.toString();
    const user = await User.findById(currentUserId).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get stories from followed users + own stories
    const followedIds = [...user.followingIds, currentUserId];
    const now = new Date();

    const stories = await Story.find({
      userId: { $in: followedIds },
      isActive: true,
      expiresAt: { $gt: now }
    })
      .populate('userId', 'name username avatarUrl')
      .sort({ createdAt: -1 })
      .lean();

    const mutualIds = new Set(
      user.followingIds
        .filter((id: any) => user.followerIds.some((followerId: any) => followerId.toString() === id.toString()))
        .map((id: any) => id.toString())
    );

    const visibleStories = stories.filter((story: any) => {
      const ownerId = story.userId?._id?.toString?.() || story.userId?.toString?.();
      if (!ownerId || ownerId === currentUserId) return true;
      return mutualIds.has(ownerId);
    });

    // Group stories by user
    const storiesByUser = visibleStories.reduce((acc: any, story: any) => {
      const storyOwnerId = story.userId._id.toString();
      if (!acc[storyOwnerId]) {
        acc[storyOwnerId] = {
          user: story.userId,
          stories: [],
          hasViewed: false
        };
      }
      acc[storyOwnerId].stories.push(story);
      // Check if current user has viewed all stories from this user
      const hasViewedAll = acc[storyOwnerId].stories.every((s: any) =>
        s.views.some((v: any) => v.toString() === currentUserId)
      );
      acc[storyOwnerId].hasViewed = hasViewedAll;
      return acc;
    }, {});

    res.json(Object.values(storiesByUser));
  } catch (error) {
    console.error('GET /api/stories error:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

// Create a new story
app.post('/api/stories', uploadStoryMedia.single('media'), async (req, res) => {
  try {
    const { userId, caption, mediaType, duration, audience, visualFilter, overlayTexts, drawings, stickers, cameraEffect } = req.body;

    if (!userId || !req.file) {
      return res.status(400).json({ error: 'userId and media are required' });
    }

    // Process and upload the media
    let mediaUrl: string;
    let thumbnailUrl: string | undefined;

    const normalizedMediaType = req.file.mimetype.startsWith('video/') || mediaType === 'video' ? 'video' : 'image';

    if (normalizedMediaType === 'video') {
      const originalName = typeof req.file.originalname === 'string' ? req.file.originalname : 'story-video.mp4';
      const extension = path.extname(originalName).toLowerCase() || '.mp4';
      const filename = generateUniqueFilename(`story-video${extension}`);
      const contentType = req.file.mimetype && req.file.mimetype.startsWith('video/')
        ? req.file.mimetype
        : 'video/mp4';
      mediaUrl = await uploadToR2(req.file.buffer, filename, contentType);
    } else {
      // Image
      const filename = generateUniqueFilename('story.jpg');
      mediaUrl = await processImage(req.file.buffer, filename);
    }

    // Stories expire after 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const normalizedCaption = typeof caption === 'string' ? caption.trim() : '';
    const mentions = extractMentions(normalizedCaption);
    let parsedOverlayTexts: Array<{
      text: string;
      x: number;
      y: number;
      color: string;
      size: 'sm' | 'md' | 'lg';
      background: 'none' | 'soft' | 'solid';
    }> = [];
    let parsedDrawings: Array<{
      tool: 'brush' | 'eraser';
      color: string;
      size: number;
      points: Array<{ x: number; y: number }>;
    }> = [];
    let parsedStickers: Array<{
      pack: 'basic' | 'reactions' | 'neon';
      value: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    }> = [];

    if (typeof overlayTexts === 'string' && overlayTexts.trim()) {
      try {
        const candidate = JSON.parse(overlayTexts);
        if (Array.isArray(candidate)) {
          parsedOverlayTexts = candidate
            .filter((item) => typeof item?.text === 'string' && item.text.trim())
            .slice(0, 5)
            .map((item) => ({
              text: item.text.trim().slice(0, 80),
              x: Math.max(0, Math.min(100, Number(item.x) || 50)),
              y: Math.max(0, Math.min(100, Number(item.y) || 50)),
              color: typeof item.color === 'string' ? item.color.slice(0, 24) : '#ffffff',
              size: item.size === 'sm' || item.size === 'lg' ? item.size : 'md',
              background: item.background === 'none' || item.background === 'solid' ? item.background : 'soft',
            }));
        }
      } catch (error) {
        return res.status(400).json({ error: 'overlayTexts is invalid' });
      }
    }

    if (typeof drawings === 'string' && drawings.trim()) {
      try {
        const candidate = JSON.parse(drawings);
        if (Array.isArray(candidate)) {
          parsedDrawings = candidate
            .filter((item) => Array.isArray(item?.points) && item.points.length > 1)
            .slice(0, 30)
            .map((item) => ({
              tool: (item.tool === 'eraser' ? 'eraser' : 'brush') as 'brush' | 'eraser',
              color: typeof item.color === 'string' ? item.color.slice(0, 24) : '#ffffff',
              size: Math.max(1, Math.min(24, Number(item.size) || 4)),
              points: item.points
                .slice(0, 500)
                .map((point: any) => ({
                  x: Math.max(0, Math.min(100, Number(point?.x) || 0)),
                  y: Math.max(0, Math.min(100, Number(point?.y) || 0)),
                })),
            }))
            .filter((path) => path.points.length > 1);
        }
      } catch (error) {
        return res.status(400).json({ error: 'drawings is invalid' });
      }
    }

    if (typeof stickers === 'string' && stickers.trim()) {
      try {
        const candidate = JSON.parse(stickers);
        if (Array.isArray(candidate)) {
          parsedStickers = candidate
            .filter((item) => typeof item?.value === 'string' && item.value.trim())
            .slice(0, 25)
            .map((item) => ({
              pack: item.pack === 'reactions' || item.pack === 'neon' ? item.pack : 'basic',
              value: item.value.trim().slice(0, 10),
              x: Math.max(0, Math.min(100, Number(item.x) || 50)),
              y: Math.max(0, Math.min(100, Number(item.y) || 50)),
              scale: Math.max(0.6, Math.min(2.5, Number(item.scale) || 1)),
              rotation: Math.max(-180, Math.min(180, Number(item.rotation) || 0)),
            }));
        }
      } catch (error) {
        return res.status(400).json({ error: 'stickers is invalid' });
      }
    }

    const story = await Story.create({
      userId,
      drawings: parsedDrawings,
      stickers: parsedStickers,
      cameraEffect: cameraEffect === 'vintage' || cameraEffect === 'cool' || cameraEffect === 'vivid' || cameraEffect === 'mono' ? cameraEffect : 'none',
      overlayTexts: parsedOverlayTexts,
      visualFilter: visualFilter === 'warm' || visualFilter === 'mono' || visualFilter === 'dream' || visualFilter === 'boost' ? visualFilter : 'none',
      mediaUrl,
      mediaType: normalizedMediaType,
      audience: 'mutuals',
      thumbnailUrl,
      caption: normalizedCaption,
      mentions,
      duration: normalizedMediaType === 'video' ? parseInt(duration) : undefined,
      expiresAt,
      views: [],
      isActive: true
    });

    if (mentions.length > 0) {
      await sendMentionNotifications(userId, mentions, 'story', story._id.toString());
    }

    const populated = await Story.findById(story._id)
      .populate('userId', 'name username avatarUrl')
      .lean();

    res.status(201).json(populated);
  } catch (error) {
    console.error('POST /api/stories error:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// View a story (mark as viewed)
app.post('/api/stories/:storyId/view', async (req, res) => {
  try {
    const { storyId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Add user to views if not already viewed
    if (!story.views.includes(userId as any)) {
      story.views.push(userId as any);
      await story.save();

      // Send notification to story owner
      if (story.userId.toString() !== userId) {
        const viewer = await User.findById(userId).lean();
        if (viewer) {
          const notification = await Notification.create({
            userId: story.userId,
            type: 'story_view',
            content: `${viewer.name} viewed your story`,
            relatedUserId: userId,
            relatedStoryId: storyId
          });

          io.to(`user_${story.userId.toString()}`).emit('new_notification', {
            ...notification.toObject(),
            id: notification._id.toString()
          });
        }
      }
    }

    res.json({ success: true, viewCount: story.views.length });
  } catch (error) {
    console.error('POST /api/stories/:storyId/view error:', error);
    res.status(500).json({ error: 'Failed to mark story as viewed' });
  }
});

app.get('/api/stories/:storyId/viewers', async (req, res) => {
  try {
    const { storyId } = req.params;
    const userId = req.query.userId?.toString();

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const story = await Story.findById(storyId).select('userId views').lean();
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    if (story.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Only the story owner can view story analytics' });
    }

    const viewers = await User.find({ _id: { $in: story.views || [] } })
      .select('name username avatarUrl')
      .lean();

    const orderedViewers = (story.views || [])
      .map((viewerId) => viewers.find((viewer) => viewer._id.toString() === viewerId.toString()))
      .filter(Boolean);

    res.json({ viewers: orderedViewers, total: orderedViewers.length });
  } catch (error) {
    console.error('GET /api/stories/:storyId/viewers error:', error);
    res.status(500).json({ error: 'Failed to fetch story viewers' });
  }
});

// Delete a story
app.delete('/api/stories/:storyId', async (req, res) => {
  try {
    const { storyId } = req.params;
    const { userId } = req.query;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Only owner can delete
    if (story.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this story' });
    }

    story.isActive = false;
    await story.save();

    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/stories/:storyId error:', error);
    res.status(500).json({ error: 'Failed to delete story' });
  }
});

// Get stories for a specific user
app.get('/api/stories/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId?.toString();
    const now = new Date();

    const profileUser = await User.findById(userId).select('followingIds followerIds').lean();
    if (!profileUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stories = await Story.find({
      userId,
      isActive: true,
      expiresAt: { $gt: now }
    })
      .populate('userId', 'name username avatarUrl')
      .sort({ createdAt: -1 })
      .lean();

    const isOwnProfile = currentUserId === userId;
    const isMutual = currentUserId
      ? profileUser.followerIds.some((id: any) => id.toString() === currentUserId) &&
        profileUser.followingIds.some((id: any) => id.toString() === currentUserId)
      : false;

    const visibleStories = stories.filter((story: any) => {
      if (isOwnProfile) return true;
      return Boolean(currentUserId && isMutual);
    });

    res.json(visibleStories);
  } catch (error) {
    console.error('GET /api/stories/user/:userId error:', error);
    res.status(500).json({ error: 'Failed to fetch user stories' });
  }
});

// -- Tag & Mention Routes -------------------------------------------------------

// Get posts where user is tagged
app.get('/api/users/:userId/tagged', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const posts = await Post.find({
      taggedUsers: userId,
      isDeleted: false
    })
      .populate('userId', 'name username avatarUrl isVerified')
      .populate('taggedUsers', 'name username avatarUrl')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ posts });
  } catch (error) {
    console.error('GET /api/users/:userId/tagged error:', error);
    res.status(500).json({ error: 'Failed to fetch tagged content' });
  }
});

// Search users for tagging/mentioning (autocomplete)
app.get('/api/users/search/mentions', async (req, res) => {
  try {
    const { query, currentUserId } = req.query;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    const sanitizedQuery = sanitizeSearchQuery(query, 30);
    if (!sanitizedQuery) {
      return res.status(400).json({ error: 'query is invalid' });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: sanitizedQuery, $options: 'i' } },
        { name: { $regex: sanitizedQuery, $options: 'i' } }
      ],
      ...(currentUserId ? { _id: { $ne: currentUserId as string } } : {})
    })
      .select('name username avatarUrl isVerified')
      .limit(10)
      .lean();

    res.json(users);
  } catch (error) {
    console.error('GET /api/users/search/mentions error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// -- Admin Routes ---------------------------------------------------------------

// Get all users (admin only)
app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string || '';
    const skip = (page - 1) * limit;

    const searchQuery = search ? {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    } : {};

    const [users, total] = await Promise.all([
      User.find(searchQuery)
        .select('-password -telegramAuthCode')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(searchQuery)
    ]);

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('GET /api/admin/users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Ban user (admin only)
app.post('/api/admin/users/:userId/ban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Ban reason is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Cannot ban admin users' });
    }

    user.isBanned = true;
    user.bannedAt = new Date();
    user.bannedBy = req.user._id;
    user.banReason = reason;
    await user.save();

    res.json({ success: true, user: { id: user._id, isBanned: user.isBanned } });
  } catch (error) {
    console.error('POST /api/admin/users/:userId/ban error:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// Unban user (admin only)
app.post('/api/admin/users/:userId/unban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isBanned = false;
    user.bannedAt = undefined;
    user.bannedBy = undefined;
    user.banReason = undefined;
    await user.save();

    res.json({ success: true, user: { id: user._id, isBanned: user.isBanned } });
  } catch (error) {
    console.error('POST /api/admin/users/:userId/unban error:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// Delete post (admin only)
app.delete('/api/admin/posts/:postId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    post.isDeleted = true;
    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    await post.save();

    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/admin/posts/:postId error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Get admin statistics
app.get('/api/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers,
      bannedUsers,
      totalPosts,
      deletedPosts,
      recentUsers,
      recentPosts
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isBanned: true }),
      Post.countDocuments(),
      Post.countDocuments({ isDeleted: true }),
      User.find().select('name username createdAt').sort({ createdAt: -1 }).limit(5),
      Post.find({ isDeleted: false }).populate('userId', 'name username').sort({ createdAt: -1 }).limit(5)
    ]);

    res.json({
      stats: {
        users: {
          total: totalUsers,
          banned: bannedUsers,
          active: totalUsers - bannedUsers
        },
        posts: {
          total: totalPosts,
          deleted: deletedPosts,
          active: totalPosts - deletedPosts
        }
      },
      recent: {
        users: recentUsers,
        posts: recentPosts
      }
    });
  } catch (error) {
    console.error('GET /api/admin/stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Get all posts (admin only)
app.get('/api/admin/posts', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      Post.find()
        .populate('userId', 'name username avatarUrl')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments()
    ]);

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('GET /api/admin/posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.post('/api/admin/posts/:postId/approval', authenticate, requireAdmin, async (req, res) => {
  try {
    const { postId } = req.params;
    const { approvalStatus } = req.body;

    if (approvalStatus !== 'approved' && approvalStatus !== 'rejected') {
      return res.status(400).json({ error: 'approvalStatus must be approved or rejected' });
    }

    const post = await Post.findByIdAndUpdate(
      postId,
      { approvalStatus },
      { new: true }
    ).populate('userId', 'name username avatarUrl');

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    console.error('POST /api/admin/posts/:postId/approval error:', error);
    res.status(500).json({ error: 'Failed to update approval status' });
  }
});

// ==================== Admin Ad Management Endpoints ====================

// Get all ads (with pagination and filtering)
app.get('/api/admin/ads', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const isActive = req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined;

    const filter: any = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const ads = await Ad.find(filter)
      .populate('createdBy', 'name username email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalAds = await Ad.countDocuments(filter);

    res.json({
      ads,
      totalPages: Math.ceil(totalAds / limit),
      currentPage: page,
      totalAds,
    });
  } catch (error) {
    console.error('GET /api/admin/ads error:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

// Get a single ad by ID
app.get('/api/admin/ads/:adId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adId } = req.params;
    const ad = await Ad.findById(adId).populate('createdBy', 'name username email');

    if (!ad) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    res.json(ad);
  } catch (error) {
    console.error('GET /api/admin/ads/:adId error:', error);
    res.status(500).json({ error: 'Failed to fetch ad' });
  }
});

// Create a new ad
app.post('/api/admin/ads', authenticate, requireAdmin, async (req, res) => {
  try {
    const userId = req.query.userId as string;
    const { title, content, imageUrl, linkUrl, isActive, startDate, endDate, targetAudience } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const ad = await Ad.create({
      title,
      content,
      imageUrl,
      linkUrl,
      isActive: isActive !== undefined ? isActive : true,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      targetAudience: targetAudience || 'all',
      createdBy: userId,
    });

    const populatedAd = await Ad.findById(ad._id).populate('createdBy', 'name username email');

    res.status(201).json(populatedAd);
  } catch (error) {
    console.error('POST /api/admin/ads error:', error);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

// Update an ad
app.put('/api/admin/ads/:adId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adId } = req.params;
    const { title, content, imageUrl, linkUrl, isActive, startDate, endDate, targetAudience } = req.body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (linkUrl !== undefined) updateData.linkUrl = linkUrl;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (targetAudience !== undefined) updateData.targetAudience = targetAudience;

    const ad = await Ad.findByIdAndUpdate(adId, updateData, { new: true })
      .populate('createdBy', 'name username email');

    if (!ad) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    res.json(ad);
  } catch (error) {
    console.error('PUT /api/admin/ads/:adId error:', error);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

// Delete an ad
app.delete('/api/admin/ads/:adId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { adId } = req.params;

    const ad = await Ad.findByIdAndDelete(adId);

    if (!ad) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    res.json({ message: 'Ad deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/admin/ads/:adId error:', error);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// Get ad statistics
app.get('/api/admin/ads/stats/summary', authenticate, requireAdmin, async (req, res) => {
  try {
    const totalAds = await Ad.countDocuments();
    const activeAds = await Ad.countDocuments({ isActive: true });
    const inactiveAds = await Ad.countDocuments({ isActive: false });

    const adStats = await Ad.aggregate([
      {
        $group: {
          _id: null,
          totalImpressions: { $sum: '$impressions' },
          totalClicks: { $sum: '$clicks' },
        }
      }
    ]);

    const stats = adStats[0] || { totalImpressions: 0, totalClicks: 0 };

    res.json({
      totalAds,
      activeAds,
      inactiveAds,
      totalImpressions: stats.totalImpressions,
      totalClicks: stats.totalClicks,
      clickThroughRate: stats.totalImpressions > 0
        ? ((stats.totalClicks / stats.totalImpressions) * 100).toFixed(2)
        : '0.00',
    });
  } catch (error) {
    console.error('GET /api/admin/ads/stats/summary error:', error);
    res.status(500).json({ error: 'Failed to fetch ad statistics' });
  }
});

// -- Badge & Verification Routes -----------------------------------------------

// Get maintenance status (public)
app.get('/api/system/maintenance', async (_req, res) => {
  try {
    const settings = await SystemSettings.findOne();
    res.json({
      maintenanceMode: settings?.maintenanceMode ?? false,
      maintenanceMessage: settings?.maintenanceMessage ?? 'We are performing scheduled maintenance. We will be back shortly!',
    });
  } catch (error) {
    console.error('GET /api/system/maintenance error:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance status' });
  }
});

// Get/set maintenance mode (admin only)
app.get('/api/admin/maintenance', authenticate, requireAdmin, async (_req, res) => {
  try {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({ maintenanceMode: false, maintenanceMessage: 'We are performing scheduled maintenance. We will be back shortly!' });
    }
    res.json(settings);
  } catch (error) {
    console.error('GET /api/admin/maintenance error:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance settings' });
  }
});

app.post('/api/admin/maintenance', authenticate, requireAdmin, async (req, res) => {
  try {
    const { maintenanceMode, maintenanceMessage } = req.body;
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = new SystemSettings({});
    }
    if (typeof maintenanceMode === 'boolean') settings.maintenanceMode = maintenanceMode;
    if (typeof maintenanceMessage === 'string' && maintenanceMessage.trim()) settings.maintenanceMessage = maintenanceMessage;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json(settings);
  } catch (error) {
    console.error('POST /api/admin/maintenance error:', error);
    res.status(500).json({ error: 'Failed to update maintenance settings' });
  }
});

// Submit verification request (user)
app.post('/api/users/:targetUserId/verification-request', authenticate, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    if (req.userId !== targetUserId) {
      return res.status(403).json({ error: 'You can only submit a verification request for yourself' });
    }
    const { realName, photoUrl, note } = req.body;
    if (!realName || !realName.trim()) {
      return res.status(400).json({ error: 'Real name is required' });
    }
    if (!photoUrl || !photoUrl.trim()) {
      return res.status(400).json({ error: 'Photo URL is required for verification' });
    }

    const user = await User.findById(targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.verificationStatus === 'pending') {
      return res.status(400).json({ error: 'You already have a pending verification request' });
    }
    if (user.verificationStatus === 'approved') {
      return res.status(400).json({ error: 'Your account is already verified' });
    }

    user.verificationStatus = 'pending';
    user.verificationRealName = realName.trim();
    user.verificationPhotoUrl = photoUrl.trim();
    user.verificationNote = note?.trim() || '';
    user.verificationRequestedAt = new Date();
    await user.save();

    res.json({ success: true, message: 'Verification request submitted. An admin will review it shortly.' });
  } catch (error) {
    console.error('POST /api/users/:userId/verification-request error:', error);
    res.status(500).json({ error: 'Failed to submit verification request' });
  }
});

// Get pending verification requests (admin only)
app.get('/api/admin/verification-requests', authenticate, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = (req.query.status as string) || 'pending';
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      User.find({ verificationStatus: status })
        .select('name username email avatarUrl verificationStatus verificationRealName verificationPhotoUrl verificationNote verificationRequestedAt badgeType')
        .sort({ verificationRequestedAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments({ verificationStatus: status }),
    ]);

    res.json({ requests, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('GET /api/admin/verification-requests error:', error);
    res.status(500).json({ error: 'Failed to fetch verification requests' });
  }
});

// Grant/revoke badge (admin only)
app.post('/api/admin/users/:targetUserId/badge', authenticate, requireAdmin, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const { badgeType, approve } = req.body; // badgeType: 'none'|'blue'|'gold', approve: boolean

    const user = await User.findById(targetUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const badge = badgeType as 'none' | 'blue' | 'gold';
    if (!['none', 'blue', 'gold'].includes(badge)) {
      return res.status(400).json({ error: 'Invalid badge type. Must be none, blue, or gold' });
    }

    user.badgeType = badge;
    user.isVerified = badge !== 'none';

    if (approve === true || badge !== 'none') {
      user.verificationStatus = 'approved';
      user.verificationReviewedAt = new Date();
      user.verificationReviewedBy = req.user._id;
    } else if (approve === false) {
      user.verificationStatus = 'rejected';
      user.verificationReviewedAt = new Date();
      user.verificationReviewedBy = req.user._id;
    }

    await user.save();

    res.json({ success: true, user: { id: user._id, badgeType: user.badgeType, isVerified: user.isVerified, verificationStatus: user.verificationStatus } });
  } catch (error) {
    console.error('POST /api/admin/users/:userId/badge error:', error);
    res.status(500).json({ error: 'Failed to update badge' });
  }
});

// Serve React app for all other routes (SPA fallback)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`DDU Social server running on http://localhost:${PORT}`);
  });
}

export default app;
