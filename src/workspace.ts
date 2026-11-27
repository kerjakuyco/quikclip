import { invoke } from '@tauri-apps/api/core';
import { desktop } from './studio';

/**
 * Where the workspace (projects, the open project, export history) is kept. The desktop app saves it as a file in its
 * data folder (src-tauri workspace.rs), with no storage cap; the browser preview keeps it in localStorage. A desktop
 * workspace from before the file moves into it on first save.
 */
export type Workspace = { projects?: unknown; active?: unknown; exports?: unknown };

let loaded: Workspace | null = null;

/** Reads the saved workspace before the studio opens. */
export async function loadWorkspace() {
  if (!desktop) return;
  try {
    const text = await invoke<string | null>('read_workspace');
    loaded = text ? (JSON.parse(text) as Workspace) : null;
  } catch {
    loaded = null;
  }
}

/** One part of the saved workspace: the file's on the desktop, else the older localStorage copy. */
export function savedPart<T>(key: keyof Workspace, fallback: T): T {
  if (loaded && key in loaded && loaded[key] != null) return loaded[key] as T;
  try {
    return JSON.parse(localStorage.getItem(`quikclip.1.${key}`) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

let writing: Promise<void> = Promise.resolve();
let timer: number | undefined;

/**
 * Saves the workspace; `done` hears whether it was kept. On the desktop, quick successive changes are written once,
 * after a short pause, one write at a time.
 */
export function saveWorkspace(workspace: Required<Workspace>, done: (saved: boolean) => void) {
  if (!desktop) {
    try {
      for (const [key, value] of Object.entries(workspace))
        localStorage.setItem(`quikclip.1.${key}`, JSON.stringify(value));
      done(true);
    } catch {
      done(false);
    }
    return;
  }
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const contents = JSON.stringify(workspace);
    writing = writing
      .then(() => invoke('write_workspace', { contents }))
      .then(
        () => done(true),
        () => done(false),
      );
  }, 250);
  // Kept in localStorage too while it fits, for tools that read it there; the file is what counts.
  try {
    for (const [key, value] of Object.entries(workspace))
      localStorage.setItem(`quikclip.1.${key}`, JSON.stringify(value));
  } catch {
    // Too large for localStorage: the file still holds it.
  }
}
