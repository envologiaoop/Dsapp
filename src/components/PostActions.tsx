import { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark } from 'lucide-react';
import { ShareModal } from './ShareModal';
import { withAuthHeaders } from '../utils/clientAuth';
import { cn } from '../lib/utils';

interface PostActionsProps {
  postId: string;
  userId: string;
  initialLikes?: number;
  initialLiked?: boolean;
  initialBookmarked?: boolean;
  initialComments?: number;
  initialShares?: number;
  onComment?: () => void;
}

export function PostActions({
  postId,
  userId,
  initialLikes = 0,
  initialLiked = false,
  initialBookmarked = false,
  initialComments = 0,
  initialShares = 0,
  onComment,
}: PostActionsProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [shares, setShares] = useState(initialShares);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const handleLike = async () => {
    const newLiked = !liked;
    setLiked(newLiked);
    setLikes((prev) => (newLiked ? prev + 1 : prev - 1));
    try {
      await fetch(`/api/posts/${postId}/like`, {
        method: newLiked ? 'POST' : 'DELETE',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId }),
      });
    } catch (err) {
      setLiked(!newLiked);
      setLikes((prev) => (newLiked ? prev - 1 : prev + 1));
    }
  };

  const handleBookmark = async () => {
    const newBookmarked = !bookmarked;
    setBookmarked(newBookmarked);
    try {
      await fetch(`/api/posts/${postId}/bookmark`, {
        method: newBookmarked ? 'POST' : 'DELETE',
        headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId }),
      });
    } catch (err) {
      setBookmarked(!newBookmarked);
    }
  };

  return (
    <div className="flex items-center gap-1 px-4 py-2">
      {/* Left actions */}
      <button
        onClick={handleLike}
        className="p-2 -ml-2 transition-transform active:scale-90"
        aria-label={liked ? 'Unlike' : 'Like'}
      >
        <Heart
          className={cn('w-6 h-6 transition-colors', liked ? 'fill-red-500 text-red-500' : 'text-foreground')}
        />
      </button>

      <button
        onClick={onComment}
        className="p-2 transition-transform active:scale-90"
        aria-label="Comment"
      >
        <MessageCircle className="w-6 h-6 text-foreground" />
      </button>

      <button
        onClick={() => setShareModalOpen(true)}
        className="p-2 transition-transform active:scale-90"
        aria-label="Share"
      >
        <Send className="w-6 h-6 text-foreground" />
      </button>

      {/* Bookmark pinned right */}
      <button
        onClick={handleBookmark}
        className="ml-auto p-2 -mr-2 transition-transform active:scale-90"
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        <Bookmark
          className={cn('w-6 h-6 transition-colors', bookmarked ? 'fill-foreground text-foreground' : 'text-foreground')}
        />
      </button>

      <ShareModal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        postId={postId}
        userId={userId}
        onShareComplete={() => setShares((prev) => prev + 1)}
      />
    </div>
  );
}
