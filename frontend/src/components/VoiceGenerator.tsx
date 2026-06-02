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
  const [selectedEmoji, setSelectedEmoji] = useState<{ [voiceId: string]: string }>({});
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const EMOJI_OPTIONS = [
    { emoji: '👂', label: '囁き、耳元の音' },
    { emoji: '😮‍💨', label: '吐息、溜息、寝息' },
    { emoji: '⏸️', label: '間、沈黙' },
    { emoji: '🤭', label: '笑い（くすくす等）' },
    { emoji: '🥵', label: '喘ぎ、うめき声' },
    { emoji: '📢', label: 'エコー、リバーブ' },
    { emoji: '😏', label: 'からかうように、甘えるように' },
    { emoji: '🥺', label: '声を震わせながら、自信のなさげに' },
    { emoji: '🌬️', label: '息切れ、荒い息遣い' },
    { emoji: '😮', label: '息をのむ' },
    { emoji: '👅', label: '舐める音、水音' },
    { emoji: '💋', label: 'リップノイズ' },
    { emoji: '🫶', label: '優しく' },
    { emoji: '😭', label: '嗚咽、泣き声' },
    { emoji: '😱', label: '悲鳴、絶叫' },
    { emoji: '😪', label: '眠そうに、気だるげに' },
    { emoji: '⏩', label: '早口、急いで' },
    { emoji: '📞', label: '電話越し' },
    { emoji: '🐢', label: 'ゆっくりと' },
    { emoji: '🥤', label: '唾を飲み込む音' },
    { emoji: '🤧', label: '咳き込み、鼻をすする' },
    { emoji: '😒', label: '舌打ち' },
    { emoji: '😰', label: '慌てて、動揺' },
    { emoji: '😆', label: '喜びながら' },
    { emoji: '😠', label: '怒り、不満げに' },
    { emoji: '😲', label: '驚き' },
    { emoji: '🥱', label: 'あくび' },
    { emoji: '😖', label: '苦しげに' },
    { emoji: '😟', label: '心配そうに' },
    { emoji: '🫣', label: '恥ずかしそうに' },
    { emoji: '🙄', label: '呆れたように' },
    { emoji: '😊', label: '楽しげに' },
    { emoji: '👌', label: '相槌、頷く音' },
    { emoji: '🙏', label: '懇願するように' },
    { emoji: '🥴', label: '酔っ払って' },
    { emoji: '🎵', label: '鼻歌' },
    { emoji: '🤐', label: '口を塞がれて' },
    { emoji: '😌', label: '安堵、満足げに' },
    { emoji: '🤔', label: '疑問の声' }
  ];

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
  };

  const handleUnassignFromCharacter = (charId: string) => {
    const newChars = characters.map(c => {
      if (c.id === charId) {
        return {
          ...c,
          refAudioPath: "",
          refText: ""
        };
      }
      return c;
    });
    setCharacters(newChars);
  };

  const handleGenerateVariation = async (voice: VoiceData, emoji: string) => {
    if (isGenerating) return;
    setIsGenerating(true);
    
    // プロンプトに絵文字を追加
    const newPrompt = `${voice.prompt} ${emoji}`.trim();
    
    try {
      const res = await fetch("http://127.0.0.1:7861/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: voice.text || "こんにちは。これは音声合成のテストです。",
          caption: newPrompt
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
          audioUrl = data.url;
        }
      } catch (e) {
        console.warn("生成された音声の永続化に失敗しました。", e);
      }

      const newVoice: VoiceData = {
        id: `voice_${Date.now()}`,
        name: `${voice.name} ${emoji}`,
        prompt: newPrompt,
        text: voice.text,
        audioUrl: audioUrl,
        source: 'generated',
        timestamp: new Date().toLocaleTimeString(),
        parentId: voice.parentId || voice.id // 孫ではなく子として直列に追加
      };
      setVoices(prev => [newVoice, ...prev]);
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
      <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
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
              style={{ width: '100%', height: '120px', padding: '12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'none', fontSize: '14px', fontFamily: 'sans-serif', outline: 'none', boxSizing: 'border-box' }}
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
              style={{ width: '100%', height: '120px', padding: '12px', backgroundColor: '#1e1e1e', color: '#fff', border: '1px solid #444', borderRadius: '4px', resize: 'none', fontSize: '14px', fontFamily: 'sans-serif', outline: 'none', boxSizing: 'border-box' }}
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
            voices.filter(v => !v.parentId).map((parentVoice) => {
              const childVoices = voices.filter(v => v.parentId === parentVoice.id);
              const isCollapsed = collapsedParents.has(parentVoice.id);
              
              const toggleCollapse = () => {
                setCollapsedParents(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(parentVoice.id)) {
                    newSet.delete(parentVoice.id);
                  } else {
                    newSet.add(parentVoice.id);
                  }
                  return newSet;
                });
              };

              return (
                <div key={`group_${parentVoice.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* 親ボイスカード */}
                  {renderVoiceCard(parentVoice, false)}
                  
                  {/* アコーディオンボタン (派生がある場合のみ) */}
                  {childVoices.length > 0 && (
                    <div style={{ display: 'flex', marginLeft: '24px', marginTop: '-4px', zIndex: 1 }}>
                      <button
                        onClick={toggleCollapse}
                        style={{
                          background: '#2d3748',
                          color: '#cbd5e0',
                          border: '1px solid #4a5568',
                          borderTop: 'none',
                          borderRadius: '0 0 8px 8px',
                          padding: '2px 12px',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#4a5568'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#2d3748'; e.currentTarget.style.color = '#cbd5e0'; }}
                      >
                        <span>{isCollapsed ? '▶' : '▼'}</span>
                        <span>派生 ({childVoices.length})</span>
                      </button>
                    </div>
                  )}
                  
                  {/* 派生ボイスカード群 */}
                  {!isCollapsed && childVoices.length > 0 && (
                    <div style={{ 
                      paddingLeft: '24px', 
                      marginLeft: '12px', 
                      borderLeft: '2px solid #4a5568', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      gap: '8px',
                      paddingTop: '8px'
                    }}>
                      {childVoices.map(childVoice => renderVoiceCard(childVoice, true))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );

  function renderVoiceCard(voice: VoiceData, isChild: boolean) {
    return (
      <div key={voice.id} style={{ 
        backgroundColor: isChild ? '#222222' : '#1e1e1e', 
        padding: '12px', 
        borderRadius: '6px', 
        border: isChild ? '1px solid #333' : '1px solid #444', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px',
        boxShadow: isChild ? 'none' : '0 2px 4px rgba(0,0,0,0.1)',
        position: 'relative',
        zIndex: 2
      }}>
        {/* ヘッダーエリア */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            {/* 再生ボタン */}
            <button 
              onClick={() => togglePlay(voice.id, voice.audioUrl)}
              style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                backgroundColor: playingId === voice.id ? '#e53e3e' : '#4a90e2',
                color: '#fff', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', transition: 'background-color 0.2s'
              }}
              onMouseEnter={e => { if(playingId !== voice.id) e.currentTarget.style.backgroundColor = '#3182ce'; }}
              onMouseLeave={e => { if(playingId !== voice.id) e.currentTarget.style.backgroundColor = '#4a90e2'; }}
              title={playingId === voice.id ? "停止" : "再生"}
            >
              {playingId === voice.id ? '⏹' : '▶'}
            </button>

            {isChild && <span style={{ fontSize: '12px', color: '#a0aec0' }}>↳</span>}
            
            {/* ソースバッジ */}
            {voice.source === 'imported' ? (
              <span style={{ fontSize: '10px', color: '#48bb78', border: '1px solid rgba(72, 187, 120, 0.5)', padding: '0 4px', borderRadius: '4px' }}>IMP</span>
            ) : (
              <span style={{ fontSize: '10px', color: '#63b3ed', border: '1px solid rgba(99, 179, 237, 0.5)', padding: '0 4px', borderRadius: '4px' }}>GEN</span>
            )}
            
            {/* 名前インプット */}
            <input 
              type="text"
              value={voice.name}
              onChange={(e) => updateVoice(voice.id, 'name', e.target.value)}
              style={{ 
                fontSize: isChild ? '13px' : '14px', 
                color: '#fff', 
                fontWeight: 'bold', 
                backgroundColor: 'transparent', 
                border: '1px solid transparent', 
                borderBottom: '1px dashed #666',
                outline: 'none',
                flex: 1,
                minWidth: '0',
                padding: '2px 4px',
                textOverflow: 'ellipsis'
              }}
              onFocus={e => e.currentTarget.style.borderBottom = '1px solid #4a90e2'}
              onBlur={e => e.currentTarget.style.borderBottom = '1px dashed #666'}
              placeholder="ボイスの名前"
            />
            <span style={{ fontSize: '10px', color: '#666', whiteSpace: 'nowrap' }}>{voice.timestamp}</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {voice.source === 'generated' && (
              <button 
                onClick={() => {
                  setVoicePrompt(voice.prompt);
                  setSpeechText(voice.text);
                }}
                style={{ background: 'none', border: 'none', color: '#63b3ed', cursor: 'pointer', fontSize: '12px', padding: '4px', borderRadius: '4px' }}
                title="プロンプトをロード"
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(99, 179, 237, 0.1)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                ↩️
              </button>
            )}
            <button 
              onClick={() => deleteVoice(voice.id)}
              style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
              title="削除"
              onMouseEnter={e => e.currentTarget.style.color = '#e53e3e'}
              onMouseLeave={e => e.currentTarget.style.color = '#666'}
            >×</button>
          </div>
        </div>

        {/* サンプルテキスト */}
        {voice.text && (
          <div style={{ 
            fontSize: '12px', 
            color: '#cbd5e0', 
            padding: '0 8px 0 36px', 
            opacity: 0.8,
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {voice.source === 'imported' ? '（インポートされた音声）' : `"${voice.text}"`}
          </div>
        )}

        {/* フッターエリア (アクション) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px', paddingTop: '8px', borderTop: '1px dashed #333' }}>
          
          {/* 左側：キャラクター割り当て */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: '#888' }} title="キャラクター割り当て">👤</span>
            
            {characters.filter(c => c.refAudioPath === voice.audioUrl).map(c => (
              <div 
                key={c.id} 
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '2px', 
                  backgroundColor: 'rgba(74, 144, 226, 0.15)', 
                  border: '1px solid rgba(74, 144, 226, 0.4)', 
                  borderRadius: '12px', 
                  padding: '1px 6px', 
                  fontSize: '11px', 
                  color: '#63b3ed' 
                }}
              >
                {c.name}
                <button 
                  onClick={() => handleUnassignFromCharacter(c.id)}
                  style={{ background: 'none', border: 'none', color: '#4a90e2', cursor: 'pointer', fontSize: '10px', padding: '0 2px', marginLeft: '2px' }}
                  title="割り当て解除"
                >×</button>
              </div>
            ))}

            <select 
              onChange={(e) => {
                handleAssignToCharacter(voice, e.target.value);
                e.target.value = "";
              }}
              value=""
              style={{ 
                padding: '2px 4px', backgroundColor: 'transparent', color: '#888', 
                border: '1px dashed #444', borderRadius: '4px', cursor: 'pointer', 
                fontSize: '11px', outline: 'none' 
              }}
            >
              <option value="" disabled>＋</option>
              {characters
                .filter(c => c.refAudioPath !== voice.audioUrl)
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))
              }
            </select>
          </div>

          {/* 右側：派生生成 */}
          {voice.source === 'generated' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', flexShrink: 0 }}>
              <span style={{ fontSize: '14px', color: '#888' }} title="派生を作成">🌱</span>
              <select
                value={selectedEmoji[voice.id] || ''}
                onChange={(e) => setSelectedEmoji(prev => ({ ...prev, [voice.id]: e.target.value }))}
                style={{
                  padding: '2px 4px',
                  backgroundColor: '#252526',
                  color: '#cbd5e0',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  fontSize: '11px',
                  outline: 'none',
                  maxWidth: '100px'
                }}
              >
                <option value="" disabled>演出を選ぶ</option>
                {EMOJI_OPTIONS.map(opt => (
                  <option key={opt.emoji} value={opt.emoji}>{opt.emoji} {opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => handleGenerateVariation(voice, selectedEmoji[voice.id])}
                disabled={isGenerating || !selectedEmoji[voice.id]}
                style={{
                  background: 'transparent',
                  color: '#4a90e2',
                  border: '1px solid #4a90e2',
                  borderRadius: '4px',
                  cursor: (isGenerating || !selectedEmoji[voice.id]) ? 'not-allowed' : 'pointer',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  transition: 'all 0.2s',
                  opacity: (isGenerating || !selectedEmoji[voice.id]) ? 0.5 : 1
                }}
                onMouseEnter={e => { if(!isGenerating && selectedEmoji[voice.id]) e.currentTarget.style.backgroundColor = 'rgba(74, 144, 226, 0.1)'; }}
                onMouseLeave={e => { if(!isGenerating && selectedEmoji[voice.id]) e.currentTarget.style.backgroundColor = 'transparent'; }}
                title="新しい派生を生成"
              >
                生成
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
};
