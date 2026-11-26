import { ArrowDownToLine, ArrowRight, Check, Film, Plus, Trash2 } from 'lucide-react';
import { asset, clock, frame, type ExportEntry, type Project } from '../studio';

export function MediaLibrary({
  projects,
  busy,
  onChoose,
  onDelete,
  onImport,
}: {
  projects: Project[];
  busy: boolean;
  onChoose: (p: Project) => void;
  onDelete: (p: Project) => void;
  onImport: () => void;
}) {
  return (
    <div className="workspace-page">
      <header className="page-title">
        <div>
          <h1>Media library</h1>
          <p>Pick a source video to open its clips in the editor.</p>
        </div>
        <span className="page-count">
          {projects.length} {projects.length === 1 ? 'source' : 'sources'}
        </span>
      </header>
      <div className="library-grid">
        {projects.map((project) => {
          const poster = asset(project, project.poster) ?? frame(project, 0);
          return (
            <div className="library-item" key={project.id}>
              <button className="library-card" onClick={() => onChoose(project)}>
                <span className="library-poster">
                  {poster ? <img alt="" src={poster} loading="lazy" /> : <Film />}
                  <small>{clock(project.duration)}</small>
                </span>
                <span className="library-copy">
                  <small>{project.source === 'Sample' ? 'Sample project' : project.source}</small>
                  <strong>{project.title}</strong>
                  <span>
                    {project.cuts.length} {project.cuts.length === 1 ? 'clip' : 'clips'}{' '}
                    <ArrowRight size={15} />
                  </span>
                </span>
              </button>
              {projects.length > 1 && (
                <button
                  className="icon-btn library-delete"
                  aria-label={`Delete ${project.title}`}
                  title="Delete project"
                  disabled={busy}
                  onClick={() => onDelete(project)}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          );
        })}
        <button className="import-tile" onClick={onImport}>
          <span>
            <Plus size={19} />
          </span>
          <strong>Add a source</strong>
          <small>Import a video file or link</small>
        </button>
      </div>
    </div>
  );
}

export function ExportHistory({ entries, onEdit }: { entries: ExportEntry[]; onEdit: () => void }) {
  return (
    <div className="workspace-page">
      <header className="page-title">
        <div>
          <h1>Exports</h1>
          <p>Find your rendered clips and where they were saved.</p>
        </div>
        <span className="page-count">
          {entries.length} {entries.length === 1 ? 'render' : 'renders'}
        </span>
      </header>
      {entries.length ? (
        <ul className="exports-list" aria-label="Export history">
          {entries.map((entry) => (
            <li className="export-row" key={entry.id}>
              <span className="export-icon" title="Export complete">
                <Check size={17} aria-label="Export complete" />
              </span>
              <div>
                <strong>{entry.title}</strong>
                <small>
                  {entry.project} · {clock(entry.duration)} ·{' '}
                  <time dateTime={entry.date}>{new Date(entry.date).toLocaleDateString()}</time>
                </small>
                <code>{entry.path}</code>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="empty" aria-labelledby="empty-exports">
          <div className="empty-slate" aria-hidden="true">
            <ArrowDownToLine size={24} />
          </div>
          <h2 id="empty-exports">No exports yet</h2>
          <p>Select a clip in the editor to render your first cut.</p>
          <button className="btn secondary" onClick={onEdit}>
            Open clip editor <ArrowRight size={14} />
          </button>
        </section>
      )}
    </div>
  );
}
