/** Post copy (src-tauri post.rs): what goes with a clip on each platform. */
export const PLATFORMS = [
  ['tiktok', 'TikTok'],
  ['instagram', 'Reels'],
  ['youtube', 'Shorts'],
  ['x', 'X'],
  ['linkedin', 'LinkedIn'],
] as const;
export type Platform = (typeof PLATFORMS)[number][0];
export const TONES = [
  ['friendly', 'Friendly'],
  ['professional', 'Professional'],
  ['bold', 'Bold'],
] as const;
export type Tone = (typeof TONES)[number][0];
export type Post = { platform: Platform; title?: string; caption: string; hashtags: string[] };

export function platformName(platform: string) {
  return PLATFORMS.find(([value]) => value === platform)?.[1] ?? platform;
}

/** A post as pasted: the caption, then its hashtags. */
export function postText(post: Pick<Post, 'caption' | 'hashtags'>) {
  const tags = post.hashtags.map((tag) => `#${tag}`).join(' ');
  return tags ? `${post.caption}\n\n${tags}` : post.caption;
}

/** Saved posts that still read as posts. */
export function cutPosts(cut: { posts?: Post[] }): Post[] {
  return (cut.posts ?? []).filter(
    (post) =>
      post &&
      PLATFORMS.some(([value]) => value === post.platform) &&
      typeof post.caption === 'string' &&
      Array.isArray(post.hashtags),
  );
}
