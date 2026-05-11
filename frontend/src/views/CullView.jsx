import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAppContext } from '../AppContext';
import { ArrowLeft, Check, X, Star, FastForward } from 'lucide-react';

export default function CullView() {
  const { photos, currentIndex, setCurrentIndex, branchState, makeDecision, markBest } = useAppContext();
  const navigate = useNavigate();

  const handleKeyDown = useCallback((e) => {
    if (photos.length === 0) return;
    const currentPhoto = photos[currentIndex];

    switch(e.key) {
      case 'ArrowRight':
        makeDecision(currentPhoto.id, 'keep');
        break;
      case 'ArrowLeft':
        makeDecision(currentPhoto.id, 'reject');
        break;
      case 'ArrowDown':
        makeDecision(currentPhoto.id, 'skip');
        break;
      case 'ArrowUp':
        markBest(currentPhoto.group_id, currentPhoto.id);
        break;
      case 'Escape':
        navigate('/');
        break;
      default:
        break;
    }
  }, [currentIndex, photos, makeDecision, markBest, navigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!photos || photos.length === 0) {
    return <div className="flex-center" style={{ height: '100%' }}>No photos available. Import first.</div>;
  }

  const activePhoto = photos[currentIndex];
  const groupPhotos = photos.filter(p => p.group_id === activePhoto.group_id);

  // Stats
  const keeps = Object.values(branchState).filter(v => v === 'keep').length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#000' }}>
      
      {/* Top HUD */}
      <div style={{ 
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)'
      }}>
        <button onClick={() => navigate('/')} className="btn" style={{ background: 'var(--bg-glass)', color: 'white' }}>
          <ArrowLeft size={18}/> Back
        </button>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>{currentIndex + 1} <span style={{ color: 'var(--text-secondary)' }}>/ {photos.length}</span></div>
          <div style={{ color: 'var(--accent-keep)', fontWeight: 'bold' }}>{keeps} Kept</div>
        </div>
      </div>

      {/* Main Image Stage */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img 
          src={api.getThumbnailUrl(activePhoto.id, 'main')} 
          alt="Main Cull" 
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        />
        
        {/* State Indicator Overlay */}
        {branchState[activePhoto.id] && (
          <div style={{ 
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: 'var(--bg-glass)', padding: '2rem', borderRadius: '50%', backdropFilter: 'blur(10px)',
            color: branchState[activePhoto.id] === 'keep' ? 'var(--accent-keep)' : 'var(--accent-reject)'
          }}>
            {branchState[activePhoto.id] === 'keep' ? <Check size={64}/> : <X size={64}/>}
          </div>
        )}
      </div>

      {/* Bottom Strip (Burst Group) */}
      <div style={{ 
        height: '160px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--bg-glass-border)',
        display: 'flex', alignItems: 'center', padding: '0 2rem', overflowX: 'auto', gap: '0.5rem'
      }}>
        {groupPhotos.map(p => (
          <div 
            key={p.id}
            onClick={() => setCurrentIndex(photos.findIndex(x => x.id === p.id))}
            style={{
              height: '120px', minWidth: '180px', borderRadius: 'var(--border-radius-sm)', overflow: 'hidden',
              cursor: 'pointer', position: 'relative',
              border: activePhoto.id === p.id ? '3px solid var(--accent-primary)' : '2px solid transparent',
              opacity: activePhoto.id === p.id ? 1 : 0.6,
              transition: 'all 0.2s'
            }}
          >
            <img 
              src={api.getThumbnailUrl(p.id, 'strip')} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
            {/* Status icon if decided */}
            {branchState[p.id] && (
              <div style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'rgba(0,0,0,0.7)', borderRadius: '50%', padding: '4px' }}>
                {branchState[p.id] === 'keep' ? <Check size={14} color="var(--accent-keep)"/> : <X size={14} color="var(--accent-reject)"/>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Keyboard Legend */}
      <div style={{ position: 'absolute', bottom: '180px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '1rem', background: 'var(--bg-glass)', padding: '0.5rem 1rem', borderRadius: 'var(--border-radius-lg)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <span><kbd>←</kbd> Reject</span>
        <span><kbd>→</kbd> Keep</span>
        <span><kbd>↑</kbd> Mark Best</span>
        <span><kbd>↓</kbd> Skip</span>
      </div>

    </div>
  );
}
