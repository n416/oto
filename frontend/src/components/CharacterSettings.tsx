import React, { useState } from 'react';
import type { VoiceData, DialogOptions } from '../App';

export interface CharacterData {
  id: string;
  name: string;
  refAudioPath?: string;
  refText?: string;
}

interface CharacterSettingsProps {
  characters: CharacterData[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterData[]>>;
  voices: VoiceData[];
  onGoToVoiceDesign: () => void;
  setDialog: (dialog: DialogOptions | null) => void;
}

export const CharacterSettings: React.FC<CharacterSettingsProps> = ({ characters, setCharacters, voices, onGoToVoiceDesign, setDialog }) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const updateCharacter = (field: keyof CharacterData, value: string) => {
    if (selectedIndex < 0 || selectedIndex >= characters.length) return;
    const newChars = [...characters];
    newChars[selectedIndex] = { ...newChars[selectedIndex], [field]: value };
    setCharacters(newChars);
  };

  const handleVoiceSelect = (voiceId: string) => {
    if (!voiceId) {
      // 未設定を選択した場合
      updateCharacter('refAudioPath', '');
      return;
    }
    
    if (voiceId === '__new__') {
      onGoToVoiceDesign();
      return;
    }

    const voice = voices.find(v => v.id === voiceId);
    if (voice) {
      const newChars = [...characters];
      newChars[selectedIndex] = { 
        ...newChars[selectedIndex], 
        refAudioPath: voice.source === 'imported' ? voice.name : `generated_${voice.id}.wav`,
        refText: voice.text 
      };
      setCharacters(newChars);
    }
  };

  const deleteCharacter = (index: number) => {
    setDialog({
      type: 'confirm',
      title: 'キャラクターの削除',
      message: 'このキャラクター設定を削除しますか？',
      onConfirm: () => {
        const newChars = characters.filter((_, i) => i !== index);
        setCharacters(newChars);
        if (selectedIndex >= newChars.length) {
          setSelectedIndex(Math.max(0, newChars.length - 1));
        } else if (selectedIndex === index) {
          setSelectedIndex(0);
        }
      }
    });
  };

  const addCharacter = () => {
    const newChars = [...characters, { id: "NEW", name: "新規キャラクター", refText: "" }];
    setCharacters(newChars);
    setSelectedIndex(newChars.length - 1);
  };

  const selectedChar = characters[selectedIndex];

  // 現在選択されているVoiceDataのIDを探す
  let currentVoiceId = "";
  if (selectedChar?.refAudioPath) {
    const matchedVoice = voices.find(v => 
      (v.source === 'imported' && v.name === selectedChar.refAudioPath) ||
      (v.source === 'generated' && `generated_${v.id}.wav` === selectedChar.refAudioPath)
    );
    if (matchedVoice) {
      currentVoiceId = matchedVoice.id;
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', backgroundColor: '#1e1e1e', color: '#ccc', boxSizing: 'border-box' }}>
      {/* 左サイドバー: キャラクター一覧 */}
      <div style={{ width: '250px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column', backgroundColor: '#252526' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #333' }}>
          <h2 style={{ fontSize: '14px', margin: 0, color: '#fff' }}>👥 キャラクター一覧</h2>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {characters.map((char, index) => (
            <div 
              key={index} 
              onClick={() => setSelectedIndex(index)}
              style={{ 
                padding: '12px 16px', 
                borderBottom: '1px solid #333', 
                cursor: 'pointer',
                backgroundColor: selectedIndex === index ? '#37373d' : 'transparent',
                borderLeft: selectedIndex === index ? '3px solid #4a90e2' : '3px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background-color 0.1s'
              }}
              onMouseEnter={(e) => { if (selectedIndex !== index) e.currentTarget.style.backgroundColor = '#2d2d30' }}
              onMouseLeave={(e) => { if (selectedIndex !== index) e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <div>
                <div style={{ fontSize: '13px', color: selectedIndex === index ? '#fff' : '#d4d4d4', fontWeight: selectedIndex === index ? 'bold' : 'normal' }}>
                  {char.name}
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                  ID: {char.id}
                </div>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); deleteCharacter(index); }}
                style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px', display: characters.length > 1 ? 'block' : 'none', padding: '0 4px' }}
                title="削除"
                onMouseEnter={(e) => { e.currentTarget.style.color = '#e53e3e' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#666' }}
              >×</button>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px', borderTop: '1px solid #333' }}>
          <button 
            onClick={addCharacter}
            style={{ width: '100%', padding: '10px', backgroundColor: '#2d3748', color: '#63b3ed', border: '1px dashed #4a5568', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', transition: 'all 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#4a5568'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2d3748'; e.currentTarget.style.color = '#63b3ed' }}
          >
            ＋ キャラクター追加
          </button>
        </div>
      </div>

      {/* 右ペイン: 選択したキャラクターの詳細設定 */}
      <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
        {selectedChar ? (
          <div style={{ maxWidth: '600px' }}>
            <h2 style={{ fontSize: '20px', marginTop: 0, marginBottom: '8px', color: '#fff' }}>{selectedChar.name} の設定</h2>
            <p style={{ fontSize: '13px', color: '#aaa', marginBottom: '32px', lineHeight: '1.5' }}>
              Irodori-TTSで合成するための参考音声（10秒程度のノイズのない音声）と、その音声が実際に喋っているテキストを登録します。台本エディタで指定したIDと一致した際にこの設定が適用されます。
            </p>

            <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
              <div style={{ flex: '0 0 120px' }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>台本上のID</label>
                <input 
                  value={selectedChar.id} 
                  onChange={(e) => updateCharacter('id', e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', boxSizing: 'border-box', fontWeight: 'bold', fontSize: '14px', outline: 'none' }} 
                  placeholder="XX"
                  onFocus={(e) => e.target.style.borderColor = '#4a90e2'}
                  onBlur={(e) => e.target.style.borderColor = '#444'}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>表示名 (キャラクター名)</label>
                <input 
                  value={selectedChar.name} 
                  onChange={(e) => updateCharacter('name', e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', boxSizing: 'border-box', fontSize: '14px', outline: 'none' }} 
                  placeholder="ずんだもん"
                  onFocus={(e) => e.target.style.borderColor = '#4a90e2'}
                  onBlur={(e) => e.target.style.borderColor = '#444'}
                />
              </div>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>🎙️ 参考音声 (.wav)</label>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', backgroundColor: '#252526', padding: '16px', borderRadius: '6px', border: '1px solid #333' }}>
                
                <select
                  value={currentVoiceId || ''}
                  onChange={(e) => handleVoiceSelect(e.target.value)}
                  style={{ flex: 1, minWidth: 0, height: '40px', padding: '0 12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', fontSize: '14px', outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}
                >
                  <option value="">未設定</option>
                  {voices.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.source === 'imported' ? `📁 ${v.name}` : `🎲 自動生成 (${v.timestamp})`} - {v.text.substring(0, 15)}...
                    </option>
                  ))}
                  <option value="__new__">... (ボイスデザインで新規作成 / インポート)</option>
                </select>

                <button 
                  onClick={onGoToVoiceDesign}
                  style={{ height: '40px', padding: '0 16px', backgroundColor: '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', transition: 'background-color 0.2s', whiteSpace: 'nowrap', boxSizing: 'border-box' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#444'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#333'}
                >
                  ボイスライブラリを開く
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
            キャラクターを選択するか、新しく追加してください。
          </div>
        )}
      </div>
    </div>
  );
};
