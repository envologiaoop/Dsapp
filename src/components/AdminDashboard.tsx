import { useState, useEffect } from 'react';
import { FriendlyCard } from './FriendlyCard';
import { Users, FileText, Shield, Search, X, Trash2, Ban, CheckCircle, ArrowLeft, Megaphone, BadgeCheck, Wrench, Clock, XCircle } from 'lucide-react';
import { AdManagement } from './AdManagement';
import { withAuthHeaders } from '../utils/clientAuth';

interface AdminStats {
  stats: {
    users: { total: number; banned: number; active: number };
    posts: { total: number; deleted: number; active: number };
  };
  recent: {
    users: any[];
    posts: any[];
  };
}

interface User {
  _id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  isBanned: boolean;
  bannedAt?: string;
  banReason?: string;
  badgeType?: 'none' | 'blue' | 'gold';
  isVerified?: boolean;
  createdAt: string;
}

interface Post {
  _id: string;
  content: string;
  title?: string;
  userId: { name: string; username: string };
  isDeleted: boolean;
  createdAt: string;
  mediaUrls?: string[];
  likesCount?: number;
  contentType?: 'feed' | 'group' | 'event' | 'academic' | 'announcement';
  groupId?: string;
  place?: string;
  eventTime?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
}

interface VerificationRequest {
  _id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl?: string;
  verificationStatus: string;
  verificationRealName: string;
  verificationPhotoUrl: string;
  verificationNote?: string;
  verificationRequestedAt: string;
  badgeType?: string;
}

interface Props {
  userId: string;
  onClose: () => void;
}

