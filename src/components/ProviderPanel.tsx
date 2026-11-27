import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Cloud, HardDrive, LoaderCircle, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { Select } from './Select';
import { desktop, errorText, readSaved } from '../studio';
import {
  HIGHLIGHT_COUNTS,
  HIGHLIGHT_LENGTHS,
  LONGEST_CLIP,
  MAX_HIGHLIGHTS,
  SHORTEST_CLIP,
  cleanHighlightOptions,
  loadHighlightOptions,
  rememberHighlightOptions,
  type HighlightOptions,
} from '../highlights';

const providers = {
  ollama: {
    label: 'Ollama',
    cloud: false,
    help: 'Start Ollama and install a vision model, for example: ollama pull gemma3:4b.',
  },
  lmstudio: {
    label: 'LM Studio',
    cloud: false,
    help: 'Download a vision model in LM Studio and start its local server in the Developer tab.',
  },
  openrouter: {
    label: 'OpenRouter',
    cloud: true,
    help: 'Use an OpenRouter API key. Quikclip checks it and lists models that accept images.',
  },
  cloudflare: {
    label: 'Cloudflare Gateway',
    cloud: true,
    help: 'Use a Cloudflare token with Account → Workers AI → Read. Choose your gateway or use default.',
  },
} as const;
type Provider = keyof typeof providers;
export type Connection = {
  provider: Provider;
  port?: number;
  accountId?: string;
  gateway?: string;
};
type Model = { id: string; name: string };
type Profile = { connection: Connection; models: Model[]; model: string; custom: boolean };
/** Keep a typed gateway id that is not in the catalog. An empty custom id does not stick once vision models load. */
function chosenModel(
  provider: Provider,
  profile: Profile | undefined,
  models: Model[],
  preferredModel: string | null,
) {
  const savedModel = profile?.model ?? '';
  const listed =
    [savedModel, preferredModel, models[0]?.id].find(
      (id) => !!id && models.some((m) => m.id === id),
    ) ?? '';
  const keepCustom =
    provider === 'cloudflare' &&
    profile?.custom === true &&
    savedModel.length > 0 &&
    !models.some((m) => m.id === savedModel);
  const custom = provider === 'cloudflare' && (keepCustom || models.length === 0);
  return { custom, model: keepCustom ? savedModel : custom ? '' : listed };
}
type Settings = { active: Provider; profiles: Partial<Record<Provider, Profile>> };
const initial: Settings = { active: 'ollama', profiles: {} };
const storageKey = 'ai.providers';
/** A saved cloud connection that can turn speech into text (Whisper on OpenRouter or Cloudflare), the active one first. */
export function transcriptionConnection(): { connection: Connection; label: string } | null {
  const settings = readSaved<Settings>(storageKey, initial);
  for (const provider of [settings.active, 'cloudflare', 'openrouter'] as Provider[]) {
    if (provider !== 'cloudflare' && provider !== 'openrouter') continue;
    const profile = settings.profiles?.[provider];
    if (profile?.connection)
      return { connection: profile.connection, label: providers[provider].label };
  }
  return null;
}

/** The model Highlight finder would use, for a short caption translation. */
export function suggestionModel(): { connection: Connection; model: string } | null {
  const settings = readSaved<Settings>(storageKey, initial);
  const order = [settings.active, 'cloudflare', 'openrouter', 'ollama', 'lmstudio'] as Provider[];
  const seen = new Set<Provider>();
  for (const provider of order) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    const profile = settings.profiles?.[provider];
    const model = profile?.model?.trim();
    if (profile?.connection && model) return { connection: profile.connection, model };
  }
  return null;
}

