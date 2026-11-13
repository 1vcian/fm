import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { loadGameTiers } from './utils/gameTiers'

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Ages and rarities come from the newest build's GameTiers.json; every page reads them, so the
// app renders once they are in.
loadGameTiers(import.meta.env.BASE_URL).then(
    () => root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    ),
    (e) => {
        console.error('[gameTiers]', e);
        root.render(<div style={{ padding: 32, color: '#f5f5f5', fontFamily: 'sans-serif' }}>Could not load the game data. Reload the page to try again.</div>);
    },
);
