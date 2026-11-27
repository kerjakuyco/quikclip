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
  browserFrame,
  browserImport,
  clamp,
  clock,
  cropBox,
  cropFrame,
  cropRect,
  cutFit,
  cutCamera,
  cutFraming,
  cutLoudness,
  exportFraming,
  framedCrop,
  LOUDNESS,
  loudnessLufs,
  cutLogo,
  cutMusic,
  cutPauses,
  cutVoice,
  desktop,
  fileSrc,
  mediaOf,
  MAX_VIDEOS,
  TRANSITIONS,
  type Bookend,
  type Transition,
  projectVideos,
  withMedia,
  type Video,
  logoBlob,
  musicBlob,
  FRAME_PRESETS,
  errorText,
  frame,
  nativeImport,
  drawWave,
  newId,
  readSaved,
  releaseUnusedCutMedia,
  deleteProjectMedia,
  round,
  sample,
  type Project,
  type Cut,
  type ExportEntry,
  type Shape,
} from './studio';
import { exportWeb } from './browser-export';
import {
  HEADLINE_MAX,
  headlineBottom,
  headlineLines,
  headlinePng,
  headlineSpec,
  headlineText,
} from './headline';
import { cornerLabel, logoFit } from './logo';
import { musicAt, musicMix, musicVolume } from './music';
import { clipClock, pauseSummary, scanCut, type PausePlan } from './pauses';
import { cutSpeed, playedLength } from './speed';
import { Inspector, type FaceStatus, type InspectorPanel } from './components/Inspector';
import { AssistantPanel } from './components/AssistantPanel';
import { applyOps, assistantContext, parseAssistant, type Turn } from './assistant';
import type { Platform, Post, Tone } from './post';
import { MirrorVideo } from './components/MirrorVideo';
import { CommandPalette, type Command } from './components/CommandPalette';
import { VideoMenu } from './components/VideoMenu';
import { FRAME_ICONS, IMPORT_ICONS, JOIN_ICONS, TRANSITION_ICONS } from './components/icons';
import { BrollLayer } from './components/BrollLayer';
import { brollRequest, cutBroll } from './broll';
import { cutTexts, newText, textsRequest } from './texts';
import { TextLayer } from './components/TextLayer';
import type { FaceSample } from './camera';
import { closeEdit, emptyStack, noteEdit, redoEdit, undoEdit, type EditStack } from './history';
import {
  applyLook,
  BUILT_IN_LOOKS,
  clearLook,
  freshName,
  lookFrom,
  matchingLook,
  readLook,
  readLooks,
  writeLook,
  writeLooks,
  type NamedLook,
} from './look';
import {
  fillerRanges,
  fromStart,
  isFiller,
  mergeSpans,
  punchRanges,
  spanSeconds,
  speakingAt,
  within,
} from './polish';
import { JobProgress, useElapsed, type JobStep } from './components/JobProgress';
import { Timeline } from './components/Timeline';
import {
  MIN_CLIP,
  trimTime,
  trimToWord,
  wordEdges,
  type TrimMotion,
  type TrimSnap,
} from './timeline';
import type { HighlightOptions } from './highlights';
import { exportJobs, MAX_EXPORT_FILES, type ExportJob } from './export-plan';
import { safeInsets } from './safe-areas';
import { Dialog } from './components/Dialog';
import { StudioShell, type Page } from './components/StudioShell';
import { ExportHistory, MediaLibrary } from './components/WorkspacePages';
import './studio.css';

