import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clapperboard,
  Film,
  Keyboard,
  Layers3,
  Plus,
  Trash2,
} from 'lucide-react';
import mark from '../assets/quikclip-mark.svg';
import { desktop, frame, type Project } from '../studio';
import { WindowControls } from './WindowControls';

export type Page = 'Clip editor' | 'Media library' | 'Exports';

const nav = [
  ['Clip editor', Clapperboard],
  ['Media library', Layers3],
  ['Exports', ArrowDownToLine],
] as const;

function useWindowFrame() {
  const [frame, setFrame] = useState<TauriWindow | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void (async () => {
      const window = getCurrentWindow();
      if ((await window.isDecorated()) === false && active) setFrame(window);
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return frame;
}

export function StudioShell({
  page,
  project,
  projects,
  saved,
  busy,
  onNavigate,
  onChoose,
  onDelete,
  onImport,
  onExport,
  onShortcuts,
  onGuide,
  notice,
  children,
}: {
  page: Page;
  project: Project;
  projects: Project[];
  saved: boolean;
  busy: boolean;
  onNavigate: (page: Page) => void;
  onChoose: (p: Project) => void;
  onDelete: (p: Project) => void;
  onImport: () => void;
  onExport: () => void;
  onShortcuts: () => void;
  onGuide: () => void;
  notice: (message: string) => void;
  children: ReactNode;
}) {
  const windowFrame = useWindowFrame();
  const workspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    workspace.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header
        className={`topbar${windowFrame ? ' topbar-native' : ''}`}
        data-tauri-drag-region={windowFrame ? 'deep' : undefined}
      >
        <div className="brand">
          <img src={mark} alt="" width={32} height={32} />
          <strong>Quikclip</strong>
          <span>Studio</span>
        </div>
        <div className="breadcrumbs" aria-hidden="true">
          <span>Workspace</span>
          <ChevronRight size={13} />
          <b>{page}</b>
        </div>
        <div className="top-actions">
          <span
            className={`save-status${saved ? '' : ' unsaved'}`}
            title={saved ? 'Saved on this device' : 'Storage full. Changes are not saved.'}
            role="status"
          >
            {saved ? <Check size={14} /> : <CircleAlert size={14} />}
            <span>{saved ? 'Saved locally' : 'Storage full · unsaved'}</span>
          </span>
          <button className="btn secondary" aria-label="Import media" onClick={onImport}>
            <Plus size={16} />
            <span>
              Import<span className="action-detail"> media</span>
            </span>
          </button>
          {page === 'Clip editor' && (
            <button className="btn primary" aria-label="Export clip" onClick={onExport}>
              <ArrowDownToLine size={16} />
              <span>
                Export<span className="action-detail"> clip</span>
              </span>
            </button>
          )}
        </div>
        {windowFrame && <WindowControls frame={windowFrame} notice={notice} />}
      </header>
      <aside className="sidebar">
        <div className="side-content">
          <div className="side-label">Workspace</div>
          <nav aria-label="Workspace">
            {nav.map(([name, Icon]) => (
              <button
                aria-label={name}
                title={name}
                className={`nav-item${page === name ? ' current' : ''}`}
                key={name}
                onClick={() => onNavigate(name)}
                aria-current={page === name ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{name}</span>
                {page === name && <i aria-hidden="true" />}
              </button>
            ))}
          </nav>
          <div className="side-projects">
            <div className="side-label side-split">
              Projects
              <button
                className="icon-btn"
                aria-label="Import new project"
                title="Import new project"
                onClick={onImport}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="project-nav">
              {projects.map((item) => {
                const thumbnail = frame(item, 0);
                return (
                  <div className="project-row" key={item.id}>
                    <button
                      onClick={() => onChoose(item)}
                      className={`project-item${item.id === project.id ? ' chosen' : ''}`}
                      aria-current={
                        item.id === project.id && page === 'Clip editor' ? 'true' : undefined
                      }
                      title={item.title}
                    >
                      <span className="project-thumb" aria-hidden="true">
                        {thumbnail ? (
                          <img src={thumbnail} alt="" loading="lazy" />
                        ) : (
                          <Film size={12} />
                        )}
                      </span>
                      <span className="project-name">{item.title}</span>
                    </button>
                    {projects.length > 1 && (
                      <button
                        className="icon-btn project-delete"
                        aria-label={`Delete ${item.title}`}
                        title="Delete project"
                        disabled={busy}
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="side-bottom">
          <button aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={onShortcuts}>
            <Keyboard size={16} />
            <span>Shortcuts</span>
            <kbd aria-hidden="true">?</kbd>
          </button>
          <button aria-label="Studio guide" title="Studio guide" onClick={onGuide}>
            <CircleHelp size={16} />
            <span>Studio guide</span>
          </button>
        </div>
      </aside>
      <main className="workspace" id="workspace" ref={workspace} tabIndex={-1}>
        {children}
      </main>
      <footer className="statusbar">
        <span className="status-location">
          <i aria-hidden="true" /> Local workspace
        </span>
        {page === 'Clip editor' && (
          <span className="work-hint">
            <kbd>Space</kbd> Play / pause <i /> <kbd>I</kbd>
            <kbd>O</kbd> Set in / out
          </span>
        )}
        <span className="status-platform">{desktop ? 'Desktop app' : 'Browser preview'}</span>
        <div className="mobile-help">
          <button className="icon-btn" aria-label="Keyboard shortcuts" onClick={onShortcuts}>
            <Keyboard size={16} />
          </button>
          <button className="icon-btn" aria-label="Studio guide" onClick={onGuide}>
            <CircleHelp size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
