import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { User } from '../src/models/User.js';
import { Ad } from '../src/models/Ad.js';
// Notification model no longer needed in bot UI (notifications are pushed automatically)
import { Message } from '../src/models/Message.js';
import { Post } from '../src/models/Post.js';
import { connectDB } from '../src/db.js';
import { resolveTelegramWebhookUrl } from '../src/utils/telegram.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = resolveTelegramWebhookUrl({
  explicitUrl: process.env.TELEGRAM_WEBHOOK_URL,
  appUrl: process.env.APP_URL,
  vercelUrl: process.env.VERCEL_URL,
});
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const useWebhook = Boolean(webhookUrl);

// Admin Configuration
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'Envologia01@gmail.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const ADMIN_TELEGRAM_USERNAME = process.env.ADMIN_TELEGRAM_USERNAME || '@dev_envologia';
const ADMIN_TELEGRAM_USER_ID = process.env.ADMIN_TELEGRAM_USER_ID || '6882100039';
const USER_CACHE_TTL_MS = 5 * 60_000;
const RESPONSE_CACHE_TTL_MS = 60_000;
const telegramUserCache = new Map<string, { user: any; expiresAt: number }>();
const botResponseCache = new Map<string, { value: any; expiresAt: number }>();

// Helper function to get user from telegram chat ID
async function getUserFromTelegram(chatId: number, options?: { fresh?: boolean }) {
  const cacheKey = chatId.toString();
  const now = Date.now();

  if (!options?.fresh) {
    const cached = telegramUserCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.user;
    }
  }

  const user = await User.findOne({ telegramChatId: cacheKey });
  if (user) {
    telegramUserCache.set(cacheKey, { user, expiresAt: now + USER_CACHE_TTL_MS });
  } else {
    telegramUserCache.delete(cacheKey);
  }
  return user;
}

function primeTelegramUserCache(chatId: number, user: any) {
  telegramUserCache.set(chatId.toString(), {
    user,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
}

async function getCachedResponse<T>(key: string, builder: () => Promise<T>, ttlMs = RESPONSE_CACHE_TTL_MS) {
  const now = Date.now();
  const cached = botResponseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await builder();
  botResponseCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

async function sendBotChatAction(bot: TelegramBot, chatId: number, action: 'typing' | 'upload_photo' = 'typing') {
  try {
    await bot.sendChatAction(chatId, action);
  } catch {
    // ignore transient Telegram action failures
  }
}

// Helper function to format date
function formatDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// Create main menu keyboard
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📊 My Stats', callback_data: 'menu_stats' },
        { text: '❓ Help', callback_data: 'menu_help' }
      ],
      [
        { text: '💬 Messages', callback_data: 'menu_messages' },
        { text: '🔥 Trending', callback_data: 'menu_trending' }
      ],
      [
        { text: '📢 Ads', callback_data: 'menu_ads' },
        { text: '👤 My Profile', callback_data: 'menu_profile' }
      ]
    ]
  };
}

