import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ProviderPanel,
  suggestionModel,
  transcriptionConnection,
  type Connection,
} from './components/ProviderPanel';
import { CaptionFields, LiveCaptions } from './components/Captions';
import {
  CAPTION_STYLES,
  buildCues,
  captionTop,
  captionWords,
  correctedWords,
  cutCaptions,
  TRANSLATE_LANGUAGES,
  languageName,
  languageTag,
  paceCues,
  presentCues,
  readingLines,
  toSrt,
  transcriptText,
  type Transcript,
} from './captions';
import { TranscriptPanel, type TranscriptStatus } from './components/TranscriptPanel';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Link2,
  LoaderCircle,
  Maximize,
  Pause,
  Play,
  Plus,
  Trash2,
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
} from 'lucide-react';
import {
  asset,
  browserBlob,
  browserImport,
  clamp,
  clock,
  cutFit,
  cutLogo,
  cutMusic,
  cutPauses,
  cutVoice,
  desktop,
  fileSrc,
  logoBlob,
  musicBlob,
  outputFrame,
  errorText,
  frame,
  nativeImport,
  drawWave,
  newId,
  readSaved,
  releaseMusic,
  releaseLogo,
  deleteProjectMedia,
  round,
  sample,
  type Project,
  type Cut,
  type ExportEntry,
} from './studio';
import { exportWeb } from './browser-export';
import { headlineBottom, headlineLines, headlinePng, headlineSpec, headlineText } from './headline';
import { cornerLabel, logoFit } from './logo';
import { musicAt, musicVolume } from './music';
import { clipClock, pauseSummary, scanCut, type PausePlan } from './pauses';
import { cutSpeed, playedLength } from './speed';
import { Inspector } from './components/Inspector';
import { JobProgress, useElapsed, type JobStep } from './components/JobProgress';
import { Timeline } from './components/Timeline';
import { Dialog } from './components/Dialog';
import { StudioShell, type Page } from './components/StudioShell';
import { ExportHistory, MediaLibrary } from './components/WorkspacePages';
import './studio.css';

