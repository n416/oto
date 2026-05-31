import React, { useState, useRef } from 'react';

import type { CharacterData } from './CharacterSettings';
import type { VoiceData, DialogOptions } from '../App';

interface VoiceGeneratorProps {
  characters: CharacterData[];
  setCharacters: React.Dispatch<React.SetStateAction<CharacterData[]>>;
  voices: VoiceData[];
  setVoices: React.Dispatch<React.SetStateAction<VoiceData[]>>;
  setDialog: (dialog: DialogOptions | null) => void;
}

export const VoiceGenerator: React.FC<VoiceGeneratorProps> = ({ characters, setCharacters, voices, setVoices, setDialog }) => {
  const [voicePrompt, setVoicePrompt] = useState("");
  const [speechText, setSpeechText] = useState("こんにちは。これは音声合成のテストです。");
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenerate = async () => {
    if (!voicePrompt || !speechText) return;
    setIsGenerating(true);
    
    try {
      const res = await fetch("http://127.0.0.1:7861/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: speechText,
          caption: voicePrompt
        })
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const resultData = await res.json();
      let audioUrl = resultData.urls?.[0] || "#";

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
          body: JSON.stringify({ filename: `voice_${Date.now()}.wav`, base64 })
        });
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          audioUrl = data.url; // 永続化されたURLに差し替え
        }
      } catch (e) {
        console.warn("生成された音声の永続化に失敗しました。GradioのURLをフォールバックとして使用します。", e);
      }

      const newVoice: VoiceData = {
        id: `voice_${Date.now()}`,
        name: voicePrompt, // デフォルト名をプロンプトと同一にする
        prompt: voicePrompt,
        text: speechText,
        audioUrl: audioUrl,
        source: 'generated',
        timestamp: new Date().toLocaleTimeString()
      };
      setVoices(prev => [newVoice, ...prev]);
    } catch (error) {
      console.error(error);
      setDialog({
        type: 'alert',
        title: '生成エラー',
        message: 'バックエンドとの通信に失敗しました。Irodori-TTSのVoice Designサーバー (127.0.0.1:7861) が起動しているか確認してください。'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImportWav = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const audioUrl = URL.createObjectURL(file);
    
    const newVoice: VoiceData = {
      id: `imported_${Date.now()}`,
      name: file.name,
      prompt: "（外部からインポートした音声）",
      text: "", // インポート直後は空なので、ユーザーに手入力させる
      audioUrl: audioUrl,
      source: 'imported',
      timestamp: new Date().toLocaleTimeString()
    };
    
    setVoices(prev => [newVoice, ...prev]);
    // 連続して同じファイルを選べるようにリセット
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateVoice = (id: string, field: keyof VoiceData, value: string) => {
    setVoices(voices.map(v => v.id === id ? { ...v, [field]: value } : v));
  };

  const deleteVoice = (id: string) => {
    const voiceToDelete = voices.find(v => v.id === id);
    setDialog({
      type: 'confirm',
      title: '音声の削除',
      message: 'この音声をライブラリから削除しますか？',
      onConfirm: async () => {
        if (voiceToDelete && voiceToDelete.audioUrl && voiceToDelete.audioUrl.startsWith('/uploads/')) {
          try {
            await fetch('/api/backend/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: voiceToDelete.audioUrl })
            });
          } catch (e) {
            console.error("Failed to delete voice audio file:", voiceToDelete.audioUrl, e);
          }
        }
        setVoices(voices.filter(v => v.id !== id));
      }
    });
  };

  const handleAssignToCharacter = (voice: VoiceData, charId: string) => {
    if (!charId) return;
    const newChars = characters.map(c => {
      if (c.id === charId) {
        return {
          ...c,
          refAudioPath: voice.audioUrl, // 実際のURL（Blob URL または http://...）を保存
          refText: voice.text
        };
      }
      return c;
    });
    setCharacters(newChars);
    setDialog({
      type: 'alert',
      title: '通知',
      message: `キャラクター「${characters.find(c => c.id === charId)?.name}」の参考音声に割り当てました！`
    });
  };

  const togglePlay = (voiceId: string, audioUrl: string) => {
    if (playingId === voiceId) {
      // すでに再生中なら停止する
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
    } else {
      // 別の音声を再生開始する
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioUrl && audioUrl !== '#') {
        const audio = new Audio(audioUrl);
        audio.onended = () => setPlayingId(null); // 再生終了時に状態を戻す
        audio.play().catch(e => console.error("Audio playback failed", e));
        audioRef.current = audio;
        setPlayingId(voiceId);
      } else {
        setDialog({ type: 'alert', title: 'エラー', message: '音声データがありません。' });
      }
    }
  };

  return (
    <div style={{ padding: '32px', backgroundColor: '#1e1e1e', height: '100%', overflowY: 'auto', color: '#ccc', boxSizing: 'border-box', display: 'flex', gap: '32px' }}>
      
      {/* 左ペイン：生成フォーム */}
      <div style={{ flex: '0 0 400px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div>
          <h2 style={{ fontSize: '20px', marginTop: 0, marginBottom: '8px', color: '#fff' }}>🎨 ボイスデザイン (Irodori-TTS)</h2>
          <p style={{ fontSize: '13px', color: '#aaa', margin: 0, lineHeight: '1.5' }}>
            音声の特徴（プロンプト）を指定してゼロから新しい声を生成するか、既存のWAVファイルをインポートしてボイスライブラリに追加します。
          </p>
        </div>

        <div style={{ backgroundColor: '#252526', padding: '24px', borderRadius: '8px', border: '1px solid #333' }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '13px', color: '#fff', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              🗣️ 音声の特徴 (プロンプト)
            </label>
            <textarea 
              value={voicePrompt}
              onChange={e => setVoicePrompt(e.target.value)}
              placeholder="例：少し低めで落ち着いた、20代女性の声"
              style={{ width: '100%', height: '80px', padding: '12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'none', fontSize: '14px', fontFamily: 'sans-serif', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = '#4a90e2'}
              onBlur={(e) => e.target.style.borderColor = '#444'}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ fontSize: '13px', color: '#fff', display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
              📝 喋らせるテキスト (10秒程度を推奨)
            </label>
            <textarea 
              value={speechText}
              onChange={e => setSpeechText(e.target.value)}
              style={{ width: '100%', height: '80px', padding: '12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'none', fontSize: '14px', fontFamily: 'sans-serif', outline: 'none' }}
              onFocus={(e) => e.target.style.borderColor = '#4a90e2'}
              onBlur={(e) => e.target.style.borderColor = '#444'}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !voicePrompt || !speechText}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: isGenerating || !voicePrompt || !speechText ? '#4a5568' : '#4a90e2',
              color: isGenerating || !voicePrompt || !speechText ? '#a0aec0' : '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: isGenerating || !voicePrompt || !speechText ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background-color 0.2s'
            }}
          >
            {isGenerating ? '⏳ 声帯を生成中...' : '🎲 新しい声を生成する'}
          </button>
        </div>
      </div>

      {/* 右ペイン：生成履歴 / ライブラリ */}
      <div style={{ flex: 1, backgroundColor: '#252526', borderRadius: '8px', border: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #333', backgroundColor: '#2d2d30', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>📋 ボイスライブラリ</h3>
          
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
          {voices.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
              ライブラリは空です。<br/>「新しい声を生成する」か、「WAVをインポート」してください。
            </div>
          ) : (
            voices.map((voice) => (
              <div key={voice.id} style={{ backgroundColor: '#1e1e1e', padding: '16px', borderRadius: '6px', border: '1px solid #444', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {voice.source === 'imported' ? (
                      <span style={{ fontSize: '11px', color: '#48bb78', backgroundColor: 'rgba(72, 187, 120, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>📁 インポート</span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#63b3ed', backgroundColor: 'rgba(99, 179, 237, 0.15)', padding: '2px 6px', borderRadius: '4px' }}>🎲 自動生成</span>
                    )}
                    <input 
                      type="text"
                      value={voice.name}
                      onChange={(e) => updateVoice(voice.id, 'name', e.target.value)}
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
                      onFocus={e => e.currentTarget.style.borderBottom = '1px solid #4a90e2'}
                      onBlur={e => e.currentTarget.style.borderBottom = '1px dashed #666'}
                      title="クリックして名前を変更"
                      placeholder="ボイスの名前"
                    />
                    <span style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>({voice.timestamp})</span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {voice.source === 'generated' && (
                      <button 
                        onClick={() => {
                          setVoicePrompt(voice.prompt);
                          setSpeechText(voice.text);
                        }}
                        style={{ background: 'none', border: '1px solid transparent', color: '#63b3ed', cursor: 'pointer', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', transition: 'all 0.2s', fontWeight: 'bold' }}
                        title="このプロンプトを左のフォームに読み込みます"
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(99, 179, 237, 0.1)'; e.currentTarget.style.border = '1px solid #4a90e2'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.border = '1px solid transparent'; }}
                      >
                        ↩️ ロード
                      </button>
                    )}
                    <button 
                      onClick={() => deleteVoice(voice.id)}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '18px', padding: '0 4px', marginLeft: '4px' }}
                      title="この音声を削除"
                      onMouseEnter={e => e.currentTarget.style.color = '#e53e3e'}
                      onMouseLeave={e => e.currentTarget.style.color = '#666'}
                    >×</button>
                  </div>
                </div>


                <div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                    サンプルテキスト
                  </div>
                  <div style={{ fontSize: '13px', color: '#e2e8f0', backgroundColor: 'rgba(255,255,255,0.03)', padding: '8px', borderRadius: '4px' }}>
                    {voice.source === 'imported' ? '（インポートされた音声のためテキスト情報はありません）' : voice.text}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px', paddingTop: '16px', borderTop: '1px dashed #333' }}>
                  <button 
                    onClick={() => togglePlay(voice.id, voice.audioUrl)}
                    style={{ 
                      padding: '8px 16px', 
                      backgroundColor: playingId === voice.id ? '#e53e3e' : '#2d3748', 
                      color: '#fff', 
                      border: '1px solid #4a5568', 
                      borderRadius: '4px', 
                      cursor: 'pointer', 
                      fontSize: '13px', 
                      transition: 'background-color 0.2s',
                      width: '90px',
                      textAlign: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = playingId === voice.id ? '#c53030' : '#4a5568'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = playingId === voice.id ? '#e53e3e' : '#2d3748'}
                  >
                    {playingId === voice.id ? '⏹ 停止' : '▶ 再生'}
                  </button>
                  
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '12px', color: '#888' }}>✅ キャラクターに設定:</span>
                    <select 
                      onChange={(e) => {
                        handleAssignToCharacter(voice, e.target.value);
                      }}
                      value={characters.find(c => c.refAudioPath === voice.audioUrl)?.id || ""}
                      style={{ padding: '8px', backgroundColor: '#252526', color: '#63b3ed', border: '1px solid #4a5568', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold', outline: 'none' }}
                    >
                      <option value="" disabled>キャラを選択...</option>
                      {characters.map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
};
