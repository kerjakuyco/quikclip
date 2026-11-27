import { Cpu } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_WHISPER_PORT, type LocalTranscriber } from '../transcriber';

/**
 * Transcribing on this computer: the port of a local Whisper server (and the model it should use, when it serves more
 * than one). Saving it starts the transcript; clearing it goes back to the cloud providers.
 */
export function TranscriberFields({
  transcriber,
  save,
}: {
  transcriber: LocalTranscriber | null;
  save: (transcriber: LocalTranscriber | null) => void;
}) {
  const [port, setPort] = useState(String(transcriber?.port ?? DEFAULT_WHISPER_PORT));
  const [model, setModel] = useState(transcriber?.model ?? '');
  const number = Number(port);
  const valid = Number.isInteger(number) && number > 0 && number < 65536;
  return (
    <form
      className="transcriber"
      aria-label="Transcribe on this computer"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save({ kind: 'local', port: number, model: model.trim() });
      }}
    >
      <strong>
        <Cpu size={14} aria-hidden="true" /> Transcribe on this computer
      </strong>
      <p>
        Run a Whisper server here (whisper.cpp’s server, Speaches, or faster-whisper-server) and
        nothing leaves your machine. It needs OpenAI’s transcription API at
        /v1/audio/transcriptions.
      </p>
      <div className="transcriber-fields">
        <label className="field-label">
          Port
          <input
            inputMode="numeric"
            value={port}
            aria-invalid={!valid}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
          />
        </label>
        <label className="field-label">
          Model <small>optional</small>
          <input
            placeholder="e.g. Systran/faster-whisper-small"
            value={model}
            maxLength={200}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
      </div>
      <div className="transcriber-actions">
        <button type="submit" className="btn secondary" disabled={!valid}>
          {transcriber ? 'Save and transcribe' : 'Use my Whisper server'}
        </button>
        {transcriber && (
          <button type="button" className="text-btn" onClick={() => save(null)}>
            Use the cloud instead
          </button>
        )}
      </div>
    </form>
  );
}