type Modal = 'import' | 'export' | 'ai' | 'keys' | 'guide' | 'delete' | null;
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
  const [doomed, setDoomed] = useState<Project | null>(null);
  // Each desktop project's transcript once read or made, and how the making goes until then.
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({}),
    [transcribing, setTranscribing] = useState<Record<string, TranscriptStatus>>({});
  const asked = useRef(new Set<string>());
  const [panel, setPanel] = useState<'clips' | 'transcript'>('clips');
  const [spokenLanguage, setSpokenLanguage] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  const [step, setStep] = useState<JobStep | null>(null),
    [busySince, setBusySince] = useState(0);
  const busyFor = useElapsed(busySince);
  const video = useRef<HTMLVideoElement>(null),
    musicEl = useRef<HTMLAudioElement>(null),
    monitor = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  const syncMusic = useRef<(videoEl: HTMLVideoElement, playing: boolean) => void>(() => {});
  const skips = useRef<{ start: number; end: number }[]>([]);
  const [musicUrl, setMusicUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [pausePlan, setPausePlan] = useState<PausePlan | null>(null);
  const [pauseError, setPauseError] = useState('');
  useEffect(() => {
    if (!desktop) return;
    const subscriptions = [
      listen<string>('studio-progress', (e) => setBusy(e.payload)),
      listen<JobStep>('studio-step', (e) => setStep(e.payload)),
      listen<{ id: string; done: number; total: number }>('studio-transcript', (e) =>
        setTranscribing((prev) => ({
          ...prev,
          [e.payload.id]: { state: 'working', done: e.payload.done, total: e.payload.total },
        })),
      ),
    ];
    return () => {
      for (const subscription of subscriptions) void subscription.then((unlisten) => unlisten());
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
    // `undefined` means the waveform has not been drawn yet (a new import, or one closed early).
    if (!desktop || p.wave !== undefined) return;
    const id = p.id;
    void drawWave(id).then((wave) => {
      if (wave !== undefined)
        setProjects((prev) => prev.map((x) => (x.id === id ? { ...x, wave } : x)));
    });
  }, [p.id, p.wave]);
  useEffect(() => {
    // Every imported video is transcribed: read when made, else made now, once per session.
    if (!desktop || p.id === 'sample' || transcripts[p.id] || asked.current.has(p.id)) return;
    asked.current.add(p.id);
    const id = p.id;
    invoke<Transcript | null>('read_transcript', { id })
      .then((found) => {
        if (found) setTranscripts((prev) => ({ ...prev, [id]: found }));
        else void transcribe(id);
      })
      .catch(() => void transcribe(id));
    // Once per project: `transcribe` and the maps are read fresh inside.
  }, [p.id]);
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
  useEffect(() => {
    const track = cutMusic(cut);
    if (!track) {
      setMusicUrl('');
      return;
    }
    if (desktop) {
      setMusicUrl(fileSrc(track.source));
      return;
    }
    let alive = true,
      objectUrl = '';
    musicBlob(track.source)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setMusicUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setMusicUrl('');
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cut.music?.source]);
  useEffect(() => {
    const mark = cutLogo(cut);
    if (!mark) {
      setLogoUrl('');
      return;
    }
    if (desktop) {
      setLogoUrl(fileSrc(mark.source));
      return;
    }
    let alive = true,
      objectUrl = '';
    logoBlob(mark.source)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setLogoUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setLogoUrl('');
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cut.logo?.source]);
  useEffect(() => {
    if (!cutPauses(cut)) {
      setPausePlan(null);
      setPauseError('');
      return;
    }
    const controller = new AbortController();
    setPausePlan(null);
    setPauseError('');
    scanCut(p, cut, controller.signal)
      .then((plan) => {
        if (!controller.signal.aborted) setPausePlan(plan);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          return;
        if (!controller.signal.aborted) setPauseError(errorText(error));
      });
    return () => controller.abort();
  }, [cut.pauses, cut.start, cut.end, cut.id, p.id]);
  skips.current = cutPauses(cut) && pausePlan ? pausePlan.cuts : [];
  syncMusic.current = (videoEl, playing) => {
    const audio = musicEl.current;
    const track = cutMusic(cut);
    if (!audio || !track) return;
    audio.muted = muted;
    const pace = cutSpeed(cut);
    const rate = videoEl.playbackRate;
    if (pace === 1) {
      if (Number.isFinite(rate) && rate > 0) audio.playbackRate = rate;
    } else if (Number.isFinite(rate) && rate > 0) {
      audio.playbackRate = rate / pace;
    }
    const marks = skips.current;
    const removed = cutPauses(cut) && pausePlan ? pausePlan.seconds : 0;
    const state = musicAt(
      pace === 1
        ? marks.length
          ? clipClock(videoEl.currentTime, cut.start, marks)
          : videoEl.currentTime - cut.start
        : clipClock(videoEl.currentTime, cut.start, marks, pace),
      track,
      track.duration,
      playedLength(cut.end - cut.start, removed, pace),
    );
    if (!playing || state.position === null) {
      audio.pause();
      return;
    }
    audio.volume = state.volume;
    if (Math.abs(audio.currentTime - state.position) > 0.3) {
      try {
        audio.currentTime = state.position;
      } catch {
        /* The track is not ready to seek yet. */
      }
    }
    if (audio.paused) void audio.play().catch(() => {});
  };
  useEffect(() => {
    const videoEl = video.current;
    if (videoEl) syncMusic.current(videoEl, !videoEl.paused);
  }, [musicUrl, muted, cut.id, cut.music?.volume, cut.start, cut.end, cut.speed, pausePlan]);
  useEffect(() => {
    const videoEl = video.current;
    if (videoEl) videoEl.playbackRate = speed * cutSpeed(cut);
  }, [speed, cut.speed]);
  useEffect(() => {
    if (!playing || !pausePlan?.count) return;
    let frame = 0;
    const tick = () => {
      const player = video.current;
      const hit =
        player && !player.paused
          ? skips.current.find(
              (item) => player.currentTime >= item.start && player.currentTime < item.end - 0.02,
            )
          : undefined;
      if (player && hit) {
        const to = Math.min(hit.end, cut.end);
        if (to > player.currentTime) {
          player.currentTime = to;
          setTime(to);
          syncMusic.current(player, true);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pausePlan, cut.end]);
  function edit(fn: (old: Project) => Project) {
    setProjects((prev) => prev.map((s) => (s.id === p.id ? fn(s) : s)));
  }
  function update(delta: Partial<Cut>) {
    edit((s) => ({ ...s, cuts: s.cuts.map((c) => (c.id === cut.id ? { ...c, ...delta } : c)) }));
  }
  /** The whole video's transcript (src-tauri transcript.rs): made once, in the background, with progress as it goes. */
  async function transcribe(id: string, again = false) {
    const linked = transcriptionConnection();
    if (!linked) {
      setTranscribing((prev) => ({ ...prev, [id]: { state: 'connect' } }));
      return;
    }
    const chosen = spokenLanguage[id];
    setTranscribing((prev) => ({ ...prev, [id]: { state: 'working', done: 0, total: 0 } }));
    try {
      const made = await invoke<Transcript>('transcribe_source', {
        id,
        connection: linked.connection,
        language: chosen && chosen !== 'auto' ? chosen : null,
        again,
      });
      setTranscripts((prev) => ({ ...prev, [id]: made }));
      setTranscribing(({ [id]: _, ...rest }) => rest);
    } catch (e) {
      setTranscribing((prev) => ({ ...prev, [id]: { state: 'error', text: errorText(e) } }));
    }
  }
  /** The transcript as text, or the whole video's subtitles as SubRip, saved where the user chooses. */
  async function downloadTranscript(kind: 'txt' | 'srt') {
    if (!transcript) return;
    const contents =
      kind === 'txt'
        ? transcriptText(p.title, readingLines(transcript, p.fixes))
        : toSrt(paceCues(buildCues(heard, 0, p.duration), p.duration));
    try {
      const saved = await invoke<string | null>('save_text', {
        name: kind === 'txt' ? `${p.title} transcript` : p.title,
        extension: kind,
        contents,
      });
      if (saved) setToast(kind === 'txt' ? 'Transcript saved' : 'Subtitles saved');
    } catch (e) {
      setToast(errorText(e));
    }
  }
  /** A misheard word corrected in the transcript (or emptied to drop it): every clip's captions use it. */
  function fixWord(index: number, text: string) {
    const read = transcripts[p.id]?.words[index]?.text;
    const value = text.replace(/\s+/g, ' ').trim().slice(0, 64);
    edit((s) => {
      const fixes = { ...(s.fixes ?? {}) };
      if (value === read) delete fixes[index];
      else fixes[index] = value;
      return { ...s, fixes };
    });
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
        fit: 'fill',
        voice: true,
      };
    edit((s) => ({ ...s, selected: c.id, cuts: [...s.cuts, c] }));
    setToast('Clip added to the bin');
  }
  function remove() {
    const source = cut.music?.source;
    const rest = p.cuts.filter((c) => c.id !== cut.id);
    if (source && !rest.some((c) => c.music?.source === source)) releaseMusic(source);
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
  function askDelete(q: Project) {
    setDoomed(q);
    open('delete');
  }
  async function deleteProject(q: Project) {
    await action('Deleting project…', async () => {
      const rest = projects.filter((x) => x.id !== q.id);
      if (!rest.length) throw Error('Keep at least one project in the workspace.');
      if (p.id === q.id) {
        // Let the player close the editing copy so it can be deleted.
        video.current?.pause();
        setActive(rest[0].id);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await deleteProjectMedia(q.id);
      const others = rest.flatMap((x) => x.cuts);
      const tracks = new Set(q.cuts.flatMap((c) => (c.music?.source ? [c.music.source] : [])));
      const marks = new Set(q.cuts.flatMap((c) => (c.logo?.source ? [c.logo.source] : [])));
      for (const source of tracks)
        if (!others.some((c) => c.music?.source === source)) releaseMusic(source);
      for (const source of marks)
        if (!others.some((c) => c.logo?.source === source)) releaseLogo(source);
      setProjects(rest);
      setModal(null);
      setDoomed(null);
      setToast(`Deleted “${q.title}”`);
    });
  }
  function play() {
    const v = video.current;
    if (!v) return;
    if (!v.paused) v.pause();
    else {
      if (loop && (time >= cut.end || time < cut.start)) {
        v.currentTime = cut.start;
        setTime(cut.start);
      }
      syncMusic.current(v, true);
      v.play().catch(() => setToast('Playback unavailable. Check the source or import an MP4.'));
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (monitor.current?.requestFullscreen) await monitor.current.requestFullscreen();
      else setToast('Fullscreen is unavailable.');
    } catch {
      setToast('Fullscreen is unavailable.');
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
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button, summary, a[href]')) {
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
    setStep(null);
    setBusySince(Date.now());
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
      setStep(null);
      setBusySince(0);
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
            'YouTube, Twitch, and Kick import runs in the Quikclip desktop app. Open the studio with npm run tauri dev, or choose a local video here.',
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
      const clips: Cut[] = results.map((c) => ({
        ...c,
        id: newId(),
        shape: 'source',
        fit: 'fill',
        voice: true,
      }));
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
      const frameSize = outputFrame(cut.shape, p.width, p.height);
      const track = cutMusic(cut);
      const mark = cutLogo(cut);
      const path = desktop
        ? await invoke<string | null>('export_clip', {
            id: p.id,
            title: cut.title,
            start: cut.start,
            end: cut.end,
            shape: cut.shape,
            fit: cutFit(cut),
            headline:
              (await headlinePng(
                cut.shape,
                frameSize.width,
                frameSize.height,
                cut.headline ?? '',
              )) ?? '',
            voice: cutVoice(cut),
            music: track?.source ?? '',
            volume: track ? musicVolume(track) : 0,
            pauses: cutPauses(cut),
            logo: mark?.source ?? '',
            corner: mark?.corner ?? '',
            speed: cutSpeed(cut),
            captions:
              captions.style !== 'none' && cues.length
                ? JSON.stringify({
                    cues,
                    style: captions.style,
                    position: captions.position,
                    color: captions.color,
                    highlight: captions.highlight,
                    top: captions.position === 'top' ? captionStart : null,
                    language: transcript?.language ?? null,
                  })
                : '',
          })
        : await exportWeb(src, p, cut, controller.signal, setProgress);
      if (!path) return;
      setEntries((prev) => [
        {
          id: newId(),
          title: cut.title,
          path,
          duration: playedLength(
            cut.end - cut.start,
            cutPauses(cut) && pausePlan ? pausePlan.seconds : 0,
            cutSpeed(cut),
          ),
          date: new Date().toISOString(),
          project: p.title,
        },
        ...prev,
      ]);
      setModal(null);
      setToast(
        desktop && captions.style !== 'none' && cues.length
          ? 'Clip exported, with its captions as an .srt beside it'
          : 'Clip exported successfully',
      );
    });
  }
  const ratio = cut.shape === 'source' ? p.width / p.height : cut.shape === 'vertical' ? 9 / 16 : 1;
  const blur = cut.shape !== 'source' && cutFit(cut) === 'blur';
  const music = cutMusic(cut);
  const logo = cutLogo(cut);
  const pixels = outputFrame(cut.shape, p.width, p.height);
  const logoBox = logo
    ? logoFit(pixels.width, pixels.height, logo.width, logo.height, logo.corner)
    : null;
  const headline = headlineText(cut.headline);
  const head = headlineSpec(cut.shape, p.width, p.height, Math.min(p.width, p.height));
  const transcript = transcripts[p.id];
  const heard = useMemo(
    () => (transcript ? correctedWords(transcript.words, p.fixes) : []),
    [transcript, p.fixes],
  );
  const captions = cutCaptions(cut);
  // `captions` is rebuilt from cut.captions on every render, so the memos follow the stored value.
  const captionSource = useMemo(() => captionWords(heard, captions), [heard, cut.captions]);
  const sourceCues = useMemo(
    () => buildCues(captionSource, cut.start, cut.end),
    [captionSource, cut.start, cut.end],
  );
  const cues = useMemo(
    () => presentCues(sourceCues, captions.translation, cut.start),
    [sourceCues, captions.translation, cut.start],
  );
  async function translateClip(language: string, both: boolean) {
    const linked = suggestionModel();
    if (!linked) {
      setToast('Choose a model in Highlight finder before translating captions.');
      open('ai');
      return;
    }
    const known = TRANSLATE_LANGUAGES.find((item) => item.code === language)?.code;
    if (!sourceCues.length || !known) return;
    setTranslating(true);
    try {
      const lines = await invoke<string[]>('translate_captions', {
        connection: linked.connection,
        model: linked.model,
        language: known,
        lines: sourceCues.map((cue) => cue.text),
      });
      update({
        captions: {
          ...captions,
          translation: {
            language: known,
            both,
            lines: sourceCues.flatMap((cue, index) => {
              const line = (lines[index] ?? '').replace(/\s+/g, ' ').trim();
              return line ? [{ at: Math.round((cut.start + cue.start) * 1000) / 1000, line }] : [];
            }),
          },
        },
      });
      setToast(`Captions translated to ${languageName(known)}.`);
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setTranslating(false);
    }
  }
  const status: TranscriptStatus | null = !desktop
    ? { state: 'unavailable', text: 'Transcripts are made in the Quikclip desktop app.' }
    : p.id === 'sample'
      ? {
          state: 'unavailable',
          text: 'The sample has no transcript. Import a video to transcribe it.',
        }
      : (transcribing[p.id] ?? null);
  const waiting = transcript
    ? null
    : status?.state === 'working'
      ? status.total
        ? `Transcribing the source (${status.done} of ${status.total} parts). Captions will appear here when it’s ready.`
        : 'Transcribing the source. Captions will appear here when it’s ready.'
      : status?.state === 'error'
        ? `The transcript stopped: ${status.text}`
        : status?.state === 'connect'
          ? 'Connect OpenRouter or Cloudflare in Highlight finder to create captions.'
          : status?.state === 'unavailable'
            ? status.text
            : 'Reading the transcript…';
  // Captions on Top start under the headline, in the export frame's pixels.
  const captionStart =
    captions.style !== 'none'
      ? captionTop(
          pixels.width,
          pixels.height,
          captions.style,
          headlineBottom(cut.shape, pixels.width, pixels.height, cut.headline),
          headlineSpec(
            cut.shape,
            pixels.width,
            pixels.height,
            Math.min(pixels.width, pixels.height),
          ).fontSize,
        )
      : 0;
  const lines = headlineLines(headline, head.columns);
  const projectIndex = String(projects.indexOf(p) + 1).padStart(2, '0');
  const poster = asset(p, p.poster) ?? frame(p, 0);
  const outputShape = { source: 'Original', vertical: '9:16', square: '1:1' }[cut.shape];
  return (
    <>
      <StudioShell
        page={page}
        project={p}
        projects={projects}
        saved={saved}
        busy={!!busy}
        onNavigate={navigate}
        onChoose={choose}
        onDelete={askDelete}
        onImport={() => open('import')}
        onExport={() => open('export')}
        onShortcuts={() => open('keys')}
        onGuide={() => open('guide')}
        notice={setToast}
      >
        {page === 'Clip editor' ? (
          <div className="edit-grid">
            <div className="editor-stage">
              <header className="project-header">
                <div className="project-heading">
                  <div className="project-context">
                    <span>Project {projectIndex}</span>
                    <span className="source-badge">
                      <Film size={12} />
                      {p.source === 'Sample' ? 'Sample project' : p.source}
                    </span>
                  </div>
                  <h1 title={p.title}>{p.title}</h1>
                </div>
                <div className="metadata" role="group" aria-label="Source details">
                  <span title="Source duration">
                    <Clock3 size={14} />
                    {clock(p.duration)}
                  </span>
                  <span title="Source resolution">
                    {p.width} × {p.height}
                  </span>
                  {p.fps > 0 && <span>{Math.round(p.fps * 100) / 100} fps</span>}
                </div>
              </header>
              <section className="monitor" ref={monitor} aria-labelledby="monitor-title">
                <div className="panel-heading">
                  <h2 id="monitor-title">
                    <ScanLine />
                    Source monitor
                  </h2>
                  <span className="monitor-format" title="Preview output frame">
                    <span>{outputShape}</span>
                    {pixels.width} × {pixels.height}
                  </span>
                </div>
                <div className="screen" onDoubleClick={toggleFullscreen}>
                  {src && (
                    <div
                      className={`stage${blur ? ' blur-fill' : ''}`}
                      style={{
                        width: `min(100cqw, ${ratio * 100}cqh)`,
                        height: `min(100cqh, ${100 / ratio}cqw)`,
                      }}
                    >
                      {blur && <img className="blur-plate" alt="" src={frame(p, time) ?? poster} />}
                      <video
                        key={src}
                        ref={video}
                        src={src}
                        aria-label={`Video preview: ${p.title}`}
                        poster={poster}
                        playsInline
                        preload="metadata"
                        muted={muted}
                        onClick={play}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.playbackRate = speed * cutSpeed(cut);
                          e.currentTarget.currentTime = cut.start;
                          setTime(cut.start);
                        }}
                        onTimeUpdate={(e) => {
                          const v = e.currentTarget;
                          if (!v.paused) {
                            const hit = skips.current.find(
                              (item) =>
                                v.currentTime >= item.start && v.currentTime < item.end - 0.02,
                            );
                            if (hit) v.currentTime = Math.min(hit.end, cut.end);
                            if (loop && v.currentTime >= cut.end) v.currentTime = cut.start;
                          }
                          setTime(v.currentTime);
                          syncMusic.current(v, !v.paused);
                        }}
                        onPlay={(e) => {
                          setPlaying(true);
                          syncMusic.current(e.currentTarget, true);
                        }}
                        onPause={(e) => {
                          setPlaying(false);
                          syncMusic.current(e.currentTarget, false);
                        }}
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
                      {lines.length > 0 && (
                        <p
                          className="headline"
                          style={{
                            top: `${head.top * 100}%`,
                            fontSize: `calc(${head.size} / 1080 * 100cqmin)`,
                          }}
                        >
                          <span>
                            {lines.map((line, i) => (
                              <Fragment key={i}>
                                {i > 0 && <br />}
                                {line}
                              </Fragment>
                            ))}
                          </span>
                        </p>
                      )}
                      {cues.length > 0 && (
                        <LiveCaptions
                          cues={cues}
                          time={time - cut.start}
                          captions={captions}
                          width={pixels.width}
                          height={pixels.height}
                          top={captionStart}
                          duration={cut.end - cut.start}
                          lang={languageTag(transcript?.language)}
                        />
                      )}
                      {logoUrl && logo && logoBox && (
                        <img
                          className="logo"
                          alt=""
                          aria-hidden="true"
                          draggable={false}
                          src={logoUrl}
                          data-logo-corner={logo.corner}
                          style={{
                            left: `${logoBox.left * 100}%`,
                            top: `${logoBox.top * 100}%`,
                            width: `${logoBox.width * 100}%`,
                            height: `${logoBox.height * 100}%`,
                          }}
                        />
                      )}
                      {musicUrl && (
                        <audio
                          key={musicUrl}
                          ref={musicEl}
                          className="music-bed"
                          src={musicUrl}
                          preload="auto"
                          hidden
                        />
                      )}
                    </div>
                  )}
                  {sourceError ? (
                    <div className="media-error" role="alert">
                      <CircleAlert size={17} />
                      {sourceError}
                    </div>
                  ) : !src ? (
                    <span className="monitor-loading" role="status">
                      Loading source…
                    </span>
                  ) : null}
                </div>
                <div className="transport">
                  <div className="transport-time" role="group" aria-label="Source time">
                    <span className="time-now">{clock(time, true)}</span>
                    <span className="time-total">/ {clock(p.duration)}</span>
                  </div>
                  <div className="transport-playback" role="group" aria-label="Playback">
                    <button
                      className="icon-btn"
                      title="Jump to clip start"
                      aria-label="Jump to clip start"
                      onClick={() => seek(cut.start)}
                    >
                      <SkipBack />
                    </button>
                    <button
                      className="play-btn"
                      data-playing={playing || undefined}
                      aria-label={playing ? 'Pause' : 'Play'}
                      title={playing ? 'Pause (Space)' : 'Play (Space)'}
                      disabled={!src || !!sourceError}
                      onClick={play}
                    >
                      {playing ? <Pause /> : <Play />}
                    </button>
                    <button
                      className="icon-btn"
                      title="Jump to clip end"
                      aria-label="Jump to clip end"
                      onClick={() => seek(cut.end)}
                    >
                      <SkipForward />
                    </button>
                  </div>
                  <div className="transport-right" role="group" aria-label="Monitor controls">
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
                      aria-label={`Playback speed: ${speed} times`}
                      onClick={() => {
                        const speeds = [0.5, 1, 1.5, 2];
                        const s = speeds[(speeds.indexOf(speed) + 1) % 4];
                        setSpeed(s);
                        if (video.current) video.current.playbackRate = s * cutSpeed(cut);
                      }}
                    >
                      {speed}×
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={muted ? 'Unmute' : 'Mute'}
                      title={muted ? 'Unmute monitor (M)' : 'Mute monitor (M)'}
                      onClick={() => setMuted(!muted)}
                    >
                      {muted ? <VolumeX /> : <Volume2 />}
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="Fullscreen monitor"
                      title="Toggle fullscreen"
                      onClick={toggleFullscreen}
                    >
                      <Maximize />
                    </button>
                  </div>
                </div>
              </section>
            </div>
            <Timeline p={p} cut={cut} time={time} seek={seek} trim={trim} add={addCut} />
            <Inspector
              p={p}
              cut={cut}
              select={select}
              update={update}
              trim={trim}
              analyze={() => open('ai')}
              remove={remove}
              notice={setToast}
              panel={panel}
              setPanel={setPanel}
              captions={
                <CaptionFields
                  cut={cut}
                  captions={captions}
                  cues={cues}
                  words={captionSource}
                  update={update}
                  waiting={waiting}
                  openTranscript={() => {
                    setPanel('transcript');
                    document.getElementById('inspector-tab-transcript')?.focus();
                  }}
                  spoken={transcript?.language}
                  translating={translating}
                  onTranslate={(language, both) => void translateClip(language, both)}
                />
              }
              transcript={
                <TranscriptPanel
                  transcript={transcript}
                  fixes={p.fixes}
                  status={status}
                  time={time}
                  clip={cut}
                  onSeek={seek}
                  onRange={(start, end) => {
                    const from = round(clamp(start, 0, p.duration - 0.25));
                    update({ start: from, end: round(clamp(end, from + 0.25, p.duration)) });
                    seek(from);
                  }}
                  onFix={fixWord}
                  language={spokenLanguage[p.id] ?? 'auto'}
                  onLanguage={(code) => setSpokenLanguage((prev) => ({ ...prev, [p.id]: code }))}
                  onTranscribe={(again) => void transcribe(p.id, again)}
                  onConnect={() => open('ai')}
                  onDownload={(kind) => void downloadTranscript(kind)}
                />
              }
              pauseNote={
                !cutPauses(cut)
                  ? 'Remove quiet stretches of 0.5 seconds or longer.'
                  : pauseError
                    ? pauseError
                    : pausePlan
                      ? pauseSummary(pausePlan)
                      : 'Listening for quiet…'
              }
            />
          </div>
        ) : page === 'Media library' ? (
          <MediaLibrary
            projects={projects}
            busy={!!busy}
            onChoose={choose}
            onDelete={askDelete}
            onImport={() => open('import')}
          />
        ) : (
          <ExportHistory entries={entries} onEdit={() => navigate('Clip editor')} />
        )}
      </StudioShell>
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
          eyebrow={modal === 'ai' ? 'AI connections' : 'Quikclip Studio'}
          title={
            {
              import: 'Import media',
              export: 'Export clip',
              ai: 'Highlight finder',
              keys: 'Keyboard shortcuts',
              guide: 'Studio guide',
              delete: 'Delete project',
            }[modal]
          }
          busy={!!busy}
          close={() => setModal(null)}
        >
          {modal === 'import' && (
            <>
              <p>Start a project from a video file or a YouTube, Twitch, or Kick link.</p>
              <div className="tabs" role="group" aria-label="Import source">
                {(
                  [
                    ['file', 'Local video', Upload],
                    ['url', 'Video link', Link2],
                  ] as const
                ).map(([t, label, I]) => (
                  <button
                    disabled={!!busy}
                    className={t === tab ? 'active' : ''}
                    aria-pressed={t === tab}
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
                    aria-label="Video file"
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
                    Video link
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
                  <p className="subnote">
                    YouTube, Twitch, and Kick · One public video or clip · Built-in desktop importer
                  </p>
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
                      : `${cut.shape === 'square' ? 'Square · 1:1' : 'Vertical · 9:16'} · ${
                          blur ? 'whole picture' : 'fill'
                        }`}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {clock(
                      playedLength(
                        cut.end - cut.start,
                        cutPauses(cut) && pausePlan ? pausePlan.seconds : 0,
                        cutSpeed(cut),
                      ),
                      true,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Speed</dt>
                  <dd>{cutSpeed(cut)}×</dd>
                </div>
                <div>
                  <dt>Headline</dt>
                  <dd>{headline || 'None'}</dd>
                </div>
                <div>
                  <dt>Sound</dt>
                  <dd>{cutVoice(cut) ? 'Clearer voice' : 'Original'}</dd>
                </div>
                <div>
                  <dt>Pauses</dt>
                  <dd>
                    {cutPauses(cut)
                      ? pauseError
                        ? 'Could not listen'
                        : pausePlan
                          ? pauseSummary(pausePlan)
                          : 'Listening…'
                      : 'Kept'}
                  </dd>
                </div>
                <div>
                  <dt>Music</dt>
                  <dd>
                    {music ? `${music.name} · ${Math.round(musicVolume(music) * 100)}%` : 'None'}
                  </dd>
                </div>
                <div>
                  <dt>Logo</dt>
                  <dd>{logo ? `${logo.name} · ${cornerLabel(logo.corner)}` : 'None'}</dd>
                </div>
                <div>
                  <dt>Captions</dt>
                  <dd>
                    {captions.style !== 'none' && cues.length
                      ? `${CAPTION_STYLES.find((s) => s.value === captions.style)?.label} · ${cues.length} lines`
                      : 'None'}
                  </dd>
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
          {modal === 'delete' && doomed && (
            <>
              <p>
                “{doomed.title}” and its {doomed.cuts.length}{' '}
                {doomed.cuts.length === 1 ? 'clip' : 'clips'} will be removed from this workspace.{' '}
                {doomed.id === 'sample'
                  ? 'The sample ships with Quikclip, so no files are deleted.'
                  : desktop
                    ? 'The editing copy, thumbnails, and waveform Quikclip made on this device are deleted. Your original video and exported MP4s are not touched.'
                    : 'The copy of the video stored in this browser is deleted. Your original file and downloaded exports are not touched.'}
              </p>
              <div className="confirm-actions">
                <button className="btn secondary" disabled={!!busy} onClick={() => setModal(null)}>
                  Keep project
                </button>
                <button
                  className="btn danger"
                  disabled={!!busy}
                  onClick={() => void deleteProject(doomed)}
                >
                  <Trash2 size={15} />
                  Delete project
                </button>
              </div>
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
                  'Use Import media for a local video or a YouTube, Twitch, or Kick link. The desktop app includes the tools for downloading, preparing, and exporting footage.',
                ],
                [
                  Scissors,
                  'Shape the cut',
                  'Select a clip, then drag the timeline handles or enter exact in and out points. Choose a frame and clip speed. Open Captions to style or translate them, Headline and logo to add an overlay, or Audio to clean up voice, remove pauses, and add background music. Correct words for all clips in the Transcript tab.',
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
          {busy && desktop && step && (
            <JobProgress
              step={step}
              since={busySince}
              onCancel={() => invoke('cancel_job').catch((e) => setError(errorText(e)))}
            />
          )}
          {busy && !(desktop && step) && (
            <div className="busy" role="status">
              <LoaderCircle className="spin" size={16} />
              {busy}
              {busyFor >= 1 && <span className="busy-time">{clock(busyFor)}</span>}
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
    </>
  );
}
