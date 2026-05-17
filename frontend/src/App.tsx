import { useState, useMemo, useRef, useEffect } from 'react';
import { Layout, Model, TabNode } from 'flexlayout-react';
import type { IJsonModel } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { SettingsModal } from './components/SettingsModal';
import { CharacterSettings, type CharacterData } from './components/CharacterSettings';
import { VoiceGenerator } from './components/VoiceGenerator';
import { PreviewPane } from './components/PreviewPane';

type LayerType = string;

export interface ScriptData {
  [layerId: string]: string;
}

export interface LayerInfo {
  id: string;
  name: string;
  color: string;
  visibleInTimeline: boolean;
}

export interface VoiceData {
  id: string;
  name: string;
  prompt: string;
  text: string;
  audioUrl: string;
  source: 'generated' | 'imported';
  timestamp: string;
}

interface ParsedBlock {
  id: string;
  lineIndex: number;
  layer: LayerType;
  text: string;
  color: string;
}

export type DialogOptions = {
  type: 'alert' | 'confirm' | 'prompt';
  title: string;
  message: string;
  defaultValue?: string;
  onConfirm?: (val?: string) => void;
};

// ----------------------------------------------------
// FlexLayout (IDEレイアウト) の初期設定
// ----------------------------------------------------
const initialLayout: IJsonModel = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
  },
  borders: [],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 35,
        children: [
          {
            type: "tab",
            name: "📝 台本エディタ",
            component: "editor"
          },
          {
            type: "tab",
            name: "👥 キャラクター設定",
            component: "characters"
          },
          {
            type: "tab",
            id: "tab-voice-design",
            name: "🎨 ボイスデザイン",
            component: "voice"
          }
        ]
      },
      {
        type: "tabset",
        weight: 35,
        children: [
          {
            type: "tab",
            name: "📺 プレビュー",
            component: "preview"
          }
        ]
      },
      {
        type: "tabset",
        weight: 30,
        children: [
          {
            type: "tab",
            name: "⏱️ タイムライン",
            component: "timeline"
          }
        ]
      }
    ]
  }
};

const defaultLayers: LayerInfo[] = [
  { id: 'dialogue', name: '会話 (Dialogue)', color: '#4a90e2', visibleInTimeline: true },
  { id: 'sfx', name: '効果音 (SFX)', color: '#e2a74a', visibleInTimeline: true },
  { id: 'bgm', name: 'BGM', color: '#50e3c2', visibleInTimeline: true }
];

