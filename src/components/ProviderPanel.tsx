import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Cloud, HardDrive, LoaderCircle, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { desktop, errorText, readSaved } from '../studio';

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
type Settings = { active: Provider; profiles: Partial<Record<Provider, Profile>> };
const initial: Settings = { active: 'ollama', profiles: {} };
const storageKey = 'ai.providers';
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
  analyze: (connection: Connection, model: string) => Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings>(() => readSaved(storageKey, initial));
  const provider = settings.active,
    meta = providers[provider],
    profile = settings.profiles[provider];
  const [form, setForm] = useState<Connection>(() => profile?.connection ?? defaults(provider));
  const [expanded, setExpanded] = useState(!profile);
  const [key, setKey] = useState(''),
    [working, setWorking] = useState(false),
    [problem, setProblem] = useState('');
  const disabled = busy || working || !desktop;
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
      const custom = provider === 'cloudflare' && (profile?.custom === true || !models.length);
      const model = custom
        ? profile?.custom
          ? profile.model
          : ''
        : ([profile?.model, preferredModel, models[0]?.id].find((id) =>
            models.some((m) => m.id === id),
          ) ?? '');
      changeProfile({ connection: form, models, model, custom });
      setKey('');
      setExpanded(false);
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setWorking(false);
    }
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
            <label className="field-label">
              Vision model
              <select
                disabled={disabled}
                value={profile.custom ? '__custom' : profile.model}
                onChange={(e) => {
                  const custom = e.target.value === '__custom';
                  changeProfile({ ...profile, custom, model: custom ? '' : e.target.value });
                }}
              >
                {!profile.models.length && provider !== 'cloudflare' && (
                  <option value="">No vision models installed</option>
                )}
                {profile.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
                {provider === 'cloudflare' && (
                  <option value="__custom">Other gateway model…</option>
                )}
              </select>
            </label>
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
            <p className="subnote">
              {meta.cloud
                ? `Analysis sends a nine-frame contact sheet and timestamps to ${meta.label}. Your original video stays on this device.`
                : `Analysis sends sampled frames to your ${meta.label} server on port ${profile.connection.port}.`}
            </p>
            <button
              className="btn primary wide"
              disabled={disabled || !profile.model}
              onClick={() => void analyze(profile.connection, profile.model)}
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
