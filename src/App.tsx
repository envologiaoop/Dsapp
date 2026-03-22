import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Home, MessageSquare, Ghost, LogOut, Shield, Bell, Plus, User, Search, Lock, Eye, HelpCircle, Flag, ChevronRight, UserCog, Sparkles, Copy, RefreshCw, ExternalLink, X } from 'lucide-react';
import { OnboardingFlow } from './components/Onboarding/OnboardingFlow';
import { IntroductionFlow } from './components/Onboarding/IntroductionFlow';
import { PostActions } from './components/PostActions';
import { FollowButton } from './components/FollowButton';
import { ImageCarousel } from './components/ImageCarousel';
import { cn } from './lib/utils';
import { Dock } from '../components/ui/dock-two';
import { ThemeSwitch } from './components/ui/ThemeSwitch';
import { NotificationBell } from './components/NotificationBell';
import socket from './services/socket';
import { PostOptions } from './components/PostOptions';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { SocialText } from './components/SocialText';

import { NotificationSettings, DEFAULT_NOTIFICATION_SETTINGS, normalizeNotificationSettings } from './utils/notificationSettings';
import { normalizeContentType } from './utils/community';
import { sortStoryGroups, StoryGroup } from './utils/stories';
import { GHOST_MODE_MIN_ACCOUNT_AGE_DAYS, canUseGhostMode } from './utils/ghostPolicy';
import { getTelegramHandle, getTelegramProfileUrl, getTelegramDeepLink } from './utils/telegram';
import { getStoredDataSaverMode, setStoredDataSaverMode, shouldEnableDataSaverByDefault } from './utils/performance';
import { withAuthHeaders } from './utils/clientAuth';

const AUTH_SYNC_ORIGINS = [
  'https://ddusocial.vercel.app',
  'https://ddusocial.tech',
  'http://localhost:5173',
  'http://localhost:3000',
];

