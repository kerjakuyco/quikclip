/**
 * The render queue (src-tauri renders.rs): exports chosen in the export dialog wait here and render one after another
 * in the background, while the studio stays free for editing and importing. Each keeps the settings it was queued with.
 */
export type RenderKind = 'clip' | 'batch' | 'joined';
export type RenderStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type RenderTask = {
  id: string;
  kind: RenderKind;
  title: string;
  /** The project it came from, for the export history. */
  project: string;
  status: RenderStatus;
  /** 0 to 1 while it renders. */
  progress: number;
  /** The file, or for a batch the folder, it is written to. */
  target: string;
  /** What the render command is sent, as it was when queued. */
  args: Record<string, unknown>;
  /** How long the finished video should run, for the export history. */
  duration: number;
  output?: string;
  error?: string;
};

export const RENDER_COMMAND: Record<RenderKind, string> = {
  clip: 'render_clip',
  batch: 'render_batch',
  joined: 'render_joined',
};

export function renderStatus(task: Pick<RenderTask, 'status' | 'progress' | 'error' | 'output'>) {
  switch (task.status) {
    case 'queued':
      return 'Waiting';
    case 'running':
      return `Rendering · ${Math.round(task.progress * 100)}%`;
    case 'done':
      return task.output ? `Saved to ${task.output}` : 'Done';
    case 'failed':
      return task.error || 'Failed';
    default:
      return 'Cancelled';
  }
}

/** The status bar's one line about the queue: what's rendering, what's left, or what finished. */
export function queueSummary(tasks: readonly RenderTask[]) {
  const running = tasks.find((task) => task.status === 'running');
  const waiting = tasks.filter((task) => task.status === 'queued').length;
  if (running)
    return `Rendering ${Math.round(running.progress * 100)}%${waiting ? ` · ${waiting} waiting` : ''}`;
  if (waiting) return `${waiting} waiting`;
  const done = tasks.filter((task) => task.status === 'done').length;
  const failed = tasks.filter((task) => task.status === 'failed').length;
  if (failed) return `${done} rendered · ${failed} failed`;
  return `${done} rendered`;
}

/** The next render to start: the first waiting one, when nothing is rendering. */
export function nextRender(tasks: readonly RenderTask[]) {
  if (tasks.some((task) => task.status === 'running')) return null;
  return tasks.find((task) => task.status === 'queued') ?? null;
}
