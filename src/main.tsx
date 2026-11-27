import { createRoot } from 'react-dom/client';
import App from './App';
import { loadWorkspace } from './workspace';

// The saved workspace is read before the studio opens, so it starts with your projects.
void loadWorkspace().then(() => createRoot(document.getElementById('root')!).render(<App />));
