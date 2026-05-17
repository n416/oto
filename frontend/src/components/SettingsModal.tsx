import React from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lineNumber: number | null;
  layer: string;
  text: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, lineNumber, layer, text }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999
    }}>
      <div style={{
        backgroundColor: '#252526',
        padding: '24px',
        borderRadius: '8px',
        width: '400px',
        color: '#d4d4d4',
        border: '1px solid #444',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        fontFamily: 'sans-serif'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>
            <span style={{ color: layer === 'dialogue' ? '#4a90e2' : layer === 'sfx' ? '#e2a74a' : '#50e3c2' }}>{layer.toUpperCase()}</span> - L{lineNumber}
          </h2>
          <button 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
          >
            ✕
          </button>
        </div>

        {text && (
          <div style={{ padding: '8px', backgroundColor: '#1e1e1e', borderRadius: '4px', fontSize: '12px', color: '#ccc', marginBottom: '16px', borderLeft: '3px solid #666' }}>
            {text}
          </div>
        )}
        
        <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '8px', color: '#aaa', fontWeight: 'bold' }}>🎬 採用テイク (Take 選択)</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <select style={{ flex: 1, padding: '8px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}>
              <option>Take 1 (最新)</option>
              <option>Take 2</option>
              <option>Take 3</option>
            </select>
            <button 
              title="選択中のテイクを削除"
              style={{ 
                padding: '0 12px', 
                backgroundColor: '#2d3748', 
                color: '#e53e3e', 
                border: '1px solid #4a5568', 
                borderRadius: '4px', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#4a5568';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#2d3748';
              }}
            >
              🗑️
            </button>
          </div>
          
          <button 
            style={{ 
              width: '100%', 
              padding: '8px', 
              backgroundColor: '#2d3748', 
              color: '#63b3ed', 
              border: '1px solid #4a5568', 
              borderRadius: '4px', 
              cursor: 'pointer', 
              fontSize: '13px', 
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#4a5568';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#2d3748';
              e.currentTarget.style.color = '#63b3ed';
            }}
          >
            <span>🎲</span> 新しいTakeを生成する (ガチャ)
          </button>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: '#aaa' }}>⏱️ N分割長 (タイムライン上の長さ)</label>
          <input 
            type="number" 
            defaultValue={4} 
            min={1}
            style={{ width: '100%', padding: '8px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', boxSizing: 'border-box' }} 
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button 
            onClick={onClose} 
            style={{ padding: '6px 16px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >
            キャンセル
          </button>
          <button 
            onClick={onClose} 
            style={{ padding: '6px 16px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};
