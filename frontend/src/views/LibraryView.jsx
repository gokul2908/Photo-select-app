import React, { useState } from 'react';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { HardDrive, RefreshCw, GitBranch, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function LibraryView() {
  const { photos, branches, currentBranch, selectBranch, setPhotos } = useAppContext();
  const [importPath, setImportPath] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const navigate = useNavigate();

  const handleImport = async (e) => {
    e.preventDefault();
    if (!importPath) return;
    setIsImporting(true);
    try {
      await api.importDirectory(importPath);
      // Wait a bit and refresh catalog
      setTimeout(async () => {
        const res = await api.getPhotos();
        setPhotos(res.data);
        setIsImporting(false);
        setImportPath('');
      }, 3000);
    } catch (err) {
      console.error(err);
      setIsImporting(false);
    }
  };

  const handleBranchSelect = async (branchId) => {
    await selectBranch(branchId);
    navigate('/cull');
  };

  const handleCreateBranch = async () => {
    const name = prompt("New branch name:");
    if (!name) return;
    try {
      await api.createBranch(name, currentBranch);
      window.location.reload(); // naive reload to refresh branches for mvp
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: '3rem', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }} className="animate-fade-in">
      
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><HardDrive size={24}/> Import Photos</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Paste an absolute path to a folder containing JPEGs to start a new indexing job.</p>
        
        <form onSubmit={handleImport} style={{ display: 'flex', gap: '1rem' }}>
          <input 
            type="text" 
            className="input-field" 
            placeholder="/Users/name/Pictures/Event"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={isImporting}>
            {isImporting ? <RefreshCw className="lucide-spin" size={18} /> : 'Import'}
          </button>
        </form>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><GitBranch size={24}/> Active Branches</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {branches.map(b => (
              <div 
                key={b.id} 
                onClick={() => handleBranchSelect(b.id)}
                style={{ 
                  padding: '1rem', 
                  borderRadius: 'var(--border-radius-sm)', 
                  background: currentBranch === b.id ? 'rgba(59, 130, 246, 0.2)' : 'var(--bg-glass-border)',
                  cursor: 'pointer',
                  border: currentBranch === b.id ? '1px solid var(--accent-primary)' : '1px solid transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: 'all 0.2s'
                }}
              >
                <span style={{ fontWeight: 500 }}>{b.name}</span>
                {currentBranch === b.id && <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>Active</span>}
              </div>
            ))}
          </div>
          <button onClick={handleCreateBranch} className="btn" style={{ background: 'var(--bg-glass-border)', marginTop: '1rem' }}>
            + Create New Branch
          </button>
        </div>

        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <h3 style={{ color: 'var(--text-secondary)' }}>Total Photos Indexed</h3>
          <div style={{ fontSize: '4rem', fontWeight: 'bold', background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {photos.length}
          </div>
          <button onClick={() => navigate('/cull')} className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }}>
            <Play size={18}/> Jump to Cull Engine
          </button>
        </div>
      </div>

    </div>
  );
}