function App() {
  const [layoutModel] = useState<Model>(() => Model.fromJson(initialLayout));
  
  // --- カスタムダイアログ用ステート ---
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  const [layers, setLayers] = useState<LayerInfo[]>(() => {
    const saved = localStorage.getItem('oto_ide_layers');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return defaultLayers;
  });

  const [activeTab, setActiveTab] = useState<LayerType>(layers[0]?.id || 'dialogue');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadY, setPlayheadY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, lineIndex: number } | null>(null);
  const [timelineContextMenu, setTimelineContextMenu] = useState<{ x: number, y: number } | null>(null);
  
  const [scripts, setScripts] = useState<ScriptData>(() => {
    const saved = localStorage.getItem('oto_ide_scripts');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved scripts", e);
      }
    }
    return {
      dialogue: "XX:こんにちは\nYY:どーもどーも\n\nXX:今日の天気はどうですか？\nYY:快晴ですね！",
      sfx: "\n\n(a loud cinematic explosion, boom)",
      bgm: "(Start intense BGM)"
    };
  });

  const [characters, setCharacters] = useState<CharacterData[]>(() => {
    const saved = localStorage.getItem('oto_ide_characters');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse saved characters", e);
      }
    }
    return [
      { id: "XX", name: "キャラクター1", refText: "" },
      { id: "YY", name: "キャラクター2", refText: "" }
    ];
  });

  const [voices, setVoices] = useState<VoiceData[]>(() => {
    const saved = localStorage.getItem('oto_ide_voices');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  // カット（区切り線）のY座標リスト（初期は3秒=180px毎）
  const [cuts, setCuts] = useState<number[]>(() => {
    const saved = localStorage.getItem('oto_ide_cuts');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [180, 360, 540, 720, 900, 1080, 1260, 1440];
  });

  // テキストが変更されるたびにローカルストレージに自動保存
  useEffect(() => {
    localStorage.setItem('oto_ide_scripts', JSON.stringify(scripts));
  }, [scripts]);

  useEffect(() => {
    localStorage.setItem('oto_ide_characters', JSON.stringify(characters));
  }, [characters]);

  useEffect(() => {
    localStorage.setItem('oto_ide_cuts', JSON.stringify(cuts));
  }, [cuts]);

  useEffect(() => {
    localStorage.setItem('oto_ide_layers', JSON.stringify(layers));
  }, [layers]);

  useEffect(() => {
    localStorage.setItem('oto_ide_voices', JSON.stringify(voices));
  }, [voices]);

  // JSONファイルへの書き出し
  const handleExport = () => {
    const projectData = { scripts, characters, cuts, layers, voices };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projectData, null, 2));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", "oto_project.json");
    document.body.appendChild(downloadNode);
    downloadNode.click();
    downloadNode.remove();
  };

  // JSONファイルの読み込み
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        // 古いバージョンのファイル互換性維持
        if (json.dialogue !== undefined) {
          setScripts(json);
        } else if (json.scripts) {
          setScripts(json.scripts);
          if (json.characters) setCharacters(json.characters);
          if (json.cuts) setCuts(json.cuts);
          if (json.layers) setLayers(json.layers);
          if (json.voices) setVoices(json.voices);
        } else {
          setDialog({ type: 'alert', title: 'エラー', message: '対応していないファイル形式です。' });
        }
      } catch (error) {
        setDialog({ type: 'alert', title: 'エラー', message: '無効なJSONファイルです。' });
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // 同じファイルを再読み込みできるようにリセット
  };

  // 右クリックメニューをそれ以外の場所クリックで閉じる
  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setTimelineContextMenu(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const GRID_HEIGHT = 60; // 1行あたりの高さ

  const maxLines = Math.max(
    ...layers.map(l => (scripts[l.id] || "").split('\n').length),
    20
  );

  // 再生ヘッドのアニメーション
  useEffect(() => {
    let animationFrameId: number;
    let lastTime: number;

    const animate = (time: number) => {
      if (lastTime !== undefined) {
        const delta = time - lastTime;
        // 1秒間に 60px (1行分) 進む想定
        setPlayheadY(prev => prev + (delta / 1000) * GRID_HEIGHT);
      }
      lastTime = time;
      animationFrameId = requestAnimationFrame(animate);
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying]);

  const handlePlayToggle = () => {
    if (!isPlaying && playheadY >= maxLines * GRID_HEIGHT) {
      setPlayheadY(0); // 最後までいってたら最初から再生
    }
    setIsPlaying(!isPlaying);
  };

  // タイムライン上のブロックをDnDで移動した時の処理
  const moveBlock = (layer: LayerType, fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    const lines = (scripts[layer] || '').split('\n');
    const textToMove = lines[fromIndex] || '';
    
    // 行数が足りない場合は空行でパディング
    while (lines.length <= Math.max(fromIndex, toIndex)) {
      lines.push('');
    }
    
    // 入れ替え処理 (Swap)
    const temp = lines[toIndex];
    lines[toIndex] = textToMove;
    lines[fromIndex] = temp;
    
    setScripts({
      ...scripts,
      [layer]: lines.join('\n')
    });
  };

  // タイムラインの右クリックメニューからの時間（行）の追加・削除処理
  const handleModifyTime = (lineIndex: number, amount: number, isDelete: boolean, force: boolean = false) => {
    if (isDelete && !force) {
      // 巻き込まれて消えるブロックがあるかチェック
      let hasOverlap = false;
      layers.forEach(layer => {
        const lines = (scripts[layer.id] || '').split('\n');
        for (let i = 0; i < amount; i++) {
          if (lines[lineIndex + i] && lines[lineIndex + i].trim() !== '') {
            hasOverlap = true;
          }
        }
      });
      
      if (hasOverlap) {
        setDialog({
          type: 'confirm',
          title: 'ブロック削除の警告',
          message: '指定した範囲にブロック（テキスト）が存在します。削除してよろしいですか？',
          onConfirm: () => handleModifyTime(lineIndex, amount, isDelete, true)
        });
        return;
      }
    }

    // スクリプト（テキスト）の更新
    const newScripts = { ...scripts };
    layers.forEach(layer => {
      const lines = (newScripts[layer.id] || '').split('\n');
      if (isDelete) {
        lines.splice(lineIndex, amount);
      } else {
        const padding = Array(amount).fill('');
        // 1行下（後ろ）に追加する
        lines.splice(lineIndex + 1, 0, ...padding);
      }
      newScripts[layer.id] = lines.join('\n');
    });
    setScripts(newScripts);

    // カット（区切り線）のY座標の更新
    setCuts(prevCuts => {
      // 追加の場合は1行下（その後ろ）がズレる基準点になる
      const targetY = (isDelete ? lineIndex : lineIndex + 1) * GRID_HEIGHT;
      const shiftY = amount * GRID_HEIGHT * (isDelete ? -1 : 1);
      
      const newCuts = prevCuts.map(cutY => {
        if (isDelete && cutY >= targetY && cutY < targetY + amount * GRID_HEIGHT) {
          return -1; // 削除領域内のカットは消す
        }
        if (cutY >= targetY) {
          return cutY + shiftY; // ズレる
        }
        return cutY;
      });
      return newCuts.filter(y => y > 0);
    });
  };

  // レイヤー管理関連
  const handleAddLayer = () => {
    const id = `layer_${Date.now()}`;
    setDialog({
      type: 'prompt',
      title: '新しいレイヤーの追加',
      message: '新規レイヤーの名前を入力してください',
      defaultValue: '新規レイヤー',
      onConfirm: (name) => {
        if (!name || name.trim() === '') return;
        const colors = ['#f56565', '#ed8936', '#ecc94b', '#48bb78', '#38b2ac', '#4299e1', '#667eea', '#9f7aea', '#ed64a6'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const newLayer: LayerInfo = { id, name, color: randomColor, visibleInTimeline: true };
        setLayers(prev => [...prev, newLayer]);
        setScripts(prev => ({ ...prev, [id]: "" }));
        setActiveTab(id);
      }
    });
  };

  const handleEditLayer = (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;
    setDialog({
      type: 'prompt',
      title: 'レイヤー名の変更',
      message: 'レイヤーの新しい名前を入力してください',
      defaultValue: layer.name,
      onConfirm: (newName) => {
        if (newName && newName.trim() !== '') {
          setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name: newName } : l));
        }
      }
    });
  };

  const handleDeleteLayer = (layerId: string) => {
    if (layers.length <= 1) {
      setDialog({ type: 'alert', title: 'エラー', message: '最後のレイヤーは削除できません。' });
      return;
    }
    setDialog({
      type: 'confirm',
      title: 'レイヤーの削除',
      message: 'このレイヤーと、含まれるすべての台本データを削除しますか？',
      onConfirm: () => {
        setLayers(prev => prev.filter(l => l.id !== layerId));
        const newScripts = { ...scripts };
        delete newScripts[layerId];
        setScripts(newScripts);
        if (activeTab === layerId) {
          setActiveTab(layers.filter(l => l.id !== layerId)[0].id);
        }
      }
    });
  };

  // スクロール同期・ドラッグ領域用のRef
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // ドラッグ操作の実装
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect();
        let newY = e.clientY - rect.top + timelineRef.current.scrollTop;
        const maxY = maxLines * GRID_HEIGHT;
        
        if (newY < 0) newY = 0;
        if (newY > maxY) newY = maxY;
        
        setPlayheadY(newY);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, maxLines]);

  // モーダル管理用のState
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setScripts({
      ...scripts,
      [activeTab]: e.target.value
    });
  };

  const handleScroll = () => {
    if (editorRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = editorRef.current.scrollTop;
    }
  };

  const timelineBlocks = useMemo(() => {
    const blocks: ParsedBlock[] = [];
    
    layers.forEach(layer => {
      if (!layer.visibleInTimeline) return;
      
      const text = scripts[layer.id] || "";
      const lines = text.split('\n');
      lines.forEach((lineText, idx) => {
        if (lineText.trim() !== '') {
          blocks.push({
            id: `${layer.id}-${idx}`,
            lineIndex: idx,
            layer: layer.id,
            text: lineText.trim(),
            color: layer.color
          });
        }
      });
    });

    blocks.sort((a, b) => a.lineIndex - b.lineIndex);
    return blocks;
  }, [scripts, layers]);

  const visibleLayers = layers.filter(l => l.visibleInTimeline);

  // ----------------------------------------------------
  // IDEの各ペイン（タブ）の中身を生成するファクトリー関数
  // ----------------------------------------------------
  const factory = (node: TabNode) => {
    const component = node.getComponent();

    if (component === "characters") {
      return (
        <CharacterSettings 
          characters={characters} 
          setCharacters={setCharacters} 
          voices={voices}
          onGoToVoiceDesign={() => {
            layoutModel.doAction(FlexLayout.Actions.selectTab("tab-voice-design"));
          }}
          setDialog={setDialog}
        />
      );
    }

    if (component === "voice") {
      return <VoiceGenerator characters={characters} setCharacters={setCharacters} voices={voices} setVoices={setVoices} setDialog={setDialog} />;
    }

    if (component === "preview") {
      return (
        <PreviewPane
          playheadY={playheadY}
          setPlayheadY={setPlayheadY}
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
          maxLines={maxLines}
          GRID_HEIGHT={GRID_HEIGHT}
          cuts={cuts}
          scripts={scripts}
        />
      );
    }

    if (component === "editor") {
      const currentLinesCount = Math.max((scripts[activeTab] || '').split('\n').length, 20);
      
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#1e1e1e' }}>
          <div style={{ display: 'flex', backgroundColor: '#252526', borderBottom: '1px solid #333', overflowX: 'auto', alignItems: 'center' }}>
            {layers.map(layer => (
              <div 
                key={layer.id}
                onClick={() => setActiveTab(layer.id)} 
                onContextMenu={(e) => { e.preventDefault(); handleEditLayer(layer.id); }}
                style={{ 
                  padding: '8px 16px', 
                  fontSize: '13px', 
                  cursor: 'pointer', 
                  backgroundColor: activeTab === layer.id ? '#1e1e1e' : 'transparent', 
                  borderTop: activeTab === layer.id ? `2px solid ${layer.color}` : '2px solid transparent', 
                  color: activeTab === layer.id ? '#fff' : '#888',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap',
                  userSelect: 'none'
                }}
              >
                <span onDoubleClick={() => handleEditLayer(layer.id)} title="ダブルクリックで名前を変更">{layer.name}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteLayer(layer.id); }}
                  style={{ background: 'none', border: 'none', color: activeTab === layer.id ? '#888' : '#555', cursor: 'pointer', padding: '0 4px', fontSize: '14px' }}
                  title="レイヤーを削除"
                  onMouseEnter={e => e.currentTarget.style.color = '#e53e3e'}
                  onMouseLeave={e => e.currentTarget.style.color = activeTab === layer.id ? '#888' : '#555'}
                >×</button>
              </div>
            ))}
            <button 
              onClick={handleAddLayer}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: '8px 16px', fontWeight: 'bold', fontSize: '16px' }}
              title="新しいレイヤーを追加"
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = '#888'}
            >＋</button>
          </div>
          
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* 行番号ガター */}
            <div 
              ref={gutterRef}
              style={{ 
                width: '40px', 
                backgroundColor: '#252526', 
                borderRight: '1px solid #333', 
                color: '#666', 
                textAlign: 'right', 
                padding: '16px 8px 16px 0', 
                fontSize: '14px', 
                fontFamily: 'Consolas, Monaco, monospace', 
                lineHeight: '21px', // textareaと完全に一致させる
                overflowY: 'hidden', // スクロールバーは隠す
                boxSizing: 'border-box',
                userSelect: 'none'
              }}
            >
              {[...Array(currentLinesCount)].map((_, i) => (
                <div 
                  key={i} 
                  onClick={() => setSelectedLine(i + 1)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                  onMouseLeave={(e) => e.currentTarget.style.color = '#666'}
                  title={`Line ${i + 1} の設定を開く`}
                >
                  L{i + 1}
                </div>
              ))}
            </div>
            
            {/* テキストエディタ */}
            <textarea 
              ref={editorRef}
              value={scripts[activeTab] || ''}
              onChange={handleScriptChange}
              onScroll={handleScroll}
              spellCheck={false}
              style={{ flex: 1, backgroundColor: '#1e1e1e', color: '#d4d4d4', border: 'none', padding: '16px', fontSize: '14px', fontFamily: 'Consolas, Monaco, monospace', lineHeight: '21px', resize: 'none', outline: 'none', whiteSpace: 'pre', overflowY: 'auto' }}
              placeholder={`ここに ${layers.find(l => l.id === activeTab)?.name || ''} の台本を記述してください...`}
            />
          </div>
        </div>
      );
    }

    if (component === "timeline") {
      return (
        <div 
          ref={timelineRef}
          style={{ height: '100%', overflowY: 'auto', backgroundColor: '#1e1e1e', padding: '10px', position: 'relative' }}
          onContextMenu={(e) => {
            // 背景クリック時のみメニュー表示
            if (e.target === e.currentTarget || (e.target as HTMLElement).getAttribute('data-timeline-bg') === "true") {
              e.preventDefault();
              setTimelineContextMenu({ x: e.clientX, y: e.clientY });
            }
          }}
        >
          <div data-timeline-bg="true" style={{ position: 'relative', width: '100%', height: `${maxLines * GRID_HEIGHT}px` }}>
            <div data-timeline-bg="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40px', borderRight: '1px solid #333' }}>
              {[...Array(maxLines)].map((_, i) => (
                <div 
                  key={i} 
                  style={{ height: `${GRID_HEIGHT}px`, borderBottom: '1px dashed #333', color: '#666', fontSize: '11px', textAlign: 'right', paddingRight: '8px', boxSizing: 'border-box', paddingTop: '4px', cursor: 'context-menu' }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, lineIndex: i });
                  }}
                  title="右クリックで時間を追加・削除"
                >
                  L{i + 1}
                </div>
              ))}
            </div>

            {/* 再生ヘッド (赤い線) */}
            <div 
              style={{
                position: 'absolute',
                top: `${playheadY}px`,
                left: '40px', // 行番号の右から始まる
                right: 0,
                height: '2px',
                backgroundColor: '#e74c3c',
                zIndex: 10,
                cursor: 'ns-resize',
                boxShadow: '0 0 6px rgba(231, 76, 60, 0.8)'
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDragging(true);
                setIsPlaying(false); // ドラッグ中は再生を停止する
              }}
            >
              {/* 左端の三角形のつまみ */}
              <div style={{
                position: 'absolute',
                left: '-10px',
                top: '-6px',
                width: 0,
                height: 0,
                borderTop: '7px solid transparent',
                borderBottom: '7px solid transparent',
                borderLeft: '10px solid #e74c3c',
                cursor: 'grab'
              }} />
            </div>

            <div data-timeline-bg="true" style={{ marginLeft: '50px', position: 'relative', height: '100%' }}>
              {[...Array(maxLines)].map((_, i) => (
                <div 
                  key={i} 
                  data-timeline-bg="true"
                  style={{ 
                    height: `${GRID_HEIGHT}px`, 
                    borderBottom: '1px dashed #222', 
                    boxSizing: 'border-box',
                    backgroundColor: dragOverIndex === i ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    transition: 'background-color 0.1s'
                  }} 
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverIndex !== i) setDragOverIndex(i);
                  }}
                  onDragLeave={(e) => {
                    if (dragOverIndex === i) setDragOverIndex(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverIndex(null);
                    const data = e.dataTransfer.getData('text/plain');
                    if (data) {
                      const [dragLayer, dragIndexStr] = data.split(':');
                      moveBlock(dragLayer as LayerType, parseInt(dragIndexStr, 10), i);
                    }
                  }}
                />
              ))}
              
              {/* カット区切り線 */}
              {cuts.map((cutY, index) => (
                <div 
                  key={`cut-${index}`}
                  style={{
                    position: 'absolute',
                    top: `${cutY}px`,
                    left: '40px',
                    right: 0,
                    height: '1px',
                    borderTop: '1px dashed rgba(255, 255, 255, 0.2)',
                    zIndex: 5,
                    pointerEvents: 'none'
                  }}
                >
                  {/* 中央のドラッグハンドル */}
                  <div 
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '-9px',
                      width: '44px',
                      height: '18px',
                      marginLeft: '-22px',
                      backgroundColor: '#2d3748',
                      color: '#a0aec0',
                      border: '1px solid #4a5568',
                      borderRadius: '4px',
                      fontSize: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'ns-resize',
                      pointerEvents: 'auto',
                      fontWeight: 'normal',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      userSelect: 'none'
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const startY = e.clientY;
                      const startCutY = cutY;
                      
                      const handleMouseMove = (moveEvent: MouseEvent) => {
                        const deltaY = moveEvent.clientY - startY;
                        let newY = startCutY + deltaY;
                        
                        // 1行の高さ(GRID_HEIGHT)ごとにスナップ（吸着）させる
                        newY = Math.round(newY / GRID_HEIGHT) * GRID_HEIGHT;
                        
                        setCuts(prev => {
                          const newCuts = [...prev];
                          
                          // 前後のカットを追い越せないように制限
                          const minBound = index > 0 ? prev[index - 1] + GRID_HEIGHT : GRID_HEIGHT;
                          const maxBound = index < prev.length - 1 ? prev[index + 1] - GRID_HEIGHT : maxLines * GRID_HEIGHT;
                          
                          if (newY < minBound) newY = minBound;
                          if (newY > maxBound) newY = maxBound;
                          
                          newCuts[index] = newY;
                          return newCuts;
                        });
                      };
                      
                      const handleMouseUp = () => {
                        window.removeEventListener('mousemove', handleMouseMove);
                        window.removeEventListener('mouseup', handleMouseUp);
                      };
                      
                      window.addEventListener('mousemove', handleMouseMove);
                      window.addEventListener('mouseup', handleMouseUp);
                    }}
                  >
                    ✂ Cut {index + 1}
                  </div>
                </div>
              ))}

              {timelineBlocks.map((block) => {
                const layerIndex = visibleLayers.findIndex(l => l.id === block.layer);
                if (layerIndex === -1) return null; // Shouldn't happen
                
                const widthPercentage = 100 / visibleLayers.length;
                const leftPercentage = layerIndex * widthPercentage;

                return (
                  <div 
                    key={block.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', `${block.layer}:${block.lineIndex}`);
                    }}
                    onClick={() => {
                      setActiveTab(block.layer);
                      setSelectedLine(block.lineIndex + 1);
                    }}
                    style={{ 
                      position: 'absolute', 
                      top: `${block.lineIndex * GRID_HEIGHT + 4}px`, 
                      height: `${GRID_HEIGHT - 8}px`, 
                      left: `${leftPercentage}%`, 
                      width: `${widthPercentage - 1}%`, // slightly smaller to leave gap
                      backgroundColor: block.color + '25', // Add transparency (25 hex = ~15%)
                      borderLeft: `3px solid ${block.color}`, 
                      padding: '4px 8px', 
                      borderRadius: '2px', 
                      fontSize: '12px', 
                      overflow: 'hidden', 
                      whiteSpace: 'nowrap', 
                      textOverflow: 'ellipsis', 
                      cursor: 'grab', 
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)', 
                      userSelect: 'none' 
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.5)'}
                    onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                  >
                    {block.text}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#1e1e1e' }}>
      <header style={{ padding: '8px 16px', borderBottom: '1px solid #333', backgroundColor: '#333333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '14px', color: '#ccc' }}>Oto IDE</h1>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            onClick={handlePlayToggle}
            style={{ padding: '4px 16px', fontSize: '12px', backgroundColor: isPlaying ? '#e74c3c' : '#2ecc71', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginRight: '16px' }}
          >
            {isPlaying ? '⏸ Stop' : '▶ Play'}
          </button>
          
          <label style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#444', color: 'white', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            📥 Import
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button onClick={handleExport} style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            💾 Export
          </button>
        </div>
      </header>
      <div style={{ flex: 1, position: 'relative' }}>
        <Layout model={layoutModel} factory={factory} />
      </div>

      <SettingsModal 
        isOpen={selectedLine !== null} 
        onClose={() => setSelectedLine(null)} 
        lineNumber={selectedLine} 
        layer={activeTab}
        text={selectedLine ? (scripts[activeTab] || '').split('\n')[selectedLine - 1] : ''}
      />

      {/* 右クリックメニュー: 行番号用 */}
      {contextMenu && (
        <div style={{
          position: 'fixed',
          top: contextMenu.y,
          left: contextMenu.x,
          backgroundColor: '#2d3748',
          border: '1px solid #4a5568',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 1000,
          padding: '4px 0',
          minWidth: '160px',
          fontFamily: 'sans-serif'
        }}>
          <div 
            style={{ padding: '8px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={() => handleModifyTime(contextMenu.lineIndex, 1, false)}
          >
            ➕ 1秒（1行）追加
          </div>
          <div 
            style={{ padding: '8px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={() => {
              setDialog({
                type: 'prompt',
                title: '行（秒数）の追加',
                message: '追加する秒数（行数）を入力してください',
                defaultValue: '3',
                onConfirm: (val) => {
                  const num = parseInt(val || "0", 10);
                  if (num > 0) handleModifyTime(contextMenu.lineIndex, num, false);
                }
              });
            }}
          >
            ➕ N秒追加...
          </div>
          <div style={{ height: '1px', backgroundColor: '#4a5568', margin: '4px 0' }} />
          <div 
            style={{ padding: '8px 16px', fontSize: '13px', color: '#fc8181', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={() => handleModifyTime(contextMenu.lineIndex, 1, true)}
          >
            ➖ 1秒（1行）削除
          </div>
          <div 
            style={{ padding: '8px 16px', fontSize: '13px', color: '#fc8181', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            onClick={() => {
              setDialog({
                type: 'prompt',
                title: '行（秒数）の削除',
                message: '削除する秒数（行数）を入力してください',
                defaultValue: '3',
                onConfirm: (val) => {
                  const num = parseInt(val || "0", 10);
                  if (num > 0) handleModifyTime(contextMenu.lineIndex, num, true);
                }
              });
            }}
          >
            ➖ N秒削除...
          </div>
        </div>
      )}

      {/* 右クリックメニュー: タイムラインの背景用 (レイヤー表示切り替え) */}
      {timelineContextMenu && (
        <div style={{
          position: 'fixed',
          top: timelineContextMenu.y,
          left: timelineContextMenu.x,
          backgroundColor: '#2d3748',
          border: '1px solid #4a5568',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 1000,
          padding: '8px 0',
          minWidth: '200px',
          fontFamily: 'sans-serif'
        }}
        onClick={(e) => e.stopPropagation()} // チェックボックスクリックで閉じないようにする
        >
          <div style={{ padding: '4px 16px', fontSize: '12px', color: '#888', borderBottom: '1px solid #4a5568', marginBottom: '4px' }}>
            タイムライン表示レイヤー
          </div>
          {layers.map(layer => (
            <label 
              key={layer.id} 
              style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', color: '#e2e8f0', cursor: 'pointer', fontSize: '13px' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <input 
                type="checkbox" 
                checked={layer.visibleInTimeline} 
                onChange={() => {
                  setLayers(layers.map(l => l.id === layer.id ? { ...l, visibleInTimeline: !l.visibleInTimeline } : l));
                }}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              <span style={{ color: layer.color, marginRight: '6px' }}>●</span> {layer.name}
            </label>
          ))}
        </div>
      )}

      {/* カスタムダイアログの実装 */}
      {dialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#2d3748', borderRadius: '8px', padding: '24px', width: '400px', maxWidth: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', fontFamily: 'sans-serif' }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#fff', fontSize: '18px' }}>{dialog.title}</h3>
            <p style={{ margin: '0 0 20px 0', color: '#cbd5e0', fontSize: '14px', lineHeight: '1.5' }}>{dialog.message}</p>
            
            {dialog.type === 'prompt' && (
              <input 
                autoFocus
                type="text" 
                defaultValue={dialog.defaultValue} 
                onKeyDown={e => {
                  if (e.key === 'Enter' && dialog.onConfirm) {
                    dialog.onConfirm((e.target as HTMLInputElement).value);
                    setDialog(null);
                  }
                }}
                style={{ width: '100%', padding: '10px', backgroundColor: '#1a202c', color: '#fff', border: '1px solid #4a5568', borderRadius: '4px', boxSizing: 'border-box', marginBottom: '24px', fontSize: '14px', outline: 'none' }}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {dialog.type !== 'alert' && (
                <button 
                  onClick={() => setDialog(null)}
                  style={{ padding: '8px 16px', backgroundColor: 'transparent', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', transition: 'background-color 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  キャンセル
                </button>
              )}
              <button 
                onClick={(e) => {
                  const inputEl = e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement;
                  if (dialog.onConfirm) dialog.onConfirm(dialog.type === 'prompt' ? inputEl.value : undefined);
                  setDialog(null);
                }}
                style={{ padding: '8px 16px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', transition: 'background-color 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#357abd'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#4a90e2'}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
