import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Folder, Play, Layers, Grid, Trash2 } from 'lucide-react';
import LibraryView from './views/LibraryView';
import CullView from './views/CullView';
import GalleryView from './views/GalleryView';
import TrashView from './views/TrashView';
import './index.css';

function App() {
  const location = useLocation();

  return (
    <div className="app-container">
      {/* Header */}
      {location.pathname !== '/cull' && (
        <header className="app-header glass-panel">
          <Link
            to="/"
            className="app-header-brand"
            style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
            aria-label="Go to Library"
          >
            <Layers size={20} />
            <span className="app-header-brand-text">Photo Culler</span>
          </Link>
          <nav className="app-header-nav">
            {[
              { to: '/', label: 'Library', icon: Folder },
              { to: '/gallery', label: 'Gallery', icon: Grid },
              { to: '/trash', label: 'Trash', icon: Trash2 },
            ].map(({ to, label, icon: Icon }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`btn app-nav-link${active ? ' is-active' : ''}`}
                >
                  <Icon size={16} /> <span className="app-nav-label">{label}</span>
                </Link>
              );
            })}
            <Link to="/cull" className="btn btn-primary app-nav-cta">
              <Play size={16} /> <span className="app-nav-label">Start Culling</span>
            </Link>
          </nav>
        </header>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Routes>
          <Route path="/" element={<LibraryView />} />
          <Route path="/gallery" element={<GalleryView />} />
          <Route path="/trash" element={<TrashView />} />
          <Route path="/cull" element={<CullView />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
