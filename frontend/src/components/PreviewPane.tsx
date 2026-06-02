import React from 'react';
import type { ScriptData } from '../App';

interface PreviewPaneProps {

  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  maxLines: number;
  GRID_HEIGHT: number;
  cuts: number[];
  scripts: ScriptData;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({
  isPlaying, setIsPlaying, maxLines, GRID_HEIGHT, cuts, scripts
}) => {
  const [playheadY, setLocalPlayheadY] = React.useState(0);

  React.useEffect(() => {
    const handleUpdate = (e: any) => {
      if (e.detail && typeof e.detail.y === 'number') {
        setLocalPlayheadY(e.detail.y);
      }
    };
    window.addEventListener('playheadUpdate', handleUpdate);
    // 初期値を取得するためのリクエスト（App側で処理）
    window.dispatchEvent(new CustomEvent('requestInitialPlayhead'));
    return () => window.removeEventListener('playheadUpdate', handleUpdate);
  }, []);
  const currentSeconds = playheadY / GRID_HEIGHT;
  const totalSeconds = maxLines;

  let currentCutIndex = 0;
  for (let i = 0; i < cuts.length; i++) {
    if (playheadY < cuts[i]) {
      currentCutIndex = i;
      break;
    }
    if (i === cuts.length - 1 && playheadY >= cuts[i]) {
      currentCutIndex = cuts.length;
    }
  }

  const bgColor = currentCutIndex % 2 === 0 ? '#222222' : '#3a3a3a';
  const currentLineIndex = Math.floor(currentSeconds);
  const activeTexts: string[] = [];
  Object.keys(scripts).forEach(layerId => {
    const lines = (scripts[layerId] || '').split('\n');
    if (lines[currentLineIndex] && lines[currentLineIndex].trim() !== '') {
      activeTexts.push(lines[currentLineIndex].trim());
    }
  });
  const subtitleText = activeTexts.join(' / ');

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#000' }}>
      {/* 動画画面部分 */}
      <div style={{ flex: 1, backgroundColor: bgColor, position: 'relative', transition: 'background-color 0.1s', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '32px', overflow: 'hidden' }}>
        
        {/* 右上のカット番号 */}
        <div style={{ position: 'absolute', top: '16px', right: '16px', backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 12px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', border: '1px solid #555' }}>
          Cut {currentCutIndex + 1}
        </div>

        {/* セリフ（字幕） */}
        {subtitleText && (
          <div style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', padding: '8px 24px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', maxWidth: '90%', textAlign: 'center', textShadow: '2px 2px 4px #000', border: '1px solid rgba(255,255,255,0.1)' }}>
            {subtitleText}
          </div>
        )}
      </div>

      {/* コントロールバー */}
      <div style={{ padding: '12px 16px', backgroundColor: '#1e1e1e', display: 'flex', alignItems: 'center', gap: '16px', borderTop: '1px solid #333' }}>
        <button 
          onClick={() => setIsPlaying(!isPlaying)}
          style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: isPlaying ? '#e74c3c' : '#4a90e2', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', transition: 'background-color 0.2s', outline: 'none', flexShrink: 0 }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        
        <div style={{ color: '#ccc', fontSize: '12px', fontFamily: 'monospace', flexShrink: 0 }}>
          {formatTime(currentSeconds)}
        </div>

        <input 
          type="range" 
          min="0" 
          max={maxLines * GRID_HEIGHT} 
          value={playheadY}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setLocalPlayheadY(val);
            window.dispatchEvent(new CustomEvent('requestPlayheadUpdate', { detail: { y: val } }));
            setIsPlaying(false);
          }}
          style={{ flex: 1, cursor: 'pointer', height: '4px', appearance: 'none', backgroundColor: '#444', borderRadius: '2px', outline: 'none' }}
        />

        <div style={{ color: '#888', fontSize: '12px', fontFamily: 'monospace', flexShrink: 0 }}>
          {formatTime(totalSeconds)}
        </div>
      </div>
    </div>
  );
};
