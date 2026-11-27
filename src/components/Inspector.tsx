import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AudioLines,
  Bot,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  FileText,
  Film,
  Layers,
  LoaderCircle,
  Megaphone,
  Palette,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  ScanFace,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
  TextCursorInput,
  Trash2,
  Play,
} from 'lucide-react';
import { ScoreCard, scoreTone } from './Score';
import { CAM_CORNERS, MAX_CAM, MIN_CAM, camAt, camCorner, camFromFaces, cutCam } from '../facecam';
import { AiSuggest, type AiAccess } from './AiSuggest';
import { HEADLINE_MAX } from '../headline';
import { defaultLogoCorner, LOGO_CORNERS } from '../logo';
import { cutSpeed, SPEEDS } from '../speed';
import { MUSIC_TYPES, musicMix, musicRights, saveMusicRights, type MusicSettings } from '../music';
import {
  CENTER_CROP,
  clock,
  cutCamera,
  cutCrop,
  cutFaces,
  cutFit,
  cutFraming,
  cutLogo,
  cutLoudness,
  cutMusic,
  cutPauses,
  cutVoice,
  cropBox,
  desktop,
  following,
  splitShape,
  errorText,
  FRAME_PRESETS,
  frame,
  keepLogoFile,
  keepMusicFile,
  LOUDNESS,
  loudnessLufs,
  outputFrame,
  parseTime,
  pickLogoFile,
  pickMusicFile,
  readSaved,
  type Project,
  type Cut,
  type Shape,
  type Video,
} from '../studio';
import { clipMatches, type ClipLength, type SpokenBit } from '../clips';
import { LengthRuler } from './LengthRuler';
import { LookPicker } from './LookPicker';
import { CORNER_ICONS, FIT_ICONS, FRAME_ICONS, FRAMING_ICONS, LOUDNESS_ICONS } from './icons';
import { BrollFields } from './BrollFields';
import { TextFields } from './TextFields';
import { PostFields } from './PostFields';
import { cutPosts, type Platform, type Tone } from '../post';
import { cutTexts } from '../texts';
import { cutBroll } from '../broll';
import { MAX_LOOKS, type NamedLook } from '../look';
import { trimClock } from '../timeline';
import { fillerRanges, punchRanges, spanSeconds } from '../polish';

const NO_WORDS: readonly SpokenBit[] = [];
/** How the empty clip list names a length band. */
const EMPTY_BANDS = {
  short: 'under 30 seconds',
  medium: 'between 30 and 60 seconds',
  long: 'over 60 seconds',
} as const;

const inspectorTabs = [
  ['clips', 'Clips', Film],
  ['transcript', 'Transcript', FileText],
  ['assistant', 'Assistant', Bot],
] as const;
export type InspectorPanel = (typeof inspectorTabs)[number][0];
/** The selected clip's settings, a tab each (instead of one long scroll). */
const CLIP_TOOLS = [
  ['frame', 'Frame', Crop],
  ['text', 'Text', Captions],
  ['audio', 'Audio', AudioLines],
  ['broll', 'B-roll', Layers],
  ['post', 'Post', Megaphone],
] as const;
type ClipTool = (typeof CLIP_TOOLS)[number][0];