type Modal = 'import' | 'export' | 'ai' | 'keys' | 'guide' | 'delete' | 'video' | null;
const shortcuts = [
  ['Space', 'Play / pause'],
  ['←  →', 'Step one frame'],
  ['I', 'Set clip in point'],
  ['O', 'Set clip out point'],
  ['M', 'Mute / unmute'],
  ['Ctrl K', 'Command palette'],
  ['Ctrl Z', 'Undo'],
  ['Ctrl Shift Z', 'Redo'],
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
  // The video the selected clip cuts from: what plays, is transcribed, and is exported.
  const m = mediaOf(p, cut);
  const [page, setPage] = useState<Page>('Clip editor'),
    [modal, setModal] = useState<Modal>(null),
    [tab, setTab] = useState<'file' | 'url'>('file'),
    // Where an import goes: a new project, or another video in the open one.
    [into, setInto] = useState<'new' | 'project'>('new'),
    [doomedVideo, setDoomedVideo] = useState<Video | null>(null);
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
  const [snap, setSnap] = useState<TrimSnap>(() => {
    const saved = readSaved<unknown>('trimSnap', null);
    if (saved === 'words' || saved === 'frames' || saved === 'off') return saved;
    return readSaved<boolean>('frameSnap', false) ? 'frames' : 'off';
  });
  const [progress, setProgress] = useState(0),
    [speed, setSpeed] = useState(1);
  const [doomed, setDoomed] = useState<Project | null>(null);
  // Each desktop project's transcript once read or made, and how the making goes until then.
  const [transcripts, setTranscripts] = useState<Record<string, Transcript>>({}),
    [transcribing, setTranscribing] = useState<Record<string, TranscriptStatus>>({});
  const asked = useRef(new Set<string>());
  // Finding faces for a clip (src-tauri faces.rs), by clip id, while it runs or after it fails.
  const [faceJobs, setFaceJobs] = useState<Record<string, FaceStatus>>({});
  // Each project's undo stack (history.ts): quick successive changes, such as a drag, are one step.
  const stacks = useRef(new Map<string, EditStack<Project>>());
  const closing = useRef<number | undefined>(undefined);
  const [, setHistoryTick] = useState(0);
  const [lookSaved, setLookSaved] = useState(() => readLook() !== null);
  const [palette, setPalette] = useState(false);
  const [lookName, setLookName] = useState(() => readLook()?.name);
  const [ownLooks, setOwnLooks] = useState<NamedLook[]>(readLooks);
  const allLooks = useMemo(() => [...BUILT_IN_LOOKS, ...ownLooks], [ownLooks]);
  const [panel, setPanel] = useState<InspectorPanel>('clips');
  // The assistant's conversation, by project, and post copy being written.
  const [turns, setTurns] = useState<Record<string, (Turn & { edits?: number })[]>>({});
  const [assisting, setAssisting] = useState(false);
  const [postWriting, setPostWriting] = useState(false);
  const [safeAreas, setSafeAreas] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchShapes, setBatchShapes] = useState<Shape[]>([]);
  // Batch exports as separate files, or the clips joined into one video.
  const [joined, setJoined] = useState(false);
  const [transition, setTransition] = useState<Transition>('cut');
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
  const savedProjects = useRef(projects);
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
      if (savedProjects.current !== projects) {
        releaseUnusedCutMedia(savedProjects.current, projects);
        savedProjects.current = projects;
      }
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [projects, active, entries]);
  useEffect(() => {
    try {
      localStorage.setItem('quikclip.1.trimSnap', JSON.stringify(snap));
    } catch {
      // The toggle still works for the session when storage is unavailable.
    }
  }, [snap]);
  useEffect(() => {
    // `undefined` means the waveform has not been drawn yet (a new import, or one closed early).
    if (!desktop || m.wave !== undefined) return;
    const id = m.id;
    void drawWave(id).then((wave) => {
      if (wave !== undefined) setProjects((prev) => prev.map((x) => withMedia(x, id, { wave })));
    });
  }, [m.id, m.wave]);
  useEffect(() => {
    // Every imported video is transcribed: read when made, else made now, once per session.
    if (!desktop || m.id === 'sample' || transcripts[m.id] || asked.current.has(m.id)) return;
    asked.current.add(m.id);
    const id = m.id;
    invoke<Transcript | null>('read_transcript', { id })
      .then((found) => {
        if (found) setTranscripts((prev) => ({ ...prev, [id]: found }));
        else void transcribe(id);
      })
      .catch(() => void transcribe(id));
    // Once per video: `transcribe` and the maps are read fresh inside.
  }, [m.id]);
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
    if (m.id === 'sample' || desktop) setSrc(asset(m, m.path) ?? '');
    else
      browserBlob(m.id)
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
  }, [m.id, m.path]);
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
    scanCut(m, cut, controller.signal)
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
  }, [cut.pauses, cut.start, cut.end, cut.id, m.id]);
  const transcript = transcripts[m.id];
  const heard = useMemo(
    () => (transcript ? correctedWords(transcript.words, m.fixes) : []),
    [transcript, m.fixes],
  );
  // What the preview skips: the marked pauses, and the clip's ums when those are cut too (polish.ts).
  const fillerSpans = useMemo(
    () => (cut.fillers === true ? fillerRanges(heard, cut.start, cut.end) : []),
    [cut.fillers, heard, cut.start, cut.end],
  );
  const skipSpans = useMemo(
    () =>
      mergeSpans([
        ...(cutPauses(cut) && pausePlan
          ? pausePlan.cuts.map((item): [number, number] => [item.start, item.end])
          : []),
        ...fillerSpans,
      ]),
    [cut.pauses, pausePlan, fillerSpans],
  );
  const skipped = spanSeconds(skipSpans);
  skips.current = skipSpans.map(([start, end]) => ({ start, end }));
  const punchSpans = useMemo(
    () => (cut.punch === true ? punchRanges(heard, cut.start, cut.end) : []),
    [cut.punch, heard, cut.start, cut.end],
  );
  const clipWords = useMemo(
    () => heard.filter((word) => word.end > cut.start && word.start < cut.end),
    [heard, cut.start, cut.end],
  );
  syncMusic.current = (videoEl, playing) => {
    const audio = musicEl.current;
    const track = cutMusic(cut);
    const mix = track ? musicMix(track, track.duration) : null;
    videoEl.volume = mix?.source_volume ?? 1;
    if (!audio || !track || !mix) return;
    audio.muted = muted;
    audio.loop = mix.loop;
    const pace = cutSpeed(cut);
    const rate = videoEl.playbackRate;
    if (pace === 1) {
      if (Number.isFinite(rate) && rate > 0) audio.playbackRate = rate;
    } else if (Number.isFinite(rate) && rate > 0) {
      audio.playbackRate = rate / pace;
    }
    const marks = skips.current;
    const removed = skipped;
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
    // Music set to dip under speech plays lower while someone talks, as the export's sidechain does.
    audio.volume =
      state.volume * (mix.duck && speakingAt(clipWords, videoEl.currentTime) ? 0.35 : 1);
    if (Math.abs(audio.currentTime - state.position) > (audio.paused ? 0.01 : 0.15)) {
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
  }, [src, musicUrl, muted, cut.id, cut.music, cut.start, cut.end, cut.speed, pausePlan]);
  useEffect(() => {
    const videoEl = video.current;
    if (videoEl) videoEl.playbackRate = speed * cutSpeed(cut);
  }, [speed, cut.speed]);
  useEffect(() => {
    if (!playing || !skipSpans.length) return;
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
  }, [playing, skipSpans, cut.end]);
  function edit(fn: (old: Project) => Project) {
    const next = fn(p);
    // Choosing a clip is not an edit to undo.
    const changed = (Object.keys(next) as (keyof Project)[]).some(
      (key) => key !== 'selected' && next[key] !== p[key],
    );
    if (changed) remember(p);
    setProjects((prev) => prev.map((s) => (s.id === p.id ? fn(s) : s)));
  }
  function remember(before: Project) {
    const stack = stacks.current.get(before.id) ?? emptyStack<Project>();
    stacks.current.set(before.id, noteEdit(stack, before, true));
    window.clearTimeout(closing.current);
    closing.current = window.setTimeout(() => {
      const open = stacks.current.get(before.id);
      if (open) stacks.current.set(before.id, closeEdit(open));
    }, 700);
    setHistoryTick((n) => n + 1);
  }
  function travel(direction: 'undo' | 'redo') {
    const stack = stacks.current.get(p.id);
    const step = stack && (direction === 'undo' ? undoEdit(stack, p) : redoEdit(stack, p));
    if (!step) return;
    window.clearTimeout(closing.current);
    stacks.current.set(p.id, step.stack);
    setProjects((prev) => prev.map((s) => (s.id === p.id ? step.value : s)));
    setHistoryTick((n) => n + 1);
    setToast(direction === 'undo' ? 'Undone' : 'Redone');
  }
  const canUndo = (stacks.current.get(p.id)?.past.length ?? 0) > 0;
  const canRedo = (stacks.current.get(p.id)?.future.length ?? 0) > 0;
  /** Faces in the selected clip, for the calm camera. The samples land on that clip even if another is chosen meanwhile. */
  async function findFaces(speaker = cutFraming(cut) === 'speaker') {
    const target = { project: p.id, media: m.id, cut: cut.id, start: cut.start, end: cut.end };
    setFaceJobs((prev) => ({ ...prev, [target.cut]: { state: 'working' } }));
    try {
      const samples = await invoke<FaceSample[]>('find_faces', {
        id: target.media,
        start: target.start,
        end: target.end,
        speaker,
      });
      setProjects((prev) =>
        prev.map((x) =>
          x.id !== target.project
            ? x
            : {
                ...x,
                cuts: x.cuts.map((c) =>
                  c.id === target.cut
                    ? { ...c, faces: { start: target.start, end: target.end, samples, speaker } }
                    : c,
                ),
              },
        ),
      );
      setFaceJobs(({ [target.cut]: _, ...rest }) => rest);
    } catch (e) {
      setFaceJobs((prev) => ({ ...prev, [target.cut]: { state: 'error', text: errorText(e) } }));
    }
  }
  function applyNamedLook(item: NamedLook) {
    const styled = applyLook(cut, item.look);
    update(styled);
    setToast(`Applied the look “${item.name}”`);
    // A look that follows faces finds them, where the system face detector is.
    const framing = cutFraming(styled);
    if (
      (framing === 'faces' || framing === 'speaker') &&
      desktop &&
      /windows/i.test(navigator.userAgent) &&
      (!styled.faces || (framing === 'speaker' && !styled.faces.speaker)) &&
      !faceJobs[cut.id]
    )
      void findFaces(framing === 'speaker');
  }
  /** Everything the command palette can do, in the order it lists them before a search. */
  function commands(): Command[] {
    const editing = page === 'Clip editor';
    const toggle = (
      id: string,
      label: string,
      on: boolean,
      change: Partial<Cut>,
      keywords = '',
    ): Command => ({
      id,
      label: `${on ? 'Turn off' : 'Turn on'} ${label}`,
      group: 'Clip',
      keywords,
      disabled: !editing,
      run: () => update(change),
    });
    return [
      { id: 'export', label: 'Export clip', group: 'Studio', run: () => open('export') },
      {
        id: 'import',
        label: 'Import media',
        group: 'Studio',
        run: () => {
          setInto('new');
          open('import');
        },
      },
      {
        id: 'add-video',
        label: 'Add a video to this project',
        group: 'Studio',
        keywords: 'import media source another',
        disabled: (p.videos?.length ?? 0) + 1 >= MAX_VIDEOS,
        run: addVideo,
      },
      ...projectVideos(p).map((v, index) => ({
        id: `video-${v.id}`,
        label: `Show video ${index + 1}: ${v.title}`,
        group: 'Videos',
        keywords: 'source switch',
        disabled: !editing || v.id === m.id || !p.videos?.length,
        run: () => showVideo(v),
      })),
      {
        id: 'highlights',
        label: 'Find highlights',
        group: 'Studio',
        keywords: 'ai suggest moments',
        run: () => open('ai'),
      },
      { id: 'add', label: 'Add clip', group: 'Clip', disabled: !editing, run: addCut },
      {
        id: 'add-text',
        label: 'Add text at the playhead',
        group: 'Clip',
        keywords: 'title label caption overlay',
        disabled: !editing || cutTexts(cut).length >= 8,
        run: () => update({ texts: [...cutTexts(cut), newText(cut, time)] }),
      },
      { id: 'duplicate', label: 'Duplicate clip', group: 'Clip', run: duplicate },
      {
        id: 'remove',
        label: 'Remove clip',
        group: 'Clip',
        keywords: 'delete',
        disabled: p.cuts.length === 1,
        run: remove,
      },
      {
        id: 'undo',
        label: 'Undo',
        group: 'Edit',
        hint: 'Ctrl Z',
        disabled: !canUndo,
        run: () => travel('undo'),
      },
      {
        id: 'redo',
        label: 'Redo',
        group: 'Edit',
        hint: 'Ctrl Shift Z',
        disabled: !canRedo,
        run: () => travel('redo'),
      },
      { id: 'play', label: 'Play or pause', group: 'Playback', hint: 'Space', run: play },
      {
        id: 'safe',
        label: safeAreas ? 'Hide safe areas' : 'Show safe areas',
        group: 'Playback',
        disabled: !guide,
        run: () => setSafeAreas((on) => !on),
      },
      {
        id: 'panel',
        label: panel === 'clips' ? 'Show the transcript' : 'Show the clips',
        group: 'Studio',
        run: () => setPanel(panel === 'clips' ? 'transcript' : 'clips'),
      },
      {
        id: 'assistant',
        label: 'Ask the assistant',
        group: 'Studio',
        keywords: 'ai chat edit help',
        disabled: panel === 'assistant',
        run: () => setPanel('assistant'),
      },
      ...(Object.keys(FRAME_PRESETS) as Shape[]).map((shape) => ({
        id: `frame-${shape}`,
        label: `Frame: ${FRAME_PRESETS[shape].label}`,
        group: 'Clip',
        keywords: `${FRAME_PRESETS[shape].name} aspect ratio output`,
        disabled: !editing || cut.shape === shape,
        run: () => update({ shape }),
      })),
      ...(
        [
          ['fill', 'Fill the frame'],
          ['blur', 'Show the whole video'],
          ['split', 'Split: face on top'],
        ] as const
      ).map(([fit, label]) => ({
        id: `fit-${fit}`,
        label,
        group: 'Clip',
        keywords: 'fit layout crop',
        disabled:
          !editing ||
          cut.shape === 'source' ||
          cutFit(cut) === fit ||
          (fit === 'split' && cut.shape !== 'vertical' && cut.shape !== 'portrait'),
        run: () => update({ fit }),
      })),
      toggle(
        'pauses',
        'cut out pauses',
        cutPauses(cut),
        { pauses: cutPauses(cut) ? undefined : true },
        'silence',
      ),
      toggle(
        'fillers',
        'cut ums and fillers',
        cut.fillers === true,
        { fillers: cut.fillers ? undefined : true },
        'um uh filler words',
      ),
      toggle(
        'punch',
        'punch-in zooms',
        cut.punch === true,
        { punch: cut.punch ? undefined : true },
        'zoom jump cut',
      ),
      toggle('voice', 'clearer voice', cutVoice(cut), { voice: !cutVoice(cut) }, 'audio rumble'),
      ...CAPTION_STYLES.map((style) => ({
        id: `captions-${style.value}`,
        label: `Captions: ${style.label}`,
        group: 'Clip',
        keywords: 'subtitles style',
        disabled: !editing || captions.style === style.value,
        run: () => update({ captions: { ...captions, style: style.value } }),
      })),
      ...allLooks.map((item) => ({
        id: `look-${item.id}`,
        label: `Apply look: ${item.name}`,
        group: 'Looks',
        keywords: 'template preset style',
        disabled: !editing,
        run: () => applyNamedLook(item),
      })),
      ...p.cuts.map((item, index) => ({
        id: `clip-${item.id}`,
        label: `Go to clip ${String(index + 1).padStart(2, '0')}: ${item.title}`,
        group: 'Clips',
        disabled: !editing || item.id === cut.id,
        run: () => select(item),
      })),
      ...projects.map((item) => ({
        id: `project-${item.id}`,
        label: `Open project: ${item.title}`,
        group: 'Projects',
        disabled: item.id === p.id,
        run: () => choose(item),
      })),
      ...(['Clip editor', 'Media library', 'Exports'] as const).map((to) => ({
        id: `page-${to}`,
        label: `Go to ${to}`,
        group: 'Pages',
        disabled: page === to,
        run: () => navigate(to),
      })),
      {
        id: 'keys',
        label: 'Keyboard shortcuts',
        group: 'Help',
        hint: '?',
        run: () => open('keys'),
      },
      { id: 'guide', label: 'Studio guide', group: 'Help', run: () => open('guide') },
    ];
  }
  /** A short name for a clip's video in the bin, when the project has more than one. */
  function videoLabel(item: Cut) {
    if (!p.videos?.length) return null;
    const at = projectVideos(p).findIndex((v) => v.id === mediaOf(p, item).id);
    return `V${at + 1}`;
  }
  /** Shows a video: its first clip, or a new clip at its start when it has none. */
  function showVideo(v: Video) {
    const main = v.id === p.id;
    const first = p.cuts.find((c) => mediaOf(p, c).id === v.id);
    video.current?.pause();
    if (first) {
      select(first);
      return;
    }
    const c: Cut = applyLook(
      {
        id: newId(),
        title: v.title.slice(0, 64) || 'New clip',
        start: 0,
        end: Math.min(v.duration, 15),
        shape: 'source',
        fit: 'fill',
        voice: true,
        ...(main ? {} : { video: v.id }),
      },
      readLook(),
    );
    edit((s) => ({ ...s, cuts: [...s.cuts, c], selected: c.id }));
  }
  function addVideo() {
    setInto('project');
    open('import');
  }
  /** Removes an added video, its clips, and the copy Quikclip made of it. */
  async function removeVideo(v: Video) {
    await action('Removing video…', async () => {
      video.current?.pause();
      const kept = p.cuts.filter((c) => mediaOf(p, c).id !== v.id);
      const fallback: Cut = {
        id: newId(),
        title: 'First cut',
        start: 0,
        end: Math.min(p.duration, 15),
        shape: 'source',
        fit: 'fill',
        voice: true,
      };
      const cuts = kept.length ? kept : [fallback];
      const selected = cuts.some((c) => c.id === p.selected) ? p.selected : cuts[0].id;
      edit((s) => ({
        ...s,
        videos: (s.videos ?? []).filter((item) => item.id !== v.id),
        cuts: s.cuts.filter((c) => mediaOf(s, c).id !== v.id).length
          ? s.cuts.filter((c) => mediaOf(s, c).id !== v.id)
          : cuts,
        selected,
      }));
      // Let the player let go of the editing copy before it is deleted.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await deleteProjectMedia(v.id);
      setModal(null);
      setDoomedVideo(null);
      setToast(`Removed “${v.title}” from this project`);
    });
  }
  /** Why the AI features can't run here, if they can't: the browser, or no model chosen yet. */
  const aiBlocked = !desktop
    ? 'This runs in the Quikclip desktop app.'
    : !suggestionModel()
      ? 'Choose a model in Highlight finder first.'
      : null;
  /** The assistant reads the project and transcript, answers, and its edits apply as one undo step. */
  async function askAssistant(instruction: string) {
    const linked = suggestionModel();
    if (!linked) return;
    const id = p.id;
    const history = turns[id] ?? [];
    setTurns((prev) => ({ ...prev, [id]: [...history, { role: 'user', text: instruction }] }));
    setAssisting(true);
    try {
      const answer = await invoke<string>('ask_assistant', {
        connection: linked.connection,
        model: linked.model,
        instruction,
        context: assistantContext(p, cut, transcript?.segments ?? [], allLooks),
        history: history.map(({ role, text }) => ({ role, text })),
      });
      const { reply, ops } = parseAssistant(answer);
      const result = applyOps(p, ops, allLooks, m.id);
      if (result.applied) edit(() => result.project);
      const skipped = result.skipped.length ? ` Skipped ${result.skipped.join('; ')}.` : '';
      setTurns((prev) => ({
        ...prev,
        [id]: [
          ...(prev[id] ?? []),
          { role: 'assistant', text: `${reply}${skipped}`, edits: result.applied },
        ],
      }));
    } catch (e) {
      setTurns((prev) => ({
        ...prev,
        [id]: [...(prev[id] ?? []), { role: 'assistant', text: errorText(e) }],
      }));
    } finally {
      setAssisting(false);
    }
  }
  /** Post copy for the selected clip, from what it says, kept on the clip. */
  async function writePosts(platforms: Platform[], tone: Tone) {
    const linked = suggestionModel();
    if (!linked) return;
    const target = cut.id;
    setPostWriting(true);
    try {
      const posts = await invoke<Post[]>('write_post_copy', {
        connection: linked.connection,
        model: linked.model,
        clip: {
          title: cut.title,
          hook: cut.headline ?? '',
          transcript: clipWords.map((word) => word.text).join(' '),
          language: transcript?.language ?? null,
        },
        platforms,
        tone,
      });
      edit((s) => ({
        ...s,
        cuts: s.cuts.map((item) => (item.id === target ? { ...item, posts } : item)),
      }));
    } catch (e) {
      setToast(errorText(e));
    } finally {
      setPostWriting(false);
    }
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
        ? transcriptText(m.title, readingLines(transcript, m.fixes))
        : toSrt(paceCues(buildCues(heard, 0, m.duration), m.duration));
    try {
      const saved = await invoke<string | null>('save_text', {
        name: kind === 'txt' ? `${m.title} transcript` : m.title,
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
    const read = transcripts[m.id]?.words[index]?.text;
    const value = text.replace(/\s+/g, ' ').trim().slice(0, 64);
    const media = m.id;
    edit((s) => {
      const fixes = { ...(projectVideos(s).find((item) => item.id === media)?.fixes ?? {}) };
      if (value === read) delete fixes[index];
      else fixes[index] = value;
      return withMedia(s, media, { fixes });
    });
  }
  function seek(n: number) {
    const t = clamp(n, 0, m.duration);
    if (video.current?.readyState) video.current.currentTime = t;
    setTime(t);
  }
  function trim(k: 'start' | 'end', n: number, motion?: TrimMotion) {
    const min = k === 'start' ? 0 : Math.min(m.duration, cut.start + MIN_CLIP);
    const max = k === 'start' ? Math.max(0, cut.end - MIN_CLIP) : m.duration;
    const mode = motion && !motion.free ? snap : 'off';
    const fps = mode === 'frames' && Number.isFinite(m.fps) && m.fps > 0 ? m.fps : 0;
    const at = n + (motion?.step ?? 0) * (fps ? 1 / fps : 0.1);
    const t =
      mode === 'words' && edges[k].length
        ? trimToWord(edges[k], n, min, max, motion?.step)
        : // The actual end stays reachable even if it isn't on the frame grid.
          k === 'end' && at >= m.duration
          ? m.duration
          : trimTime(at, min, max, fps);
    update({ [k]: t });
    video.current?.pause();
    seek(t);
    return t;
  }
  function select(c: Cut) {
    video.current?.pause();
    edit((s) => ({ ...s, selected: c.id }));
    seek(c.start);
  }
  function addCut() {
    const start = trimTime(time, 0, m.duration - MIN_CLIP, 0),
      c: Cut = {
        id: newId(),
        title: `Clip ${String(p.cuts.length + 1).padStart(2, '0')}`,
        start,
        end: Math.min(m.duration, round(start + 10)),
        shape: 'source',
        fit: 'fill',
        voice: true,
        ...(m.id !== p.id ? { video: m.id } : {}),
      };
    const styled = applyLook(c, readLook());
    edit((s) => ({ ...s, selected: styled.id, cuts: [...s.cuts, styled] }));
    setToast('Clip added to the bin');
  }
  function duplicate() {
    const id = newId();
    video.current?.pause();
    edit((s) => {
      const index = s.cuts.findIndex((c) => c.id === cut.id);
      if (index === -1) return s;
      const original = s.cuts[index];
      const titles = new Set(s.cuts.map((c) => c.title));
      let number = 1;
      let title: string;
      do {
        const suffix = number === 1 ? ' (copy)' : ` (copy ${number})`;
        title = `${original.title.slice(0, 64 - suffix.length).trimEnd()}${suffix}`;
        number++;
      } while (titles.has(title));
      const copy = { ...structuredClone(original), id, title };
      const cuts = [...s.cuts];
      cuts.splice(index + 1, 0, copy);
      return { ...s, cuts, selected: id };
    });
    setToast('Clip duplicated');
  }
  function remove() {
    const next = p.cuts.find((c) => c.id !== cut.id);
    if (!next) return;
    video.current?.pause();
    edit((s) => ({
      ...s,
      cuts: s.cuts.filter((c) => c.id !== cut.id),
      selected: next.id,
    }));
    seek(next.start);
  }
  function open(m: Modal) {
    video.current?.pause();
    setError('');
    if (m === 'export') {
      setBatchIds([cut.id]);
      setBatchShapes([cut.shape]);
    }
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
      for (const item of projectVideos(q)) await deleteProjectMedia(item.id);
      setProjects((latest) => latest.filter((x) => x.id !== q.id));
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
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!modal) setPalette((on) => !on);
        return;
      }
      if (palette) return;
      const typing = (e.target as HTMLElement)?.closest(
        'input,select,textarea,[contenteditable=true]',
      );
      if (!modal && !typing && page === 'Clip editor' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const letter = e.key.toLowerCase();
        if (letter === 'z' || letter === 'y') {
          e.preventDefault();
          travel(letter === 'y' || e.shiftKey ? 'redo' : 'undo');
          return;
        }
      }
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
      if (e.code === 'KeyI') trim('start', time, {});
      if (e.code === 'KeyO') trim('end', time, {});
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !(e.target as HTMLElement)?.closest('.handle')
      ) {
        e.preventDefault();
        video.current?.pause();
        seek(time + (e.key === 'ArrowLeft' ? -1 : 1) / (m.fps || 30));
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
        const look = readLook();
        if (into === 'project') {
          const added: Video = {
            id: q.id,
            title: q.title,
            source: q.source,
            path: q.path,
            duration: q.duration,
            width: q.width,
            height: q.height,
            fps: q.fps,
            frames: q.frames,
            wave: q.wave,
            poster: q.poster,
          };
          const first = applyLook(
            { ...q.cuts[0], title: q.title.slice(0, 64) || 'New video', video: q.id },
            look,
          );
          edit((s) => ({
            ...s,
            videos: [...(s.videos ?? []), added],
            cuts: [...s.cuts, first],
            selected: first.id,
          }));
          navigate('Clip editor');
          setModal(null);
          setUrl('');
          setInto('new');
          setToast(`Added “${q.title}” to this project`);
          return;
        }
        const styled = { ...q, cuts: q.cuts.map((c) => applyLook(c, look)) };
        setProjects((prev) => [...prev, styled]);
        choose(styled);
        setModal(null);
        setUrl('');
        setToast('Media imported');
      },
    );
  }
  async function analyze(connection: Connection, model: string, options: HighlightOptions) {
    await action('Preparing highlight search…', async () => {
      if (!desktop) throw Error('Open the desktop app to connect your AI provider.');
      const results = await invoke<
        (Pick<Cut, 'start' | 'end' | 'title' | 'highlight'> & { hook?: string })[]
      >('find_highlights', {
        id: m.id,
        connection,
        model,
        options,
      });
      if (!results.length)
        throw Error(
          'No usable highlights were found. Try different options or trim a clip by hand.',
        );
      const look = readLook();
      const clips: Cut[] = results.map(({ hook, ...c }) =>
        applyLook(
          {
            ...c,
            // The review's hook line opens the clip as its headline.
            ...(hook ? { headline: hook.slice(0, HEADLINE_MAX) } : {}),
            id: newId(),
            shape: 'source',
            fit: 'fill',
            voice: true,
            ...(m.id !== p.id ? { video: m.id } : {}),
          },
          look,
        ),
      );
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
      const track = cutMusic(cut);
      const mark = cutLogo(cut);
      const path = desktop
        ? await invoke<string | null>('export_clip', {
            id: m.id,
            title: cut.title,
            start: cut.start,
            end: cut.end,
            shape: cut.shape,
            fit: cutFit(cut),
            ...exportFraming(cut, m.width, m.height),
            loudness: loudnessLufs(cut),
            drops: fromStart(fillerSpans, cut.start),
            zooms: fromStart(punchSpans, cut.start),
            broll: brollRequest(cutBroll(cut, projectVideos(p))),
            texts: textsRequest(cutTexts(cut)),
            headline: (await headlinePng(pixels.width, pixels.height, cut.headline ?? '')) ?? '',
            voice: cutVoice(cut),
            music: track?.source ?? '',
            musicMix: track ? musicMix(track, track.duration) : null,
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
        : await exportWeb(
            src,
            m,
            { ...cut, crop: framedCrop(cut, m.width, m.height) },
            controller.signal,
            setProgress,
          );
      if (!path) return;
      setEntries((prev) => [
        {
          id: newId(),
          title: cut.title,
          path,
          duration: playedLength(cut.end - cut.start, skipped, cutSpeed(cut)),
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
  async function clipRequest(item: Cut, shape: Shape) {
    const im = mediaOf(p, item);
    const transcript = transcripts[im.id];
    const heard = transcript ? correctedWords(transcript.words, im.fixes) : [];
    const frame = cropFrame({ shape, crop: item.crop }, im.width, im.height);
    const size = desktop ? frame : browserFrame(frame);
    const caps = cutCaptions(item);
    const lines = presentCues(
      buildCues(captionWords(heard, caps), item.start, item.end),
      caps.translation,
      item.start,
    );
    const top =
      caps.style !== 'none'
        ? captionTop(
            size.width,
            size.height,
            caps.style,
            headlineBottom(size.width, size.height, item.headline ?? ''),
            headlineSpec(size.width, size.height).fontSize,
          )
        : 0;
    const track = cutMusic(item);
    const mark = cutLogo(item);
    return {
      title: item.title,
      start: item.start,
      end: item.end,
      shape,
      fit: cutFit({ ...item, shape }),
      ...exportFraming({ ...item, shape }, im.width, im.height),
      video: im.id,
      loudness: loudnessLufs(item),
      drops: item.fillers ? fromStart(fillerRanges(heard, item.start, item.end), item.start) : [],
      zooms: item.punch ? fromStart(punchRanges(heard, item.start, item.end), item.start) : [],
      broll: brollRequest(cutBroll(item, projectVideos(p))),
      texts: textsRequest(cutTexts(item)),
      headline: (await headlinePng(size.width, size.height, item.headline ?? '')) ?? '',
      voice: cutVoice(item),
      music: track?.source ?? '',
      musicMix: track ? musicMix(track, track.duration) : null,
      pauses: cutPauses(item),
      logo: mark?.source ?? '',
      corner: mark?.corner ?? '',
      speed: cutSpeed(item),
      captions:
        caps.style !== 'none' && lines.length
          ? JSON.stringify({
              cues: lines,
              style: caps.style,
              position: caps.position,
              color: caps.color,
              highlight: caps.highlight,
              top: caps.position === 'top' ? top : null,
              language: transcript?.language ?? null,
            })
          : '',
    };
  }
  /** The selected clips, in bin order, as one video between the project's opening shot and end card. */
  async function exportingJoined(shape: Shape) {
    await action('Rendering and joining your clips…', async () => {
      const ordered = p.cuts.filter((item) => batchIds.includes(item.id));
      const requests = [];
      for (const item of ordered) requests.push(await clipRequest(item, shape));
      if (!requests.length) return;
      const intro = p.bookends?.intro;
      const outro = p.bookends?.outro;
      const path = await invoke<string | null>('export_joined', {
        id: p.id,
        requests,
        transition,
        intro: intro?.path ?? null,
        outro: outro?.path ?? null,
      });
      if (!path) return;
      const parts = ordered.length + Number(!!intro) + Number(!!outro);
      const length =
        ordered.reduce((sum, item) => sum + (item.end - item.start) / cutSpeed(item), 0) +
        (intro?.duration ?? 0) +
        (outro?.duration ?? 0) -
        (transition === 'cut' ? 0 : 0.5 * (parts - 1));
      setEntries((prev) => [
        {
          id: newId(),
          title: `${ordered[0]?.title ?? 'Clips'}${ordered.length > 1 ? ` + ${ordered.length - 1} more` : ''}`,
          path,
          duration: Math.max(0, length),
          date: new Date().toISOString(),
          project: p.title,
        },
        ...prev,
      ]);
      setModal(null);
      setToast(
        `${ordered.length} ${ordered.length === 1 ? 'clip' : 'clips'} joined into one video`,
      );
    });
  }
  /** Chooses, or clears, the project's opening shot or end card. */
  async function setBookend(end: 'intro' | 'outro', add: boolean) {
    try {
      const picked = add ? await invoke<Bookend | null>('pick_bookend') : null;
      if (add && !picked) return;
      edit((s) => ({
        ...s,
        bookends: { ...(s.bookends ?? {}), [end]: picked ?? undefined },
      }));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function exportingBatch(jobs: ExportJob[]) {
    await action('Rendering your clips…', async () => {
      const requests = [];
      for (const job of jobs) {
        const item = p.cuts.find((entry) => entry.id === job.id);
        if (item) requests.push(await clipRequest(item, job.shape));
      }
      if (!requests.length) return;
      const report = await invoke<{
        folder: string | null;
        total: number;
        outputs: {
          title: string;
          path: string;
          duration: number;
          warning?: string | null;
        }[];
        failures: { title: string; error: string }[];
        cancelled: boolean;
      } | null>('export_batch', { id: p.id, requests });
      if (!report) return;
      if (!report.outputs.length) {
        if (report.cancelled) return;
        throw Error(report.failures[0]?.error || 'Nothing was exported.');
      }
      const savedAt = new Date().toISOString();
      setEntries((prev) => [
        ...report.outputs.map((output) => ({
          id: newId(),
          title: output.title,
          path: output.path,
          duration: output.duration,
          date: savedAt,
          project: p.title,
        })),
        ...prev,
      ]);
      setModal(null);
      const failed = report.failures.length;
      const done = report.cancelled
        ? `Stopped after ${report.outputs.length} of ${report.total} files`
        : failed
          ? `${report.outputs.length} exported, ${failed} failed`
          : `${report.outputs.length} clips exported to one folder`;
      const warning = report.outputs.find((output) => output.warning)?.warning;
      setToast(warning ? `${done}. ${warning}` : done);
    });
  }
  const following = ['faces', 'speaker'].includes(cutFraming(cut));
  const placed = framedCrop(cut, m.width, m.height, time - cut.start);
  const crop = cropFrame({ shape: cut.shape, crop: placed }, m.width, m.height);
  const split = cut.shape !== 'source' && cutFit(cut) === 'split';
  const band = cropBox(cut, m.width, m.height);
  const view = split ? cropRect(band, placed, m.width, m.height) : crop;
  const punched = within(punchSpans, time);
  const pixels = desktop ? crop : browserFrame(crop);
  const ratio = pixels.width / pixels.height;
  const blur = cut.shape !== 'source' && cutFit(cut) === 'blur';
  const cropped = cut.shape !== 'source' && !blur;
  const cropStyle = cropped
    ? {
        width: `${(m.width / view.width) * 100}%`,
        height: `${(m.height / view.height) * 100}%`,
        left: `${(-view.left / view.width) * 100}%`,
        top: `${(-view.top / view.height) * 100}%`,
        ...(following && playing ? { transition: 'left 0.25s linear, top 0.25s linear' } : {}),
      }
    : undefined;
  const music = cutMusic(cut);
  const logo = cutLogo(cut);
  const logoBox = logo
    ? logoFit(pixels.width, pixels.height, logo.width, logo.height, logo.corner)
    : null;
  const headline = headlineText(cut.headline);
  const head = headlineSpec(pixels.width, pixels.height);
  const edges = useMemo(() => wordEdges(heard), [heard]);
  const captions = cutCaptions(cut);
  // `captions` is rebuilt from cut.captions on every render, so the memos follow the stored value.
  const captionSource = useMemo(
    () => captionWords(heard, captions).filter((word) => !(cut.fillers && isFiller(word.text))),
    [heard, cut.captions, cut.fillers],
  );
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
    : m.id === 'sample'
      ? {
          state: 'unavailable',
          text: 'The sample has no transcript. Import a video to transcribe it.',
        }
      : (transcribing[m.id] ?? null);
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
          headlineBottom(pixels.width, pixels.height, cut.headline),
          head.fontSize,
        )
      : 0;
  const lines = headlineLines(headline, head.columns);
  const projectIndex = String(projects.indexOf(p) + 1).padStart(2, '0');
  const poster = asset(m, m.poster) ?? frame(m, 0);
  const preset = FRAME_PRESETS[cut.shape] ?? FRAME_PRESETS.source;
  const guide = safeInsets(cut.shape);
  const jobs = exportJobs(p.cuts, batchIds, batchShapes);
  const sameExport = jobs.length === 1 && jobs[0].id === cut.id && jobs[0].shape === cut.shape;
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
        onImport={() => {
          setInto('new');
          open('import');
        }}
        onExport={() => open('export')}
        history={{
          canUndo,
          canRedo,
          undo: () => travel('undo'),
          redo: () => travel('redo'),
        }}
        onShortcuts={() => open('keys')}
        onCommands={() => setPalette(true)}
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
                      {m.source === 'Sample' ? 'Sample project' : m.source}
                    </span>
                    <VideoMenu
                      p={p}
                      current={m.id}
                      choose={showVideo}
                      add={addVideo}
                      remove={(v) => {
                        setDoomedVideo(v);
                        open('video');
                      }}
                      full={(p.videos?.length ?? 0) + 1 >= MAX_VIDEOS}
                    />
                  </div>
                  <h1 title={p.title}>{p.title}</h1>
                </div>
                <div className="metadata" role="group" aria-label="Source details">
                  <span title="Source duration">
                    <Clock3 size={14} />
                    {clock(m.duration)}
                  </span>
                  <span title="Source resolution">
                    {m.width} × {m.height}
                  </span>
                  {m.fps > 0 && <span>{Math.round(m.fps * 100) / 100} fps</span>}
                </div>
              </header>
              <section className="monitor" ref={monitor} aria-labelledby="monitor-title">
                <div className="panel-heading">
                  <h2 id="monitor-title">
                    <ScanLine />
                    Source monitor
                  </h2>
                  <span className="monitor-format" title="Preview output frame">
                    <span>{preset.label}</span>
                    {pixels.width} × {pixels.height}
                    <button
                      type="button"
                      className={`safe-toggle${safeAreas ? ' active' : ''}`}
                      aria-pressed={safeAreas}
                      aria-label="Safe areas"
                      disabled={!guide}
                      title={
                        guide ? guide.label : 'Safe areas apply once the clip has an output frame'
                      }
                      onClick={() => setSafeAreas((on) => !on)}
                    >
                      Safe areas
                    </button>
                  </span>
                </div>
                <div className="screen" onDoubleClick={toggleFullscreen}>
                  {src && (
                    <div
                      className={`stage${blur ? ' blur-fill' : cropped ? ' crop-fill' : ''}${split ? ' split-fill' : ''}`}
                      style={{
                        width: `min(100cqw, ${ratio * 100}cqh)`,
                        height: `min(100cqh, ${100 / ratio}cqw)`,
                      }}
                    >
                      <div
                        className={`stage-media${punched ? ' punched' : ''}`}
                        data-punched={punched || undefined}
                      >
                        {blur && (
                          <img className="blur-plate" alt="" src={frame(m, time) ?? poster} />
                        )}
                        <div
                          className="stage-face"
                          style={
                            split ? { height: `${(band.height / crop.height) * 100}%` } : undefined
                          }
                        >
                          <video
                            key={src}
                            ref={video}
                            src={src}
                            style={cropStyle}
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
                        </div>
                        {split && (
                          <div
                            className="stage-whole"
                            style={{ top: `${(band.height / crop.height) * 100}%` }}
                          >
                            <img className="blur-plate" alt="" src={frame(m, time) ?? poster} />
                            <MirrorVideo source={video} playing={playing} time={time} />
                          </div>
                        )}
                      </div>
                      <BrollLayer
                        p={p}
                        shots={cutBroll(cut, projectVideos(p))}
                        start={cut.start}
                        time={time}
                        playing={playing}
                      />
                      {lines.length > 0 && (
                        <p
                          className="headline"
                          style={{
                            top: `${head.top * 100}%`,
                            fontSize: `${(head.fontSize / Math.min(pixels.width, pixels.height)) * 100}cqmin`,
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
                      <TextLayer
                        layers={cutTexts(cut)}
                        start={cut.start}
                        time={time}
                        playing={playing}
                        source={video}
                        width={pixels.width}
                        height={pixels.height}
                      />
                      {safeAreas && guide && (
                        <div className="safe-areas" aria-hidden="true">
                          <div
                            className="safe-frame"
                            style={{
                              top: `${guide.top * 100}%`,
                              right: `${guide.right * 100}%`,
                              bottom: `${guide.bottom * 100}%`,
                              left: `${guide.left * 100}%`,
                            }}
                          >
                            <span>{guide.label}</span>
                          </div>
                        </div>
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
                    <span className="time-total">/ {clock(m.duration)}</span>
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
            <Timeline
              key={m.id}
              p={m}
              cut={cut}
              time={time}
              seek={seek}
              trim={trim}
              add={addCut}
              snap={snap}
              canSnapWords={edges.start.length > 0}
              setSnap={setSnap}
            />
            <Inspector
              p={m}
              thumb={(item) => frame(mediaOf(p, item), item.start)}
              videos={projectVideos(p)}
              playhead={time}
              posts={{
                writing: postWriting,
                available: aiBlocked,
                write: (list, tone) => void writePosts(list, tone),
              }}
              assistant={
                <AssistantPanel
                  turns={turns[p.id] ?? []}
                  working={assisting}
                  available={aiBlocked}
                  ask={(text) => void askAssistant(text)}
                  undo={() => travel('undo')}
                  canUndo={canUndo}
                />
              }
              videoLabel={(item) => videoLabel(item)}
              cut={cut}
              select={select}
              update={update}
              trim={trim}
              analyze={() => open('ai')}
              duplicate={duplicate}
              remove={remove}
              notice={setToast}
              faces={faceJobs[cut.id] ?? null}
              findFaces={(speaker) => void findFaces(speaker)}
              look={{
                saved: lookSaved,
                name: lookName,
                save: () => {
                  const named = matchingLook(cut, allLooks)?.name;
                  writeLook(lookFrom(cut), named);
                  setLookSaved(true);
                  setLookName(named);
                  setToast('New clips will start with this look');
                },
                clear: () => {
                  clearLook();
                  setLookSaved(false);
                  setLookName(undefined);
                  setToast('New clips start plain again');
                },
              }}
              looks={{
                list: allLooks,
                current: matchingLook(cut, allLooks),
                apply: applyNamedLook,
                save: (name) => {
                  const item = {
                    id: newId(),
                    name: freshName(name, allLooks),
                    look: lookFrom(cut),
                  };
                  const next = [...ownLooks, item];
                  setOwnLooks(next);
                  writeLooks(next);
                  setToast(`Saved the look “${item.name}”`);
                },
                remove: (item) => {
                  const next = ownLooks.filter((own) => own.id !== item.id);
                  setOwnLooks(next);
                  writeLooks(next);
                },
              }}
              panel={panel}
              setPanel={setPanel}
              spoken={heard}
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
                  fixes={m.fixes}
                  status={status}
                  time={time}
                  clip={cut}
                  onSeek={seek}
                  onRange={(start, end) => {
                    const from = trimTime(start, 0, m.duration - MIN_CLIP, 0);
                    update({ start: from, end: trimTime(end, from + MIN_CLIP, m.duration, 0) });
                    seek(from);
                  }}
                  onFix={fixWord}
                  language={spokenLanguage[m.id] ?? 'auto'}
                  onLanguage={(code) => setSpokenLanguage((prev) => ({ ...prev, [m.id]: code }))}
                  onTranscribe={(again) => void transcribe(m.id, again)}
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
            onImport={() => {
              setInto('new');
              open('import');
            }}
          />
        ) : (
          <ExportHistory entries={entries} onEdit={() => navigate('Clip editor')} />
        )}
      </StudioShell>
      {palette && <CommandPalette commands={commands()} close={() => setPalette(false)} />}
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
              video: 'Remove video',
            }[modal]
          }
          busy={!!busy}
          close={() => setModal(null)}
        >
          {modal === 'import' && (
            <>
              <div className="format-options import-into" role="group" aria-label="Import into">
                {(
                  [
                    ['new', 'New project'],
                    ['project', `Add to “${p.title}”`],
                  ] as const
                ).map(([value, label]) => {
                  const Icon = IMPORT_ICONS[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={
                        !!busy || (value === 'project' && (p.videos?.length ?? 0) + 1 >= MAX_VIDEOS)
                      }
                      className={into === value ? 'active' : ''}
                      aria-pressed={into === value}
                      onClick={() => setInto(value)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              <p>
                {into === 'project'
                  ? `Add another video to “${p.title}”: its clips join the same bin, and each exports from its own video.`
                  : 'Start a project from a video file or a YouTube, Twitch, or Kick link.'}
              </p>
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
                <img src={frame(m, cut.start)} alt="" />
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
                    {preset.ratio
                      ? `${preset.name} · ${preset.label} · ${blur ? 'whole picture' : 'fill'}`
                      : preset.label}
                  </dd>
                </div>
                {preset.ratio && !blur && (
                  <div>
                    <dt>Framing</dt>
                    <dd>
                      {cutFraming(cut) === 'center'
                        ? 'Centered'
                        : cutFraming(cut) === 'faces' || cutFraming(cut) === 'speaker'
                          ? cutCamera(cut, m.width, m.height).length
                            ? cutFraming(cut) === 'speaker'
                              ? 'Following the speaker'
                              : 'Following faces'
                            : 'Centered · no face found yet'
                          : 'By hand'}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Duration</dt>
                  <dd>{clock(playedLength(cut.end - cut.start, skipped, cutSpeed(cut)), true)}</dd>
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
                {desktop && (
                  <div>
                    <dt>Loudness</dt>
                    <dd>
                      {cutLoudness(cut)
                        ? `${LOUDNESS.find(([value]) => value === cutLoudness(cut))?.[1]} · ${loudnessLufs(cut)} LUFS`
                        : 'Original'}
                    </dd>
                  </div>
                )}
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
              {desktop && (
                <div className="batch-export">
                  <span className="field-label">Clips and frames</span>
                  <div className="format-options join-options" role="group" aria-label="Export as">
                    {(
                      [
                        [false, 'Separate files'],
                        [true, 'One joined video'],
                      ] as const
                    ).map(([value, label]) => {
                      const Icon = JOIN_ICONS[value ? 'joined' : 'separate'];
                      return (
                        <button
                          key={label}
                          type="button"
                          className={joined === value ? 'active' : ''}
                          aria-pressed={joined === value}
                          onClick={() => {
                            setJoined(value);
                            if (value) setBatchShapes((shapes) => shapes.slice(0, 1));
                          }}
                        >
                          <Icon size={14} aria-hidden="true" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="subnote" id="batch-note">
                    {joined
                      ? 'The selected clips play in bin order as one video, each with its own settings, in one frame.'
                      : `Each selected clip is rendered in each selected frame, up to ${MAX_EXPORT_FILES} files in one folder.`}
                  </p>
                  <div className="batch-clips" role="group" aria-label="Clips to export">
                    {p.cuts.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={batchIds.includes(item.id)}
                          onChange={() =>
                            setBatchIds((ids) =>
                              ids.includes(item.id)
                                ? ids.filter((id) => id !== item.id)
                                : [...ids, item.id],
                            )
                          }
                        />
                        <span>{item.title}</span>
                      </label>
                    ))}
                  </div>
                  <div
                    className="format-options frame-options"
                    role="group"
                    aria-label="Frames to export"
                    aria-describedby="batch-note"
                  >
                    {(Object.keys(FRAME_PRESETS) as Shape[]).map((shape) => {
                      const Icon = FRAME_ICONS[shape];
                      return (
                        <button
                          key={shape}
                          type="button"
                          className={batchShapes.includes(shape) ? 'active' : ''}
                          aria-pressed={batchShapes.includes(shape)}
                          onClick={() =>
                            setBatchShapes((shapes) =>
                              joined
                                ? [shape]
                                : shapes.includes(shape)
                                  ? shapes.filter((item) => item !== shape)
                                  : [...shapes, shape],
                            )
                          }
                        >
                          <Icon size={14} aria-hidden="true" />
                          {FRAME_PRESETS[shape].label}
                        </button>
                      );
                    })}
                  </div>
                  {joined && (
                    <>
                      <span className="field-label" id="transition-title">
                        Between clips
                      </span>
                      <div
                        className="format-options transition-options"
                        role="group"
                        aria-labelledby="transition-title"
                      >
                        {TRANSITIONS.map(([value, label]) => {
                          const Icon = TRANSITION_ICONS[value];
                          return (
                            <button
                              key={value}
                              type="button"
                              className={transition === value ? 'active' : ''}
                              aria-pressed={transition === value}
                              onClick={() => setTransition(value)}
                            >
                              <Icon size={14} aria-hidden="true" />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="bookends" role="group" aria-label="Opening shot and end card">
                        {(
                          [
                            ['intro', 'Opening shot', 'Plays first'],
                            ['outro', 'End card', 'Plays last'],
                          ] as const
                        ).map(([end, label, hint]) => {
                          const file = p.bookends?.[end];
                          return (
                            <div key={end} className="bookend-row">
                              <span className="settings-summary">
                                <strong>{label}</strong>
                                <small>
                                  {file ? `${file.name} · ${clock(file.duration, true)}` : hint}
                                </small>
                              </span>
                              {file ? (
                                <button
                                  type="button"
                                  className="text-btn"
                                  aria-label={`Remove the ${label.toLowerCase()}`}
                                  onClick={() => void setBookend(end, false)}
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-btn"
                                  disabled={!!busy}
                                  onClick={() => void setBookend(end, true)}
                                >
                                  <Plus size={13} aria-hidden="true" /> Add {label.toLowerCase()}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {!joined && jobs.length > MAX_EXPORT_FILES && (
                    <p className="subnote">Choose {MAX_EXPORT_FILES} files or fewer.</p>
                  )}
                </div>
              )}
              <button
                className="btn primary wide"
                onClick={() =>
                  void (desktop && joined
                    ? exportingJoined(batchShapes[0] ?? cut.shape)
                    : desktop && !sameExport
                      ? exportingBatch(jobs)
                      : exporting())
                }
                disabled={
                  !!busy ||
                  !src ||
                  (desktop &&
                    (joined
                      ? !batchIds.length || !batchShapes.length
                      : jobs.length < 1 || jobs.length > MAX_EXPORT_FILES))
                }
              >
                <ArrowDownToLine size={16} />
                {desktop && joined
                  ? `Choose where to save · ${batchIds.length} ${batchIds.length === 1 ? 'clip' : 'clips'} joined`
                  : desktop
                    ? sameExport
                      ? 'Choose destination'
                      : `Choose a folder · ${jobs.length} ${jobs.length === 1 ? 'file' : 'files'}`
                    : 'Export WebM'}
              </button>
            </>
          )}
          {modal === 'video' && doomedVideo && (
            <>
              <p>
                “{doomedVideo.title}” and its{' '}
                {p.cuts.filter((c) => mediaOf(p, c).id === doomedVideo.id).length} clips will be
                removed from this project.{' '}
                {desktop
                  ? 'The editing copy, thumbnails, waveform and transcript Quikclip made of it are deleted. Your original video and exported MP4s are not touched.'
                  : 'The copy of the video stored in this browser is deleted. Your original file and downloaded exports are not touched.'}
              </p>
              <div className="confirm-actions">
                <button className="btn secondary" disabled={!!busy} onClick={() => setModal(null)}>
                  Keep video
                </button>
                <button
                  className="btn danger"
                  disabled={!!busy}
                  onClick={() => void removeVideo(doomedVideo)}
                >
                  <Trash2 size={15} />
                  Remove video
                </button>
              </div>
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
                  'Fit the timeline to a clip, then drag the handles or enter exact in and out points. Duplicate a clip to try a different trim or crop without changing the original. Choose an output frame and adjust its crop, or open Captions, Headline and logo, and Audio for more controls.',
                ],
                [
                  Sparkles,
                  'Find a highlight',
                  'Choose a local or cloud provider in Highlight finder, connect, and select a vision model. The sample project includes three cuts you can try right away.',
                ],
                [
                  Download,
                  'Render your clip',
                  'Export clip writes an MP4 in the desktop app. Select more than one clip or frame to render them together into one folder. The web preview downloads WebM in supported browsers.',
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
