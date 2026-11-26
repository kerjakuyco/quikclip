import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AudioLines,
  Captions,
  Check,
  ChevronDown,
  FileText,
  Film,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { HEADLINE_MAX } from '../headline';
import { defaultLogoCorner, LOGO_CORNERS } from '../logo';
import { cutSpeed, SPEEDS } from '../speed';
import { MUSIC_TYPES, musicRights, musicVolume, saveMusicRights } from '../music';
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

const inspectorTabs = [
  ['clips', 'Clips', Film],
  ['transcript', 'Transcript', FileText],
] as const;

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
        title="Enter seconds or a time such as 00:12.50"
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
      <span className="field-label">Background music</span>
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
          <p className="fit-note">Loops under the clip and fades in and out.</p>
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

function SettingsDisclosure({
  title,
  description,
  icon,
  expanded,
  onExpand,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="settings-disclosure"
      open={expanded}
      onToggle={(event) => onExpand(event.currentTarget.open)}
    >
      <summary>
        <span className="settings-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="settings-summary">
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <ChevronDown className="settings-chevron" size={15} aria-hidden="true" />
      </summary>
      <div className="settings-body">{children}</div>
    </details>
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
  const [expanded, setExpanded] = useState({ captions: false, overlays: false, audio: false });
  useEffect(() => setTitle(cut.title), [cut.id, cut.title]);
  useEffect(() => setHeadline(cut.headline ?? ''), [cut.id, cut.headline]);
  function expand(section: keyof typeof expanded, value: boolean) {
    setExpanded((previous) =>
      previous[section] === value ? previous : { ...previous, [section]: value },
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
        className="inspector-body inspector-clips"
        role="tabpanel"
        id="inspector-panel-clips"
        aria-labelledby="inspector-tab-clips"
        hidden={panel !== 'clips'}
      >
        {panel === 'clips' && (
          <>
            <section className="clip-bin" aria-labelledby="bin-title">
              <div className="bin-title">
                <div>
                  <h2 id="bin-title">Source clips</h2>
                  <span className="count">
                    {p.cuts.length} {p.cuts.length === 1 ? 'clip' : 'clips'}
                  </span>
                </div>
                <button
                  className="btn secondary highlight-action"
                  title="Suggest clips with your AI model"
                  onClick={analyze}
                >
                  <Sparkles size={14} />
                  Find highlights
                </button>
              </div>
              <div className="cut-list" role="group" aria-label="Clips">
                {p.cuts.map((c, i) => {
                  const thumbnail = frame(p, c.start);
                  return (
                    <button
                      key={c.id}
                      className={`cut-card${cut.id === c.id ? ' selected' : ''}`}
                      onClick={() => select(c)}
                      aria-pressed={cut.id === c.id}
                      title={c.title}
                    >
                      <span className="cut-thumb" aria-hidden="true">
                        {thumbnail ? (
                          <img src={thumbnail} alt="" loading="lazy" />
                        ) : (
                          <Film size={15} />
                        )}
                        <span className="cut-index">{String(i + 1).padStart(2, '0')}</span>
                      </span>
                      <span className="cut-copy">
                        <strong>{c.title}</strong>
                        <small>
                          {clock(c.start)} <span aria-hidden="true">→</span>
                          <span className="sr-only"> to </span> {clock(c.end)}
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
            </section>
            <section className="cut-settings" aria-labelledby="settings-title">
              <div className="settings-head">
                <h2 id="settings-title">
                  <SlidersHorizontal size={15} />
                  Edit selected clip
                </h2>
                <button
                  className="icon-btn"
                  title="Remove selected clip"
                  aria-label="Remove selected clip"
                  disabled={p.cuts.length === 1}
                  onClick={remove}
                >
                  <Trash2 size={15} />
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
              <div className="times" role="group" aria-label="Trim range">
                <TimeField label="In point" value={cut.start} commit={(n) => trim('start', n)} />
                <TimeField label="Out point" value={cut.end} commit={(n) => trim('end', n)} />
              </div>
              <span className="field-label">Output frame</span>
              <div className="format-options" role="group" aria-label="Output frame">
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
                  <span className="field-label">Frame fit</span>
                  <div className="format-options fit-options" role="group" aria-label="Frame fit">
                    {(
                      [
                        ['fill', 'Fill the frame', 'Crop the source to fill the output frame'],
                        [
                          'blur',
                          'Show the whole video',
                          'Fit the source with a blurred background',
                        ],
                      ] as const
                    ).map(([fit, label, hint]) => (
                      <button
                        key={fit}
                        className={cutFit(cut) === fit ? 'active' : ''}
                        aria-pressed={cutFit(cut) === fit}
                        title={hint}
                        onClick={() => update({ fit: fit as Fit })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
              <div className="clip-tool-sections">
                <SettingsDisclosure
                  title="Captions"
                  description="Style, colors, and translation"
                  icon={<Captions size={17} />}
                  expanded={expanded.captions}
                  onExpand={(value) => expand('captions', value)}
                >
                  {captions}
                </SettingsDisclosure>
                <SettingsDisclosure
                  title="Headline and logo"
                  description="Add a title or a corner logo"
                  icon={<Type size={17} />}
                  expanded={expanded.overlays}
                  onExpand={(value) => expand('overlays', value)}
                >
                  <label className="field-label">
                    Headline
                    <input
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
                  </label>
                  <LogoFields p={p} cut={cut} cuts={p.cuts} update={update} notice={notice} />
                </SettingsDisclosure>
                <SettingsDisclosure
                  title="Audio"
                  description="Voice cleanup, pauses, and music"
                  icon={<AudioLines size={17} />}
                  expanded={expanded.audio}
                  onExpand={(value) => expand('audio', value)}
                >
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
                  </div>
                  <MusicFields cut={cut} cuts={p.cuts} update={update} notice={notice} />
                </SettingsDisclosure>
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
