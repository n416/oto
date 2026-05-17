import React from 'react';
import type { ScriptData } from '../App';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  playheadY: number;
  setPlayheadY: (y: number) => void;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  maxLines: number;
  GRID_HEIGHT: number;
  cuts: number[];
  scripts: ScriptData;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen, onClose, playheadY, setPlayheadY, isPlaying, setIsPlaying, maxLines, GRID_HEIGHT, cuts, scripts
}) => {
  if (!isOpen) return null;

  const currentSeconds = playheadY / GRID_HEIGHT;
  const totalSeconds = maxLines;

  // Calculate current cut
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

  // 偶数と奇数で背景色を交互に変える（濃いグレー、薄いグレー）
  const bgColor = currentCutIndex % 2 === 0 ? '#222222' : '#3a3a3a';

  // 現在の行数（秒）
  const currentLineIndex = Math.floor(currentSeconds);

  // すべてのレイヤーから現在の行のテキストを抽出
  const activeTexts: string[] = [];
  Object.keys(scripts).forEach(layerId => {
    const lines = (scripts[layerId] || '').split('\n');
    if (lines[currentLineIndex] && lines[currentLineIndex].trim() !== '') {
      activeTexts.push(lines[currentLineIndex].trim());
    }
  });
  
  // テキストを結合して表示
  const subtitleText = activeTexts.join(' / ');

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      
      {/* 閉じるボタン */}
      <button 
        onClick={onClose}
        style={{ position: 'absolute', top: '20px', right: '30px', background: 'none', border: 'none', color: '#fff', fontSize: '40px', cursor: 'pointer', transition: 'color 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#e74c3c'}
        onMouseLeave={e => e.currentTarget.style.color = '#fff'}
      >×</button>

      {/* プレイヤー領域 */}
      <div style={{ width: '800px', maxWidth: '95vw', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.8)' }}>
        
        {/* 動画画面部分 (16:9) */}
        <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: bgColor, position: 'relative', transition: 'background-color 0.1s', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '40px' }}>
          
          {/* 右上のカット番号 */}
          <div style={{ position: 'absolute', top: '20px', right: '20px', backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 16px', borderRadius: '4px', fontSize: '15px', fontWeight: 'bold', border: '1px solid #555' }}>
            Cut {currentCutIndex + 1}
          </div>

          {/* セリフ（字幕） */}
          {subtitleText && (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', padding: '12px 32px', borderRadius: '8px', fontSize: '24px', fontWeight: 'bold', maxWidth: '85%', textAlign: 'center', textShadow: '2px 2px 4px #000', border: '1px solid rgba(255,255,255,0.1)' }}>
              {subtitleText}
            </div>
          )}
        </div>

        {/* コントロールバー */}
        <div style={{ padding: '16px 24px', backgroundColor: '#1e1e1e', display: 'flex', alignItems: 'center', gap: '20px', borderTop: '1px solid #333' }}>
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: isPlaying ? '#e74c3c' : '#4a90e2', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', transition: 'background-color 0.2s', outline: 'none' }}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          
          <div style={{ color: '#ccc', fontSize: '14px', fontFamily: 'monospace' }}>
            {formatTime(currentSeconds)}
          </div>

          <input 
            type="range" 
            min="0" 
            max={maxLines * GRID_HEIGHT} 
            value={playheadY}
            onChange={(e) => {
              setPlayheadY(parseFloat(e.target.value));
              setIsPlaying(false);
            }}
            style={{ flex: 1, cursor: 'pointer', height: '6px', appearance: 'none', backgroundColor: '#444', borderRadius: '3px', outline: 'none' }}
          />

          <div style={{ color: '#888', fontSize: '14px', fontFamily: 'monospace' }}>
            {formatTime(totalSeconds)}
          </div>
        </div>

      </div>
    </div>
  );
};
