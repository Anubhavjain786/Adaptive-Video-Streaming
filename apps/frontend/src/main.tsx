import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import PlayerPage from './pages/PlayerPage';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="app-shell">
        <div className="app-frame">
          <header className="app-header">
            <div className="brand">
              <div className="brand-mark">AV</div>
              <div className="brand-copy">
                <h1>Adaptive Video Streaming</h1>
                <p>Upload once, transcode automatically, stream with HLS.</p>
              </div>
            </div>

            <nav className="app-nav">
              <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
                Upload
              </NavLink>
              <NavLink to="/play" className={({ isActive }) => (isActive ? 'active' : '')}>
                Play
              </NavLink>
            </nav>
          </header>

          <Routes>
            <Route path="/" element={<UploadPage />} />
            <Route path="/play" element={<PlayerPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  </React.StrictMode>
);
