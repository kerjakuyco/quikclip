import {
  Ban,
  Contrast,
  Heading1,
  Heading2,
  Keyboard,
  MousePointerClick,
  MoveUp,
  Plus,
  Quote,
  Tag,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  MAX_TEXT_CHARS,
  MAX_TEXTS,
  newText,
  TEXT_ANIMATIONS,
  TEXT_PLACES,
  TEXT_PRESETS,
  type TextLayer,
} from '../texts';
import type { Cut } from '../studio';
import { SecondsField } from './BrollFields';
import { Swatches } from './Captions';

const PRESET_ICONS: Record<string, LucideIcon> = {
  title: Heading1,
  subtitle: Heading2,
  label: Tag,
  quote: Quote,
  cta: MousePointerClick,
};
const ANIMATION_ICONS: Record<string, LucideIcon> = {
  none: Ban,
  fade: Contrast,
  pop: Zap,
  slide: MoveUp,
  type: Keyboard,
};

/** The words of a layer, kept as typed and saved when the field is left. */
function Words({
  value,
  label,
  commit,
}: {
  value: string;
  label: string;
  commit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      className="text-words"
      aria-label={label}
      rows={2}
      maxLength={MAX_TEXT_CHARS}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text !== value) commit(text);
        else setText(value);
      }}
    />
  );
}

/** The clip's text layers: their words, style, entrance, place, colour and timing; and adding one at the playhead. */
export function TextFields({
  cut,
  layers,
  playhead,
  update,
}: {
  cut: Cut;
  layers: readonly TextLayer[];
  playhead: number;
  update: (c: Partial<Cut>) => void;
}) {
  const span = cut.end - cut.start;
  const change = (id: string, patch: Partial<TextLayer>) =>
    update({ texts: layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)) });
  return (
    <div className="text-fields">
      {layers.length === 0 && (
        <p className="fit-note">
          Put a title, a label, a quote or a call to action on the video. It appears at the playhead
          for three seconds; change its words, style, place and timing after.
        </p>
      )}
      {layers.map((layer, index) => {
        const name = `Text ${index + 1}`;
        return (
          <div key={layer.id} className="text-card" role="group" aria-label={name}>
            <div className="text-head">
              <Words
                value={layer.text}
                label={`${name} words`}
                commit={(text) => change(layer.id, { text })}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove text ${index + 1}`}
                onClick={() => update({ texts: layers.filter((item) => item.id !== layer.id) })}
              >
                <X size={14} />
              </button>
            </div>
            <div className="format-options text-presets" role="group" aria-label={`${name} style`}>
              {TEXT_PRESETS.map((preset) => {
                const Icon = PRESET_ICONS[preset.value];
                return (
                  <button
                    key={preset.value}
                    type="button"
                    className={layer.preset === preset.value ? 'active' : ''}
                    aria-pressed={layer.preset === preset.value}
                    onClick={() => change(layer.id, { preset: preset.value })}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div
              className="format-options text-animations"
              role="group"
              aria-label={`${name} entrance`}
            >
              {TEXT_ANIMATIONS.map((animation) => {
                const Icon = ANIMATION_ICONS[animation.value];
                return (
                  <button
                    key={animation.value}
                    type="button"
                    className={layer.animation === animation.value ? 'active' : ''}
                    aria-pressed={layer.animation === animation.value}
                    onClick={() => change(layer.id, { animation: animation.value })}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {animation.label}
                  </button>
                );
              })}
            </div>
            <div className="text-place-row">
              <div className="text-places" role="group" aria-label={`${name} place`}>
                {TEXT_PLACES.map((place) => {
                  const on =
                    Math.abs(layer.x - place.x) < 0.01 && Math.abs(layer.y - place.y) < 0.01;
                  return (
                    <button
                      key={place.label}
                      type="button"
                      aria-label={place.label}
                      title={place.label}
                      aria-pressed={on}
                      className={on ? 'active' : ''}
                      onClick={() => change(layer.id, { x: place.x, y: place.y })}
                    >
                      <i aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <div className="text-times">
                <SecondsField
                  label="Shows at"
                  value={layer.at}
                  min={0}
                  max={Math.max(0, span - 0.2)}
                  commit={(at) =>
                    change(layer.id, { at, length: Math.min(layer.length, span - at) })
                  }
                />
                <SecondsField
                  label="For"
                  value={layer.length}
                  min={0.2}
                  max={Math.max(0.2, span - layer.at)}
                  commit={(length) => change(layer.id, { length })}
                />
              </div>
            </div>
            <Swatches
              label="Colour"
              group={`${name} colour`}
              value={layer.color ?? '#FFFFFF'}
              onChange={(color) => change(layer.id, { color })}
            />
          </div>
        );
      })}
      <button
        type="button"
        className="btn secondary asset-button"
        disabled={layers.length >= MAX_TEXTS || span < 0.4}
        onClick={() => update({ texts: [...layers, newText(cut, playhead)] })}
      >
        <Plus size={13} /> Add text at the playhead
      </button>
    </div>
  );
}
