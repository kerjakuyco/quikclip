import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Film, Plus, Trash2 } from 'lucide-react';
import { clock, frame, mediaOf, type Project, type Video } from '../studio';

/**
 * The project's videos (ClipCheap's media): which one the selected clip cuts from, switching to another, adding one, and
 * removing an added one. The first video is the project's own and stays.
 */
export function VideoMenu({
  p,
  current,
  choose,
  add,
  remove,
  full,
}: {
  p: Project;
  /** The id of the video on screen. */
  current: string;
  choose: (video: Video) => void;
  add: () => void;
  remove: (video: Video) => void;
  /** The project holds as many videos as it can. */
  full: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const videos = [{ ...p, id: p.id } as Video, ...(p.videos ?? [])];
  const index = Math.max(
    0,
    videos.findIndex((item) => item.id === current),
  );
  const shown = videos[index];
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        box.current?.querySelector<HTMLButtonElement>('.video-switch')?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const count = (id: string) => p.cuts.filter((cut) => mediaOf(p, cut).id === id).length;
  return (
    <div className="video-menu" ref={box}>
      <button
        type="button"
        className="video-switch"
        aria-expanded={open}
        aria-controls="project-videos"
        title="The project's videos"
        onClick={() => setOpen((on) => !on)}
      >
        <Film size={12} aria-hidden="true" />
        <span className="video-switch-name">{shown.title}</span>
        <small>
          {index + 1}/{videos.length}
        </small>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="video-panel" id="project-videos" role="group" aria-label="Project videos">
          <ul>
            {videos.map((item, at) => {
              const clips = count(item.id);
              const thumb = frame(mediaOf(p, at ? { video: item.id } : null), 0);
              return (
                <li key={item.id} className={item.id === current ? 'current' : undefined}>
                  <button
                    type="button"
                    className="video-pick"
                    aria-current={item.id === current ? 'true' : undefined}
                    onClick={() => {
                      setOpen(false);
                      choose(item);
                    }}
                  >
                    <span className="video-thumb" aria-hidden="true">
                      {thumb ? <img src={thumb} alt="" /> : <Film size={14} />}
                      <b>V{at + 1}</b>
                    </span>
                    <span className="video-copy">
                      <strong>{item.title}</strong>
                      <small>
                        {clock(item.duration)} · {clips} {clips === 1 ? 'clip' : 'clips'}
                      </small>
                    </span>
                  </button>
                  {at > 0 && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove the video ${item.title}`}
                      title="Remove this video and its clips"
                      onClick={() => {
                        setOpen(false);
                        remove(item);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn secondary video-add"
            disabled={full}
            title={full ? 'A project holds up to 24 videos' : undefined}
            onClick={() => {
              setOpen(false);
              add();
            }}
          >
            <Plus size={14} /> Add a video to this project
          </button>
        </div>
      )}
    </div>
  );
}