function TimeField({
  label,
  value,
  commit,
}: {
  label: string;
  value: number;
  commit: (n: number) => void;
}) {
  const formatted = trimClock(value);
  const [text, set] = useState(formatted);
  useEffect(() => set(formatted), [formatted]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        title="Enter seconds or a time such as 00:12.50"
        value={text}
        onChange={(e) => set(e.target.value)}
        onBlur={() => {
          if (text !== formatted) {
            const n = parseTime(text);
            if (Number.isFinite(n)) commit(n);
          }
          set(formatted);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function MusicFields({
  cut,
  update,
  notice,
}: {
  cut: Cut;
  update: (c: Partial<Cut>) => void;
  notice: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(musicRights);
  const [adding, setAdding] = useState(false);
  const music = cutMusic(cut);
  const mix = music ? musicMix(music, music.duration) : null;
  function setMix(patch: Partial<MusicSettings>) {
    if (music) update({ music: { ...music, ...musicMix({ ...music, ...patch }, music.duration) } });
  }
  async function add(file?: File) {
    setAdding(true);
    try {
      const saved = file ? await keepMusicFile(file) : await pickMusicFile();
      if (saved) update({ music: saved });
    } catch (e) {
      notice(errorText(e));
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="music-block">
      <span className="field-label">Background music</span>
      {music && mix ? (
        <>
          <div className="music-row">
            <span className="music-name" title={music.name}>
              {music.name}
            </span>
            <small className="music-duration" title="Track length">
              {trimClock(music.duration)}
            </small>
            <button
              type="button"
              className="text-btn"
              aria-label="Remove music"
              onClick={() => update({ music: undefined })}
            >
              Remove
            </button>
          </div>
          <div className="music-mix" role="group" aria-label="Music mix">
            <MixSlider
              label="Music volume"
              value={Math.round(mix.volume * 100)}
              max={100}
              step={5}
              unit="%"
              change={(volume) => setMix({ volume: volume / 100 })}
            />
            <MixSlider
              label="Video volume"
              value={Math.round(mix.source_volume * 100)}
              max={100}
              step={5}
              unit="%"
              change={(source_volume) => setMix({ source_volume: source_volume / 100 })}
            />
            <div className="music-offset">
              <TimeField
                label="Start in track"
                value={mix.start}
                commit={(start) => setMix({ start })}
              />
              <label className="music-repeat">
                Loop track
                <input
                  type="checkbox"
                  role="switch"
                  checked={mix.loop}
                  onChange={(e) => setMix({ loop: e.target.checked })}
                />
              </label>
              <label className="music-repeat">
                Lower under speech
                <input
                  type="checkbox"
                  role="switch"
                  checked={mix.duck}
                  onChange={(e) => setMix({ duck: e.target.checked || undefined })}
                />
              </label>
            </div>
            <div className="music-fades">
              <MixSlider
                label="Fade in"
                value={mix.fade_in}
                max={5}
                step={0.5}
                unit=" s"
                change={(fade_in) => setMix({ fade_in })}
              />
              <MixSlider
                label="Fade out"
                value={mix.fade_out}
                max={5}
                step={0.5}
                unit=" s"
                change={(fade_out) => setMix({ fade_out })}
              />
            </div>
          </div>
          <p className="fit-note">
            Fades run on the finished clip, after speed changes and removed pauses.
          </p>
        </>
      ) : (
        <>
          <label className="music-rights">
            <input
              className="music-rights-input"
              type="checkbox"
              checked={rights}
              aria-labelledby="music-rights-label"
              aria-describedby="music-rights-note"
              onChange={(e) => {
                saveMusicRights(e.target.checked);
                setRights(e.target.checked);
              }}
            />
            <span className="rights-check" aria-hidden="true">
              <Check size={13} />
            </span>
            <span className="settings-summary">
              <strong id="music-rights-label">
                I own this audio or have permission to use it.
              </strong>
              <small id="music-rights-note">Required before adding a track.</small>
            </span>
          </label>
          <button
            type="button"
            className="btn secondary asset-button"
            disabled={!rights || adding}
            onClick={() => {
              if (desktop) void add();
              else fileRef.current?.click();
            }}
          >
            <Plus size={13} />
            {adding ? 'Reading music…' : 'Add music'}
          </button>
          {rights && !desktop && (
            <input
              ref={fileRef}
              hidden
              type="file"
              accept={MUSIC_TYPES}
              aria-label="Music file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void add(file);
              }}
            />
          )}
          <p className="fit-note">MP3, WAV, M4A, OGG, FLAC, or AAC. Up to 20 MB and 20 minutes.</p>
        </>
      )}
    </div>
  );
}

function MixSlider({
  label,
  value,
  max,
  step,
  unit,
  change,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  unit: string;
  change: (n: number) => void;
}) {
  return (
    <label className="mix-slider">
      <span>{label}</span>
      <span aria-hidden="true">
        {value}
        {unit}
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={`${value}${unit}`}
        min={0}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${(value / max) * 100}%` } as CSSProperties}
        onChange={(e) => change(Number(e.target.value))}
      />
    </label>
  );
}
function LogoFields({
  p,
  cut,
  update,
  notice,
}: {
  p: Project;
  cut: Cut;
  update: (c: Partial<Cut>) => void;
  notice: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const logo = cutLogo(cut);
  const frameSize = outputFrame(cut.shape, p.width, p.height);
  async function add(file?: File) {
    setAdding(true);
    try {
      const corner = defaultLogoCorner(frameSize.width, frameSize.height);
      const saved = file ? await keepLogoFile(file, corner) : await pickLogoFile(corner);
      if (saved) update({ logo: saved });
    } catch (e) {
      notice(errorText(e));
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="logo-block">
      <span className="field-label">Logo</span>
      {logo ? (
        <>
          <div className="logo-row">
            <span className="logo-name" title={logo.name}>
              {logo.name}
            </span>
            <button
              type="button"
              className="text-btn"
              aria-label="Remove logo"
              onClick={() => update({ logo: undefined })}
            >
              Remove
            </button>
          </div>
          <div role="group" aria-label="Logo corner" className="format-options logo-corners">
            {LOGO_CORNERS.map((corner) => {
              const Icon = CORNER_ICONS[corner.value];
              return (
                <button
                  key={corner.value}
                  type="button"
                  className={logo.corner === corner.value ? 'active' : ''}
                  aria-pressed={logo.corner === corner.value}
                  onClick={() => update({ logo: { ...logo, corner: corner.value } })}
                >
                  <Icon size={14} aria-hidden="true" />
                  {corner.label}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn secondary asset-button"
            disabled={adding}
            onClick={() => {
              if (desktop) void add();
              else fileRef.current?.click();
            }}
          >
            <Plus size={13} />
            {adding ? 'Reading image…' : 'Add logo'}
          </button>
          {!desktop && (
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/png,.png"
              aria-label="Logo file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void add(file);
              }}
            />
          )}
          <p className="fit-note">
            PNG up to 2 MB and 4096 × 4096 px. Transparent backgrounds work best.
          </p>
        </>
      )}
    </div>
  );
}

/** The stacked layout's facecam: which corner of the source, how big, or around the face found in the clip. */
function FacecamFields({
  cut,
  width,
  height,
  update,
  faces,
  findFaces,
}: {
  cut: Cut;
  width: number;
  height: number;
  update: (c: Partial<Cut>) => void;
  faces: FaceStatus | null;
  findFaces: () => void;
}) {
  const cam = cutCam(cut, width, height);
  const corner = camCorner(cam);
  const around = camFromFaces(cut, width, height);
  return (
    <div className="facecam-fields" role="group" aria-labelledby="facecam-title">
      <span className="field-label" id="facecam-title">
        Facecam
      </span>
      <div className="format-options facecam-corners" role="group" aria-label="Facecam corner">
        {CAM_CORNERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={corner === value ? 'active' : ''}
            aria-pressed={corner === value}
            onClick={() => update({ cam: camAt(value, cam.w, cut.shape, width, height) })}
          >
            <span className="corner-preview" data-corner={value} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <label className="crop-axis">
        <span>Size</span>
        <input
          type="range"
          aria-label="Facecam size"
          min={MIN_CAM}
          max={MAX_CAM}
          step={0.01}
          value={cam.w}
          style={
            {
              '--fill': `${((cam.w - MIN_CAM) / (MAX_CAM - MIN_CAM)) * 100}%`,
            } as CSSProperties
          }
          onChange={(e) =>
            update({ cam: camAt(corner, Number(e.target.value), cut.shape, width, height) })
          }
        />
        <span aria-hidden="true">{Math.round(cam.w * 100)}%</span>
      </label>
      <div className="facecam-face">
        {around ? (
          <button type="button" className="text-btn" onClick={() => update({ cam: around })}>
            <ScanFace size={13} aria-hidden="true" /> Frame the face found
          </button>
        ) : (
          <button
            type="button"
            className="text-btn"
            disabled={!faceDetection || faces?.state === 'working'}
            onClick={findFaces}
          >
            {faces?.state === 'working' ? (
              <LoaderCircle className="spin" size={13} aria-hidden="true" />
            ) : (
              <ScanFace size={13} aria-hidden="true" />
            )}
            {faces?.state === 'working' ? 'Finding the face…' : 'Find the face'}
          </button>
        )}
        {faces?.state === 'error' && <p className="caption-error">{faces.text}</p>}
      </div>
      <p className="fit-note">
        The box fills the top of the frame; the game fills the rest. Move it under Gameplay
        position.
      </p>
    </div>
  );
}

/** How finding faces for the selected clip is going, when it isn't done. */
export type FaceStatus = { state: 'working' } | { state: 'error'; text: string };
/** Faces are found in the desktop app on every system: Windows' own detector, or the bundled one (src-tauri faces.rs). */
const faceDetection = desktop;
const FRAMINGS = [
  ['hand', 'By hand', 'Place the crop yourself'],
  ['center', 'Center', 'Keep the crop in the middle of the source'],
  ['faces', 'Follow faces', 'Keep the largest face in frame, gliding only after a real move'],
  ['speaker', 'Follow speaker', 'Keep whoever is talking in frame, holding through crosstalk'],
] as const;

function FrameFields({
  p,
  cut,
  update,
  faces,
  findFaces,
  words,
}: {
  p: Project;
  cut: Cut;
  update: (c: Partial<Cut>) => void;
  faces: FaceStatus | null;
  findFaces: (speaker: boolean) => void;
  /** The transcript's words on the source clock, for punch-ins. */
  words: readonly SpokenBit[];
}) {
  const fit = cutFit(cut);
  const punches = punchRanges(words, cut.start, cut.end);
  const framing = cutFraming(cut);
  const found = cutFaces(cut);
  const camera = cutCamera(cut, p.width, p.height);
  const partial = found && (cut.start < found.start - 0.5 || cut.end > found.end + 0.5);
  const position = cutCrop(cut);
  const size = cropBox(cut, p.width, p.height);
  const axes = [
    { key: 'x', label: 'Horizontal', travel: p.width - size.width },
    { key: 'y', label: 'Vertical', travel: p.height - size.height },
  ] as const;
  const adjustable = axes.filter(({ travel }) => travel >= 2);
  return (
    <>
      <span className="field-label">Output frame</span>
      <div className="format-options frame-options" role="group" aria-label="Output frame">
        {(Object.keys(FRAME_PRESETS) as Shape[]).map((shape) => {
          const { label, name } = FRAME_PRESETS[shape];
          const Icon = FRAME_ICONS[shape];
          return (
            <button
              key={shape}
              type="button"
              className={cut.shape === shape ? 'active' : ''}
              aria-pressed={cut.shape === shape}
              title={name}
              onClick={() => update({ shape })}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>
      {cut.shape !== 'source' && (
        <>
          <span className="field-label">Frame fit</span>
          <div className="format-options fit-options" role="group" aria-label="Frame fit">
            {(
              [
                ['fill', 'Fill the frame', 'Crop the source to fill the output frame'],
                ['blur', 'Show the whole video', 'Fit the source with a blurred background'],
                ...(splitShape(cut.shape)
                  ? ([
                      [
                        'split',
                        'Split: face on top',
                        'A crop of the speaker on top, the whole picture below',
                      ],
                      [
                        'stack',
                        'Facecam + gameplay',
                        'Your camera box on top, the game below: for streams',
                      ],
                    ] as const)
                  : []),
              ] as const
            ).map(([mode, label, hint]) => {
              const Icon = FIT_ICONS[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  className={fit === mode ? 'active' : ''}
                  aria-pressed={fit === mode}
                  title={hint}
                  aria-label={label}
                  onClick={() =>
                    update(
                      mode === 'stack' && !cut.cam
                        ? {
                            fit: mode,
                            cam:
                              camFromFaces(cut, p.width, p.height) ??
                              cutCam(cut, p.width, p.height),
                          }
                        : { fit: mode },
                    )
                  }
                >
                  <Icon size={14} aria-hidden="true" />
                  {mode === 'blur' ? 'Whole video' : mode === 'stack' ? 'Facecam' : label}
                </button>
              );
            })}
          </div>
          {fit === 'split' && (
            <p className="fit-note">
              The top band follows the framing below; the whole picture fills the rest.
            </p>
          )}
          {fit === 'stack' && (
            <FacecamFields
              cut={cut}
              width={p.width}
              height={p.height}
              update={update}
              faces={faces}
              findFaces={() => findFaces(false)}
            />
          )}
          {fit !== 'blur' && fit !== 'stack' && adjustable.length > 0 && (
            <>
              <span className="field-label" id="framing-title">
                Framing
              </span>
              <div
                className="format-options framing-options"
                role="group"
                aria-labelledby="framing-title"
              >
                {FRAMINGS.map(([mode, label, hint]) => {
                  const unavailable = following(mode) && !faceDetection;
                  const Icon = FRAMING_ICONS[mode];
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={framing === mode ? 'active' : ''}
                      aria-pressed={framing === mode}
                      disabled={unavailable}
                      title={unavailable ? 'Face tracking is in the desktop app' : hint}
                      onClick={() => {
                        update({ framing: mode === 'hand' ? undefined : mode });
                        const missing = !found || (mode === 'speaker' && !found.speaker);
                        if (following(mode) && missing && faces?.state !== 'working')
                          findFaces(mode === 'speaker');
                      }}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
              {framing === 'center' && (
                <p className="fit-note">The crop stays in the middle of the source.</p>
              )}
              {following(framing) && (
                <div className="face-status" role="status">
                  {faces?.state === 'working' ? (
                    <p className="fit-note">
                      <LoaderCircle className="spin" size={13} aria-hidden="true" />{' '}
                      {framing === 'speaker'
                        ? 'Finding faces and who is talking…'
                        : 'Finding faces in this clip…'}
                    </p>
                  ) : faces?.state === 'error' ? (
                    <p className="caption-error">{faces.text}</p>
                  ) : !found ? (
                    <p className="fit-note">Faces haven’t been found for this clip yet.</p>
                  ) : camera.length && framing === 'speaker' ? (
                    <p className="fit-note">
                      Following whoever is talking. The shot moves to a new speaker once they have
                      led for a moment, and holds through crosstalk and pauses.
                    </p>
                  ) : camera.length ? (
                    <p className="fit-note">
                      Following the largest face. The frame holds still for small moves and glides
                      after a real one, in the preview and the export.
                    </p>
                  ) : (
                    <p className="fit-note">
                      No face stayed in view long enough, so the frame stays centered.
                    </p>
                  )}
                  {partial && faces?.state !== 'working' && (
                    <p className="fit-note">
                      Faces were found for {clock(found.start)} – {clock(found.end)}. Find them
                      again to cover the whole clip.
                    </p>
                  )}
                  {faces?.state !== 'working' && (
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => findFaces(framing === 'speaker')}
                    >
                      <ScanFace size={13} aria-hidden="true" />{' '}
                      {found || faces?.state === 'error' ? 'Find faces again' : 'Find faces'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {fit !== 'blur' && (framing === 'hand' || fit === 'stack') && adjustable.length > 0 && (
            <div className="crop-controls" role="group" aria-labelledby="crop-position-title">
              <div className="settings-label-line">
                <span className="field-label" id="crop-position-title">
                  {fit === 'stack' ? 'Gameplay position' : 'Crop position'}
                </span>
                <button
                  type="button"
                  className="text-btn"
                  aria-label="Center crop"
                  disabled={adjustable.every(({ key }) => position[key] === CENTER_CROP[key])}
                  onClick={() => update({ crop: undefined })}
                >
                  Center
                </button>
              </div>
              {adjustable.map(({ key, label }) => (
                <label key={key} className="crop-axis">
                  <span>{label}</span>
                  <input
                    type="range"
                    aria-label={`${label} crop position`}
                    min={0}
                    max={100}
                    step={1}
                    value={position[key]}
                    style={{ '--fill': `${position[key]}%` } as CSSProperties}
                    onChange={(e) =>
                      update({ crop: { ...position, [key]: Number(e.target.value) } })
                    }
                  />
                  <span aria-hidden="true">{position[key]}%</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className="setting-toggle punch-toggle"
        aria-labelledby="clip-punch-label"
        aria-describedby="clip-punch-note"
        aria-pressed={cut.punch === true}
        disabled={!punches.length && cut.punch !== true}
        onClick={() => update({ punch: cut.punch ? undefined : true })}
      >
        <span className="settings-summary">
          <strong id="clip-punch-label">Punch-in zooms</strong>
          <small id="clip-punch-note">
            {!words.length
              ? 'Zooms follow the sentences, so they need the transcript.'
              : punches.length
                ? `Zoom in on every other sentence: ${punches.length} ${punches.length === 1 ? 'zoom' : 'zooms'} in this clip.`
                : 'This clip has too few sentences to zoom between.'}
          </small>
        </span>
        <span className="switch-track" aria-hidden="true" />
      </button>
    </>
  );
}

export function Inspector({
  p,
  cut,
  select,
  update,
  trim,
  analyze,
  duplicate,
  remove,
  move,
  toolAsk,
  playInOrder,
  ai,
  notice,
  pauseNote,
  captions,
  transcript,
  faces,
  findFaces,
  look,
  looks,
  thumb,
  videoLabel,
  videos,
  playhead,
  assistant,
  posts,
  panel,
  setPanel,
  spoken = [],
}: {
  p: Project;
  cut: Cut;
  select: (c: Cut) => void;
  update: (c: Partial<Cut>) => void;
  trim: (k: 'start' | 'end', n: number) => void;
  analyze: () => void;
  duplicate: () => void;
  remove: () => void;
  /** Moves a clip to another place in the bin (the order a joined video plays in). */
  move?: (id: string, to: number) => void;
  /** Plays every clip in bin order in the monitor, as one joined video. */
  playInOrder?: () => void;
  /** A settings tab to show, asked for from elsewhere; `at` makes each ask new. */
  toolAsk?: { tool: string; at: number } | null;
  /** The AI by the fields it fills: titles by the clip name, hooks by the headline, callouts by the text tools. */
  ai?: {
    access: AiAccess;
    options: (task: 'titles' | 'hooks') => Promise<string[]>;
    callouts: () => Promise<string>;
    /** Whether the clip has words to work from. */
    spoken: boolean;
  };
  notice: (text: string) => void;
  pauseNote: string;
  /** The captions section (components/Captions.tsx CaptionFields). */
  captions: ReactNode;
  /** The video's transcript (components/TranscriptPanel.tsx). */
  transcript: ReactNode;
  /** Finding faces for the selected clip, and starting it. */
  faces: FaceStatus | null;
  findFaces: (speaker: boolean) => void;
  /** The look new clips start from (look.ts): whether one is saved, and saving or clearing it. */
  look: { saved: boolean; name?: string; save: () => void; clear: () => void };
  /** Every video in the project, for b-roll. */
  videos: readonly Video[];
  /** Where the preview is, on the source clock. */
  playhead: number;
  /** A clip's thumbnail, from its own video. */
  thumb: (cut: Cut) => string | undefined;
  /** Which of the project's videos a clip cuts from ("V2"), when it has more than one. */
  videoLabel: (cut: Cut) => string | null;
  /** Named looks (look.ts), built in and your own. */
  looks: {
    list: readonly NamedLook[];
    current: NamedLook | null;
    apply: (look: NamedLook) => void;
    save: (name: string) => void;
    remove: (look: NamedLook) => void;
  };
  panel: InspectorPanel;
  setPanel: (panel: InspectorPanel) => void;
  /** The editing assistant's chat (components/AssistantPanel.tsx). */
  assistant: ReactNode;
  /** Post copy for the clip. */
  posts: {
    writing: boolean;
    available: string | null;
    write: (platforms: Platform[], tone: Tone) => void;
  };
  /** Words from the source transcript, used to search what a clip says. */
  spoken?: readonly SpokenBit[];
}) {
  const [title, setTitle] = useState(cut.title);
  const [headline, setHeadline] = useState(cut.headline ?? '');
  const [query, setQuery] = useState('');
  const [length, setLength] = useState<ClipLength>('any');
  // The clip settings tab stays as it was left, and opens when another part of the studio asks for it.
  const [tool, setToolState] = useState<ClipTool>(() => {
    const saved = readSaved<string>('tool', 'frame');
    return CLIP_TOOLS.some(([value]) => value === saved) ? (saved as ClipTool) : 'frame';
  });
  function setTool(next: ClipTool) {
    setToolState(next);
    try {
      localStorage.setItem('quikclip.1.tool', JSON.stringify(next));
    } catch {
      // It still changes for this session.
    }
  }
  useEffect(() => {
    if (toolAsk && CLIP_TOOLS.some(([value]) => value === toolAsk.tool))
      setTool(toolAsk.tool as ClipTool);
  }, [toolAsk]);
  // The clip list folds away to give the settings the room; it stays as you left it.
  const [binOpen, setBinOpenState] = useState(() => readSaved<boolean>('binOpen', true) !== false);
  function setBinOpen(open: boolean) {
    setBinOpenState(open);
    try {
      localStorage.setItem('quikclip.1.binOpen', JSON.stringify(open));
    } catch {
      // Folding still works for the session without storage.
    }
  }
  const position = p.cuts.findIndex((item) => item.id === cut.id);
  useEffect(() => setTitle(cut.title), [cut.id, cut.title]);
  useEffect(() => setHeadline(cut.headline ?? ''), [cut.id, cut.headline]);
  const searched = p.cuts.filter((item) => clipMatches(item, query, 'any', spoken));
  const fillers = useMemo(
    () => fillerRanges(spoken ?? NO_WORDS, cut.start, cut.end),
    [spoken, cut.start, cut.end],
  );
  const shown = p.cuts
    .map((item, index) => ({ cut: item, index }))
    .filter(({ cut: item }) => clipMatches(item, query, length, spoken));
  // Clips are dragged into a new order only when the whole bin shows, so a drop lands where it looks.
  const reorderable = !!move && shown.length === p.cuts.length && p.cuts.length > 1;
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const cardList = useRef<HTMLDivElement>(null);
  // The list scrolls itself (never the page) to keep the selected clip in view.
  useEffect(() => {
    const list = cardList.current;
    const card = list?.querySelector<HTMLElement>(`[data-cut="${cut.id}"]`);
    if (!list || !card || list.scrollHeight <= list.clientHeight) return;
    const [view, box] = [list.getBoundingClientRect(), card.getBoundingClientRect()];
    if (box.top < view.top) list.scrollTop -= view.top - box.top;
    else if (box.bottom > view.bottom) list.scrollTop += box.bottom - view.bottom;
  }, [cut.id]);
  function shift(c: Cut, to: number) {
    if (!move || to < 0 || to >= p.cuts.length) return;
    move(c.id, to);
    notice(`${c.title} is now clip ${to + 1} of ${p.cuts.length}.`);
    // Keep the moved card focused for the next key press.
    requestAnimationFrame(() =>
      cardList.current?.querySelector<HTMLElement>(`[data-cut="${c.id}"]`)?.focus(),
    );
  }
  return (
    <aside className="inspector" aria-label="Clip inspector">
      <div className="panel-tabs" role="tablist" aria-label="Clips and transcript">
        {inspectorTabs.map(([value, label, Icon], index) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`inspector-tab-${value}`}
            aria-controls={`inspector-panel-${value}`}
            aria-selected={panel === value}
            tabIndex={panel === value ? 0 : -1}
            className={panel === value ? 'active' : ''}
            onClick={() => setPanel(value)}
            onKeyDown={(e) => {
              const count = inspectorTabs.length;
              let next: number;
              switch (e.key) {
                case 'Home':
                  next = 0;
                  break;
                case 'End':
                  next = count - 1;
                  break;
                case 'ArrowLeft':
                  next = (index - 1 + count) % count;
                  break;
                case 'ArrowRight':
                  next = (index + 1) % count;
                  break;
                default:
                  return;
              }
              e.preventDefault();
              e.stopPropagation();
              setPanel(inspectorTabs[next][0]);
              e.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
            }}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div
        className="inspector-body"
        role="tabpanel"
        id="inspector-panel-transcript"
        aria-labelledby="inspector-tab-transcript"
        tabIndex={0}
        hidden={panel !== 'transcript'}
      >
        {panel === 'transcript' && transcript}
      </div>
      <div
        className="inspector-body inspector-assistant"
        role="tabpanel"
        id="inspector-panel-assistant"
        aria-labelledby="inspector-tab-assistant"
        hidden={panel !== 'assistant'}
      >
        {panel === 'assistant' && assistant}
      </div>
      <div
        className="inspector-body inspector-clips"
        role="tabpanel"
        id="inspector-panel-clips"
        aria-labelledby="inspector-tab-clips"
        hidden={panel !== 'clips'}
      >
        {panel === 'clips' && (
          <>
            <section className={`clip-bin${binOpen ? '' : ' folded'}`} aria-labelledby="bin-title">
              <div className="bin-title">
                <div>
                  <h2 id="bin-title">Source clips</h2>
                  <span className="count">
                    {shown.length === p.cuts.length
                      ? `${p.cuts.length} ${p.cuts.length === 1 ? 'clip' : 'clips'}`
                      : `${shown.length} of ${p.cuts.length}`}
                  </span>
                </div>
                <span className="bin-actions">
                  <button
                    className="btn secondary highlight-action"
                    title="Suggest clips with your AI model"
                    onClick={analyze}
                  >
                    <Sparkles size={14} />
                    Find highlights
                  </button>
                  <button
                    type="button"
                    className="icon-btn bin-fold"
                    aria-expanded={binOpen}
                    aria-controls="clip-bin-body"
                    aria-label={binOpen ? 'Hide the clip list' : 'Show the clip list'}
                    title={binOpen ? 'Hide the clip list' : 'Show the clip list'}
                    onClick={() => setBinOpen(!binOpen)}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </span>
              </div>
              {binOpen && (
                <div id="clip-bin-body">
                  <label className="clip-search">
                    <Search size={14} aria-hidden="true" />
                    <input
                      aria-label="Search clips"
                      placeholder="Search titles, notes, and speech"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <LengthRuler
                    cuts={searched}
                    current={cut.id}
                    value={length}
                    onChange={setLength}
                  />
                  <div
                    className={`cut-list${dragged ? ' reordering' : ''}`}
                    role="group"
                    aria-label="Clips"
                    aria-describedby={reorderable ? 'cut-list-hint' : undefined}
                    ref={cardList}
                  >
                    {shown.length === 0 && (
                      <div className="clip-empty">
                        <p>
                          {query.trim() || length === 'any'
                            ? 'No clips match this search.'
                            : `No clips ${EMPTY_BANDS[length]}.`}
                        </p>
                        {length !== 'any' && (
                          <button
                            type="button"
                            className="text-btn"
                            onClick={() => setLength('any')}
                          >
                            Show every length
                          </button>
                        )}
                      </div>
                    )}
                    {shown.map(({ cut: c, index: i }) => {
                      const thumbnail = thumb(c);
                      const label = videoLabel(c);
                      return (
                        <button
                          key={c.id}
                          className={`cut-card${cut.id === c.id ? ' selected' : ''}${dragged === c.id ? ' dragged' : ''}${dropAt === i && dragged !== c.id ? ' drop-before' : ''}${dropAt === i + 1 && i === p.cuts.length - 1 && dragged !== c.id ? ' drop-after' : ''}`}
                          onClick={() => select(c)}
                          aria-pressed={cut.id === c.id}
                          title={reorderable ? `${c.title} · drag to reorder` : c.title}
                          data-cut={c.id}
                          draggable={reorderable}
                          onDragStart={(e) => {
                            if (!reorderable) return;
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', c.id);
                            setDragged(c.id);
                          }}
                          onDragOver={(e) => {
                            if (!dragged) return;
                            e.preventDefault();
                            const box = e.currentTarget.getBoundingClientRect();
                            setDropAt(e.clientY > box.top + box.height / 2 ? i + 1 : i);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const from = p.cuts.findIndex((item) => item.id === dragged);
                            if (from >= 0 && dropAt !== null) {
                              const to = dropAt > from ? dropAt - 1 : dropAt;
                              if (to !== from) shift(p.cuts[from], to);
                            }
                            setDragged(null);
                            setDropAt(null);
                          }}
                          onDragEnd={() => {
                            setDragged(null);
                            setDropAt(null);
                          }}
                          onKeyDown={(e) => {
                            if (!reorderable || !e.altKey) return;
                            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                            e.preventDefault();
                            shift(c, i + (e.key === 'ArrowUp' ? -1 : 1));
                          }}
                        >
                          <span className="cut-thumb" aria-hidden="true">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" loading="lazy" />
                            ) : (
                              <Film size={15} />
                            )}
                            <span className="cut-index">{String(i + 1).padStart(2, '0')}</span>
                            {label && (
                              <span className="cut-video" title={`From video ${label.slice(1)}`}>
                                {label}
                              </span>
                            )}
                          </span>
                          <span className="cut-copy">
                            <strong>{c.title}</strong>
                            <small>
                              {clock(c.start)} <span aria-hidden="true">→</span>
                              <span className="sr-only"> to </span> {clock(c.end)}
                              {c.highlight && (
                                <span
                                  className="cut-ai"
                                  data-tone={
                                    c.highlight.score !== undefined
                                      ? scoreTone(c.highlight.score)
                                      : undefined
                                  }
                                  title="AI editorial score for the suggested range"
                                >
                                  <span className="sr-only"> AI suggestion</span>
                                  <span aria-hidden="true">AI</span>
                                  {c.highlight.score !== undefined && (
                                    <>
                                      {' '}
                                      {c.highlight.score}
                                      <span className="sr-only"> out of 100</span>
                                    </>
                                  )}
                                </span>
                              )}
                            </small>
                          </span>
                          {cut.id === c.id && (
                            <span className="cut-check" aria-hidden="true">
                              <Check size={14} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {reorderable && (
                    <div className="cut-list-foot">
                      <p className="cut-list-hint" id="cut-list-hint">
                        Drag clips, or press Alt + ↑ / ↓, to reorder them. Joined videos play in
                        this order.
                      </p>
                      {playInOrder && (
                        <button type="button" className="text-btn" onClick={playInOrder}>
                          <Play size={12} aria-hidden="true" /> Play in order
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            <section className="cut-settings" aria-labelledby="settings-title">
              <div className="settings-head">
                <h2 id="settings-title">
                  <SlidersHorizontal size={15} />
                  Edit clip
                </h2>
                <div className="settings-actions">
                  <span className="clip-step" role="group" aria-label="Choose a clip">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Previous clip"
                      title="Previous clip ( [ )"
                      disabled={position <= 0}
                      onClick={() => select(p.cuts[position - 1])}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <small aria-live="polite">
                      {position + 1} / {p.cuts.length}
                    </small>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Next clip"
                      title="Next clip ( ] )"
                      disabled={position >= p.cuts.length - 1}
                      onClick={() => select(p.cuts[position + 1])}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </span>
                  <button
                    type="button"
                    className="icon-btn duplicate-clip"
                    title="Duplicate selected clip (Ctrl D)"
                    aria-label="Duplicate selected clip"
                    onClick={duplicate}
                  >
                    <Copy size={15} /> <span>Duplicate</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn remove-clip"
                    title="Remove selected clip (Delete)"
                    aria-label="Remove selected clip"
                    disabled={p.cuts.length === 1}
                    onClick={remove}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {(cut.highlight?.reason || cut.highlight?.score !== undefined) && (
                <ScoreCard highlight={cut.highlight!} />
              )}
              <div className="field-with-ai">
                <div className="field-head">
                  <label className="field-label" htmlFor="clip-name">
                    Clip name
                  </label>
                  {ai?.spoken && (
                    <AiSuggest
                      label="Suggest titles"
                      ai={ai.access}
                      run={() => ai.options('titles')}
                      pick={(option) => {
                        const next = option.slice(0, 64);
                        setTitle(next);
                        update({ title: next });
                      }}
                    />
                  )}
                </div>
                <input
                  id="clip-name"
                  value={title}
                  maxLength={64}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    const t = title.trim();
                    if (t) update({ title: t });
                    else setTitle(cut.title);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              </div>
              <div className="times" role="group" aria-label="Trim range">
                <TimeField label="In point" value={cut.start} commit={(n) => trim('start', n)} />
                <TimeField label="Out point" value={cut.end} commit={(n) => trim('end', n)} />
              </div>
              <LookPicker
                looks={looks.list}
                current={looks.current}
                apply={looks.apply}
                save={looks.save}
                remove={looks.remove}
                full={looks.list.filter((item) => !item.builtIn).length >= MAX_LOOKS}
              >
                <div className="look-row" role="group" aria-labelledby="look-title">
                  <small id="look-title">
                    {look.saved && look.name
                      ? `New clips start with the look “${look.name}”.`
                      : look.saved
                        ? 'New clips start with a saved look.'
                        : 'New clips start plain.'}
                  </small>
                  <span className="look-actions">
                    <button type="button" className="text-btn" onClick={look.save}>
                      <Palette size={13} aria-hidden="true" /> Use for new clips
                    </button>
                    {look.saved && (
                      <button type="button" className="text-btn" onClick={look.clear}>
                        Clear
                      </button>
                    )}
                  </span>
                </div>
              </LookPicker>
              <div className="clip-tools" role="tablist" aria-label="Clip settings">
                {CLIP_TOOLS.map(([value, label, Icon], index) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    id={`clip-tool-${value}`}
                    aria-controls="clip-tool-panel"
                    aria-selected={tool === value}
                    tabIndex={tool === value ? 0 : -1}
                    onClick={() => setTool(value)}
                    onKeyDown={(e) => {
                      const count = CLIP_TOOLS.length;
                      const next =
                        e.key === 'ArrowRight'
                          ? (index + 1) % count
                          : e.key === 'ArrowLeft'
                            ? (index - 1 + count) % count
                            : e.key === 'Home'
                              ? 0
                              : e.key === 'End'
                                ? count - 1
                                : -1;
                      if (next < 0) return;
                      e.preventDefault();
                      setTool(CLIP_TOOLS[next][0]);
                      e.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('[role=tab]')
                        [next]?.focus();
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div
                className="tool-panel"
                id="clip-tool-panel"
                role="tabpanel"
                aria-labelledby={`clip-tool-${tool}`}
              >
                {tool === 'frame' && (
                  <>
                    <FrameFields
                      p={p}
                      cut={cut}
                      update={update}
                      faces={faces}
                      findFaces={findFaces}
                      words={spoken ?? NO_WORDS}
                    />
                    <div className="settings-label-line">
                      <span className="field-label">Clip speed</span>
                      <small id="clip-speed-note">Voice pitch stays the same</small>
                    </div>
                    <div
                      className="format-options speed-options"
                      role="group"
                      aria-label="Clip speed"
                      aria-describedby="clip-speed-note"
                    >
                      {SPEEDS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={cutSpeed(cut) === value ? 'active' : ''}
                          aria-pressed={cutSpeed(cut) === value}
                          onClick={() => update({ speed: value === 1 ? undefined : value })}
                        >
                          {value}×
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {tool === 'text' && (
                  <>
                    <h3 className="tool-heading">Captions</h3>
                    {captions}
                    <div className="tool-heading-row">
                      <h3 className="tool-heading">Text on video</h3>
                      {ai?.spoken && (
                        <AiSuggest label="Suggest callouts" ai={ai.access} run={ai.callouts} />
                      )}
                    </div>
                    <TextFields
                      cut={cut}
                      layers={cutTexts(cut)}
                      playhead={playhead}
                      update={update}
                    />
                    <h3 className="tool-heading">Headline and logo</h3>
                    <div className="field-with-ai">
                      <div className="field-head">
                        <label className="field-label" htmlFor="clip-headline">
                          Headline
                        </label>
                        {ai?.spoken && (
                          <AiSuggest
                            label="Suggest hooks"
                            ai={ai.access}
                            run={() => ai.options('hooks')}
                            pick={(option) => {
                              const next = option.slice(0, HEADLINE_MAX);
                              setHeadline(next);
                              update({ headline: next });
                            }}
                          />
                        )}
                      </div>
                      <input
                        id="clip-headline"
                        aria-label="Headline"
                        maxLength={HEADLINE_MAX}
                        placeholder="Title at the top of the clip"
                        value={headline}
                        onChange={(e) => setHeadline(e.target.value)}
                        onBlur={() => update({ headline: headline.trim() })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </div>
                    <LogoFields p={p} cut={cut} update={update} notice={notice} />
                  </>
                )}
                {tool === 'audio' && (
                  <>
                    <div className="audio-toggles">
                      <button
                        type="button"
                        className="setting-toggle"
                        aria-labelledby="clip-voice-label"
                        aria-describedby="clip-voice-note"
                        aria-pressed={cutVoice(cut)}
                        onClick={() => update({ voice: !cutVoice(cut) })}
                      >
                        <span className="settings-summary">
                          <strong id="clip-voice-label">Clearer voice</strong>
                          <small id="clip-voice-note">Reduce low rumble when exporting.</small>
                        </span>
                        <span className="switch-track" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="setting-toggle"
                        aria-labelledby="clip-pause-label"
                        aria-describedby="clip-pause-note"
                        aria-pressed={cutPauses(cut)}
                        onClick={() => update({ pauses: cutPauses(cut) ? undefined : true })}
                      >
                        <span className="settings-summary">
                          <strong id="clip-pause-label">Cut out pauses</strong>
                          <small id="clip-pause-note" className="pause-note" aria-live="polite">
                            {pauseNote}
                          </small>
                        </span>
                        <span className="switch-track" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="setting-toggle"
                        aria-labelledby="clip-filler-label"
                        aria-describedby="clip-filler-note"
                        aria-pressed={cut.fillers === true}
                        disabled={!fillers.length && cut.fillers !== true}
                        onClick={() => update({ fillers: cut.fillers ? undefined : true })}
                      >
                        <span className="settings-summary">
                          <strong id="clip-filler-label">Cut ums and fillers</strong>
                          <small id="clip-filler-note">
                            {!spoken?.length
                              ? 'Fillers are found in the transcript, once there is one.'
                              : fillers.length
                                ? `${fillers.length} ${fillers.length === 1 ? 'filler' : 'fillers'} (um, uh, er) found, about ${Math.round(spanSeconds(fillers) * 10) / 10} s.`
                                : 'No ums or uhs in this clip.'}
                          </small>
                        </span>
                        <span className="switch-track" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="loudness-block">
                      <span className="field-label" id="loudness-title">
                        Export loudness
                      </span>
                      <div
                        className="format-options loudness-options"
                        role="group"
                        aria-labelledby="loudness-title"
                        aria-describedby="loudness-note"
                      >
                        {(
                          [
                            [null, 'Original'],
                            ...LOUDNESS.map(([value, label]) => [value, label] as const),
                          ] as const
                        ).map(([value, label]) => {
                          const Icon = LOUDNESS_ICONS[value ?? 'original'];
                          return (
                            <button
                              key={label}
                              type="button"
                              className={cutLoudness(cut) === value ? 'active' : ''}
                              aria-pressed={cutLoudness(cut) === value}
                              onClick={() => update({ loudness: value ?? undefined })}
                            >
                              <Icon size={14} aria-hidden="true" />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="fit-note" id="loudness-note">
                        {cutLoudness(cut)
                          ? `Evened out to ${loudnessLufs(cut)} LUFS when exporting, so clips play at a steady level.`
                          : 'Exports keep the clip’s own level.'}
                      </p>
                    </div>
                    <MusicFields cut={cut} update={update} notice={notice} />
                  </>
                )}
                {tool === 'broll' && (
                  <BrollFields
                    cut={cut}
                    shots={cutBroll(cut, videos)}
                    videos={videos}
                    own={p.id}
                    playhead={playhead}
                    update={update}
                  />
                )}
                {tool === 'post' && (
                  <PostFields
                    posts={cutPosts(cut)}
                    writing={posts.writing}
                    available={posts.available}
                    write={posts.write}
                    notice={notice}
                  />
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