export function AdminDashboard({ userId, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'posts' | 'ads' | 'verification' | 'maintenance'>('stats');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [banReason, setBanReason] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Verification
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>([]);
  const [verifPage, setVerifPage] = useState(1);
  const [verifTotalPages, setVerifTotalPages] = useState(1);
  const [verifFilter, setVerifFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [selectedVerifUser, setSelectedVerifUser] = useState<VerificationRequest | null>(null);
  const [badgeToGrant, setBadgeToGrant] = useState<'blue' | 'gold'>('blue');

  // Badge management (in users tab)
  const [badgeUser, setBadgeUser] = useState<User | null>(null);
  const [badgeType, setBadgeTypeState] = useState<'none' | 'blue' | 'gold'>('none');

  // Maintenance
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('We are performing scheduled maintenance. We will be back shortly!');
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceSaved, setMaintenanceSaved] = useState(false);
  const [userFilter, setUserFilter] = useState<'all' | 'admin' | 'active' | 'banned'>('all');
  const [postStatusFilter, setPostStatusFilter] = useState<'all' | 'pending' | 'rejected' | 'active' | 'deleted'>('all');
  const [postTypeFilter, setPostTypeFilter] = useState<'all' | 'feed' | 'group' | 'event' | 'academic' | 'announcement'>('all');

  useEffect(() => {
    if (activeTab === 'stats') {
      fetchStats();
    } else if (activeTab === 'users') {
      fetchUsers();
    } else if (activeTab === 'posts') {
      fetchPosts();
    } else if (activeTab === 'verification') {
      fetchVerificationRequests();
    } else if (activeTab === 'maintenance') {
      fetchMaintenanceSettings();
    }
  }, [activeTab, page, searchQuery, verifPage, verifFilter]);

  const fetchStats = async () => {
    try {
      const response = await fetch(`/api/admin/stats?userId=${userId}`, { headers: withAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      } else if (response.status === 403) {
        alert('You do not have admin access');
        onClose();
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users?userId=${userId}&page=${page}&search=${searchQuery}`, { headers: withAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/posts?userId=${userId}&page=${page}`, { headers: withAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setPosts(data.posts);
        setTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (targetUserId: string) => {
    if (!banReason.trim()) {
      alert('Please provide a ban reason');
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/ban`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, reason: banReason }),
      });

      if (response.ok) {
        setSelectedUser(null);
        setBanReason('');
        fetchUsers();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to ban user');
      }
    } catch (error) {
      console.error('Failed to ban user:', error);
      alert('Failed to ban user');
    }
  };

  const handleUnbanUser = async (targetUserId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/unban`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        fetchUsers();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to unban user');
      }
    } catch (error) {
      console.error('Failed to unban user:', error);
      alert('Failed to unban user');
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('Are you sure you want to delete this post?')) return;

    try {
      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'DELETE',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        fetchPosts();
      } else {
        alert('Failed to delete post');
      }
    } catch (error) {
      console.error('Failed to delete post:', error);
      alert('Failed to delete post');
    }
  };

  const handleModeratePost = async (postId: string, approvalStatus: 'approved' | 'rejected') => {
    try {
      const response = await fetch(`/api/admin/posts/${postId}/approval`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, approvalStatus }),
      });

      if (response.ok) {
        fetchPosts();
      } else {
        alert(`Failed to ${approvalStatus === 'approved' ? 'approve' : 'reject'} request`);
      }
    } catch (error) {
      console.error('Failed to moderate post:', error);
      alert('Failed to moderate post');
    }
  };

  const fetchVerificationRequests = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/verification-requests?userId=${userId}&page=${verifPage}&status=${verifFilter}`, { headers: withAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setVerificationRequests(data.requests);
        setVerifTotalPages(data.pagination.pages);
      }
    } catch (error) {
      console.error('Failed to fetch verification requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGrantBadge = async (targetUserId: string, badge: 'none' | 'blue' | 'gold', approve?: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/badge`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, badgeType: badge, approve }),
      });
      if (response.ok) {
        fetchUsers();
        fetchVerificationRequests();
        setSelectedVerifUser(null);
        setBadgeUser(null);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update badge');
      }
    } catch (error) {
      console.error('Failed to update badge:', error);
      alert('Failed to update badge');
    }
  };

  const handleRejectVerification = async (targetUserId: string) => {
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/badge`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, badgeType: 'none', approve: false }),
      });
      if (response.ok) {
        fetchVerificationRequests();
        setSelectedVerifUser(null);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to reject verification');
      }
    } catch (error) {
      console.error('Failed to reject verification:', error);
      alert('Failed to reject verification');
    }
  };

  const fetchMaintenanceSettings = async () => {
    try {
      const response = await fetch(`/api/admin/maintenance?userId=${userId}`, { headers: withAuthHeaders() });
      if (response.ok) {
        const data = await response.json();
        setMaintenanceMode(data.maintenanceMode);
        setMaintenanceMessage(data.maintenanceMessage || '');
      }
    } catch (error) {
      console.error('Failed to fetch maintenance settings:', error);
    }
  };

  const handleSaveMaintenanceSettings = async () => {
    setMaintenanceSaving(true);
    setMaintenanceSaved(false);
    try {
      const response = await fetch(`/api/admin/maintenance`, {
        method: 'POST',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, maintenanceMode, maintenanceMessage }),
      });
      if (response.ok) {
        setMaintenanceSaved(true);
        setTimeout(() => setMaintenanceSaved(false), 3000);
      } else {
        alert('Failed to save maintenance settings');
      }
    } catch (error) {
      console.error('Failed to save maintenance settings:', error);
      alert('Failed to save maintenance settings');
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    if (userFilter === 'admin') return user.role === 'admin';
    if (userFilter === 'banned') return user.isBanned;
    if (userFilter === 'active') return !user.isBanned;
    return true;
  });

  const filteredPosts = posts.filter((post) => {
    if (postStatusFilter === 'pending' && post.approvalStatus !== 'pending') return false;
    if (postStatusFilter === 'rejected' && post.approvalStatus !== 'rejected') return false;
    if (postStatusFilter === 'deleted' && !post.isDeleted) return false;
    if (
      postStatusFilter === 'active' &&
      (post.isDeleted || post.approvalStatus === 'pending' || post.approvalStatus === 'rejected')
    ) {
      return false;
    }
    if (postTypeFilter !== 'all' && post.contentType !== postTypeFilter) return false;
    return true;
  });

  const pendingApprovals = posts.filter((p) => p.approvalStatus === 'pending').length;
  const pendingVerifications = verificationRequests.filter((req) => req.verificationStatus === 'pending').length;
  const bannedUsers = users.filter((u) => u.isBanned).length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/92 backdrop-blur-2xl">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-white/30 bg-background/70 px-6 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between rounded-[28px] border border-white/25 bg-background/60 px-4 py-3 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.65)]">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="rounded-2xl border border-white/35 bg-background/75 p-2 transition-colors hover:bg-muted">
              <ArrowLeft size={20} />
            </button>
            <Shield size={24} className="text-primary" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Control Center</p>
              <h1 className="text-2xl font-bold tracking-[-0.03em]">Admin Dashboard</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-[97px] z-10 border-b border-white/20 bg-background/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-6 py-2">
          {[
            { id: 'stats', label: 'Overview', icon: Shield },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'posts', label: 'Posts', icon: FileText },
            { id: 'ads', label: 'Ads', icon: Megaphone },
            { id: 'verification', label: 'Verification', icon: BadgeCheck },
            { id: 'maintenance', label: 'Maintenance', icon: Wrench },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                setPage(1);
              }}
              className={`flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-3 transition-all ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground shadow-[0_16px_35px_-22px_rgba(15,23,42,0.9)]'
                  : 'border border-white/30 bg-background/70 text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,0.95fr)]">
          <div className="space-y-6">
            {activeTab === 'stats' && stats && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FriendlyCard className="border-white/35 bg-background/80 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="rounded-2xl bg-blue-500/20 p-3">
                        <Users size={24} className="text-blue-500" />
                      </div>
                      <h3 className="text-lg font-bold">Users</h3>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Total</span>
                        <span className="font-bold">{stats.stats.users.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Active</span>
                        <span className="font-bold text-green-500">{stats.stats.users.active}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Banned</span>
                        <span className="font-bold text-red-500">{stats.stats.users.banned}</span>
                      </div>
                    </div>
                  </FriendlyCard>

                  <FriendlyCard className="border-white/35 bg-background/80 p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="rounded-2xl bg-purple-500/20 p-3">
                        <FileText size={24} className="text-purple-500" />
                      </div>
                      <h3 className="text-lg font-bold">Posts</h3>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Total</span>
                        <span className="font-bold">{stats.stats.posts.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Active</span>
                        <span className="font-bold text-green-500">{stats.stats.posts.active}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Deleted</span>
                        <span className="font-bold text-red-500">{stats.stats.posts.deleted}</span>
                      </div>
                    </div>
                  </FriendlyCard>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FriendlyCard className="border-white/35 bg-background/80 p-6">
                    <h3 className="mb-4 text-lg font-bold">Recent Users</h3>
                    <div className="space-y-3">
                      {stats.recent.users.map((user: any) => (
                        <div key={user._id} className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{user.name}</p>
                            <p className="text-xs text-muted-foreground">@{user.username}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </FriendlyCard>

                  <FriendlyCard className="border-white/35 bg-background/80 p-6">
                    <h3 className="text-lg font-bold mb-4">Recent Posts</h3>
                    <div className="space-y-3">
                      {stats.recent.posts.map((post: any) => (
                        <div key={post._id} className="space-y-1">
                          <p className="text-sm font-medium">{post.userId?.name || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">{post.content}</p>
                        </div>
                      ))}
                    </div>
                  </FriendlyCard>
                </div>
              </div>
            )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1">
                <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search users by name, username, or email..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-2xl border border-white/35 bg-background/80 py-3 pl-10 pr-4 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex items-center gap-2">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'active', label: 'Active' },
                  { id: 'banned', label: 'Banned' },
                  { id: 'admin', label: 'Admins' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setUserFilter(opt.id as any)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      userFilter === opt.id ? 'bg-primary text-primary-foreground shadow-[0_12px_28px_-20px_rgba(15,23,42,0.9)]' : 'border border-white/30 bg-background/70 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {filteredUsers.length} of {users.length} users
            </p>

            {loading ? (
              <div className="text-center py-20 text-muted-foreground">Loading...</div>
            ) : (
              <div className="space-y-3">
                {filteredUsers.map((user) => (
                  <FriendlyCard key={user._id} className="border-white/35 bg-background/80 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold">{user.name}</p>
                          {user.role === 'admin' && (
                            <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full font-medium">
                              Admin
                            </span>
                          )}
                          {user.isBanned && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-500 text-xs rounded-full font-medium">
                              Banned
                            </span>
                          )}
                          {user.badgeType === 'gold' && (
                            <span className="px-2 py-0.5 bg-yellow-400/20 text-yellow-600 text-xs rounded-full font-medium flex items-center gap-1">
                              <BadgeCheck size={12} fill="currentColor" /> Gold
                            </span>
                          )}
                          {user.badgeType === 'blue' && (
                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-500 text-xs rounded-full font-medium flex items-center gap-1">
                              <BadgeCheck size={12} fill="currentColor" /> Blue
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">@{user.username}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                        {user.isBanned && user.banReason && (
                          <p className="text-xs text-red-500 mt-1">Reason: {user.banReason}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                          onClick={() => { setBadgeUser(user); setBadgeTypeState(user.badgeType || 'none'); }}
                          className="flex items-center gap-1 rounded-xl bg-yellow-400/10 px-3 py-2 text-sm text-yellow-600 transition-colors hover:bg-yellow-400/20"
                        >
                          <BadgeCheck size={14} />
                          Badge
                        </button>
                        {user.role !== 'admin' && (
                          <>
                            {user.isBanned ? (
                              <button
                                onClick={() => handleUnbanUser(user._id)}
                                className="flex items-center gap-2 rounded-xl bg-green-500/20 px-4 py-2.5 text-green-500 transition-colors hover:bg-green-500/30"
                              >
                                <CheckCircle size={16} />
                                Unban
                              </button>
                            ) : (
                              <button
                                onClick={() => setSelectedUser(user)}
                                className="flex items-center gap-2 rounded-xl bg-red-500/20 px-4 py-2.5 text-red-500 transition-colors hover:bg-red-500/30"
                              >
                                <Ban size={16} />
                                Ban
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </FriendlyCard>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-4 py-2">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'posts' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2">
                <select
                  value={postStatusFilter}
                  onChange={(e) => setPostStatusFilter(e.target.value as any)}
                  className="rounded-xl border border-white/30 bg-background/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="active">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="deleted">Deleted</option>
                </select>
                <select
                  value={postTypeFilter}
                  onChange={(e) => setPostTypeFilter(e.target.value as any)}
                  className="rounded-xl border border-white/30 bg-background/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All types</option>
                  <option value="feed">Feed</option>
                  <option value="group">Group</option>
                  <option value="event">Event</option>
                  <option value="academic">Academic</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Showing {filteredPosts.length} of {posts.length} posts
              </p>
            </div>

            {loading ? (
              <div className="text-center py-20 text-muted-foreground">Loading...</div>
            ) : (
              <div className="space-y-3">
                {filteredPosts.map((post) => (
                  <FriendlyCard key={post._id} className="border-white/35 bg-background/80 p-4">
                    <div className="flex justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="font-bold">{post.userId?.name || 'Unknown'}</p>
                          <span className="text-xs text-muted-foreground">@{post.userId?.username}</span>
                          {post.contentType && post.contentType !== 'feed' && (
                            <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full font-medium capitalize">
                              {post.contentType}
                            </span>
                          )}
                          {post.approvalStatus && post.approvalStatus !== 'approved' && (
                            <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                              post.approvalStatus === 'pending'
                                ? 'bg-amber-500/20 text-amber-600'
                                : 'bg-red-500/20 text-red-500'
                            }`}>
                              {post.approvalStatus}
                            </span>
                          )}
                          {post.isDeleted && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-500 text-xs rounded-full font-medium">
                              Deleted
                            </span>
                          )}
                        </div>
                        {post.title && (
                          <p className="text-sm font-semibold text-foreground mb-1">{post.title}</p>
                        )}
                        <p className="text-sm text-foreground mb-2">{post.content}</p>
                        {(post.place || post.eventTime || post.groupId) && (
                          <div className="flex flex-wrap gap-3 mb-2 text-xs text-muted-foreground">
                            {post.groupId && <span>Group: {post.groupId}</span>}
                            {post.place && <span>Place: {post.place}</span>}
                            {post.eventTime && <span>Time: {new Date(post.eventTime).toLocaleString()}</span>}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(post.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {post.approvalStatus === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleModeratePost(post._id, 'approved')}
                              className="h-fit rounded-xl bg-green-500/20 px-3 py-2.5 text-sm font-medium text-green-600 transition-colors hover:bg-green-500/30"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleModeratePost(post._id, 'rejected')}
                              className="h-fit rounded-xl bg-amber-500/20 px-3 py-2.5 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-500/30"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {!post.isDeleted && (
                          <button
                            onClick={() => handleDeletePost(post._id)}
                            className="h-fit rounded-xl bg-red-500/20 p-2.5 text-red-500 transition-colors hover:bg-red-500/30"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </FriendlyCard>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-4 py-2">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Ads Tab */}
        {activeTab === 'ads' && (
          <AdManagement userId={userId} />
        )}

        {/* Verification Requests Tab */}
        {activeTab === 'verification' && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-bold">Verification Requests</h2>
              <div className="flex gap-2">
                {(['pending', 'approved', 'rejected'] as const).map(status => (
                  <button
                    key={status}
                    onClick={() => { setVerifFilter(status); setVerifPage(1); }}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${verifFilter === status ? 'bg-primary text-primary-foreground shadow-[0_12px_30px_-20px_rgba(15,23,42,0.9)]' : 'border border-white/30 bg-background/72 text-muted-foreground hover:bg-muted/80'}`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="text-center py-20 text-muted-foreground">Loading...</div>
            ) : verificationRequests.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">No {verifFilter} verification requests.</div>
            ) : (
              <div className="space-y-4">
                {verificationRequests.map(req => (
                  <FriendlyCard key={req._id} className="border-white/35 bg-background/80 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        {req.avatarUrl ? (
                          <img src={req.avatarUrl} alt={req.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center font-bold text-lg shrink-0">
                            {req.name?.[0] || 'U'}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold">{req.name}</p>
                            <p className="text-sm text-muted-foreground">@{req.username}</p>
                            {req.verificationStatus === 'pending' && <span className="flex items-center gap-1 text-xs text-orange-500"><Clock size={12} /> Pending</span>}
                            {req.verificationStatus === 'approved' && <span className="flex items-center gap-1 text-xs text-green-500"><CheckCircle size={12} /> Approved</span>}
                            {req.verificationStatus === 'rejected' && <span className="flex items-center gap-1 text-xs text-red-500"><XCircle size={12} /> Rejected</span>}
                            {req.badgeType === 'blue' && <span className="flex items-center gap-1 text-xs text-blue-500"><BadgeCheck size={12} fill="currentColor" /> Blue</span>}
                            {req.badgeType === 'gold' && <span className="flex items-center gap-1 text-xs text-yellow-500"><BadgeCheck size={12} fill="currentColor" /> Gold</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{req.email}</p>
                          <p className="text-sm mt-1"><span className="font-medium">Real name:</span> {req.verificationRealName}</p>
                          {req.verificationNote && (
                            <p className="text-sm text-muted-foreground mt-0.5">{req.verificationNote}</p>
                          )}
                          {req.verificationPhotoUrl && (
                            <a href={req.verificationPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-1 block">View submitted photo</a>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">Requested: {new Date(req.verificationRequestedAt).toLocaleString()}</p>
                        </div>
                      </div>
                      {req.verificationStatus === 'pending' && (
                        <button
                          onClick={() => { setSelectedVerifUser(req); setBadgeToGrant('blue'); }}
                          className="shrink-0 rounded-xl bg-primary/10 px-4 py-2.5 text-sm text-primary transition-colors hover:bg-primary/20"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  </FriendlyCard>
                ))}
              </div>
            )}

            {verifTotalPages > 1 && (
              <div className="flex justify-center gap-2">
                <button onClick={() => setVerifPage(p => Math.max(1, p - 1))} disabled={verifPage === 1} className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50">Previous</button>
                <span className="px-4 py-2">Page {verifPage} of {verifTotalPages}</span>
                <button onClick={() => setVerifPage(p => Math.min(verifTotalPages, p + 1))} disabled={verifPage === verifTotalPages} className="rounded-xl bg-muted px-4 py-2.5 disabled:opacity-50">Next</button>
              </div>
            )}
          </div>
        )}

        {/* Maintenance Mode Tab */}
        {activeTab === 'maintenance' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h2 className="text-xl font-bold mb-1">Maintenance Mode</h2>
              <p className="text-sm text-muted-foreground">When enabled, non-admin users see a maintenance screen instead of the app.</p>
            </div>

            <FriendlyCard className="space-y-5 border-white/35 bg-background/80 p-6">
              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">Maintenance Mode</p>
                  <p className="text-sm text-muted-foreground">Toggle to take the app down for maintenance</p>
                </div>
                <button
                  onClick={() => setMaintenanceMode(prev => !prev)}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${maintenanceMode ? 'bg-red-500' : 'bg-muted'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${maintenanceMode ? 'translate-x-8' : 'translate-x-1'}`}
                  />
                </button>
              </div>

              {maintenanceMode && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3">
                  <Wrench size={16} className="text-red-500 shrink-0" />
                  <p className="text-sm text-red-500 font-medium">Maintenance mode is <strong>ACTIVE</strong>. Non-admin users are blocked from the app.</p>
                </div>
              )}

              {/* Message */}
              <div>
                <label className="block text-sm font-semibold mb-2">Maintenance Message</label>
                <textarea
                  value={maintenanceMessage}
                  onChange={e => setMaintenanceMessage(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-white/35 bg-background/80 px-4 py-3 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                  placeholder="Enter the message to display to users during maintenance..."
                />
              </div>

              <button
                onClick={handleSaveMaintenanceSettings}
                disabled={maintenanceSaving}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-[0_18px_35px_-24px_rgba(15,23,42,0.9)] transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                {maintenanceSaving ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />Saving...</>
                ) : maintenanceSaved ? (
                  <><CheckCircle size={16} />Settings Saved!</>
                ) : (
                  'Save Settings'
                )}
              </button>
            </FriendlyCard>
          </div>
        )}

          </div>
          <aside className="space-y-4">
            <FriendlyCard className="border-white/35 bg-background/80 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">Snapshot</p>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">Live</span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total users</span>
                  <span className="font-semibold">{stats?.stats.users.total ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active users</span>
                  <span className="font-semibold text-green-500">{stats?.stats.users.active ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Banned</span>
                  <span className="font-semibold text-red-500">{stats?.stats.users.banned ?? bannedUsers}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Posts live</span>
                  <span className="font-semibold text-primary">{stats?.stats.posts.active ?? posts.length}</span>
                </div>
              </div>
            </FriendlyCard>

            <FriendlyCard className="border-white/35 bg-background/80 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">Moderation Queues</p>
                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600">Monitor</span>
              </div>
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Post approvals</span>
                  <span className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-amber-600">
                    {pendingApprovals} pending
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Verification</span>
                  <span className="flex items-center gap-2 rounded-full bg-blue-500/10 px-3 py-1 text-blue-600">
                    {pendingVerifications} in review
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Maintenance</span>
                  <span className={`flex items-center gap-2 rounded-full px-3 py-1 ${maintenanceMode ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>
                    {maintenanceMode ? 'Active' : 'Normal'}
                  </span>
                </div>
              </div>
            </FriendlyCard>

            <FriendlyCard className="border-white/35 bg-background/80 p-5">
              <p className="text-sm font-semibold text-muted-foreground">Shortcuts</p>
              <div className="mt-3 space-y-2">
                <button
                  onClick={() => setActiveTab('verification')}
                  className="w-full rounded-xl border border-white/25 bg-background/80 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  Open verification queue
                </button>
                <button
                  onClick={() => setActiveTab('posts')}
                  className="w-full rounded-xl border border-white/25 bg-background/80 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  Review content
                </button>
                <button
                  onClick={() => setActiveTab('maintenance')}
                  className="w-full rounded-xl border border-white/25 bg-background/80 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  Update maintenance notice
                </button>
              </div>
            </FriendlyCard>
          </aside>
        </div>
      </div>

      {/* Badge Grant Modal (in Users tab) */}
      {badgeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <FriendlyCard className="w-full max-w-md border-white/30 bg-background/88 p-6 shadow-[0_28px_80px_-34px_rgba(15,23,42,0.85)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Manage Badge</h3>
              <button onClick={() => setBadgeUser(null)} className="rounded-full p-1 transition-colors hover:bg-muted"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">User</p>
                <p className="font-medium">{badgeUser.name} (@{badgeUser.username})</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Badge Type</label>
                <div className="flex gap-2">
                  {(['none', 'blue', 'gold'] as const).map(b => (
                    <button
                      key={b}
                      onClick={() => setBadgeTypeState(b)}
                      className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${badgeType === b ? 'bg-primary text-primary-foreground border-primary' : 'border-white/35 bg-background/80 text-muted-foreground hover:bg-muted/80'}`}
                    >
                      {b === 'none' ? '✕ None' : b === 'blue' ? '🔵 Blue' : '🟡 Gold'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setBadgeUser(null)} className="flex-1 rounded-xl bg-muted px-4 py-2.5 transition-colors hover:bg-muted/80">Cancel</button>
                <button
                  onClick={() => handleGrantBadge(badgeUser._id, badgeType)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <BadgeCheck size={16} /> Apply Badge
                </button>
              </div>
            </div>
          </FriendlyCard>
        </div>
      )}

      {/* Verification Review Modal */}
      {selectedVerifUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <FriendlyCard className="w-full max-w-lg border-white/30 bg-background/88 p-6 shadow-[0_28px_80px_-34px_rgba(15,23,42,0.85)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Review Verification Request</h3>
              <button onClick={() => setSelectedVerifUser(null)} className="rounded-full p-1 transition-colors hover:bg-muted"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {selectedVerifUser.avatarUrl ? (
                  <img src={selectedVerifUser.avatarUrl} alt={selectedVerifUser.name} className="w-14 h-14 rounded-full object-cover" />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-[24px] bg-muted font-bold text-xl">{selectedVerifUser.name?.[0] || 'U'}</div>
                )}
                <div>
                  <p className="font-bold">{selectedVerifUser.name}</p>
                  <p className="text-sm text-muted-foreground">@{selectedVerifUser.username}</p>
                  <p className="text-xs text-muted-foreground">{selectedVerifUser.email}</p>
                </div>
              </div>
              <div className="space-y-2 rounded-2xl border border-white/35 bg-background/76 p-4">
                <p className="text-sm"><span className="font-semibold">Real Name:</span> {selectedVerifUser.verificationRealName}</p>
                {selectedVerifUser.verificationNote && <p className="text-sm"><span className="font-semibold">Note:</span> {selectedVerifUser.verificationNote}</p>}
                {selectedVerifUser.verificationPhotoUrl && (
                  <div>
                    <p className="text-sm font-semibold mb-1">Submitted Photo:</p>
                    <img
                      src={selectedVerifUser.verificationPhotoUrl}
                      alt="Verification photo"
                      className="w-full max-h-48 rounded-2xl border border-white/35 object-cover"
                      onError={e => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = 'none';
                        const fallback = img.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                    <div style={{ display: 'none' }} className="h-20 w-full items-center justify-center rounded-2xl border border-white/35 bg-muted text-sm text-muted-foreground">
                      ⚠️ Photo could not be loaded — please open the link below
                    </div>
                    <a href={selectedVerifUser.verificationPhotoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline mt-1 block">Open in new tab</a>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Badge to Grant</label>
                <div className="flex gap-2">
                  <button onClick={() => setBadgeToGrant('blue')} className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${badgeToGrant === 'blue' ? 'border-blue-500 bg-blue-500 text-white' : 'border-white/35 bg-background/80 hover:bg-muted/80'}`}>
                    🔵 Blue Badge
                  </button>
                  <button onClick={() => setBadgeToGrant('gold')} className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${badgeToGrant === 'gold' ? 'border-yellow-400 bg-yellow-400 text-yellow-950' : 'border-white/35 bg-background/80 hover:bg-muted/80'}`}>
                    🟡 Gold Badge
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Blue = personal verified account · Gold = academic/organization/notable</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRejectVerification(selectedVerifUser._id)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/20 px-4 py-2.5 text-red-500 transition-colors hover:bg-red-500/30"
                >
                  <XCircle size={16} /> Reject
                </button>
                <button
                  onClick={() => handleGrantBadge(selectedVerifUser._id, badgeToGrant, true)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-white transition-colors hover:bg-green-600"
                >
                  <BadgeCheck size={16} /> Approve & Grant Badge
                </button>
              </div>
            </div>
          </FriendlyCard>
        </div>
      )}

      {/* Ban User Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <FriendlyCard className="w-full max-w-md border-white/30 bg-background/88 p-6 shadow-[0_28px_80px_-34px_rgba(15,23,42,0.85)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Ban User</h3>
              <button onClick={() => setSelectedUser(null)} className="rounded-full p-1 transition-colors hover:bg-muted">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">User</p>
                <p className="font-medium">{selectedUser.name} (@{selectedUser.username})</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Ban Reason</label>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Enter reason for banning this user..."
                  className="w-full resize-none rounded-2xl border border-white/35 bg-background/80 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="flex-1 rounded-xl bg-muted px-4 py-2.5 transition-colors hover:bg-muted/80"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleBanUser(selectedUser._id)}
                  className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-white transition-colors hover:bg-red-600"
                >
                  Ban User
                </button>
              </div>
            </div>
          </FriendlyCard>
        </div>
      )}
    </div>
  );
}