/** A length preset as a clock mark, so 90 seconds reads 1:30 rather than 1.5 min. */
function lengthMark(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The short end of a search. A preset uses 20s, or half the limit when that limit is under 40s. */
function clipFloor(maxSeconds: number, minSeconds?: number) {
  return minSeconds ?? Math.min(20, maxSeconds / 2);
}

const defaults = (provider: Provider): Connection =>
  provider === 'cloudflare'
    ? { provider, gateway: 'default', accountId: '' }
    : provider === 'openrouter'
      ? { provider }
      : { provider, port: provider === 'ollama' ? 11434 : 1234 };

export function ProviderPanel({
  busy,
  analyze,
}: {
  busy: boolean;
  analyze: (connection: Connection, model: string, options: HighlightOptions) => Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings>(() => readSaved(storageKey, initial));
  const provider = settings.active,
    meta = providers[provider],
    profile = settings.profiles[provider];
  const [form, setForm] = useState<Connection>(() => profile?.connection ?? defaults(provider));
  const [expanded, setExpanded] = useState(!profile);
  const [options, setOptions] = useState(loadHighlightOptions);
  const [key, setKey] = useState(''),
    [working, setWorking] = useState(false),
    [problem, setProblem] = useState('');
  const disabled = busy || working || !desktop;
  // A length range of your own, instead of a preset limit.
  const [custom, setCustom] = useState(
    () =>
      options.minSeconds !== undefined ||
      !(HIGHLIGHT_LENGTHS as readonly number[]).includes(options.maxSeconds),
  );
  function configure(patch: Partial<HighlightOptions>) {
    const next = cleanHighlightOptions({ ...options, ...patch });
    setOptions(next);
    rememberHighlightOptions(next);
  }
  function store(next: Settings) {
    setSettings(next);
    try {
      localStorage.setItem(`quikclip.1.${storageKey}`, JSON.stringify(next));
    } catch {
      setProblem('Your selection will be available for this session only.');
    }
  }
  function switchTo(next: Provider) {
    const saved = settings.profiles[next];
    setKey('');
    setProblem('');
    setForm(saved?.connection ?? defaults(next));
    setExpanded(!saved);
    store({ ...settings, active: next });
  }
  function changeProfile(next: Profile) {
    store({ ...settings, profiles: { ...settings.profiles, [provider]: next } });
  }
  async function connect() {
    setWorking(true);
    setProblem('');
    try {
      const { models, preferredModel } = await invoke<{
        models: Model[];
        preferredModel: string | null;
      }>('connect_ai', { connection: form, apiKey: key.trim() || null });
      const { custom, model } = chosenModel(provider, profile, models, preferredModel);
      changeProfile({ connection: form, models, model, custom });
      setKey('');
      setExpanded(false);
      if (!model) {
        setProblem(
          provider === 'cloudflare'
            ? 'Enter a gateway model ID to analyze this source.'
            : 'Choose a vision model to analyze this source.',
        );
        return null;
      }
      return { connection: form, model };
    } catch (e) {
      setProblem(errorText(e));
      return null;
    } finally {
      setWorking(false);
    }
  }
  async function analyzeSource() {
    if (!profile) return;
    setProblem('');
    let connection = profile.connection;
    let model = profile.model;
    if (!model) {
      if (provider === 'cloudflare' && profile.models.length === 0) {
        const loaded = await connect();
        if (!loaded) return;
        connection = loaded.connection;
        model = loaded.model;
      } else {
        setProblem('Choose a vision model to analyze this source.');
        return;
      }
    }
    await analyze(connection, model, options);
  }
  async function forget() {
    if (!profile) return;
    setWorking(true);
    setProblem('');
    try {
      await invoke('forget_ai', { connection: profile.connection });
      const profiles = { ...settings.profiles };
      delete profiles[provider];
      store({ ...settings, profiles });
      setForm(defaults(provider));
      setExpanded(true);
      setKey('');
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="provider-panel">
      <p>Choose the vision model that finds highlights in your footage.</p>
      <div className="provider-grid" aria-label="AI provider">
        {(Object.keys(providers) as Provider[]).map((id) => {
          const item = providers[id],
            Icon = item.cloud ? Cloud : HardDrive;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={id === provider}
              disabled={working || busy}
              onClick={() => switchTo(id)}
            >
              <Icon size={16} />
              <span>
                {item.label}
                <small>{item.cloud ? 'Cloud' : 'Local server'}</small>
              </span>
              {id === provider && <Check size={13} />}
            </button>
          );
        })}
      </div>
      {!desktop && (
        <p className="subnote">Open the desktop app to connect providers and analyze video.</p>
      )}
      {expanded ? (
        <form
          className="connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <p>{meta.help}</p>
          {!meta.cloud && (
            <label className="field-label">
              Local server port
              <input
                type="number"
                min="1"
                max="65535"
                required
                value={form.port || ''}
                disabled={disabled}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
            </label>
          )}
          {provider === 'cloudflare' && (
            <>
              <label className="field-label">
                Account ID
                <input
                  autoComplete="off"
                  required
                  pattern="[0-9A-Fa-f]{32}"
                  placeholder="32-character account ID"
                  value={form.accountId ?? ''}
                  disabled={disabled}
                  onChange={(e) => setForm({ ...form, accountId: e.target.value.trim() })}
                />
              </label>
              <label className="field-label">
                Gateway ID
                <input
                  required
                  value={form.gateway ?? ''}
                  placeholder="default"
                  disabled={disabled}
                  onChange={(e) => setForm({ ...form, gateway: e.target.value.trim() })}
                />
              </label>
            </>
          )}
          {provider !== 'ollama' && (
            <label className="field-label">
              {meta.cloud ? 'API token' : 'Server token (optional)'}
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={disabled}
                placeholder={
                  profile
                    ? 'Leave blank to use the saved credential'
                    : 'Stored in your system keychain'
                }
              />
            </label>
          )}
          <div className="provider-actions">
            <button className="btn secondary" type="submit" disabled={disabled}>
              {working ? <LoaderCircle className="spin" size={14} /> : <Plug size={14} />} Connect &
              load models
            </button>
            {profile && (
              <button
                className="text-btn"
                type="button"
                disabled={disabled}
                onClick={() => {
                  setForm(profile.connection);
                  setExpanded(false);
                  setKey('');
                  setProblem('');
                }}
              >
                Back
              </button>
            )}
          </div>
        </form>
      ) : (
        profile && (
          <>
            <div className="provider-actions">
              <span className="connection-label">
                <Check size={13} />
                Saved connection
              </span>
              <button
                className="text-btn"
                disabled={disabled}
                onClick={() => {
                  setExpanded(true);
                  setProblem('');
                }}
              >
                Edit connection
              </button>
            </div>
            <div className="field-label">
              <span aria-hidden="true">Vision model</span>
              <Select
                className="select-field"
                label="Vision model"
                disabled={disabled}
                value={profile.custom ? '__custom' : profile.model}
                onChange={(next) => {
                  const custom = next === '__custom';
                  changeProfile({ ...profile, custom, model: custom ? '' : next });
                }}
                options={[
                  ...(!profile.models.length && provider !== 'cloudflare'
                    ? [{ value: '', label: 'No vision models installed' }]
                    : []),
                  ...profile.models.map((m) => ({ value: m.id, label: m.name })),
                  ...(provider === 'cloudflare'
                    ? [{ value: '__custom', label: 'Other gateway model…' }]
                    : []),
                ]}
              />
            </div>
            {profile.custom && (
              <label className="field-label">
                Gateway model ID
                <input
                  placeholder="e.g. openai/gpt-4.1"
                  value={profile.model}
                  disabled={disabled}
                  onChange={(e) => changeProfile({ ...profile, model: e.target.value.trim() })}
                />
              </label>
            )}
            {!profile.models.length && !profile.custom && (
              <p className="subnote">{meta.help} Then refresh models.</p>
            )}
            <div className="provider-actions">
              <button className="text-btn" disabled={disabled} onClick={() => void connect()}>
                <RefreshCw size={12} className={working ? 'spin' : ''} />
                Refresh models
              </button>
              <button className="text-btn" disabled={disabled} onClick={() => void forget()}>
                Forget connection
              </button>
            </div>
            <div className="highlight-options">
              <div className="highlight-field">
                <div className="highlight-field-head">
                  <span id="highlight-count-label">Highlights to find</span>
                  <input
                    type="number"
                    className="number-field"
                    aria-label="Highlights to find"
                    title="Type any count from 1 to 20"
                    min={1}
                    max={MAX_HIGHLIGHTS}
                    value={options.count}
                    disabled={disabled}
                    onChange={(e) => configure({ count: Number(e.target.value) })}
                  />
                </div>
                <div
                  className="highlight-choices"
                  role="group"
                  aria-labelledby="highlight-count-label"
                >
                  {HIGHLIGHT_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      disabled={disabled}
                      className={options.count === count ? 'active' : ''}
                      aria-pressed={options.count === count}
                      onClick={() => configure({ count })}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <div className="highlight-field">
                <div className="highlight-field-head">
                  <span id="highlight-length-label">Clip length</span>
                  <span className="highlight-length-now">
                    {lengthMark(clipFloor(options.maxSeconds, options.minSeconds))}–
                    {lengthMark(options.maxSeconds)}
                  </span>
                </div>
                <div
                  className="highlight-choices"
                  role="group"
                  aria-labelledby="highlight-length-label"
                >
                  {HIGHLIGHT_LENGTHS.map((maxSeconds) => {
                    const on = !custom && options.maxSeconds === maxSeconds;
                    return (
                      <button
                        key={maxSeconds}
                        type="button"
                        disabled={disabled}
                        className={on ? 'active' : ''}
                        aria-pressed={on}
                        aria-label={`Up to ${maxSeconds} seconds`}
                        onClick={() => {
                          setCustom(false);
                          configure({ maxSeconds, minSeconds: undefined });
                        }}
                      >
                        {lengthMark(maxSeconds)}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={disabled}
                    className={custom ? 'active' : ''}
                    aria-pressed={custom}
                    onClick={() => {
                      setCustom(true);
                      configure({
                        minSeconds: options.minSeconds ?? Math.min(20, options.maxSeconds / 2),
                      });
                    }}
                  >
                    Custom
                  </button>
                </div>
                <p className="subnote">
                  Finds clips from {lengthMark(clipFloor(options.maxSeconds, options.minSeconds))}{' '}
                  to {lengthMark(options.maxSeconds)}, not one exact length.
                </p>
                {custom && (
                  <div className="highlight-range" role="group" aria-label="Clip length range">
                    <label>
                      <span>Shortest</span>
                      <input
                        type="number"
                        className="number-field"
                        aria-label="Shortest clip, in seconds"
                        min={SHORTEST_CLIP}
                        max={options.maxSeconds - SHORTEST_CLIP}
                        value={options.minSeconds ?? 20}
                        disabled={disabled}
                        onChange={(e) => configure({ minSeconds: Number(e.target.value) })}
                      />
                      <span>s</span>
                    </label>
                    <span className="highlight-range-rule" aria-hidden="true" />
                    <label>
                      <span>Longest</span>
                      <input
                        type="number"
                        className="number-field"
                        aria-label="Longest clip, in seconds"
                        min={SHORTEST_CLIP * 2}
                        max={LONGEST_CLIP}
                        value={options.maxSeconds}
                        disabled={disabled}
                        onChange={(e) => configure({ maxSeconds: Number(e.target.value) })}
                      />
                      <span>s</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <p className="subnote">
              Analysis sends the transcript when available, otherwise nine sampled frames and
              timestamps, to {meta.label}. Your original video stays on this device.
              {options.count > 8 &&
                ' Many highlights are found a part of the video at a time, so a search takes longer.'}
            </p>
            {!profile.model && (
              <p className="subnote">
                {provider === 'cloudflare' && !profile.models.length
                  ? 'No vision model is selected. Analyze source will load one from this account.'
                  : 'Choose a vision model to analyze this source.'}
              </p>
            )}
            <button
              type="button"
              className="btn primary wide"
              disabled={disabled}
              onClick={() => void analyzeSource()}
            >
              <Sparkles size={15} />
              Analyze source
            </button>
          </>
        )
      )}
      {problem && (
        <div role="alert" className="error">
          {problem}
        </div>
      )}
    </div>
  );
}
