import {
  AtSign,
  Briefcase,
  Copy,
  Flame,
  Instagram,
  Linkedin,
  LoaderCircle,
  Music2,
  PenLine,
  Smile,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  platformName,
  PLATFORMS,
  postText,
  TONES,
  type Platform,
  type Post,
  type Tone,
} from '../post';

const PLATFORM_ICONS: Record<Platform, LucideIcon> = {
  tiktok: Music2,
  instagram: Instagram,
  youtube: Youtube,
  x: AtSign,
  linkedin: Linkedin,
};
const TONE_ICONS: Record<Tone, LucideIcon> = {
  friendly: Smile,
  professional: Briefcase,
  bold: Flame,
};

/** Post copy for the clip: choose platforms and a tone, have the model write each post, and copy them. */
export function PostFields({
  posts,
  writing,
  available,
  write,
  notice,
}: {
  posts: readonly Post[];
  writing: boolean;
  /** Why posts can't be written here, if they can't. */
  available: string | null;
  write: (platforms: Platform[], tone: Tone) => void;
  notice: (text: string) => void;
}) {
  const [platforms, setPlatforms] = useState<Platform[]>(['tiktok', 'instagram', 'youtube']);
  const [tone, setTone] = useState<Tone>('friendly');
  async function copy(post: Post) {
    try {
      await navigator.clipboard.writeText(
        post.title ? `${post.title}\n\n${postText(post)}` : postText(post),
      );
      notice(`${platformName(post.platform)} post copied`);
    } catch {
      notice('Copying is unavailable here. Select the text instead.');
    }
  }
  return (
    <div className="post-fields">
      <div className="format-options post-platforms" role="group" aria-label="Platforms">
        {PLATFORMS.map(([value, label]) => {
          const Icon = PLATFORM_ICONS[value];
          const on = platforms.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={on ? 'active' : ''}
              aria-pressed={on}
              onClick={() =>
                setPlatforms((list) =>
                  on ? list.filter((item) => item !== value) : [...list, value],
                )
              }
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <div className="format-options post-tones" role="group" aria-label="Tone">
        {TONES.map(([value, label]) => {
          const Icon = TONE_ICONS[value];
          return (
            <button
              key={value}
              type="button"
              className={tone === value ? 'active' : ''}
              aria-pressed={tone === value}
              onClick={() => setTone(value)}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      {available && <p className="fit-note">{available}</p>}
      <button
        type="button"
        className="btn secondary asset-button"
        disabled={writing || !!available || !platforms.length}
        onClick={() => write(platforms, tone)}
      >
        {writing ? (
          <LoaderCircle className="spin" size={13} aria-hidden="true" />
        ) : (
          <PenLine size={13} aria-hidden="true" />
        )}
        {writing ? 'Writing…' : posts.length ? 'Write again' : 'Write post copy'}
      </button>
      {posts.map((post) => {
        const Icon = PLATFORM_ICONS[post.platform];
        return (
          <article
            key={post.platform}
            className="post-card"
            aria-label={`${platformName(post.platform)} post`}
          >
            <header>
              <span>
                <Icon size={14} aria-hidden="true" /> {platformName(post.platform)}
              </span>
              <button
                type="button"
                className="text-btn"
                aria-label={`Copy the ${platformName(post.platform)} post`}
                onClick={() => void copy(post)}
              >
                <Copy size={13} aria-hidden="true" /> Copy
              </button>
            </header>
            {post.title && <strong>{post.title}</strong>}
            <p>{post.caption}</p>
            {post.hashtags.length > 0 && (
              <p className="post-tags">{post.hashtags.map((tag) => `#${tag}`).join(' ')}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
