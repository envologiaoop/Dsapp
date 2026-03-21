type IdLike = string | { toString(): string };

type CandidateUser = {
  id: string;
  name: string;
  username: string;
  avatarUrl?: string;
  isVerified?: boolean;
  badgeType?: 'none' | 'blue' | 'gold' | string;
  followerIds: IdLike[];
};

type PreviewUser = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
};

const normalizeIds = (ids: IdLike[]) => ids.map((id) => id.toString());

export function getMutualFriendIds(
  targetFollowerIds: IdLike[],
  currentConnectionIds: Set<string> | Iterable<string>,
  currentUserId?: string | null
) {
  const currentConnections =
    currentConnectionIds instanceof Set
      ? currentConnectionIds
      : new Set<string>(currentConnectionIds);
  return Array.from(
    new Set(
      normalizeIds(targetFollowerIds).filter((id) => id !== currentUserId && currentConnections.has(id))
    )
  );
}

export function buildUserSuggestions(
  currentUserId: string,
  followingIds: IdLike[],
  followerIds: IdLike[],
  candidates: CandidateUser[],
  previewUsers: PreviewUser[] = [],
  limit = 6
) {
  const excludedIds = new Set([currentUserId, ...normalizeIds(followingIds)]);
  const connectionIds = new Set([
    ...normalizeIds(followingIds),
    ...normalizeIds(followerIds),
  ]);

  const previewMap = new Map(previewUsers.map((preview) => [preview.id, preview]));

  return candidates
    .filter((candidate) => !excludedIds.has(candidate.id))
    .map((candidate) => {
      const mutualIds = getMutualFriendIds(candidate.followerIds, connectionIds, currentUserId);
      return {
        id: candidate.id,
        name: candidate.name,
        username: candidate.username,
        avatarUrl: candidate.avatarUrl || '',
        isVerified: candidate.isVerified || false,
        badgeType: candidate.badgeType || 'none',
        mutualCount: mutualIds.length,
        mutuals: mutualIds.slice(0, 3).map((id) => previewMap.get(id)).filter(Boolean),
      };
    })
    .sort((a, b) => b.mutualCount - a.mutualCount || a.username.localeCompare(b.username))
    .slice(0, limit);
}
