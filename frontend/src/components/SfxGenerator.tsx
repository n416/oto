import React, { useState, useRef } from 'react';
import { Client } from '@gradio/client';
import type { DialogOptions } from '../App';
import type { SfxData } from '../App';
import { WaveformTrimmer } from './WaveformTrimmer';

interface SfxGeneratorProps {
  sfxs: SfxData[];
  setSfxs: React.Dispatch<React.SetStateAction<SfxData[]>>;
  setDialog: (dialog: DialogOptions | null) => void;
  onSfxNameChange?: (id: string, newName: string) => void;
}

export const SfxGenerator: React.FC<SfxGeneratorProps> = ({ sfxs, setSfxs, setDialog, onSfxNameChange }) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // SFX001〜SFX999の中で空いている最小のIDを取得
  const getNextAvailableId = (): string => {
    for (let i = 1; i <= 999; i++) {
      const id = `SFX${i.toString().padStart(3, '0')}`;
      if (!sfxs.find(s => s.id === id)) {
        return id;
      }
    }
    return `SFX${Date.now()}`; // フォールバック
  };

  const handleTranslate = async () => {
    if (!prompt) return;
    setIsTranslating(true);
    try {
      const client = await Client.connect("http://127.0.0.1:7862/");
      const result = await client.predict("/translate", [prompt]);
      const translated = result.data?.[0] as string;
      if (translated) {
        setPrompt(translated);
      }
    } catch (error) {
      console.error(error);
      setDialog({
        type: 'alert',
        title: '翻訳エラー',
        message: 'バックエンドとの通信に失敗しました。'
      });
    } finally {
      setIsTranslating(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt) return;
    setIsGenerating(true);
    
    try {
      const client = await Client.connect("http://127.0.0.1:7862/");
      
      // 生成前に自動翻訳を挟む (日本語が含まれている場合や、常に翻訳を通す)
      let finalPrompt = prompt;
      if (/[ぁ-んァ-ヶ亜-熙]/.test(prompt)) {
        const transResult = await client.predict("/translate", [prompt]);
        if (transResult.data?.[0]) {
          finalPrompt = transResult.data[0] as string;
        }
      }

      const result = await client.predict("/generate", [finalPrompt]);
      
      // @ts-ignore
      const audioData = result.data?.[0];
      
      let audioUrl = "#";
      const rawValue = (audioData && typeof audioData === "object" && audioData.__type__ === "update") 
        ? audioData.value 
        : audioData;

      if (typeof rawValue === "string") {
        audioUrl = rawValue.startsWith("http") ? rawValue : `http://127.0.0.1:7862/file=${rawValue}`;
      } else if (rawValue && typeof rawValue === "object") {
        // @ts-ignore
        audioUrl = rawValue.url || (rawValue.path ? `http://127.0.0.1:7862/file=${rawValue.path}` : "#");
      }

      try {
        const audioRes = await fetch(audioUrl);
        const arrayBuffer = await audioRes.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const uploadRes = await fetch('/api/backend/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: `sfx_${Date.now()}.wav`, base64 })
        });
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          audioUrl = data.url; // 永続化されたURLに差し替え
        }
      } catch (e) {
        console.warn("生成された音声の永続化に失敗しました。GradioのURLをフォールバックとして使用します。", e);
      }

      const newId = getNextAvailableId();
      const newSfx: SfxData = {
        id: newId,
        name: prompt, // UIで表示されるキャプションは元のプロンプト（日本語）
        prompt: finalPrompt, // 実際に生成に使われたプロンプト（英語）
        audioUrl: audioUrl,
        source: 'generated',
        timestamp: new Date().toLocaleTimeString()
      };
      setSfxs(prev => [newSfx, ...prev]);
    } catch (error) {
      console.error(error);
      setDialog({
        type: 'alert',
        title: '生成エラー',
        message: 'バックエンドとの通信に失敗しました。'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImportWav = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        
        const newId = getNextAvailableId();
        const newSfx: SfxData = {
          id: newId,
          name: file.name.replace(/\.[^/.]+$/, ""), // 拡張子を除いたファイル名を初期キャプションに
          prompt: "（外部からインポートした効果音）",
          audioUrl: data.url,
          source: 'imported',
          timestamp: new Date().toLocaleTimeString()
        };
        
        setSfxs(prev => [newSfx, ...prev]);
      } catch (err) {
        console.error(err);
        setDialog({ type: 'alert', title: 'エラー', message: 'アップロードに失敗しました。' });
      }
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateSfx = <K extends keyof SfxData>(id: string, field: K, value: SfxData[K]) => {
    setSfxs(sfxs.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const deleteSfx = (id: string) => {
    setDialog({
      type: 'confirm',
      title: '効果音の削除',
      message: `${id} をライブラリから削除しますか？`,
      onConfirm: () => {
        setSfxs(sfxs.filter(s => s.id !== id));
      }
    });
  };

  const togglePlay = (sfxId: string, audioUrl: string) => {
    if (playingId === sfxId) {
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
        setPlayingId(sfxId);
      } else {
        setDialog({ type: 'alert', title: 'エラー', message: '音声データがありません（モック状態です）。' });
      }
    }
  };

  // ID順にソートして表示
  const sortedSfxs = [...sfxs].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div style={{ padding: '32px', backgroundColor: '#1e1e1e', height: '100%', overflowY: 'auto', color: '#ccc', boxSizing: 'border-box', display: 'flex', gap: '32px' }}>
      
      {/* 左ペイン：生成フォーム */}
      <div style={{ flex: '0 0 400px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h2 style={{ fontSize: '20px', marginTop: 0, marginBottom: '8px', color: '#fff' }}>💣 効果音デザイン</h2>
          <p style={{ fontSize: '13px', color: '#aaa', margin: 0, lineHeight: '1.5' }}>
            効果音の特徴を指定してAIで生成するか、既存のWAVファイルをインポートしてSFXライブラリに追加します。
          </p>
        </div>

        <div style={{ backgroundColor: '#252526', padding: '24px', borderRadius: '8px', border: '1px solid #333' }}>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '13px', color: '#fff', fontWeight: 'bold' }}>
                💥 効果音の特徴 (日本語OK)
              </label>
              <button
                onClick={handleTranslate}
                disabled={isTranslating || !prompt}
                style={{ padding: '4px 8px', fontSize: '11px', backgroundColor: '#2d3748', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '4px', cursor: (isTranslating || !prompt) ? 'not-allowed' : 'pointer' }}
              >
                {isTranslating ? '翻訳中...' : '🔤 英語に翻訳'}
              </button>
            </div>
            <textarea 
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="例：シネマティックな爆発音、重低音 (または a loud cinematic explosion)"
              style={{ width: '100%', height: '80px', padding: '12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'none', fontSize: '14px', fontFamily: 'sans-serif', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = '#4a90e2'}
              onBlur={(e) => e.target.style.borderColor = '#444'}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: isGenerating || !prompt ? '#4a5568' : '#e2a74a',
              color: isGenerating || !prompt ? '#a0aec0' : '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: isGenerating || !prompt ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background-color 0.2s'
            }}
          >
            {isGenerating ? '⏳ 生成中...' : '🎲 新しい効果音を生成'}
          </button>
        </div>
      </div>

      {/* 右ペイン：SFXライブラリ */}
      <div style={{ flex: 1, backgroundColor: '#252526', borderRadius: '8px', border: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', backgroundColor: '#2d2d30', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>📋 SFXライブラリ</h3>
          
          <label 
            style={{ padding: '6px 12px', backgroundColor: 'transparent', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#4a5568'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#cbd5e0'; }}
          >
            📁 WAVインポート
            <input 
              type="file" 
              accept=".wav" 
              style={{ display: 'none' }} 
              ref={fileInputRef}
              onChange={handleImportWav} 
            />
          </label>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {sortedSfxs.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
              SFXライブラリは空です。<br/>効果音を生成するか、WAVをインポートしてください。
            </div>
          ) : (
            sortedSfxs.map((sfx) => (
              <div key={sfx.id} style={{ backgroundColor: '#1e1e1e', padding: '16px', borderRadius: '6px', border: '1px solid #444', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#e2a74a', fontFamily: 'monospace' }}>
                      {sfx.id}
                    </span>
                    <input 
                      type="text"
                      value={sfx.name}
                      onChange={(e) => {
                        if (onSfxNameChange) {
                          onSfxNameChange(sfx.id, e.target.value);
                        } else {
                          updateSfx(sfx.id, 'name', e.target.value);
                        }
                      }}
                      style={{ 
                        fontSize: '14px', 
                        color: '#fff', 
                        fontWeight: 'bold', 
                        backgroundColor: 'transparent', 
                        border: '1px solid transparent', 
                        borderBottom: '1px dashed #666',
                        outline: 'none',
                        flex: 1,
                        minWidth: '150px',
                        padding: '2px 4px'
                      }}
                      onFocus={e => e.currentTarget.style.borderBottom = '1px solid #e2a74a'}
                      onBlur={e => e.currentTarget.style.borderBottom = '1px dashed #666'}
                      title="キャプションを変更"
                      placeholder="例：どーーーん"
                    />
                    <span style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>({sfx.timestamp})</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '16px' }}>
                    {sfx.source === 'generated' && (
                      <button 
                        onClick={() => setPrompt(sfx.prompt)}
                        style={{ background: 'none', border: '1px solid transparent', color: '#e2a74a', cursor: 'pointer', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', transition: 'all 0.2s', fontWeight: 'bold' }}
                        title="このプロンプトを左のフォームに読み込みます"
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(226, 167, 74, 0.1)'; e.currentTarget.style.border = '1px solid #e2a74a'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
                      >
                        ↩️ ロード
                      </button>
                    )}
                    <button 
                      onClick={() => deleteSfx(sfx.id)}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '18px', padding: '0 4px', marginLeft: '4px' }}
                      title="このSFXを削除"
                      onMouseEnter={e => e.currentTarget.style.color = '#e53e3e'}
                      onMouseLeave={e => e.currentTarget.style.color = '#666'}
                    >×</button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px', paddingTop: '16px', borderTop: '1px dashed #333' }}>
                  <button 
                    onClick={() => togglePlay(sfx.id, sfx.audioUrl)}
                    style={{ 
                      padding: '8px 16px', 
                      backgroundColor: playingId === sfx.id ? '#e53e3e' : '#2d3748', 
                      color: '#fff', 
                      border: '1px solid #4a5568', 
                      borderRadius: '4px', 
                      cursor: 'pointer', 
                      fontSize: '13px', 
                      transition: 'background-color 0.2s',
                      width: '90px',
                      textAlign: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = playingId === sfx.id ? '#c53030' : '#4a5568'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = playingId === sfx.id ? '#e53e3e' : '#2d3748'}
                  >
                    {playingId === sfx.id ? '⏹ 停止' : '▶ 再生'}
                  </button>
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    プロンプト: {sfx.prompt}
                  </span>
                </div>

                {/* 手動オフセット設定 */}
                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                    ✂️ 頭出し・カット位置の調整
                  </label>
                  <WaveformTrimmer 
                    audioUrl={sfx.audioUrl}
                    trimOffset={sfx.trimOffset}
                    trimEnd={sfx.trimEnd}
                    onChangeOffset={(start, end) => {
                      // Note: updateSfx needs to be called twice or modified to accept multiple fields.
                      // To keep it simple, we update one by one or create a new object.
                      setSfxs(prev => prev.map(s => s.id === sfx.id ? { ...s, trimOffset: start, trimEnd: end } : s));
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
};
