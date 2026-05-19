import React, { useState, useRef } from 'react';
import { generateTake } from '../utils/generateTake';
import type { CharacterData } from './CharacterSettings';
import type { LineTakes, TakeData, DialogOptions, SfxData } from '../App';
import { WaveformTrimmer } from './WaveformTrimmer';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lineNumber: number | null;
  layer: string;
  text: string;
  fullScript?: string;
  blockId: string;
  lineTakesMap: Record<string, LineTakes>;
  setLineTakesMap: React.Dispatch<React.SetStateAction<Record<string, LineTakes>>>;
  characters: CharacterData[];
  sfxs: SfxData[];
  setDialog: (dialog: DialogOptions | null) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, lineNumber, layer, text, fullScript, blockId, lineTakesMap, setLineTakesMap, characters, sfxs, setDialog 
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!isOpen) return null;

  const currentTakesData = lineTakesMap[blockId] || { takes: [], activeTakeId: null };
  let takes = [...currentTakesData.takes];
  let activeTakeId = currentTakesData.activeTakeId;

  // SFXレイヤーの場合、SFXライブラリのオリジナル音源を「Take 0」として追加する
  if (layer === 'sfx') {
    const match = text.match(/^SFX(\d{3}):/);
    if (match) {
      const sfxId = `SFX${match[1]}`;
      const originalSfx = sfxs.find(s => s.id === sfxId);
      if (originalSfx && originalSfx.audioUrl) {
        const take0: TakeData = {
          id: `take0_original_${sfxId}`,
          audioUrl: originalSfx.audioUrl,
          timestamp: originalSfx.timestamp || 'オリジナル',
          trimOffset: originalSfx.trimOffset
        };
        takes = [...takes, take0];
        // もしアクティブなテイクが設定されていない（または削除された）場合、Take 0をデフォルトにする
        if (!activeTakeId) {
          activeTakeId = take0.id;
        }
      }
    }
  }

  const handleGenerate = async () => {
    if (layer !== 'dialogue' && layer !== 'sfx') {
      setDialog({ type: 'alert', title: '未対応', message: '現在、このレイヤーでの生成には対応していません。' });
      return;
    }
    
    setIsGenerating(true);
    try {
      const lineIndex = lineNumber ? lineNumber - 1 : undefined;
      const newTake = await generateTake(layer, text, characters, fullScript, lineIndex);

      setLineTakesMap(prev => {
        const existing = prev[blockId] || { takes: [], activeTakeId: null };
        return {
          ...prev,
          [blockId]: {
            takes: [newTake, ...existing.takes],
            activeTakeId: newTake.id // 自動的に新しいテイクを選択
          }
        };
      });

    } catch (error: any) {
      console.error(error);
      const port = layer === 'dialogue' ? '7860' : '7862';
      const serverName = layer === 'dialogue' ? 'ボイスクローニングサーバー' : '効果音生成サーバー';
      setDialog({
        type: 'alert',
        title: '生成エラー',
        message: `${error.message}\n\nまたは、${serverName}(127.0.0.1:${port})との通信に失敗した可能性があります。上部メニューの「⚙️ システム設定」からサーバーが起動しているか確認してください。`
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = (takeId: string, audioUrl: string) => {
    if (playingId === takeId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioUrl && audioUrl !== '#') {
        const audio = new Audio(audioUrl);
        audio.onended = () => setPlayingId(null);
        audio.play().catch(e => console.error("Audio playback failed", e));
        audioRef.current = audio;
        setPlayingId(takeId);
      }
    }
  };

  const handleDeleteTake = (takeId: string) => {
    setLineTakesMap(prev => {
      const existing = prev[blockId];
      if (!existing) return prev;
      const newTakes = existing.takes.filter(t => t.id !== takeId);
      const newActiveId = existing.activeTakeId === takeId 
        ? (newTakes.length > 0 ? newTakes[0].id : null) 
        : existing.activeTakeId;
      
      return {
        ...prev,
        [blockId]: { takes: newTakes, activeTakeId: newActiveId }
      };
    });
    if (playingId === takeId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    }
  };

  const activeTake = takes.find(t => t.id === activeTakeId);

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
            onClick={() => {
              if (audioRef.current) audioRef.current.pause();
              onClose();
            }} 
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
          
          {takes.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', color: '#888', fontSize: '12px', marginBottom: '16px', backgroundColor: '#1e1e1e', borderRadius: '4px' }}>
              テイクはまだありません。
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <select 
                value={activeTakeId || ""}
                onChange={(e) => setLineTakesMap(prev => ({ ...prev, [blockId]: { ...prev[blockId], activeTakeId: e.target.value } }))}
                style={{ flex: 1, padding: '8px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px' }}
              >
                {takes.map((t, idx) => {
                  if (t.id.startsWith('take0_original_')) {
                    return <option key={t.id} value={t.id}>Take 0 (オリジナル)</option>;
                  }
                  // take0が含まれている場合、全体の長さから1を引いて計算する
                  const baseLength = takes.some(take => take.id.startsWith('take0_original_')) ? takes.length - 1 : takes.length;
                  return (
                    <option key={t.id} value={t.id}>Take {baseLength - idx} ({t.timestamp})</option>
                  );
                })}
              </select>
              
              {activeTake && (
                <button 
                  onClick={() => togglePlay(activeTake.id, activeTake.audioUrl)}
                  style={{ padding: '0 12px', backgroundColor: playingId === activeTake.id ? '#e53e3e' : '#2d3748', color: '#fff', border: '1px solid #4a5568', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s', width: '50px' }}
                >
                  {playingId === activeTake.id ? '⏹' : '▶'}
                </button>
              )}

              <button 
                onClick={() => { if (activeTake) handleDeleteTake(activeTake.id); }}
                title="選択中のテイクを削除"
                style={{ padding: '0 12px', backgroundColor: '#2d3748', color: '#e53e3e', border: '1px solid #4a5568', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }}
              >
                🗑️
              </button>
            </div>
          )}
          
          {/* 手動オフセット設定（テイクがある場合のみ表示） */}
          {activeTake && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                ✂️ 頭出し・カット位置の調整
              </label>
              <WaveformTrimmer 
                audioUrl={activeTake.audioUrl}
                trimOffset={activeTake.trimOffset}
                trimEnd={activeTake.trimEnd}
                onChangeOffset={(start, end) => {
                  setLineTakesMap(prev => {
                    const existing = prev[blockId] || { takes: [], activeTakeId: null };
                    // 状態上のアクティブIDが未設定なら、現在のactiveTake.id（Take 0）と見なす
                    const currentActiveId = existing.activeTakeId || activeTake.id;

                    if (currentActiveId.startsWith('take0_original_')) {
                      // オリジナルを編集しようとした場合、瞬時に新しいTakeとしてフォークする
                      const newTake: TakeData = {
                        id: `take_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                        audioUrl: activeTake.audioUrl,
                        timestamp: new Date().toLocaleTimeString(),
                        trimOffset: start,
                        trimEnd: end
                      };
                      return {
                        ...prev,
                        [blockId]: {
                          takes: [newTake, ...existing.takes],
                          activeTakeId: newTake.id
                        }
                      };
                    } else {
                      // 既存のTakeを更新
                      const newTakes = existing.takes.map(t => t.id === currentActiveId ? { ...t, trimOffset: start, trimEnd: end } : t);
                      return { ...prev, [blockId]: { ...existing, takes: newTakes } };
                    }
                  });
                }}
              />
            </div>
          )}
          
          {layer !== 'bgm' && (
            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ 
                width: '100%', 
                padding: '8px', 
                backgroundColor: isGenerating ? '#4a5568' : '#2d3748', 
                color: isGenerating ? '#a0aec0' : '#63b3ed', 
                border: '1px solid #4a5568', 
                borderRadius: '4px', 
                cursor: isGenerating ? 'not-allowed' : 'pointer', 
                fontSize: '13px', 
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s'
              }}
            >
              <span>{isGenerating ? '⏳' : '🎲'}</span> {isGenerating ? '生成中...' : '新しいTakeを生成する (ガチャ)'}
            </button>
          )}

          <label 
            style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: '6px', 
              width: '100%', 
              padding: '8px', 
              backgroundColor: layer === 'bgm' ? '#2d3748' : 'transparent', 
              color: layer === 'bgm' ? '#63b3ed' : '#cbd5e0', 
              border: '1px solid #4a5568', 
              borderRadius: '4px', 
              cursor: 'pointer', 
              fontSize: layer === 'bgm' ? '13px' : '12px', 
              marginTop: layer === 'bgm' ? '0px' : '12px',
              boxSizing: 'border-box',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => { 
              if (layer !== 'bgm') {
                e.currentTarget.style.backgroundColor = '#4a5568'; 
                e.currentTarget.style.color = '#fff';
              } else {
                e.currentTarget.style.backgroundColor = '#4a5568';
              }
            }}
            onMouseLeave={e => { 
              if (layer !== 'bgm') {
                e.currentTarget.style.backgroundColor = 'transparent'; 
                e.currentTarget.style.color = '#cbd5e0';
              } else {
                e.currentTarget.style.backgroundColor = '#2d3748';
              }
            }}
          >
            <span>📁</span> {layer === 'bgm' ? 'BGMファイルをアップロード' : '手持ちの音声ファイルをアップロード'}
            <input 
              type="file" 
              accept="audio/*" 
              style={{ display: 'none' }} 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = async () => {
                  try {
                    const base64 = (reader.result as string).split(',')[1];
                    const res = await fetch('/api/backend/upload', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ filename: file.name, base64 })
                    });
                    
                    if (!res.ok) throw new Error('Upload failed');
                    const data = await res.json();
                    
                    const newTake: TakeData = {
                      id: `take_imported_${Date.now()}`,
                      audioUrl: data.url,
                      timestamp: new Date().toLocaleTimeString()
                    };
                    
                    setLineTakesMap(prev => {
                      const existing = prev[blockId] || { takes: [], activeTakeId: null };
                      return {
                        ...prev,
                        [blockId]: {
                          takes: [newTake, ...existing.takes],
                          activeTakeId: newTake.id
                        }
                      };
                    });
                  } catch (err) {
                    console.error(err);
                    setDialog({ type: 'alert', title: 'アップロードエラー', message: '音声のアップロードに失敗しました。' });
                  }
                };
                reader.readAsDataURL(file);
                
                e.target.value = ''; // リセット
              }}
            />
          </label>
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
            onClick={() => {
              if (audioRef.current) audioRef.current.pause();
              onClose();
            }} 
            style={{ padding: '6px 16px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