const ChatRoom = lazy(() => import('./components/Chat/ChatRoom').then((m) => ({ default: m.ChatRoom })));
const CreatePost = lazy(() => import('./components/CreatePost').then((m) => ({ default: m.CreatePost })));
const Inbox = lazy(() => import('./components/Inbox').then((m) => ({ default: m.Inbox })));
const NotificationPanel = lazy(() => import('./components/NotificationPanel').then((m) => ({ default: m.NotificationPanel })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const InstagramProfile = lazy(() => import('./components/InstagramProfile').then((m) => ({ default: m.InstagramProfile })));
const EditProfileModal = lazy(() => import('./components/EditProfileModal').then((m) => ({ default: m.EditProfileModal })));
const SearchPanel = lazy(() => import('./components/SearchPanel').then((m) => ({ default: m.SearchPanel })));
const StoryViewer = lazy(() => import('./components/StoryViewer').then((m) => ({ default: m.StoryViewer })));
const StoryUpload = lazy(() => import('./components/StoryUpload').then((m) => ({ default: m.StoryUpload })));
const CommentsPanel = lazy(() => import('./components/CommentsPanel').then((m) => ({ default: m.CommentsPanel })));

function LazyScreenFallback({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center">
      <div className="inline-flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [hasSeenIntro, setHasSeenIntro] = useState(() => {
    try {
      return localStorage.getItem('ddu_intro_seen') === 'true';
    } catch {
      return false;
    }
  });
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'chat' | 'inbox' | 'profile' | 'settings'>('home');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<any>(null);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [viewingProfileUserId, setViewingProfileUserId] = useState<string | null>(null);
  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [profileSelectedPost, setProfileSelectedPost] = useState<any | null>(null);
  const profileReturnRef = useRef<{ tab: typeof activeTab; viewingProfileUserId: string | null } | null>(null);
  const [searchInitialQuery, setSearchInitialQuery] = useState('');
  const [telegramNotificationsEnabled, setTelegramNotificationsEnabled] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [activeStoryUserId, setActiveStoryUserId] = useState<string | null>(null);
  const [showStoryUpload, setShowStoryUpload] = useState(false);
  const [telegramAuthCode, setTelegramAuthCode] = useState('');
  const [refreshingTelegramCode, setRefreshingTelegramCode] = useState(false);
  const [verifyingTelegram, setVerifyingTelegram] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);
  const [copiedTelegramCode, setCopiedTelegramCode] = useState(false);
  const [liteModeEnabled, setLiteModeEnabled] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Stable refs to avoid stale closures in socket effects
  const fetchChatsRef = useRef<(() => void) | null>(null);
  const chatDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Computed values
  const ghostModeDisabled = !canUseGhostMode(user?.createdAt);
  const visiblePosts = (Array.isArray(posts) ? posts : []).filter(
    (post) => post.approvalStatus !== 'pending' && post.approvalStatus !== 'rejected'
  );
  const botHandle = getTelegramHandle(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);
  const botUrl = getTelegramProfileUrl(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);
  const supportContactUrl = 'https://t.me/dev_envologia';
  const dockActiveLabel =
    activeTab === 'home'
      ? 'Home'
      : activeTab === 'chat'
        ? 'Chat'
        : activeTab === 'profile'
          ? 'Profile'
          : undefined;

  // Notification settings labels for the UI
  const notificationSettingLabels = [
    { key: 'messages' as const, title: 'Direct Messages', description: 'New messages from other users' },
    { key: 'comments' as const, title: 'Comments', description: 'Comments on your posts' },
    { key: 'likes' as const, title: 'Likes', description: 'When someone likes your post' },
    { key: 'follows' as const, title: 'Follows', description: 'New followers' },
    { key: 'mentions' as const, title: 'Mentions', description: 'When someone mentions you' },
    { key: 'shares' as const, title: 'Shares', description: 'When someone shares your post' },
  ];

  const toggleGhostMode = () => {
    if (!ghostModeDisabled) {
      setIsAnonymous(!isAnonymous);
    }
  };

  const refreshTelegramAuthCode = useCallback(async (forceNew = false) => {
    if (!user?.id || user.telegramChatId) return;

    if (user.telegramAuthCode && !forceNew) {
      setTelegramAuthCode(user.telegramAuthCode);
      return;
    }

    setRefreshingTelegramCode(true);
    try {
      const response = await fetch('/api/auth/telegram-code', {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: user.id }),
      });

      if (response.ok) {
        const data = await response.json();
        setTelegramAuthCode(data.telegramAuthCode);
        const updatedUser = normalizeUser({ ...user, telegramAuthCode: data.telegramAuthCode, telegramChatId: undefined });
        setUser(updatedUser);
        localStorage.setItem('ddu_user', JSON.stringify(updatedUser));
        setTelegramStatus('New Telegram code generated. Send it to the bot to link your account.');
      } else {
        const errorText = await response.text();
        setTelegramStatus(errorText || 'Unable to refresh Telegram code right now.');
      }
    } catch (error) {
      console.error('Failed to refresh Telegram auth code:', error);
      setTelegramStatus('Unable to refresh Telegram code right now.');
    } finally {
      setRefreshingTelegramCode(false);
    }
  }, [user]);

  const handleCopyTelegramCode = async () => {
    if (!telegramAuthCode) return;
    try {
      await navigator.clipboard.writeText(telegramAuthCode);
      setCopiedTelegramCode(true);
      setSettingsNotice({ type: 'success', message: 'Telegram code copied.' });
      setTimeout(() => setCopiedTelegramCode(false), 2000);
    } catch (error) {
      console.error('Failed to copy Telegram code:', error);
      setSettingsNotice({ type: 'error', message: 'Unable to copy Telegram code right now.' });
    }
  };

  const verifyTelegramLink = async () => {
    if (!telegramAuthCode) return;
    setVerifyingTelegram(true);
    setTelegramStatus(null);

    try {
      const response = await fetch(`/api/auth/verify-telegram/${telegramAuthCode}`);
      const data = await response.json();

      if (data?.verified && data.user) {
        const normalizedUser = normalizeUser({
          ...data.user,
          notificationSettings: normalizeNotificationSettings(data.user.notificationSettings),
        });
        setUser(normalizedUser);
        setTelegramNotificationsEnabled(Boolean(normalizedUser.telegramNotificationsEnabled));
        setNotificationSettings(normalizedUser.notificationSettings);
        setTelegramAuthCode(normalizedUser.telegramAuthCode || telegramAuthCode);
        localStorage.setItem('ddu_user', JSON.stringify(normalizedUser));
        setTelegramStatus('Telegram connected successfully.');
        setSettingsNotice({ type: 'success', message: 'Telegram connected successfully.' });
      } else {
        setTelegramStatus(`Still waiting for verification. Send the code to ${botHandle} on Telegram.`);
      }
    } catch (error) {
      console.error('Failed to verify Telegram link:', error);
      setTelegramStatus('Could not verify right now. Please try again in a moment.');
      setSettingsNotice({ type: 'error', message: 'Telegram verification failed. Please try again.' });
    } finally {
      setVerifyingTelegram(false);
    }
  };

  const handleNotificationSettingToggle = async (key: keyof NotificationSettings) => {
    const updatedSettings = {
      ...notificationSettings,
      [key]: !notificationSettings[key],
    };
    setNotificationSettings(updatedSettings);
    if (user) {
      const optimisticUser = normalizeUser({ ...user, notificationSettings: updatedSettings });
      setUser(optimisticUser);
      localStorage.setItem('ddu_user', JSON.stringify(optimisticUser));
    }

    if (!user?.id) return;

    try {
      const response = await fetch(`/api/users/${user.id}/telegram-notifications`, {
        method: 'PUT',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: telegramNotificationsEnabled, settings: updatedSettings })
      });

      if (response.ok) {
        const data = await response.json();
        const nextSettings = normalizeNotificationSettings(data.notificationSettings);
        setNotificationSettings(nextSettings);
        const updatedUser = {
          ...user,
          telegramNotificationsEnabled: data.telegramNotificationsEnabled,
          notificationSettings: nextSettings,
        };
        const normalizedUpdatedUser = normalizeUser(updatedUser);
        setUser(normalizedUpdatedUser);
        localStorage.setItem('ddu_user', JSON.stringify(normalizedUpdatedUser));
        const label = notificationSettingLabels.find((item) => item.key === key)?.title || 'Notification setting';
        setSettingsNotice({ type: 'success', message: `${updatedSettings[key] ? 'Enabled' : 'Disabled'} ${label}.` });
      }
    } catch (error) {
      console.error('Failed to update notification settings:', error);
      setSettingsNotice({ type: 'error', message: 'Failed to update notification setting.' });
    }
  };

  const handleDoubleTapLike = async (postId: string) => {
    try {
      const post = posts.find(p => p._id === postId);
      if (!post || post.isLiked) return;

      setPosts(posts.map(p =>
        p._id === postId ? { ...p, likesCount: p.likesCount + 1, isLiked: true } : p
      ));

      await fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: user?.id }),
      });
    } catch (error) {
      console.error('Failed to like post:', error);
    }
  };

  const markIntroSeen = useCallback(() => {
    setHasSeenIntro(true);
    try {
      localStorage.setItem('ddu_intro_seen', 'true');
    } catch {
      // ignore write issues
    }
  }, []);

  const normalizeUser = useCallback((raw: any) => {
    if (!raw) return raw;
    const id = raw.id || raw._id?.toString?.() || raw._id;
    return { ...raw, id };
  }, []);

  const applyStoredUser = useCallback((rawUser: any) => {
    if (!rawUser) return false;
    try {
      const normalized = normalizeUser({
        ...rawUser,
        notificationSettings: normalizeNotificationSettings(rawUser.notificationSettings),
      });
      if (!normalized.telegramChatId) {
        return false;
      }
      markIntroSeen();
      setUser(normalized);
      setIsOnboarded(true);
      setTelegramNotificationsEnabled(Boolean(normalized.telegramNotificationsEnabled));
      setNotificationSettings(normalized.notificationSettings);
      if (normalized.telegramAuthCode) {
        setTelegramAuthCode(normalized.telegramAuthCode);
      }
      localStorage.setItem('ddu_user', JSON.stringify(normalized));
      return true;
    } catch (error) {
      return false;
    }
  }, [markIntroSeen, normalizeUser]);

  const didHandleDeepLinkRef = useRef(false);

  useEffect(() => {
    const storedLiteMode = getStoredDataSaverMode();
    setLiteModeEnabled(storedLiteMode ?? shouldEnableDataSaverByDefault());

    const savedUser = localStorage.getItem('ddu_user');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        if (!applyStoredUser(parsedUser)) {
          localStorage.removeItem('ddu_user');
        }
      } catch (e) {
        localStorage.removeItem('ddu_user');
      }
    }

    // Check maintenance mode
    fetch('/api/system/maintenance')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setMaintenanceMode(data.maintenanceMode);
          setMaintenanceMessage(data.maintenanceMessage || '');
        }
      })
      .catch(() => {});
  }, [applyStoredUser]);

  // Handle deep links (e.g. from Telegram) like /?chatWith=<userId>&messageId=<messageId>
  useEffect(() => {
    if (didHandleDeepLinkRef.current) return;
    if (!isOnboarded || !user?.id) return;

    const params = new URLSearchParams(window.location.search);
    const chatWith = params.get('chatWith');
    const messageId = params.get('messageId');
    if (!chatWith) return;

    didHandleDeepLinkRef.current = true;

    (async () => {
      try {
        const res = await fetch(`/api/users/${chatWith}/profile?currentUserId=${user.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const other = data?.user || data;
        if (!other) return;
        const normalizedOther = {
          id: other.id || other._id,
          name: other.name || other.username || 'User',
          username: other.username || '',
          avatarUrl: other.avatarUrl || '',
        };
        // Store focus target so ChatRoom can scroll to it
        if (messageId) {
          sessionStorage.setItem('ddu_focus_message_id', messageId);
        }
        startChatWithUser(normalizedOther);
      } catch {
        // ignore deep link failures
      }
    })();
  }, [isOnboarded, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isOnboarded || user?.id) return;

    const targetOrigins = AUTH_SYNC_ORIGINS.filter((origin) => origin !== window.location.origin);
    if (targetOrigins.length === 0) return;

    let cleaned = false;
    const frames: HTMLIFrameElement[] = [];

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener('message', handleMessage);
      frames.forEach((frame) => frame.remove());
    };

    const handleMessage = (event: MessageEvent) => {
      if (cleaned) return;
      if (!targetOrigins.includes(event.origin)) return;
      if (event.data?.type !== 'ddu-auth-bridge-response') return;

      const payload = event.data.user;
      if (!payload) return;

      let parsedUser = payload;
      if (typeof payload === 'string') {
        try {
          parsedUser = JSON.parse(payload);
        } catch {
          return;
        }
      }

      if (applyStoredUser(parsedUser)) {
        cleanup();
      }
    };

    window.addEventListener('message', handleMessage);

    targetOrigins.forEach((origin) => {
      const frame = document.createElement('iframe');
      frame.src = `${origin}/auth-bridge.html`;
      frame.style.display = 'none';
      frame.tabIndex = -1;
      document.body.appendChild(frame);
      frames.push(frame);

      frame.onload = () => {
        frame.contentWindow?.postMessage({ type: 'ddu-auth-bridge-request' }, origin);
      };
    });

    const timeoutId = window.setTimeout(cleanup, 7000);

    return () => {
      window.clearTimeout(timeoutId);
      cleanup();
    };
  }, [applyStoredUser, isOnboarded, user?.id]);

  useEffect(() => {
    setStoredDataSaverMode(liteModeEnabled);
  }, [liteModeEnabled]);

  useEffect(() => {
    if (!settingsNotice) return;

    const timeout = setTimeout(() => setSettingsNotice(null), 2500);
    return () => clearTimeout(timeout);
  }, [settingsNotice]);

  useEffect(() => {
    if (!user?.id || user.telegramChatId) return;
    refreshTelegramAuthCode();
  }, [user?.id, user?.telegramChatId, refreshTelegramAuthCode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user?.id) return;

    const targetOrigins = AUTH_SYNC_ORIGINS.filter((origin) => origin !== window.location.origin);
    if (targetOrigins.length === 0) return;

    const frames: HTMLIFrameElement[] = [];
    const payload = JSON.stringify(user);

    targetOrigins.forEach((origin) => {
      const frame = document.createElement('iframe');
      frame.src = `${origin}/auth-bridge.html`;
      frame.style.display = 'none';
      frame.tabIndex = -1;
      document.body.appendChild(frame);
      frames.push(frame);

      frame.onload = () => {
        frame.contentWindow?.postMessage({ type: 'ddu-auth-bridge-store', user: payload }, origin);
      };
    });

    const cleanup = () => frames.forEach((frame) => frame.remove());
    const timeoutId = window.setTimeout(cleanup, 4000);

    return () => {
      window.clearTimeout(timeoutId);
      cleanup();
    };
  }, [user]);

  useEffect(() => {
    if (user?.telegramChatId) {
      setTelegramStatus(null);
    }
  }, [user?.telegramChatId]);

  useEffect(() => {
    if (isOnboarded && activeTab === 'home') {
      fetchPosts();
      fetchStories();
      fetchSuggestions();
    }
    if (isOnboarded && activeTab === 'chat') {
      fetchChats();
    }
  }, [isOnboarded, activeTab, user?.id, liteModeEnabled]);

  useEffect(() => {
    const handleFollowChanged = () => {
      fetchSuggestions();
      if (activeTab === 'home') {
        fetchPosts();
      }
    };

    window.addEventListener('social:follow-changed', handleFollowChanged as EventListener);
    return () => window.removeEventListener('social:follow-changed', handleFollowChanged as EventListener);
  }, [activeTab, fetchSuggestions]);

  // Join the user's socket room at app level so notifications and messages
  // are received even outside of ChatRoom
  useEffect(() => {
    if (!user?.id) return;

    socket.emit('join_chat', user.id);

    // When a new message arrives, refresh the chat list so the preview updates.
    // Debounce via ref to avoid multiple API calls when several messages arrive at once.
    const handleNewMessage = () => {
      if (chatDebounceRef.current) clearTimeout(chatDebounceRef.current);
      chatDebounceRef.current = setTimeout(() => fetchChatsRef.current?.(), 300);
    };

    socket.on('receive_private_message', handleNewMessage);
    socket.on('message_sent', handleNewMessage);

    return () => {
      socket.off('receive_private_message', handleNewMessage);
      socket.off('message_sent', handleNewMessage);
      if (chatDebounceRef.current) clearTimeout(chatDebounceRef.current);
    };
  }, [user?.id]);

  const fetchChats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await fetch(`/api/users/${user.id}/chats`);
      if (response.ok) {
        const data = await response.json();
        setChats(data);
      }
    } catch (error) {
      console.error("Error fetching chats:", error);
    }
  }, [user?.id]);

  // Keep the ref in sync so the socket handler always calls the latest version
  useEffect(() => {
    fetchChatsRef.current = fetchChats;
  }, [fetchChats]);

  const fetchPosts = async () => {
    if (!user?.id) return;

    try {
      const limit = liteModeEnabled ? 20 : 50;
      const response = await fetch(`/api/posts?userId=${user.id}&limit=${limit}`);
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        const data = await response.json();
        setPosts(data);
      } else {
        const text = await response.text();
        console.error("Non-JSON response from /api/posts:", text);
      }
    } catch (error) {
      console.error("Error fetching posts:", error);
    }
  };

  async function fetchSuggestions() {
    if (!user?.id) return;

    try {
      const response = await fetch(`/api/users/${user.id}/suggestions?limit=6`);
      if (response.ok) {
        const data = await response.json();
        setSuggestedUsers(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  }

  const fetchStories = async () => {
    if (!user?.id) return;

    try {
      const response = await fetch(`/api/stories?userId=${user.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch stories');
      }

      const data = await response.json();
      setStoryGroups(sortStoryGroups(data, user.id));
    } catch (error) {
      console.error('Error fetching stories:', error);
    }
  };

  const handleOnboardingFinish = (userData: any) => {
    applyStoredUser(userData);
  };

  const handleProfileUpdate = (updatedUser: any) => {
    const mergedUser = {
      ...user,
      ...updatedUser,
      notificationSettings: normalizeNotificationSettings(updatedUser.notificationSettings ?? user?.notificationSettings),
    };
    const normalized = normalizeUser(mergedUser);
    setUser(normalized);
    setNotificationSettings(mergedUser.notificationSettings);
    localStorage.setItem('ddu_user', JSON.stringify(normalized));
  };

  const handleTelegramNotificationsToggle = async () => {
    const newValue = !telegramNotificationsEnabled;
    setTelegramNotificationsEnabled(newValue);

    if (user) {
      const optimisticUser = { ...user, telegramNotificationsEnabled: newValue, notificationSettings };
      const normalizedOptimisticUser = normalizeUser(optimisticUser);
      setUser(normalizedOptimisticUser);
      localStorage.setItem('ddu_user', JSON.stringify(normalizedOptimisticUser));
    }

    if (!user?.id) return;

    try {
      const response = await fetch(`/api/users/${user.id}/telegram-notifications`, {
        method: 'PUT',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled: newValue, settings: notificationSettings })
      });

      if (response.ok) {
        const data = await response.json();
        setTelegramNotificationsEnabled(data.telegramNotificationsEnabled);
        const nextSettings = normalizeNotificationSettings(data.notificationSettings);
        setNotificationSettings(nextSettings);
        const updatedUser = {
          ...user,
          telegramNotificationsEnabled: data.telegramNotificationsEnabled,
          notificationSettings: nextSettings,
        };
        const normalizedUpdatedUser = normalizeUser(updatedUser);
        setUser(normalizedUpdatedUser);
        localStorage.setItem('ddu_user', JSON.stringify(normalizedUpdatedUser));
        setSettingsNotice({ type: 'success', message: `Telegram notifications ${data.telegramNotificationsEnabled ? 'enabled' : 'disabled'}.` });
      }
    } catch (error) {
      console.error('Failed to toggle Telegram notifications:', error);
      setSettingsNotice({ type: 'error', message: 'Failed to update Telegram notifications.' });
    }
  };

  const openSupportLink = (topic: 'bug' | 'feature') => {
    const message =
      topic === 'bug'
        ? 'Hi, I want to report a bug in DDU.'
        : 'Hi, I want to suggest a feature for DDU.';

    const url = `${supportContactUrl}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setSettingsNotice({ type: 'success', message: topic === 'bug' ? 'Opening bug report chat.' : 'Opening feature request chat.' });
  };

  const handleLogout = () => {
    localStorage.removeItem('ddu_user');
    setIsOnboarded(false);
    setUser(null);
    setPosts([]);
    setChats([]);
    setStoryGroups([]);
    setActiveStoryUserId(null);
    setProfileModalUserId(null);
    setProfileSelectedPost(null);
    setViewingProfileUserId(null);
    setShowEditProfile(false);
    setShowAdminDashboard(false);
    setShowNotifications(false);
    setShowSearch(false);
    setShowCreatePost(false);
    setShowCreateMenu(false);
    setShowStoryUpload(false);
    setCommentPostId(null);
    setActiveChat(null);
    setActiveTab('home');
    setIsAnonymous(false);
    setTelegramNotificationsEnabled(false);
    setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS);
    setTelegramAuthCode('');
    setTelegramStatus(null);
  };

  const openProfile = (targetUserId?: string | null, options?: { selectedPost?: any | null }) => {
    if (!targetUserId) return;
    if (!profileModalUserId) {
      profileReturnRef.current = { tab: activeTab, viewingProfileUserId };
    }
    setProfileModalUserId(targetUserId);
    setViewingProfileUserId(targetUserId);
    setProfileSelectedPost(options?.selectedPost || null);
    setShowSearch(false);
  };

  const openOwnProfile = () => {
    if (!user?.id) return;
    if (!profileModalUserId) {
      profileReturnRef.current = { tab: activeTab, viewingProfileUserId };
    }
    setProfileModalUserId(user.id);
    setViewingProfileUserId(user.id);
    setProfileSelectedPost(null);
  };

  const closeProfileModal = () => {
    setProfileModalUserId(null);
    setProfileSelectedPost(null);
    const ret = profileReturnRef.current;
    if (ret) {
      setActiveTab(ret.tab);
      setViewingProfileUserId(ret.viewingProfileUserId);
    }
    profileReturnRef.current = null;
  };

  const startChatWithUser = (targetUser: any) => {
    if (!targetUser) return;

    const normalizedUser = {
      id: targetUser.id || targetUser._id,
      name: targetUser.name || 'User',
      username: targetUser.username || '',
      avatarUrl: targetUser.avatarUrl || '',
    };

    if (!normalizedUser.id || normalizedUser.id === user?.id) return;

    setActiveTab('chat');
    setActiveChat(normalizedUser);
    setShowSearch(false);
    setProfileModalUserId(null);
    setViewingProfileUserId(null);
    fetchChats();
  };

  const openCreateMenu = () => setShowCreateMenu(true);

  const startCreatePost = () => {
    setShowCreateMenu(false);
    setShowCreatePost(true);
  };

  const startCreateStory = () => {
    setShowCreateMenu(false);
    setShowStoryUpload(true);
  };

  const openPostFromSearch = (post: any) => {
    if (!post?.userId?._id) return;
    openProfile(post.userId._id, { selectedPost: post });
  };

  const openHashtagSearch = (hashtag: string) => {
    setSearchInitialQuery(hashtag);
    setShowSearch(true);
  };

  if (!hasSeenIntro && !isOnboarded) {
    return <IntroductionFlow onComplete={markIntroSeen} />;
  }

  if (!isOnboarded) {
    return <OnboardingFlow onFinish={handleOnboardingFinish} />;
  }

  // Show maintenance screen for non-admin users when maintenance mode is active
  if (maintenanceMode && user?.role !== 'admin') {
    return <MaintenanceScreen message={maintenanceMessage} />;
  }

  if (activeChat) {
    const focusMessageId = sessionStorage.getItem('ddu_focus_message_id') || undefined;
    return (
      <Suspense fallback={<LazyScreenFallback label="Loading chat..." />}>
        <ChatRoom
          currentUser={user}
          otherUser={activeChat}
          focusMessageId={focusMessageId}
          onBack={() => {
            setActiveChat(null);
            setActiveTab('chat');
            fetchChats();
          }}
          onViewProfile={openProfile}
        />
      </Suspense>
    );
  }

  if (showAdminDashboard) {
    return (
      <Suspense fallback={<LazyScreenFallback label="Loading admin tools..." />}>
        <AdminDashboard userId={user?.id} onClose={() => setShowAdminDashboard(false)} />
      </Suspense>
    );
  }

  const sortedStoryGroups = user?.id ? sortStoryGroups(storyGroups, user.id) : storyGroups;
  const ownStoryGroup = sortedStoryGroups.find((group) => group.user._id === user?.id);
  const storyTrayGroups = ownStoryGroup
    ? sortedStoryGroups
    : user
      ? [{
          user: {
            _id: user.id,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl
          },
          stories: [],
          hasViewed: false
        }, ...sortedStoryGroups]
      : sortedStoryGroups;
  const viewableStoryGroups = storyTrayGroups.filter((group) => Array.isArray(group.stories) && group.stories.length > 0);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background pb-24 text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight ddu-gradient-text">DDU Social</h1>
            {isAnonymous && (
              <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <Ghost size={11} className="text-muted-foreground" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Ghost</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-full hover:bg-muted transition-colors"
              aria-label="Search"
            >
              <Search size={22} />
            </button>
            <NotificationBell userId={user?.id} onOpen={() => setShowNotifications(true)} />
            <ThemeSwitch />
            <button
              onClick={toggleGhostMode}
              className={cn(
                "p-2 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                isAnonymous ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              disabled={ghostModeDisabled}
              title={ghostModeDisabled ? `Ghost mode unlocks after ${GHOST_MODE_MIN_ACCOUNT_AGE_DAYS} days` : 'Ghost mode'}
            >
              <Ghost size={22} />
            </button>
            <button
              onClick={openOwnProfile}
              className="w-8 h-8 rounded-full overflow-hidden border border-border flex items-center justify-center font-bold text-sm bg-muted hover:opacity-90 transition-opacity"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold">{user?.name?.[0] || 'U'}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {showNotifications && (
        <Suspense fallback={<LazyScreenFallback label="Loading notifications..." />}>
          <NotificationPanel
            userId={user?.id}
            onClose={() => setShowNotifications(false)}
            onNavigate={async (n) => {
              setShowNotifications(false);
              if (n.relatedUserId) {
                openProfile(n.relatedUserId);
                return;
              }
              if (n.relatedPostId) {
                setActiveTab('home');
                try {
                  const response = await fetch(`/api/posts/${encodeURIComponent(n.relatedPostId)}?userId=${encodeURIComponent(user.id)}`);
                  if (response.ok) {
                    const post = await response.json();
                    const ownerId = post?.userId?._id?.toString?.() || post?.userId?.toString?.();
                    if (ownerId) {
                      openProfile(ownerId, { selectedPost: post });
                    } else {
                      setCommentPostId(n.relatedPostId);
                    }
                    return;
                  }
                } catch (error) {
                  console.error('Failed to open related post from notification:', error);
                }
                setCommentPostId(n.relatedPostId);
                return;
              }
            }}
          />
        </Suspense>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-lg px-0 py-0">
        {activeTab === 'home' && (
          <div className="space-y-0">
            <div className="bg-card border-b border-border">
              <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Stories</p>
                  <p className="text-xs text-muted-foreground">Quick updates at the top, posts below.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={startCreateStory}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    + Story
                  </button>
                  <button
                    onClick={openCreateMenu}
                    className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Plus size={14} />
                    Create
                  </button>
                </div>
              </div>

              <div className="flex gap-3 overflow-x-auto px-4 py-3 no-scrollbar">
                {storyTrayGroups.map((group) => {
                  const isOwnGroup = group.user._id === user?.id;
                  const hasStories = group.stories.length > 0;

                  return (
                    <button
                      key={group.user._id}
                      type="button"
                      onClick={() => {
                        if (hasStories) {
                          setActiveStoryUserId(group.user._id);
                        } else if (isOwnGroup) {
                          startCreateStory();
                        }
                      }}
                      className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 text-center"
                    >
                      <div className={cn(
                        'p-[2.5px] rounded-full',
                        hasStories
                          ? group.hasViewed
                            ? 'story-ring-viewed'
                            : 'story-ring'
                          : 'bg-border'
                      )}>
                        <div className="flex h-[3.8rem] w-[3.8rem] items-center justify-center overflow-hidden rounded-full bg-card ring-2 ring-card relative">
                          {group.user.avatarUrl ? (
                            <img src={group.user.avatarUrl} alt={group.user.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-base font-bold text-primary">{group.user.name?.[0] || 'U'}</span>
                          )}
                          {isOwnGroup && !hasStories && (
                            <div className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
                              <Plus size={11} />
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="truncate w-full text-[10px] font-semibold text-foreground">
                        {isOwnGroup ? 'Your story' : `@${group.user.username || 'user'}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {composerNotice && (
              <div className="mx-4 my-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300">
                {composerNotice}
              </div>
            )}

            {showCreatePost && (
              <div className="fixed inset-0 z-50 bg-background flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <button
                    type="button"
                    onClick={() => setShowCreatePost(false)}
                    className="p-2 rounded-full hover:bg-muted transition-colors"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                  <h2 className="text-sm font-bold">New Post</h2>
                  <div className="w-9" />
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4 max-w-lg w-full mx-auto">
                  <Suspense fallback={<LazyScreenFallback label="Loading composer..." />}>
                    <CreatePost
                      user={user}
                      isAnonymous={isAnonymous}
                      currentSection="feed"
                      onPostCreated={(createdPost) => {
                        setShowCreatePost(false);
                        if (createdPost?.approvalStatus === 'pending') {
                          setComposerNotice('Your post was submitted for review and will appear once approved.');
                        } else {
                          setComposerNotice('Your post was published to the feed.');
                        }
                        fetchPosts();
                      }}
                    />
                  </Suspense>
                </div>
              </div>
            )}

            {suggestedUsers.length > 0 && (
              <div className="bg-card border-b border-border">
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">Suggested for you</p>
                  <button className="text-xs font-semibold text-foreground">See all</button>
                </div>
                <div className="flex gap-3 overflow-x-auto px-4 pb-4 no-scrollbar">
                  {suggestedUsers.map((suggestion) => (
                    <div key={suggestion.id} className="flex w-36 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-background p-3 text-center">
                      <button
                        type="button"
                        onClick={() => openProfile(suggestion.id)}
                        className="flex flex-col items-center gap-1.5"
                      >
                        <div className="h-14 w-14 rounded-full overflow-hidden bg-muted flex items-center justify-center font-bold">
                          {suggestion.avatarUrl ? (
                            <img src={suggestion.avatarUrl} alt={suggestion.name} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-lg font-bold text-primary">{suggestion.name?.[0] || 'U'}</span>
                          )}
                        </div>
                        <p className="text-xs font-semibold truncate w-full">{suggestion.username}</p>
                        <p className="text-[10px] text-muted-foreground truncate w-full">
                          {suggestion.mutualCount > 0
                            ? `${suggestion.mutualCount} mutual`
                            : 'New on campus'}
                        </p>
                      </button>
                      <FollowButton
                        userId={user?.id}
                        targetId={suggestion.id}
                        initialIsFollowing={false}
                        className="w-full rounded-lg px-2 py-1.5 text-xs font-semibold"
                        onChange={(isFollowing) => {
                          if (isFollowing) {
                            setSuggestedUsers((prev) => prev.filter((item) => item.id !== suggestion.id));
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {visiblePosts.length > 0 ? visiblePosts.map((post) => {
              const contentType = normalizeContentType(post.contentType);
              return (
              <article key={post._id} className="bg-card border-b border-border">
                {/* Post header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => !post.isAnonymous && openProfile(post.userId?._id)}
                      disabled={post.isAnonymous || !post.userId?._id}
                      className="flex items-center gap-2.5 text-left disabled:cursor-default"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted flex items-center justify-center">
                        {post.isAnonymous ? (
                          <Ghost size={15} className="text-muted-foreground" />
                        ) : post.userId?.avatarUrl ? (
                          <img src={post.userId.avatarUrl} alt={post.userId.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        ) : (
                          <span className="text-xs font-bold text-primary">{post.userId?.name?.[0] || 'U'}</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{post.isAnonymous ? 'Ghost' : (post.userId?.name || 'User')}</p>
                        {post.userId?.username && !post.isAnonymous && (
                          <p className="text-[11px] text-muted-foreground leading-tight">@{post.userId.username}</p>
                        )}
                      </div>
                    </button>
                    {contentType && contentType !== 'feed' && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary capitalize">{contentType}</span>
                    )}
                  </div>
                  <PostOptions
                    postId={post._id}
                    userId={user?.id}
                    postOwnerId={post.userId?._id || post.userId}
                    initialContent={post.content || ''}
                    initialMediaUrls={post.mediaUrls || (post.mediaUrl ? [post.mediaUrl] : [])}
                    onDelete={fetchPosts}
                    onEdit={fetchPosts}
                  />
                </div>

                {/* Media */}
                {post.mediaUrls && post.mediaUrls.length > 0 ? (
                  <div
                    onClick={() => !post.isAnonymous && openProfile(post.userId?._id, { selectedPost: post })}
                    className={cn(!post.isAnonymous && post.userId?._id ? 'cursor-pointer' : '')}
                  >
                    <ImageCarousel
                      images={post.mediaUrls}
                      onLike={() => handleDoubleTapLike(post._id)}
                      dataSaverEnabled={liteModeEnabled}
                    />
                  </div>
                ) : post.mediaUrl ? (
                  <div
                    onClick={() => !post.isAnonymous && openProfile(post.userId?._id, { selectedPost: post })}
                    className={cn(!post.isAnonymous && post.userId?._id ? 'cursor-pointer' : '')}
                  >
                    <ImageCarousel
                      images={[post.mediaUrl]}
                      onLike={() => handleDoubleTapLike(post._id)}
                      dataSaverEnabled={liteModeEnabled}
                    />
                  </div>
                ) : null}

                {/* Actions row */}
                <PostActions
                  postId={post._id}
                  userId={user?.id}
                  initialLikes={post.likesCount}
                  initialLiked={post.isLiked}
                  initialBookmarked={post.isBookmarked}
                  initialComments={post.commentsCount}
                  initialShares={post.sharesCount}
                  onComment={() => setCommentPostId(post._id)}
                />

                {/* Likes count */}
                {post.likesCount > 0 && (
                  <p className="px-4 pb-1 text-xs font-semibold">{post.likesCount.toLocaleString()} {post.likesCount === 1 ? 'like' : 'likes'}</p>
                )}

                {/* Caption */}
                <div className="px-4 pb-3">
                  {post.content ? (
                    <div className="text-sm leading-relaxed">
                      <span className="font-semibold mr-1.5">
                        {post.isAnonymous ? 'Ghost' : (post.userId?.username || post.userId?.name || 'User')}
                      </span>
                      <SocialText
                        text={post.content}
                        className="inline text-foreground whitespace-pre-wrap"
                        onHashtagClick={openHashtagSearch}
                        onMentionClick={(username) => {
                          const match = suggestedUsers.find((suggestion) => suggestion.username?.toLowerCase() === username.toLowerCase());
                          if (match?.id) {
                            openProfile(match.id);
                          } else {
                            setSearchInitialQuery(`@${username}`);
                            setShowSearch(true);
                          }
                        }}
                      />
                    </div>
                  ) : null}
                  {post.commentsCount > 0 && (
                    <button
                      onClick={() => setCommentPostId(post._id)}
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      View all {post.commentsCount} comment{post.commentsCount === 1 ? '' : 's'}
                    </button>
                  )}
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {new Date(post.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </p>
                </div>
              </article>
            );
            }) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                <p className="text-sm">No posts yet. Be the first to share something.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="space-y-0">
            <div className="border-b border-border bg-card px-4 py-4">
              <h2 className="text-lg font-bold">Messages</h2>
            </div>
            <div className="divide-y divide-border">
              {chats.length > 0 ? chats.map((chat) => (
                <button
                  key={chat.user.id}
                  type="button"
                  onClick={() => setActiveChat(chat.user)}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="w-12 h-12 rounded-full bg-muted shrink-0 flex items-center justify-center overflow-hidden font-bold text-foreground border border-border">
                    {chat.user.avatarUrl ? (
                      <img src={chat.user.avatarUrl} alt={chat.user.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <span className="text-sm font-bold text-primary">{chat.user.name?.[0] || 'U'}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{chat.user.name}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {chat.lastMessage.unreadCount > 0 && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                            {chat.lastMessage.unreadCount}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(chat.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <p className={cn('text-xs truncate mt-0.5', chat.lastMessage.unreadCount > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      {chat.lastMessage.isMine ? 'You: ' : ''}
                      {chat.lastMessage.text}
                    </p>
                  </div>
                </button>
              )) : (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
                  <p className="text-sm">No conversations yet.</p>
                  <p className="text-xs">Follow people and start chatting!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'inbox' && user && (
          <Suspense fallback={<LazyScreenFallback label="Loading inbox..." />}>
            <Inbox userId={user.id} onViewProfile={openProfile} />
          </Suspense>
        )}

        {/* Profile is now full-screen modal so it behaves like Instagram */}
        {profileModalUserId && user && (
          <div className="fixed inset-0 z-50 bg-background">
            <div className="h-full overflow-y-auto">
              <Suspense fallback={<LazyScreenFallback label="Loading profile..." />}>
                <InstagramProfile
                  userId={profileModalUserId}
                  currentUserId={user.id}
                  currentUser={user}
                  dataSaverEnabled={liteModeEnabled}
                  initialSelectedPost={profileSelectedPost}
                  onEditProfile={() => setShowEditProfile(true)}
                  onBack={closeProfileModal}
                  onClose={closeProfileModal}
                  onOpenSettings={() => {
                    closeProfileModal();
                    setActiveTab('settings');
                  }}
                  onMessageUser={startChatWithUser}
                  onViewProfile={openProfile}
                />
              </Suspense>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-0">
            {/* Settings header */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-border bg-card">
              <div className="w-16 h-16 rounded-full bg-muted border border-border flex items-center justify-center overflow-hidden shrink-0">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <span className="text-2xl font-bold text-primary">{user?.name?.[0] || 'U'}</span>
                )}
              </div>
              <div>
                <p className="font-bold text-base">{user?.name || 'User'}</p>
                <p className="text-sm text-muted-foreground">@{user?.username || 'username'}</p>
              </div>
            </div>

            {settingsNotice && (
              <div className={cn(
                'mx-4 my-3 rounded-lg px-4 py-3 text-sm border',
                settingsNotice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950/20 dark:border-red-800 dark:text-red-300'
              )}>
                {settingsNotice.message}
              </div>
            )}

            {user?.role === 'admin' && (
              <div>
                <p className="px-4 pt-5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Admin</p>
                <div className="divide-y divide-border border-t border-b border-border">
                  <button
                    type="button"
                    onClick={() => setShowAdminDashboard(true)}
                    className="flex w-full items-center gap-4 bg-card px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Shield size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold">Admin Dashboard</p>
                      <p className="text-xs text-muted-foreground">Manage users and posts</p>
                    </div>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                </div>
              </div>
            )}

            {/* Account Section */}
            <div>
              <p className="px-4 pt-5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Account</p>
              <div className="divide-y divide-border border-t border-b border-border">
                <button
                  type="button"
                  onClick={openOwnProfile}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <User size={18} className="text-muted-foreground" />
                  <span className="text-sm flex-1">View Profile</span>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditProfile(true)}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <UserCog size={18} className="text-muted-foreground" />
                  <span className="text-sm flex-1">Edit Profile</span>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Privacy & Security */}
            <div>
              <p className="px-4 pt-5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Privacy & Security</p>
              <div className="divide-y divide-border border-t border-b border-border">
                <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Eye size={18} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Anonymous Mode</p>
                      <p className="text-[10px] text-muted-foreground">Post as Ghost</p>
                    </div>
                  </div>
                  <button
                    onClick={toggleGhostMode}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      isAnonymous ? "bg-primary" : "bg-muted"
                    )}
                    disabled={ghostModeDisabled}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                      isAnonymous ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Lock size={18} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Lite Mode (240p)</p>
                      <p className="text-[10px] text-muted-foreground">Save data on campus Wi-Fi</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setLiteModeEnabled((prev) => {
                      const nextValue = !prev;
                      setSettingsNotice({ type: 'success', message: `Lite Mode ${nextValue ? 'enabled' : 'disabled'}.` });
                      return nextValue;
                    })}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      liteModeEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                      liteModeEnabled ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Sparkles size={18} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Theme</p>
                      <p className="text-[10px] text-muted-foreground">Light or dark mode</p>
                    </div>
                  </div>
                  <ThemeSwitch />
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div>
              <p className="px-4 pt-5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Notifications</p>
              <div className="divide-y divide-border border-t border-b border-border">
                <div className="flex items-center justify-between gap-3 bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Bell size={18} className="text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Telegram Notifications</p>
                      <p className="text-[10px] text-muted-foreground">Receive notifications via Telegram bot</p>
                    </div>
                  </div>
                  <button
                    onClick={handleTelegramNotificationsToggle}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      telegramNotificationsEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                      telegramNotificationsEnabled ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>
                {!user?.telegramChatId && (
                  <div className="p-4 space-y-3 bg-muted/40">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Connect Telegram to receive alerts</p>
                        <p className="text-xs text-muted-foreground">
                          Open {botHandle} on Telegram and send this code to link your account.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => refreshTelegramAuthCode(true)}
                        disabled={refreshingTelegramCode}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-60"
                      >
                        <RefreshCw size={14} className={refreshingTelegramCode ? 'animate-spin' : ''} />
                        {refreshingTelegramCode ? 'Generating' : 'New code'}
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-center font-mono text-lg px-4 py-3 rounded-xl border border-dashed border-border bg-background text-primary tracking-widest">
                        {telegramAuthCode || '------'}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyTelegramCode}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-xs"
                      >
                        <Copy size={14} />
                        {copiedTelegramCode ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={telegramAuthCode ? getTelegramDeepLink(telegramAuthCode, import.meta.env.VITE_TELEGRAM_BOT_USERNAME) : botUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-colors"
                      >
                        Open bot &amp; verify
                        <ExternalLink size={14} />
                      </a>
                      <button
                        type="button"
                        onClick={verifyTelegramLink}
                        disabled={verifyingTelegram}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors text-xs disabled:opacity-60"
                      >
                        {verifyingTelegram ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" />
                            Checking...
                          </>
                        ) : "I've sent the code"}
                      </button>
                    </div>
                    {telegramStatus && (
                      <div className="text-xs text-muted-foreground">{telegramStatus}</div>
                    )}
                  </div>
                )}
                <div className="divide-y divide-border">
                  {notificationSettingLabels.map((setting) => (
                    <div
                      key={setting.key}
                      className="flex items-center justify-between gap-4 bg-card px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{setting.title}</p>
                        <p className="text-xs text-muted-foreground">{setting.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleNotificationSettingToggle(setting.key)}
                        className={cn(
                          'w-12 h-6 rounded-full relative transition-all shrink-0',
                          notificationSettings[setting.key] ? 'bg-primary' : 'bg-muted'
                        )}
                      >
                        <div
                          className={cn(
                            'absolute top-1 w-4 h-4 bg-white rounded-full transition-all',
                            notificationSettings[setting.key] ? 'right-1' : 'left-1'
                          )}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Help & Support */}
            <div>
              <p className="px-4 pt-5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Help & Support</p>
              <div className="divide-y divide-border border-t border-b border-border">
                <button
                  type="button"
                  onClick={() => openSupportLink('bug')}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <Flag size={18} className="text-muted-foreground" />
                  <span className="text-sm flex-1">Report a Bug</span>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => openSupportLink('feature')}
                  className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <HelpCircle size={18} className="text-muted-foreground" />
                  <span className="text-sm flex-1">Suggest a Feature</span>
                  <ChevronRight size={16} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Logout */}
            <div className="px-4 py-6">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-3 border border-red-200 dark:border-red-900 text-red-500 font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <LogOut size={18} />
                Log Out
              </button>

              <p className="text-center text-[10px] text-muted-foreground mt-4">
                Contact admin: <a href={supportContactUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">@dev_envologia</a>
              </p>
            </div>
          </div>
        )}
      </main>

      {commentPostId && user && (
        <Suspense fallback={<LazyScreenFallback label="Loading comments..." />}>
          <CommentsPanel
            postId={commentPostId}
            userId={user.id}
            onClose={() => setCommentPostId(null)}
            onViewProfile={openProfile}
          />
        </Suspense>
      )}

      {showEditProfile && user && (
        <Suspense fallback={<LazyScreenFallback label="Loading editor..." />}>
          <EditProfileModal
            user={user}
            isOpen={showEditProfile}
            onClose={() => setShowEditProfile(false)}
            onSave={handleProfileUpdate}
          />
        </Suspense>
      )}

      {showSearch && (
        <Suspense fallback={<LazyScreenFallback label="Loading search..." />}>
          <SearchPanel
            currentUserId={user?.id}
            initialQuery={searchInitialQuery}
            onClose={() => {
              setShowSearch(false);
              setSearchInitialQuery('');
            }}
            onViewProfile={openProfile}
            onStartChat={startChatWithUser}
            onOpenPost={openPostFromSearch}
          />
        </Suspense>
      )}

      {activeStoryUserId && user && viewableStoryGroups.length > 0 && (
        <Suspense fallback={<LazyScreenFallback label="Loading story..." />}>
          <StoryViewer
            groups={viewableStoryGroups}
            currentUserId={user.id}
            initialGroupUserId={activeStoryUserId}
            onClose={() => {
              setActiveStoryUserId(null);
              fetchStories();
            }}
            onStoriesMutated={fetchStories}
          />
        </Suspense>
      )}

      {showStoryUpload && user && (
        <Suspense fallback={<LazyScreenFallback label="Loading story upload..." />}>
          <StoryUpload
            userId={user.id}
            onClose={() => setShowStoryUpload(false)}
            onUploadSuccess={() => {
              fetchStories();
            }}
          />
        </Suspense>
      )}

      {showCreateMenu && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setShowCreateMenu(false)}>
          <div
            className="w-full rounded-t-2xl border-t border-border bg-card pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-4 pb-4 pt-2">
              <p className="text-base font-bold">Create</p>
              <button
                type="button"
                onClick={() => setShowCreateMenu(false)}
                className="rounded-full p-2 hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="divide-y divide-border border-t border-border">
              <button
                type="button"
                onClick={startCreatePost}
                className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Plus size={20} className="text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Post</p>
                  <p className="text-xs text-muted-foreground">Share a photo or text post</p>
                </div>
              </button>
              <button
                type="button"
                onClick={startCreateStory}
                className="flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-muted/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full story-ring flex items-center justify-center">
                  <Plus size={20} className="text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Story</p>
                  <p className="text-xs text-muted-foreground">Share to your story</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

        {/* Bottom Nav */}
        <Dock
          items={[
            { icon: Home, label: 'Home', onClick: () => (activeTab === 'home' ? (fetchPosts(), fetchStories()) : setActiveTab('home')) },
            { icon: Search, label: 'Search', onClick: () => setShowSearch(true) },
            { icon: Plus, label: 'Create', onClick: openCreateMenu },
            { icon: MessageSquare, label: 'Chat', onClick: () => (activeTab === 'chat' ? fetchChats() : setActiveTab('chat')) },
            { icon: User, label: 'Profile', onClick: openOwnProfile },
          ]}
          activeLabel={dockActiveLabel}
          className="fixed bottom-0 left-0 right-0 z-40"
        />
      </div>
    );
}