export function initBot(io?: any) {
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not found. Bot will not start.");
    return null;
  }

  const bot = new TelegramBot(token, { polling: !useWebhook });

  // Log polling/webhook errors to aid debugging
  bot.on('polling_error', (error) => {
    console.error('Telegram bot polling error:', error.message);
  });

  bot.on('webhook_error', (error) => {
    console.error('Telegram bot webhook error:', error.message);
  });

  // Log admin configuration on startup
  console.log("Telegram Bot initializing with admin config:");
  console.log(`  Admin Emails: ${ADMIN_EMAILS.join(', ')}`);
  console.log(`  Admin Telegram: ${ADMIN_TELEGRAM_USERNAME}`);
  console.log(`  Admin User ID: ${ADMIN_TELEGRAM_USER_ID}`);
  console.log(`  Webhook mode: ${useWebhook ? `enabled (${webhookUrl})` : 'disabled (polling)'}`);

  // Ensure DB connectivity and set webhook if configured
  (async () => {
    try {
      await connectDB();
      console.log('Telegram bot database connection ready');
    } catch (error) {
      console.error('Telegram bot database connection failed:', error);
    }

    if (useWebhook && webhookUrl) {
      try {
        await bot.setWebHook(webhookUrl, webhookSecret ? { secret_token: webhookSecret } : undefined);
        console.log(`Telegram webhook set: ${webhookUrl}`);
      } catch (error) {
        console.error('Failed to set Telegram webhook:', error);
      }
    } else {
      try {
        await bot.deleteWebHook();
        console.log('Telegram bot polling enabled');
      } catch (error) {
        console.error('Failed to clear Telegram webhook for polling:', error);
      }
    }
  })();

  // ── Command handler functions ────────────────────────────────────────────────
  // Each command's logic lives in a named async function so that both
  // bot.onText() handlers and the callback_query handler can call them
  // directly — avoiding the broken bot.emit('message', fakeMsg) pattern,
  // which never triggers onText callbacks.

  async function handleStart(chatId: number, payload?: string) {
    // If a 6-digit verification code was passed as the deep-link start payload,
    // auto-link the account immediately instead of asking the user to send the
    // code manually.
    if (payload && /^\d{6}$/.test(payload)) {
      try {
        const existingForChat = await User.findOne({ telegramChatId: chatId.toString() }).lean();
        if (existingForChat) {
          await bot.sendMessage(
            chatId,
            `⚠️ This Telegram account is already connected to @${existingForChat.username}.\n\n` +
              `Each Telegram account can only be linked to one DDU Social account.`
          );
          return;
        }
        const user = await User.findOne({ telegramAuthCode: payload });

        if (!user) {
          // Code not found — fall through to normal /start response
          await bot.sendMessage(
            chatId,
            "❌ *Invalid verification code*\n\n" +
            "The code in the link is incorrect or has expired.\n\n" +
            "Please:\n" +
            "1. Go to the DDU Social web app\n" +
            "2. Get a new 6-digit code\n" +
            "3. Send it here or use the new link\n\n" +
            "Need help? Use /help",
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Check if code has expired
        if (user.telegramAuthCodeExpiresAt && user.telegramAuthCodeExpiresAt.getTime() < Date.now()) {
          await bot.sendMessage(
            chatId,
            "⏰ *Code Expired*\n\n" +
            "This verification code has expired (codes are valid for 15 minutes).\n\n" +
            "Please:\n" +
            "1. Go to the DDU Social web app\n" +
            "2. Generate a new code\n" +
            "3. Use the new link or send the code here\n\n" +
            "Need help? Use /help",
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Link the account
        user.telegramChatId = chatId.toString();
        user.telegramAuthCode = undefined; // Clear the code after successful link
        user.telegramAuthCodeExpiresAt = undefined;
        await user.save();

        primeTelegramUserCache(chatId, user);
        await bot.sendMessage(
          chatId,
          `✅ *Account linked successfully!*\n\n` +
          `Welcome, ${user.name}! 🎉\n\n` +
          `Your Telegram account is now connected to DDU Social.\n\n` +
          `You'll receive instant notifications for:\n` +
          `• New messages 💬\n` +
          `• Likes and comments ❤️\n` +
          `• New followers 👥\n` +
          `• Trending posts 🔥\n\n` +
          `Use /menu to explore all features!`,
          {
            parse_mode: 'Markdown',
            reply_markup: getMainMenuKeyboard()
          }
        );
        return;
      } catch (error) {
        console.error('Error during /start deep-link verification:', error);
        await bot.sendMessage(
          chatId,
          "⚠️ *Connection Error*\n\n" +
          "We're having trouble linking your account right now.\n\n" +
          "Please try again in a few moments. If the problem persists, contact /support",
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    try {
      const user = await getUserFromTelegram(chatId);

      if (user) {
        await bot.sendMessage(
          chatId,
          `🎉 Welcome back, *${user.name}*!\n\n` +
          "Ready to dive into DDU Social? Pick an option below:",
          {
            parse_mode: 'Markdown',
            reply_markup: getMainMenuKeyboard()
          }
        );
      } else {
        await bot.sendMessage(
          chatId,
          "🚀 *Welcome to DDU Social Bot!*\n\n" +
          "Your campus social hub is now in your pocket. To get started:\n\n" +
          "1️⃣ Open the DDU Social web app\n" +
          "2️⃣ Get your 6-digit verification code\n" +
          "3️⃣ Send it here to link your account\n\n" +
          "Once linked, you'll get instant notifications, check stats, view trending posts, and much more!\n\n" +
          "Need help? Use /help",
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      console.error('Error handling /start command:', error);
      bot.sendMessage(
        chatId,
        "⚠️ Sorry, something went wrong. Please try again later or contact /support"
      );
    }
  }

  function handleHelp(chatId: number) {
    bot.sendMessage(
      chatId,
      "📱 *DDU Social Bot - Commands*\n\n" +
      "*Main Commands:*\n" +
      "/start - Show main menu\n" +
      "/menu - Open interactive menu\n" +
      "/help - Show this help message\n\n" +
      "*Social:*\n" +
      "/stats - View your statistics\n" +
      "/profile [@username] - View profile\n" +
      "/trending - See trending posts\n\n" +
      "*Communication:*\n" +
      "/unread - View unread messages\n\n" +
      "*Other:*\n" +
      "/ads - View advertisements\n" +
      "/contact - Contact developer\n" +
      "/support - Report bugs or suggest features\n\n" +
      "💡 Tip: Use /support to report bugs or share feature ideas directly with the dev team!",
      { parse_mode: 'Markdown' }
    );
  }

  async function handleMenu(chatId: number) {
    const user = await getUserFromTelegram(chatId);

    if (!user) {
      bot.sendMessage(
        chatId,
        "⚠️ Please link your account first by sending your 6-digit verification code from the web app."
      );
      return;
    }

    bot.sendMessage(
      chatId,
      `📱 *Main Menu*\n\nHey ${user.name}, what would you like to do?`,
      {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard()
      }
    );
  }

  async function handleStats(chatId: number) {
    try {
      await sendBotChatAction(bot, chatId);
      const user = await getUserFromTelegram(chatId);
      if (!user) {
        bot.sendMessage(
          chatId,
          "⚠️ Please link your account first by sending your 6-digit verification code."
        );
        return;
      }

      const [stats] = await getCachedResponse(`stats:${user._id.toString()}`, async () => (
        Post.aggregate([
          { $match: { userId: user._id, isDeleted: false } },
          {
            $group: {
              _id: null,
              posts: { $sum: 1 },
              totalLikes: { $sum: { $size: { $ifNull: ['$likedBy', []] } } },
              totalComments: { $sum: { $ifNull: ['$commentsCount', 0] } },
              totalShares: { $sum: { $ifNull: ['$sharesCount', 0] } },
            },
          },
        ])
      ), 90_000);
      const postsCount = stats?.posts || 0;
      const totalLikes = stats?.totalLikes || 0;
      const totalComments = stats?.totalComments || 0;
      const totalShares = stats?.totalShares || 0;

      const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

      const statsMessage =
        `📊 *Your DDU Social Stats*\n\n` +
        `👤 *${user.name}* ${user.isVerified ? '✓' : ''}\n` +
        `@${user.username}\n\n` +
        `*Account:*\n` +
        `• Member for ${accountAge} days\n` +
        `• Role: ${user.role}\n\n` +
        `*Following:*\n` +
        `• Followers: ${user.followerIds?.length || 0}\n` +
        `• Following: ${user.followingIds?.length || 0}\n\n` +
        `*Content:*\n` +
        `• Posts: ${postsCount}\n` +
        `• Total Likes: ${totalLikes}\n` +
        `• Total Comments: ${totalComments}\n` +
        `• Total Shares: ${totalShares}\n\n` +
        `🎯 Engagement Rate: ${postsCount > 0 ? Math.round((totalLikes + totalComments) / postsCount) : 0} per post`;

      bot.sendMessage(chatId, statsMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 Back to Menu', callback_data: 'menu_main' }
          ]]
        }
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      bot.sendMessage(chatId, "⚠️ Failed to load your stats. Please try again later.");
    }
  }

  async function handleNotifications(chatId: number) {
    bot.sendMessage(
      chatId,
      "🔔 Notifications are now delivered automatically.\n\n" +
        "To control what you receive, open the DDU Social app → Settings → Telegram notifications.",
    );
  }

  async function handleUnread(chatId: number) {
    try {
      await sendBotChatAction(bot, chatId);
      const user = await getUserFromTelegram(chatId);
      if (!user) {
        bot.sendMessage(
          chatId,
          "⚠️ Please link your account first by sending your 6-digit verification code."
        );
        return;
      }

      const unreadMessages = await getCachedResponse(`unread:${user._id.toString()}`, async () => (
        Message.find({
          receiverId: user._id,
          isRead: false,
          deletedAt: { $exists: false }
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('senderId', 'name username')
          .lean()
      ), 45_000);

      if (unreadMessages.length === 0) {
        bot.sendMessage(
          chatId,
          "💬 *Messages*\n\nNo unread messages. You're all caught up!",
          { parse_mode: 'Markdown' }
        );
        return;
      }

      let messageText = `💬 *Unread Messages* (${unreadMessages.length})\n\n`;

      unreadMessages.slice(0, 5).forEach((msg: any) => {
        const sender = msg.senderId;
        const preview = msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text;
        messageText += `📨 From *${sender.name}* (@${sender.username})\n`;
        messageText += `   "${preview}"\n`;
        messageText += `   ${formatDate(msg.createdAt)}\n\n`;
      });

      if (unreadMessages.length > 5) {
        messageText += `\n_...and ${unreadMessages.length - 5} more messages_`;
      }

      messageText += `\n💡 Open the web app to read and reply to messages.`;

      bot.sendMessage(chatId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 Back to Menu', callback_data: 'menu_main' }
          ]]
        }
      });
    } catch (error) {
      console.error('Error fetching unread messages:', error);
      bot.sendMessage(chatId, "⚠️ Failed to load messages. Please try again later.");
    }
  }

  async function handleProfile(chatId: number, requestedUsername?: string) {
    try {
      await sendBotChatAction(bot, chatId);
      const currentUser = await getUserFromTelegram(chatId);
      if (!currentUser) {
        bot.sendMessage(
          chatId,
          "⚠️ Please link your account first by sending your 6-digit verification code."
        );
        return;
      }

      const normalizedUsername = requestedUsername?.trim().toLowerCase();
      const targetUser = normalizedUsername
        ? await getCachedResponse(`profile:user:${normalizedUsername}`, () => User.findOne({ username: normalizedUsername }).lean(), 90_000)
        : currentUser;

      if (!targetUser) {
        bot.sendMessage(chatId, "❌ User not found. Please check the username and try again.");
        return;
      }

      const postsCount = await getCachedResponse(`profile:posts:${targetUser._id.toString()}`, () => (
        Post.countDocuments({ userId: targetUser._id, isDeleted: false })
      ), 90_000);
      const isOwnProfile = targetUser._id.toString() === currentUser._id.toString();

      let profileText = `👤 *Profile*\n\n`;
      profileText += `*${targetUser.name}* ${targetUser.isVerified ? '✓' : ''}\n`;
      profileText += `@${targetUser.username}\n\n`;

      if (targetUser.bio) {
        profileText += `${targetUser.bio}\n\n`;
      }

      profileText += `*Stats:*\n`;
      profileText += `• Posts: ${postsCount}\n`;
      profileText += `• Followers: ${targetUser.followerIds?.length || 0}\n`;
      profileText += `• Following: ${targetUser.followingIds?.length || 0}\n\n`;

      if (targetUser.department) {
        profileText += `🎓 ${targetUser.department}\n`;
      }
      if (targetUser.location) {
        profileText += `📍 ${targetUser.location}\n`;
      }

      const keyboard: any = { inline_keyboard: [] };

      if (!isOwnProfile) {
        const isFollowing = currentUser.followingIds?.some(id => id.toString() === targetUser._id.toString());
        keyboard.inline_keyboard.push([
          { text: isFollowing ? '✓ Following' : '➕ Follow', callback_data: `profile_follow_${targetUser._id}` }
        ]);
      }

      keyboard.inline_keyboard.push([
        { text: '🔙 Back to Menu', callback_data: 'menu_main' }
      ]);

      bot.sendMessage(chatId, profileText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      console.error('Error fetching profile:', error);
      bot.sendMessage(chatId, "⚠️ Failed to load profile. Please try again later.");
    }
  }

  async function handleTrending(chatId: number) {
    try {
      await sendBotChatAction(bot, chatId);
      const user = await getUserFromTelegram(chatId);
      if (!user) {
        bot.sendMessage(
          chatId,
          "⚠️ Please link your account first by sending your 6-digit verification code."
        );
        return;
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const trendingPosts = await getCachedResponse('trending:7d', async () => (
        Post.aggregate([
          {
            $match: {
              isDeleted: false,
              createdAt: { $gte: sevenDaysAgo }
            }
          },
          {
            $addFields: {
              likesCount: { $size: { $ifNull: ['$likedBy', []] } }
            }
          },
          { $sort: { likesCount: -1, commentsCount: -1, sharesCount: -1, createdAt: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: '$user' }
        ])
      ), 120_000);

      if (trendingPosts.length === 0) {
        bot.sendMessage(
          chatId,
          "🔥 *Trending Posts*\n\nNo trending posts at the moment. Be the first to post!",
          { parse_mode: 'Markdown' }
        );
        return;
      }

      let trendingText = `🔥 *Trending on DDU Social*\n\n`;
      trendingText += `Top posts from the last 7 days:\n\n`;

      trendingPosts.forEach((post: any, idx) => {
        const author = post.user;
        const contentPreview = post.content.length > 80
          ? post.content.substring(0, 80) + '...'
          : post.content;

        trendingText += `${idx + 1}. *${author.name}* ${author.isVerified ? '✓' : ''} @${author.username}\n`;
        trendingText += `   ${contentPreview}\n`;
        trendingText += `   ❤️ ${post.likesCount || 0} 💬 ${post.commentsCount} 🔄 ${post.sharesCount}\n`;
        trendingText += `   ${formatDate(post.createdAt)}\n\n`;
      });

      trendingText += `\n💡 Open the web app to interact with these posts!`;

      bot.sendMessage(chatId, trendingText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Refresh', callback_data: 'menu_trending' },
            { text: '🔙 Menu', callback_data: 'menu_main' }
          ]]
        }
      });
    } catch (error) {
      console.error('Error fetching trending posts:', error);
      bot.sendMessage(chatId, "⚠️ Failed to load trending posts. Please try again later.");
    }
  }

  function handleContact(chatId: number) {
    const primaryAdminEmail = ADMIN_EMAILS[0] || 'Envologia01@gmail.com';
    bot.sendMessage(
      chatId,
      "👨‍💻 *Contact the Developer*\n\n" +
      "Need to reach out to the development team?\n\n" +
      `Telegram: ${ADMIN_TELEGRAM_USERNAME}\n` +
      `Email: ${primaryAdminEmail}\n\n` +
      "For technical issues and support, use /support",
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📱 Message Developer', url: `https://t.me/${ADMIN_TELEGRAM_USERNAME.replace('@', '')}` }
          ]]
        }
      }
    );
  }

  function handleSupport(chatId: number) {
    bot.sendMessage(
      chatId,
      "🆘 *Technical Support*\n\n" +
      "Need help or want to contribute?\n\n" +
      `📞 Contact ${ADMIN_TELEGRAM_USERNAME} for:\n` +
      "• 🐛 Bug reports\n" +
      "• 💡 Feature suggestions\n" +
      "• 🔧 Technical problems\n" +
      "• 🔐 Account issues\n\n" +
      "Use the buttons below to directly reach the developer:",
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🐛 Report Bug', url: `https://t.me/${ADMIN_TELEGRAM_USERNAME.replace('@', '')}` }],
            [{ text: '💡 Suggest Feature', url: `https://t.me/${ADMIN_TELEGRAM_USERNAME.replace('@', '')}` }],
            [{ text: '💬 General Support', url: `https://t.me/${ADMIN_TELEGRAM_USERNAME.replace('@', '')}` }]
          ]
        }
      }
    );
  }

  async function handleAds(chatId: number) {
    try {
      await sendBotChatAction(bot, chatId, 'typing');
      const activeAds = await getCachedResponse('ads:active', async () => {
        const now = new Date();
        return Ad.find({
          isActive: true,
          $and: [
            {
              $or: [
                { startDate: { $exists: false } },
                { startDate: { $lte: now } }
              ]
            },
            {
              $or: [
                { endDate: { $exists: false } },
                { endDate: { $gte: now } }
              ]
            }
          ]
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('createdBy', 'name')
          .lean();
      }, 120_000);

      if (activeAds.length === 0) {
        bot.sendMessage(
          chatId,
          "📢 *No Active Advertisements*\n\nThere are no advertisements available at this time.",
          { parse_mode: 'Markdown' }
        );
        return;
      }

      bot.sendMessage(
        chatId,
        `📢 *Active Advertisements* (${activeAds.length})\n\n` +
        "Here are the latest ads from DDU Social:",
        { parse_mode: 'Markdown' }
      );

      const adImpressionUpdates: Array<{ updateOne: { filter: { _id: any }; update: { $inc: { impressions: number } } } }> = [];
      for (const ad of activeAds) {
        adImpressionUpdates.push({
          updateOne: {
            filter: { _id: ad._id },
            update: { $inc: { impressions: 1 } }
          }
        });
        const message = `*${ad.title}*\n\n${ad.content}`;
        const keyboard: any = { inline_keyboard: [] };

        if (ad.linkUrl) {
          keyboard.inline_keyboard.push([
            { text: '🔗 Learn More', url: ad.linkUrl, callback_data: `ad_click_${ad._id}` }
          ]);
        }

        if (ad.imageUrl) {
          await sendBotChatAction(bot, chatId, 'upload_photo');
          await bot.sendPhoto(chatId, ad.imageUrl, {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
          });
        } else {
          await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined
          });
        }
      }

      if (adImpressionUpdates.length > 0) {
        await Ad.bulkWrite(adImpressionUpdates);
      }
    } catch (error) {
      console.error('Error fetching ads:', error);
      bot.sendMessage(chatId, "⚠️ Sorry, there was an error fetching advertisements. Please try again later.");
    }
  }

  // ── Command registrations ────────────────────────────────────────────────────

  bot.onText(/^\/start(?:\s+(\S+))?/, (msg, match) => handleStart(msg.chat.id, match?.[1]?.trim()));
  bot.onText(/\/help/, (msg) => handleHelp(msg.chat.id));
  bot.onText(/\/menu/, (msg) => handleMenu(msg.chat.id));
  bot.onText(/\/stats/, (msg) => handleStats(msg.chat.id));
  // Notifications are delivered automatically based on in-app toggles.
  // The bot no longer exposes a notifications UI.
  bot.onText(/\/unread/, (msg) => handleUnread(msg.chat.id));
  bot.onText(/\/profile(?:\s+@?(\w+))?/, (msg, match) => handleProfile(msg.chat.id, match?.[1]));
  bot.onText(/\/trending/, (msg) => handleTrending(msg.chat.id));
  bot.onText(/\/contact/, (msg) => handleContact(msg.chat.id));
  bot.onText(/\/support/, (msg) => handleSupport(msg.chat.id));
  bot.onText(/\/ads/, (msg) => handleAds(msg.chat.id));

  // ── Callback query handler ───────────────────────────────────────────────────

  // Handle callback queries for ad clicks and menu navigation
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) return;

    try {
      // Handle ad clicks
      if (data.startsWith('ad_click_')) {
        const adId = data.replace('ad_click_', '');
        const ad = await Ad.findById(adId);
        if (ad) {
          ad.clicks += 1;
          await ad.save();
        }
        bot.answerCallbackQuery(query.id, {
          text: '✅ Opening link...',
          show_alert: false
        });
        return;
      }

      // Handle menu navigation
      const user = await getUserFromTelegram(chatId);
      if (!user && data !== 'menu_help') {
        bot.answerCallbackQuery(query.id, {
          text: '⚠️ Please link your account first',
          show_alert: true
        });
        return;
      }

      switch (data) {
        case 'menu_main':
          bot.editMessageText(
            `📱 *Main Menu*\n\nHey ${user?.name}, what would you like to do?`,
            {
              chat_id: chatId,
              message_id: query.message?.message_id,
              parse_mode: 'Markdown',
              reply_markup: getMainMenuKeyboard()
            }
          );
          bot.answerCallbackQuery(query.id);
          break;

        case 'menu_stats':
          bot.answerCallbackQuery(query.id, { text: '📊 Loading stats...' });
          await handleStats(chatId);
          break;

        case 'menu_notifications':
          bot.answerCallbackQuery(query.id, { text: 'Notifications are managed in the app.' });
          break;

        case 'menu_messages':
          bot.answerCallbackQuery(query.id, { text: '💬 Loading messages...' });
          await handleUnread(chatId);
          break;

        case 'menu_trending':
          bot.answerCallbackQuery(query.id, { text: '🔥 Loading trending...' });
          await handleTrending(chatId);
          break;

        case 'menu_ads':
          bot.answerCallbackQuery(query.id, { text: '📢 Loading ads...' });
          await handleAds(chatId);
          break;

        case 'menu_profile':
          bot.answerCallbackQuery(query.id, { text: '👤 Loading profile...' });
          await handleProfile(chatId);
          break;

        case 'menu_help':
          bot.answerCallbackQuery(query.id, { text: '❓ Loading help...' });
          handleHelp(chatId);
          break;

        case 'notif_mark_read':
          bot.answerCallbackQuery(query.id, { text: 'Notifications are managed in the app.' });
          break;

        default:
          if (data.startsWith('profile_follow_')) {
            const targetUserId = data.replace('profile_follow_', '');
            if (user) {
              const targetUser = await User.findById(targetUserId);
              if (targetUser) {
                const isFollowing = user.followingIds?.some(id => id.toString() === targetUserId);
                if (isFollowing) {
                  user.followingIds = user.followingIds?.filter(id => id.toString() !== targetUserId) || [];
                  targetUser.followerIds = targetUser.followerIds?.filter(id => id.toString() !== user._id.toString()) || [];
                  bot.answerCallbackQuery(query.id, {
                    text: `Unfollowed ${targetUser.name}`,
                    show_alert: false
                  });
                } else {
                  user.followingIds = [...(user.followingIds || []), targetUser._id];
                  targetUser.followerIds = [...(targetUser.followerIds || []), user._id];
                  bot.answerCallbackQuery(query.id, {
                    text: `Now following ${targetUser.name}!`,
                    show_alert: false
                  });
                }
                await user.save();
                await targetUser.save();
                await handleProfile(chatId, targetUser.username);
              }
            }
          } else {
            bot.answerCallbackQuery(query.id);
          }
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
      bot.answerCallbackQuery(query.id, {
        text: '⚠️ An error occurred',
        show_alert: true
      });
    }
  });

  // ── Free-text message handler ────────────────────────────────────────────────

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Skip command messages — they are handled by onText() above
    if (text?.startsWith('/')) return;

    // Check for 6-digit verification code
    if (text && /^\d{6}$/.test(text)) {
      try {
        const existingForChat = await User.findOne({ telegramChatId: chatId.toString() }).lean();
        if (existingForChat) {
          bot.sendMessage(
            chatId,
            `⚠️ This Telegram account is already connected to @${existingForChat.username}.\n\n` +
              `Each Telegram account can only be linked to one DDU Social account.`
          );
          return;
        }
        const user = await User.findOne({ telegramAuthCode: text });

        if (!user) {
          bot.sendMessage(
            chatId,
            "❌ *Invalid verification code*\n\n" +
            "The code you entered is incorrect or expired.\n\n" +
            "Please:\n" +
            "1. Go to the DDU Social web app\n" +
            "2. Get a new 6-digit code\n" +
            "3. Send it here\n\n" +
            "Need help? Use /support",
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Check if code has expired
        if (user.telegramAuthCodeExpiresAt && user.telegramAuthCodeExpiresAt.getTime() < Date.now()) {
          bot.sendMessage(
            chatId,
            "⏰ *Code Expired*\n\n" +
            "This verification code has expired (codes are valid for 15 minutes).\n\n" +
            "Please:\n" +
            "1. Go to the DDU Social web app\n" +
            "2. Generate a new code\n" +
            "3. Send it here\n\n" +
            "Need help? Use /support",
            { parse_mode: 'Markdown' }
          );
          return;
        }

        // Link the account
        user.telegramChatId = chatId.toString();
        user.telegramAuthCode = undefined; // Clear the code after successful link
        user.telegramAuthCodeExpiresAt = undefined;
        await user.save();

        primeTelegramUserCache(chatId, user);
        bot.sendMessage(
          chatId,
          `✅ *Account linked successfully!*\n\n` +
          `Welcome, ${user.name}! 🎉\n\n` +
          `Your Telegram account is now approved for authentication and recovery.\n\n` +
          `You'll now receive instant notifications for:\n` +
          `• New messages 💬\n` +
          `• Likes and comments ❤️\n` +
          `• New followers 👥\n` +
          `• Trending posts 🔥\n\n` +
          `Use /menu to explore all features!`,
          {
            parse_mode: 'Markdown',
            reply_markup: getMainMenuKeyboard()
          }
        );
      } catch (error) {
        console.error("Bot verification error:", error);
        bot.sendMessage(
          chatId,
          "⚠️ *Connection Error*\n\n" +
          "We're having trouble linking your account right now.\n\n" +
          "Please try again in a few moments. If the problem persists, contact /support",
          { parse_mode: 'Markdown' }
        );
      }
    }
    // Check for password reset requests
    else if (text?.toLowerCase().includes('reset password')) {
      bot.sendMessage(
        chatId,
        "🔐 *Password Reset*\n\n" +
        "To reset your password:\n\n" +
        "1. Open the DDU Social web app\n" +
        "2. Click 'Forgot Password'\n" +
        "3. Follow the instructions\n\n" +
        "You'll receive an OTP to reset your password.\n\n" +
        "Need help? Use /support",
        { parse_mode: 'Markdown' }
      );
    }
    // General help keywords
    else if (text?.toLowerCase().includes('support') || text?.toLowerCase().includes('help')) {
      bot.sendMessage(
        chatId,
        "💡 *Quick Help*\n\n" +
        "Here are the main commands:\n\n" +
        "/help - Full command list\n" +
        "/menu - Interactive menu\n" +
        "/support - Contact support\n" +
        "/start - Get started\n\n" +
        "Or choose an option from the menu below:",
        {
          parse_mode: 'Markdown',
          reply_markup: getMainMenuKeyboard()
        }
      );
    }
    // If user sends something else, check if they're linked
    else if (text) {
      const user = await getUserFromTelegram(chatId);
      if (!user) {
        bot.sendMessage(
          chatId,
          "👋 Hi there!\n\n" +
          "To use DDU Social Bot, please link your account first by sending your 6-digit verification code from the web app.\n\n" +
          "Don't have an account? Visit the DDU Social web app to sign up!\n\n" +
          "Use /help for more information."
        );
      } else {
        // User is linked but sent unknown text
        bot.sendMessage(
          chatId,
          `Hey ${user.name}! 👋\n\n` +
          "I didn't understand that. Try using /menu or /help to see what I can do!",
          {
            reply_markup: getMainMenuKeyboard()
          }
        );
      }
    }
  });

  console.log("Telegram Bot initialized");
  return bot;
}
