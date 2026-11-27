/**
 * Where speech becomes text. By default Whisper on a connected cloud provider (OpenRouter or Cloudflare); or a Whisper
 * server on this computer (src-tauri providers.rs Provider::Whisper) — whisper.cpp's server, Speaches, or
 * faster-whisper-server — so nothing leaves the machine and an hour of talk costs nothing.
 */
export type LocalTranscriber = { kind: 'local'; port: number; model: string };

const KEY = 'quikclip.1.transcriber';
/** Speaches and faster-whisper-server listen here; whisper.cpp's server on 8080. */
export const DEFAULT_WHISPER_PORT = 8000;

export function readTranscriber(): LocalTranscriber | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalTranscriber | null;
    if (
      saved?.kind === 'local' &&
      Number.isInteger(saved.port) &&
      saved.port > 0 &&
      saved.port < 65536
    )
      return { kind: 'local', port: saved.port, model: String(saved.model ?? '').slice(0, 200) };
  } catch {
    // Unreadable: the cloud providers apply.
  }
  return null;
}

export function writeTranscriber(transcriber: LocalTranscriber | null) {
  try {
    if (transcriber) localStorage.setItem(KEY, JSON.stringify(transcriber));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for the session only.
  }
}

/** The connection the desktop side transcribes with, for a local server. */
export function localConnection(transcriber: LocalTranscriber) {
  return {
    provider: 'whisper',
    port: transcriber.port,
    model: transcriber.model.trim() || null,
  };
}
