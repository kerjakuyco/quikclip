import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  WandSparkles,
  Trash2,
} from 'lucide-react';
import { HEADLINE_MAX } from '../headline';
import { defaultLogoCorner, LOGO_CORNERS } from '../logo';
import { cutSpeed, SPEEDS } from '../speed';
import { MUSIC_TYPES, musicRights, musicVolume, rememberMusicRights } from '../music';
import {
  clock,
  cutFit,
  cutLogo,
  cutMusic,
  cutPauses,
  cutVoice,
  desktop,
  errorText,
  frame,
  keepLogoFile,
  keepMusicFile,
  outputFrame,
  parseTime,
  pickLogoFile,
  pickMusicFile,
  releaseLogo,
  releaseMusic,
  type Project,
  type Cut,
  type CutLogo,
  type CutMusic,
  type Fit,
  type Shape,
} from '../studio';

function TimeField({
  label,
  value,
  commit,
}: {
  label: string;
  value: number;
  commit: (n: number) => void;
}) {
  const [text, set] = useState(clock(value, true));
  useEffect(() => set(clock(value, true)), [value]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        value={text}
        onChange={(e) => set(e.target.value)}
        onBlur={() => {
          const n = parseTime(text);
          if (Number.isFinite(n)) commit(n);
          set(clock(value, true));
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
  cuts,
  update,
  notice,
}: {
  cut: Cut;
  cuts: Cut[];
  update: (c: Partial<Cut>) => void;
  notice: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rights, setRights] = useState(musicRights);
  const [adding, setAdding] = useState(false);
  const music = cutMusic(cut);
  function clear(track: CutMusic) {
    update({ music: undefined });
    if (!cuts.some((c) => c.id !== cut.id && c.music?.source === track.source))
      releaseMusic(track.source);
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
      <span className="field-label">Music</span>
      {music ? (
        <>
          <div className="music-row">
            <span className="music-name" title={music.name}>
              {music.name}
            </span>
            <button
              type="button"
              className="text-btn"
              aria-label="Remove music"
              onClick={() => clear(music)}
            >
              Remove
            </button>
          </div>
          <label className="music-volume">
            Volume
            <input
              type="range"
              aria-label="Music volume"
              min={0}
              max={100}
              step={5}
              value={Math.round(musicVolume(music) * 100)}
              onChange={(e) =>
                update({ music: { ...music, volume: Number(e.target.value) / 100 } })
              }
            />
            <span>{Math.round(musicVolume(music) * 100)}%</span>
          </label>
          <p className="fit-note">Under the clip, faded in and out, and looped.</p>
        </>
      ) : (
        <>
          {!rights && (
            <label className="music-rights">
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => {
                  if (e.target.checked) rememberMusicRights();
                  setRights(e.target.checked);
                }}
              />
              I own this music or have permission to use it.
            </label>
          )}
          <button
            type="button"
            className="sound-toggle"
            disabled={!rights || adding}
            onClick={() => {
              if (desktop) void add();
              else fileRef.current?.click();
            }}
          >
            {adding ? 'Reading…' : 'Add music'}
          </button>
          {rights && !desktop && (
            <input
              ref={fileRef}
              className="music-file"
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
          <p className="fit-note">MP3, WAV, M4A, OGG, FLAC or AAC, up to 20 MB and 20 minutes.</p>
        </>
      )}
    </div>
  );
}
function LogoFields({
  p,
  cut,
  cuts,
  update,
  notice,
}: {
  p: Project;
  cut: Cut;
  cuts: Cut[];
  update: (c: Partial<Cut>) => void;
  notice: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const logo = cutLogo(cut);
  const frameSize = outputFrame(cut.shape, p.width, p.height);
  function clear(mark: CutLogo) {
    update({ logo: undefined });
    if (!cuts.some((c) => c.id !== cut.id && c.logo?.source === mark.source))
      releaseLogo(mark.source);
  }
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
              onClick={() => clear(logo)}
            >
              Remove
            </button>
          </div>
          <div role="group" aria-label="Logo corner" className="format-options logo-corners">
            {LOGO_CORNERS.map((corner) => (
              <button
                key={corner.value}
                type="button"
                className={logo.corner === corner.value ? 'active' : ''}
                aria-pressed={logo.corner === corner.value}
                onClick={() => update({ logo: { ...logo, corner: corner.value } })}
              >
                {corner.label}
              </button>
            ))}
          </div>
          <p className="fit-note">In a corner of the frame.</p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="sound-toggle"
            disabled={adding}
            onClick={() => {
              if (desktop) void add();
              else fileRef.current?.click();
            }}
          >
            {adding ? 'Reading…' : 'Show my logo'}
          </button>
          {!desktop && (
            <input
              ref={fileRef}
              className="logo-file"
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
            PNG with a transparent background, up to 2 MB and 4096 px a side.
          </p>
        </>
      )}
    </div>
  );
}
export function Inspector({
  p,
  cut,
  select,
  update,
  trim,
  analyze,
  remove,
  notice,
  pauseNote,
  captions,
  transcript,
  panel,
  setPanel,
}: {
  p: Project;
  cut: Cut;
  select: (c: Cut) => void;
  update: (c: Partial<Cut>) => void;
  trim: (k: 'start' | 'end', n: number) => void;
  analyze: () => void;
  remove: () => void;
  notice: (text: string) => void;
  pauseNote: string;
  /** The captions section (components/Captions.tsx CaptionFields). */
  captions: ReactNode;
  /** The video's transcript (components/TranscriptPanel.tsx). */
  transcript: ReactNode;
  panel: 'clips' | 'transcript';
  setPanel: (panel: 'clips' | 'transcript') => void;
}) {
  const [title, setTitle] = useState(cut.title);
  const [headline, setHeadline] = useState(cut.headline ?? '');
  useEffect(() => setTitle(cut.title), [cut.id, cut.title]);
  useEffect(() => setHeadline(cut.headline ?? ''), [cut.id, cut.headline]);
  return (
    <aside className="inspector panel">
      <div className="panel-tabs" role="tablist" aria-label="Clips and transcript">
        {(
          [
            ['clips', 'Clips'],
            ['transcript', 'Transcript'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={panel === value}
            className={panel === value ? 'active' : ''}
            onClick={() => setPanel(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {panel === 'transcript' ? (
        transcript
      ) : (
        <>
          <div className="panel-heading">
            <h2>
              <Sparkles className="accent" />
              Clip assistant
            </h2>
            <span className="ai-chip">AI</span>
          </div>
          <div className="ai-box">
            <span className="ai-orbit">
              <WandSparkles size={23} />
            </span>
            <div>
              <strong>Highlight finder</strong>
              <p>Find standout moments with your AI model.</p>
            </div>
            <button onClick={analyze}>
              <Sparkles size={14} /> Find highlights <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="bin-title">
            <span className="eyebrow">Clip bin</span>
            <span className="count">{String(p.cuts.length).padStart(2, '0')}</span>
          </div>
          <div className="cut-list">
            {p.cuts.map((c, i) => (
              <button
                key={c.id}
                className={`cut-card ${cut.id === c.id ? 'selected' : ''}`}
                onClick={() => select(c)}
                aria-pressed={cut.id === c.id}
              >
                <span className="cut-thumb">
                  <img src={frame(p, c.start)} alt="" />
                  <i>{String(i + 1).padStart(2, '0')}</i>
                </span>
                <span className="cut-copy">
                  <strong>{c.title}</strong>
                  <small>
                    {clock(c.start)} <span>–</span> {clock(c.end)}
                  </small>
                </span>
                {cut.id === c.id && <Check className="accent" size={14} />}
              </button>
            ))}
          </div>
          <div className="cut-settings">
            <div className="settings-head">
              <h3>
                <SlidersHorizontal size={15} />
                Cut settings
              </h3>
              <button
                className="icon-btn"
                title="Remove selected clip"
                aria-label="Remove selected clip"
                disabled={p.cuts.length === 1}
                onClick={remove}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <label className="field-label">
              Clip name
              <input
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
            </label>
            <div className="times">
              <TimeField label="In point" value={cut.start} commit={(n) => trim('start', n)} />
              <TimeField label="Out point" value={cut.end} commit={(n) => trim('end', n)} />
            </div>
            <span className="field-label">Output frame</span>
            <div className="format-options">
              {(
                [
                  ['source', 'Original', RectangleHorizontal],
                  ['vertical', '9:16', RectangleVertical],
                  ['square', '1:1', Square],
                ] as const
              ).map(([shape, label, Icon]) => (
                <button
                  key={shape}
                  className={cut.shape === shape ? 'active' : ''}
                  aria-pressed={cut.shape === shape}
                  onClick={() => update({ shape: shape as Shape })}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            {cut.shape !== 'source' && (
              <>
                <span className="field-label">Fit</span>
                <div className="format-options fit-options">
                  {(
                    [
                      ['fill', 'Fill', 'Fill the frame'],
                      ['blur', 'Whole', 'Show the whole video'],
                    ] as const
                  ).map(([fit, label, name]) => (
                    <button
                      key={fit}
                      className={cutFit(cut) === fit ? 'active' : ''}
                      aria-pressed={cutFit(cut) === fit}
                      aria-label={name}
                      title={name}
                      onClick={() => update({ fit: fit as Fit })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="field-label">Speed</span>
            <div className="format-options speed-options" role="group" aria-label="Speed">
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
            <p className="fit-note">A little faster holds attention. The voice keeps its pitch.</p>
            <label className="field-label">
              Headline
              <input
                aria-label="Headline"
                maxLength={HEADLINE_MAX}
                placeholder="Shown at the top of the clip"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                onBlur={() => update({ headline: headline.trim() })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
            {captions}
            <LogoFields p={p} cut={cut} cuts={p.cuts} update={update} notice={notice} />
            <span className="field-label">Sound</span>
            <button
              className={`sound-toggle ${cutVoice(cut) ? 'active' : ''}`}
              aria-pressed={cutVoice(cut)}
              onClick={() => update({ voice: !cutVoice(cut) })}
            >
              Clearer voice
            </button>
            <p className="fit-note">Takes the rumble out when the clip is exported.</p>
            <button
              className={`sound-toggle ${cutPauses(cut) ? 'active' : ''}`}
              aria-pressed={cutPauses(cut)}
              onClick={() => update({ pauses: cutPauses(cut) ? undefined : true })}
            >
              Cut out pauses
            </button>
            <p className="fit-note pause-note">{pauseNote}</p>
            <MusicFields cut={cut} cuts={p.cuts} update={update} notice={notice} />
          </div>
        </>
      )}
    </aside>
  );
}
