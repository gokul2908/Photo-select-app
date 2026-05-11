import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Folder, Play, Layers } from 'lucide-react';
import LibraryView from './views/LibraryView';
import CullView from './views/CullView';
import './index.css';

function App() {
  const location = useLocation();

  return (
    <div className="app-container">
      {/* Premium Glass Header */}
      {location.pathname !== '/cull' && (
        <header className="glass-panel" style={{ padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontWeight: 'bold', fontSize: '1.25rem' }}>
            <Layers size={28} color="var(--accent-primary)" />
            <span>Local Photo Culler</span>
          </div>
          <nav style={{ display: 'flex', gap: '1rem' }}>
            <Link to="/" className="btn" style={{ background: location.pathname === '/' ? 'var(--bg-glass-border)' : 'transparent', color: 'white', textDecoration: 'none' }}>
              <Folder size={18} /> Library
            </Link>
            <Link to="/cull" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              <Play size={18} /> Start Culling
            </Link>
          </nav>
        </header>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Routes>
          <Route path="/" element={<LibraryView />} />
          <Route path="/cull" element={<CullView />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
