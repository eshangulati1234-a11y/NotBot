import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { applyTheme, readTheme } from './theme';

applyTheme(readTheme());

// A dropped file must do nothing; otherwise Electron would navigate to it.
for (const type of ['dragover', 'drop']) {
  window.addEventListener(type, (event) => event.preventDefault());
}

createRoot(document.getElementById('root')!).render(
  window.notbotRuntime ? (
    <App />
  ) : (
    <div className="nb-fallback">
      <h1 className="nb-fallback__title">Open the Notbot app</h1>
      <p className="nb-fallback__body">Notbot runs inside its desktop app. Start it with “npm run dev”.</p>
    </div>
  ),
);
