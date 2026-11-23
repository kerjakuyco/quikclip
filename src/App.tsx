import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ProviderPanel, type Connection } from './components/ProviderPanel';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clapperboard,
  Clock3,
  Download,
  Film,
  FolderOpen,
  HardDrive,
  Keyboard,
  Layers3,
  Link2,
  LoaderCircle,
  Maximize,
  PanelTop,
  Pause,
  Play,
  Plus,
  Repeat2,
  ScanLine,
  Scissors,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from 'lucide-react';
import {
  asset,
  browserBlob,
  browserImport,
  clamp,
  clock,
  desktop,
  errorText,
  frame,
  nativeImport,
  newId,
  readSaved,
  round,
  sample,
  type Project,
  type Cut,
  type ExportEntry,
} from './studio';
import { exportWeb } from './browser-export';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { Dialog } from './components/Dialog';
import './studio.css';

type Page = 'Clip editor' | 'Media library' | 'Exports';
type Modal = 'import' | 'export' | 'ai' | 'keys' | 'guide' | null;
const nav = [
  ['Clip editor', Clapperboard],
  ['Media library', Layers3],
  ['Exports', ArrowDownToLine],
] as const;
const shortcuts = [
  ['Space', 'Play / pause'],
  ['←  →', 'Step one frame'],
  ['I', 'Set clip in point'],
  ['O', 'Set clip out point'],
  ['M', 'Mute / unmute'],
  ['?', 'Keyboard shortcuts'],
];
function initialProjects() {
  const saved = readSaved<unknown>('projects', null);
  return Array.isArray(saved) &&
    saved.length &&
    saved.every((p) => p?.id && p.duration > 0 && p.cuts?.length && Array.isArray(p.frames))
    ? (saved as Project[])
    : [sample];
}
export default function App() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [active, setActive] = useState(() => readSaved('active', 'sample'));
  const [entries, setEntries] = useState<ExportEntry[]>(() => readSaved('exports', []));
  const p = projects.find((x) => x.id === active) ?? projects[0],
    cut = p.cuts.find((c) => c.id === p.selected) ?? p.cuts[0];
  const [page, setPage] = useState<Page>('Clip editor'),
    [modal, setModal] = useState<Modal>(null),
    [tab, setTab] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [src, setSrc] = useState(''),
    [sourceError, setSourceError] = useState(''),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false),
    [loop, setLoop] = useState(false),
    [saved, setSaved] = useState(true),
    [over, setOver] = useState(false);
  const [progress, setProgress] = useState(0),
    [speed, setSpeed] = useState(1);
  const video = useRef<HTMLVideoElement>(null),
    monitor = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!desktop) return;
    const subscription = listen<string>('studio-progress', (e) => setBusy(e.payload));
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    try {
      for (const [k, v] of Object.entries({ projects, active, exports: entries }))
        localStorage.setItem(`quikclip.1.${k}`, JSON.stringify(v));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [projects, active, entries]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    let alive = true,
      objectUrl = '';
    setTime(0);
    setPlaying(false);
    setSourceError('');
    setSrc('');
    if (p.id === 'sample' || desktop) setSrc(asset(p, p.path) ?? '');
    else
      browserBlob(p.id)
        .then((blob) => {
          if (alive) {
            objectUrl = URL.createObjectURL(blob);
            setSrc(objectUrl);
          }
        })
        .catch((e) => {
          if (alive) setSourceError(errorText(e));
        });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [p.id, p.path]);
  function edit(fn: (old: Project) => Project) {
    setProjects((prev) => prev.map((s) => (s.id === p.id ? fn(s) : s)));
  }
  function update(delta: Partial<Cut>) {
    edit((s) => ({ ...s, cuts: s.cuts.map((c) => (c.id === cut.id ? { ...c, ...delta } : c)) }));
  }
  function seek(n: number) {
    const t = clamp(n, 0, p.duration);
    if (video.current?.readyState) video.current.currentTime = t;
    setTime(t);
  }
  function trim(k: 'start' | 'end', n: number) {
    const t = round(
      k === 'start' ? clamp(n, 0, cut.end - 0.25) : clamp(n, cut.start + 0.25, p.duration),
    );
    update({ [k]: t });
    video.current?.pause();
    seek(t);
  }
  function select(c: Cut) {
    video.current?.pause();
    edit((s) => ({ ...s, selected: c.id }));
    seek(c.start);
  }
  function addCut() {
    const start = Math.min(time, p.duration - 0.25),
      c: Cut = {
        id: newId(),
        title: `Clip ${String(p.cuts.length + 1).padStart(2, '0')}`,
        start: round(start),
        end: Math.min(p.duration, round(start + 10)),
        shape: 'source',
      };
    edit((s) => ({ ...s, selected: c.id, cuts: [...s.cuts, c] }));
    setToast('Clip added to the bin');
  }
  function remove() {
    const rest = p.cuts.filter((c) => c.id !== cut.id);
    if (rest.length) {
      edit((s) => ({ ...s, cuts: rest, selected: rest[0].id }));
      seek(rest[0].start);
    }
  }
  function open(m: Modal) {
    video.current?.pause();
    setError('');
    setModal(m);
    setProgress(0);
  }
  function navigate(to: Page) {
    video.current?.pause();
    setPlaying(false);
    setPage(to);
  }
  function choose(q: Project) {
    setActive(q.id);
    navigate('Clip editor');
  }
  function play() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) v.pause();
    else {
      if (loop && (time >= cut.end || time < cut.start)) seek(cut.start);
      v.play().catch(() => setToast('Playback unavailable. Check the source or import an MP4.'));
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        modal ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement)?.closest('input,select,textarea,[contenteditable=true]')
      )
        return;
      if (e.key === '?') {
        e.preventDefault();
        open('keys');
        return;
      }
      if (page !== 'Clip editor') return;
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button')) {
        e.preventDefault();
        play();
      }
      if (e.code === 'KeyM') setMuted((s) => !s);
      if (e.code === 'KeyI') trim('start', time);
      if (e.code === 'KeyO') trim('end', time);
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !(e.target as HTMLElement)?.closest('.handle')
      ) {
        e.preventDefault();
        video.current?.pause();
        seek(time + (e.key === 'ArrowLeft' ? -1 : 1) / (p.fps || 30));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  async function action(text: string, fn: () => Promise<void>) {
    setBusy(text);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
      abort.current = null;
    }
  }
  async function importing(file?: File) {
    if (tab === 'file' && !desktop && !file) {
      fileRef.current?.click();
      return;
    }
    await action(
      tab === 'url' ? 'Downloading and preparing video…' : 'Preparing source and thumbnails…',
      async () => {
        if (tab === 'url' && !desktop)
          throw Error(
            'YouTube import runs in the Quikclip desktop app. Open the studio with npm run tauri dev, or choose a local video here.',
          );
        const q = desktop
          ? await nativeImport(tab === 'url' ? url.trim() : undefined)
          : await browserImport(file!);
        if (!q) return;
        setProjects((prev) => [...prev, q]);
        choose(q);
        setModal(null);
        setUrl('');
        setToast('Media imported');
      },
    );
  }
  async function analyze(connection: Connection, model: string) {
    await action('Preparing source frames…', async () => {
      if (!desktop) throw Error('Open the desktop app to connect your AI provider.');
      const results = await invoke<Pick<Cut, 'start' | 'end' | 'title'>[]>('find_highlights', {
        id: p.id,
        connection,
        model,
      });
      const clips: Cut[] = results.map((c) => ({ ...c, id: newId(), shape: 'source' }));
      edit((s) => ({ ...s, selected: clips[0].id, cuts: [...s.cuts, ...clips] }));
      seek(clips[0].start);
      setModal(null);
      setToast(`${clips.length} highlights added to your clip bin`);
    });
  }
  async function exporting() {
    await action(desktop ? 'Rendering your MP4…' : 'Encoding WebM…', async () => {
      const controller = new AbortController();
      abort.current = controller;
      const path = desktop
        ? await invoke<string | null>('export_clip', {
            id: p.id,
            title: cut.title,
            start: cut.start,
            end: cut.end,
            shape: cut.shape,
          })
        : await exportWeb(src, p, cut, controller.signal, setProgress);
      if (!path) return;
      setEntries((prev) => [
        {
          id: newId(),
          title: cut.title,
          path,
          duration: cut.end - cut.start,
          date: new Date().toISOString(),
          project: p.title,
        },
        ...prev,
      ]);
      setModal(null);
      setToast('Clip exported successfully');
    });
  }
  const ratio = cut.shape === 'source' ? p.width / p.height : cut.shape === 'vertical' ? 9 / 16 : 1;
  const projectIndex = String(projects.indexOf(p) + 1).padStart(3, '0');
  const poster = asset(p, p.poster) ?? frame(p, 0);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/mark.svg" alt="" />
          <strong>Quikclip</strong>
          <span>STUDIO</span>
        </div>
        <div className="side-content">
          <div className="side-label">Workspace</div>
          <nav>
            {nav.map(([name, Icon]) => (
              <button
                aria-label={name}
                title={name}
                className={`nav-item ${page === name ? 'current' : ''}`}
                key={name}
                onClick={() => navigate(name)}
                aria-current={page === name ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{name}</span>
                {name === 'Clip editor' && page === name && <i />}
              </button>
            ))}
          </nav>
          <div className="side-rule" />
          <div className="side-label side-split">
            Projects
            <button
              className="icon-btn"
              aria-label="Import new project"
              onClick={() => open('import')}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="project-nav">
            {projects.map((q) => (
              <button
                key={q.id}
                onClick={() => choose(q)}
                className={`project-item ${q.id === p.id ? 'chosen' : ''}`}
              >
                <i />
                <span>{q.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="side-bottom">
          <button onClick={() => open('keys')}>
            <Keyboard size={16} />
            <span>Keyboard shortcuts</span>
          </button>
          <button onClick={() => open('guide')}>
            <CircleHelp size={16} />
            <span>Studio guide</span>
          </button>
          <div className="device">
            <span className="device-icon">
              <HardDrive size={18} />
            </span>
            <div>
              <strong>Local workspace</strong>
              <small>
                <i /> On this device
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <PanelTop size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <b>{page}</b>
          </div>
          <div className="top-actions">
            <button className="btn secondary" onClick={() => open('import')}>
              <Plus size={16} />
              Import media
            </button>
            {page === 'Clip editor' && (
              <button className="btn primary" onClick={() => open('export')}>
                <ArrowDownToLine size={15} />
                Export clip
              </button>
            )}
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow kicker">
                <i />
                {page === 'Clip editor'
                  ? `EDITING STUDIO  /  PROJECT ${projectIndex}`
                  : 'YOUR WORKSPACE'}
              </div>
              <h1>{page === 'Clip editor' ? p.title : page}</h1>
              {page === 'Clip editor' ? (
                <div className="metadata">
                  <span className="source-badge">
                    <Film size={12} />
                    {p.source === 'Sample' ? 'Sample project' : p.source}
                  </span>
                  <i />
                  <span>
                    <Clock3 />
                    {clock(p.duration)}
                  </span>
                  <i />
                  <span>
                    {p.width} × {p.height}
                  </span>
                  {p.fps > 0 && (
                    <>
                      <i />
                      <span>{Math.round(p.fps * 100) / 100} fps</span>
                    </>
                  )}
                </div>
              ) : (
                <p>
                  {page === 'Media library'
                    ? 'Your source videos, ready for the next cut.'
                    : 'A history of the clips you’ve rendered.'}
                </p>
              )}
            </div>
            {page === 'Clip editor' && (
              <span className={`save-status ${saved ? '' : 'unsaved'}`}>
                <i />
                {saved ? 'Changes saved' : 'Storage full · unsaved'}
              </span>
            )}
          </div>
          {page === 'Clip editor' ? (
            <div className="edit-grid">
              <div className="work-column">
                <section className="panel monitor" ref={monitor}>
                  <div className="panel-heading">
                    <h2>
                      <ScanLine />
                      Source monitor
                    </h2>
                    <span className="tiny-tag">
                      <i />
                      PREVIEW
                    </span>
                  </div>
                  <div
                    className="screen"
                    onDoubleClick={() => {
                      if (document.fullscreenElement) document.exitFullscreen();
                      else
                        monitor.current
                          ?.requestFullscreen()
                          .catch(() => setToast('Fullscreen is unavailable.'));
                    }}
                  >
                    {src && (
                      <video
                        key={src}
                        ref={video}
                        src={src}
                        poster={poster}
                        playsInline
                        preload="metadata"
                        muted={muted}
                        style={{
                          width: `min(100cqw, ${ratio * 100}cqh)`,
                          height: `min(100cqh, ${100 / ratio}cqw)`,
                        }}
                        onClick={play}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.playbackRate = speed;
                          e.currentTarget.currentTime = cut.start;
                          setTime(cut.start);
                        }}
                        onTimeUpdate={(e) => {
                          const v = e.currentTarget;
                          if (loop && !v.paused && v.currentTime >= cut.end) {
                            v.currentTime = cut.start;
                          }
                          setTime(v.currentTime);
                        }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => {
                          if (loop) {
                            seek(cut.start);
                            video.current?.play().catch(() => setPlaying(false));
                          } else setPlaying(false);
                        }}
                        onError={() =>
                          setSourceError(
                            'The source cannot be played. Re-import a supported video.',
                          )
                        }
                      />
                    )}
                    {sourceError && (
                      <div className="media-error">
                        <CircleAlert />
                        {sourceError}
                      </div>
                    )}
                  </div>
                  <div className="transport">
                    <div className="transport-left">
                      <button
                        className="play-btn"
                        aria-label={playing ? 'Pause' : 'Play'}
                        onClick={play}
                      >
                        {playing ? <Pause /> : <Play />}
                      </button>
                      <span className="time-now">{clock(time, true)}</span>
                      <span className="time-total">/ {clock(p.duration)}</span>
                    </div>
                    <div className="transport-right">
                      <button
                        className="icon-btn optional"
                        title="Jump to clip start"
                        aria-label="Jump to clip start"
                        onClick={() => seek(cut.start)}
                      >
                        <SkipBack />
                      </button>
                      <button
                        className="icon-btn optional"
                        title="Jump to clip end"
                        aria-label="Jump to clip end"
                        onClick={() => seek(cut.end)}
                      >
                        <SkipForward />
                      </button>
                      <i className="vline optional" />
                      <button
                        className={`icon-btn ${loop ? 'accent' : ''}`}
                        aria-label="Loop selected clip"
                        aria-pressed={loop}
                        title="Loop selected clip"
                        onClick={() => setLoop(!loop)}
                      >
                        <Repeat2 />
                      </button>
                      <button
                        className="speed-btn"
                        title="Change playback speed"
                        onClick={() => {
                          const speeds = [0.5, 1, 1.5, 2];
                          const s = speeds[(speeds.indexOf(speed) + 1) % 4];
                          setSpeed(s);
                          if (video.current) video.current.playbackRate = s;
                        }}
                      >
                        {speed}×
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={muted ? 'Unmute' : 'Mute'}
                        onClick={() => setMuted(!muted)}
                      >
                        {muted ? <VolumeX /> : <Volume2 />}
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Fullscreen monitor"
                        onClick={() => {
                          if (document.fullscreenElement) document.exitFullscreen();
                          else
                            monitor.current
                              ?.requestFullscreen()
                              .catch(() => setToast('Fullscreen unavailable'));
                        }}
                      >
                        <Maximize />
                      </button>
                    </div>
                  </div>
                </section>
                <Timeline p={p} cut={cut} time={time} seek={seek} trim={trim} add={addCut} />
                <div className="work-hint">
                  <Keyboard size={14} />
                  <kbd>Space</kbd> Play / pause <i /> <kbd>I</kbd>
                  <kbd>O</kbd> Set in / out
                </div>
              </div>
              <Inspector
                p={p}
                cut={cut}
                select={select}
                update={update}
                trim={trim}
                analyze={() => open('ai')}
                remove={remove}
              />
            </div>
          ) : page === 'Media library' ? (
            <div className="library-grid">
              {projects.map((q) => (
                <button className="library-card" key={q.id} onClick={() => choose(q)}>
                  <img alt="" src={asset(q, q.poster) ?? frame(q, 0)} />
                  <div>
                    <small>
                      {q.source} · {clock(q.duration)}
                    </small>
                    <h3>{q.title}</h3>
                    <span>
                      {q.cuts.length} clips <ArrowRight size={14} />
                    </span>
                  </div>
                </button>
              ))}
              <button className="import-tile" onClick={() => open('import')}>
                <Plus />
                Import media
              </button>
            </div>
          ) : entries.length ? (
            <div className="exports-list">
              {entries.map((e) => (
                <div className="export-row" key={e.id}>
                  <span className="export-icon">
                    <BadgeCheck />
                  </span>
                  <div>
                    <strong>{e.title}</strong>
                    <small>
                      {e.project} · {clock(e.duration)} · {new Date(e.date).toLocaleDateString()}
                    </small>
                    <code>{e.path}</code>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty panel">
              <Download />
              <h2>No exports yet</h2>
              <p>Select a clip in the editor and export your first cut.</p>
              <button className="btn secondary" onClick={() => navigate('Clip editor')}>
                Open clip editor <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
        <footer className="statusbar">
          <span>
            <i /> Studio ready
          </span>
          <span>
            QUIKCLIP STUDIO <b>/</b> V0.1
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button className="icon-btn" aria-label="Dismiss message" onClick={() => setToast('')}>
            <X size={13} />
          </button>
        </div>
      )}
      {modal && (
        <Dialog
          eyebrow={modal === 'ai' ? 'AI CONNECTIONS' : 'QUIKCLIP STUDIO'}
          title={
            {
              import: 'Import media',
              export: 'Export clip',
              ai: 'Highlight finder',
              keys: 'Keyboard shortcuts',
              guide: 'Studio guide',
            }[modal]
          }
          busy={!!busy}
          close={() => setModal(null)}
        >
          {modal === 'import' && (
            <>
              <p>Start a project from a video file or YouTube link.</p>
              <div className="tabs">
                {(
                  [
                    ['file', 'Local video', Upload],
                    ['url', 'YouTube URL', Youtube],
                  ] as const
                ).map(([t, label, I]) => (
                  <button
                    disabled={!!busy}
                    className={t === tab ? 'active' : ''}
                    onClick={() => {
                      setTab(t);
                      setError('');
                    }}
                    key={t}
                  >
                    <I size={16} />
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'file' ? (
                <>
                  <input
                    hidden
                    type="file"
                    ref={fileRef}
                    accept="video/*,.mkv,.mov,.m4v"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importing(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    disabled={!!busy}
                    className={`dropzone ${over ? 'over' : ''}`}
                    onClick={() => importing()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!desktop) setOver(true);
                    }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(false);
                      if (!desktop && !busy && e.dataTransfer.files[0])
                        importing(e.dataTransfer.files[0]);
                    }}
                  >
                    <span>
                      <FolderOpen />
                    </span>
                    <strong>
                      {desktop ? 'Choose a video file' : 'Choose or drop a video file'}
                    </strong>
                    <small>
                      {desktop
                        ? 'MP4, MOV, MKV, WebM, M4V, AVI'
                        : 'Use a browser-playable MP4 or WebM'}
                    </small>
                  </button>
                </>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    importing();
                  }}
                >
                  <label className="field-label">
                    YouTube video URL
                    <div className="url-input">
                      <Link2 size={16} />
                      <input
                        required
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=…"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={!!busy}
                      />
                    </div>
                  </label>
                  <p className="subnote">Single videos and Shorts · Built-in desktop importer</p>
                  <button className="btn primary wide" disabled={!!busy || !url.trim()}>
                    <Download size={16} />
                    Import video
                  </button>
                </form>
              )}
            </>
          )}
          {modal === 'ai' && <ProviderPanel busy={!!busy} analyze={analyze} />}
          {modal === 'export' && (
            <>
              <p>Render the selected range with your output frame.</p>
              <div className="export-preview">
                <img src={frame(p, cut.start)} alt="" />
                <div>
                  <strong>{cut.title}</strong>
                  <small>
                    {clock(cut.start, true)} – {clock(cut.end, true)}
                  </small>
                </div>
              </div>
              <dl className="specs">
                <div>
                  <dt>Format</dt>
                  <dd>{desktop ? 'MP4 · H.264 / AAC' : 'WebM · browser encoder'}</dd>
                </div>
                <div>
                  <dt>Frame</dt>
                  <dd>
                    {cut.shape === 'source'
                      ? 'Original'
                      : cut.shape === 'square'
                        ? 'Square · 1:1'
                        : 'Vertical · 9:16'}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{clock(cut.end - cut.start, true)}</dd>
                </div>
              </dl>
              {!desktop && (
                <p className="subnote">
                  Keep this tab visible while encoding. Desktop exports use MP4.
                </p>
              )}
              <button className="btn primary wide" onClick={exporting} disabled={!!busy || !src}>
                <ArrowDownToLine size={16} />
                {desktop ? 'Choose destination' : 'Export WebM'}
              </button>
            </>
          )}
          {modal === 'keys' && (
            <div className="key-list">
              {shortcuts.map(([k, v]) => (
                <div key={k}>
                  <span>{v}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </div>
          )}
          {modal === 'guide' && (
            <div className="guide">
              {[
                [
                  Upload,
                  'Bring in a source',
                  'Use Import media for a local video or YouTube link. The desktop app includes the tools for downloading, preparing, and exporting footage.',
                ],
                [
                  Scissors,
                  'Shape the cut',
                  'Select a clip, drag the timeline handles, or type precise in and out points. Choose Original, 9:16, or 1:1 to preview the crop.',
                ],
                [
                  Sparkles,
                  'Find a highlight',
                  'Choose a local or cloud provider in Highlight finder, connect, and select a vision model. The sample project includes three cuts you can try right away.',
                ],
                [
                  Download,
                  'Render your clip',
                  'Export clip writes an MP4 in the desktop app. The web preview downloads WebM in supported browsers.',
                ],
              ].map(([I, t, s]) => {
                const Icon = I as typeof BookOpen;
                return (
                  <div key={String(t)}>
                    <Icon size={18} />
                    <section>
                      <strong>{String(t)}</strong>
                      <p>{String(s)}</p>
                    </section>
                  </div>
                );
              })}
            </div>
          )}
          {busy && (
            <div className="busy" role="status">
              <LoaderCircle className="spin" size={16} />
              {busy}
              {modal === 'export' && !desktop && (
                <>
                  {Math.round(progress * 100)}%{' '}
                  <button className="text-btn" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                </>
              )}
              {desktop && (
                <button
                  className="text-btn"
                  onClick={() => invoke('cancel_job').catch((e) => setError(errorText(e)))}
                >
                  Cancel
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
