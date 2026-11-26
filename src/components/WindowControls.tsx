import { useEffect, useState } from 'react';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';

export function WindowControls({
  frame,
  notice,
}: {
  frame: TauriWindow;
  notice: (message: string) => void;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    let resizeFrame = 0;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        void frame
          .isMaximized()
          .then((value) => {
            if (active) setMaximized(value);
          })
          .catch(() => {});
      });
    };
    refresh();
    void frame
      .onResized(refresh)
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});
    return () => {
      active = false;
      cancelAnimationFrame(resizeFrame);
      unlisten?.();
    };
  }, [frame]);

  const maximizeLabel = maximized ? 'Restore window' : 'Maximize window';
  function perform(action: () => Promise<void>, failure: string) {
    void action().catch(() => notice(failure));
  }

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => perform(() => frame.minimize(), 'Could not minimize the window.')}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onClick={() =>
          perform(async () => {
            await frame.toggleMaximize();
            setMaximized(await frame.isMaximized());
          }, 'Could not resize the window.')
        }
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button
        type="button"
        className="window-close"
        aria-label="Close window"
        title="Close"
        onClick={() => perform(() => frame.close(), 'Could not close the window.')}
      >
        <X size={16} />
      </button>
    </div>
  );
}
