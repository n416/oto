import { useState, useMemo, useRef, useEffect } from 'react';
import { Layout, Model, TabNode, Actions } from 'flexlayout-react';
import type { IJsonModel } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { SettingsModal } from './components/SettingsModal';
import { BackendManagerModal } from './components/BackendManagerModal';
import { CharacterSettings, type CharacterData } from './components/CharacterSettings';
import { VoiceGenerator } from './components/VoiceGenerator';
import { SfxGenerator } from './components/SfxGenerator';
import { PreviewPane } from './components/PreviewPane';
import { useTimelineAudio } from './hooks/useTimelineAudio';
import { exportWavFiles, type ExportMode } from './utils/audioExport';
import { generateTake } from './utils/generateTake';
import { deleteAudioFiles } from './utils/deleteAudioFiles';
import { TimelineWaveform } from './components/TimelineWaveform';
import TimerWorker from './workers/timerWorker?worker';

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

export interface SfxData {
  id: string;
  name: string;
  prompt: string;
  audioUrl: string;
  source: 'generated' | 'imported';
  timestamp: string;
  trimOffset?: number; // 手動設定オフセット (秒)
  trimEnd?: number; // 終了トリム位置 (秒)
  volume?: number; // ボリューム (0.0 〜 2.0、デフォルト1.0)
  pan?: number;    // パン左右バランス (-1.0左 〜 1.0右、デフォルト0.0)
}

interface ParsedBlock {
  id: string;
  lineIndex: number;
  layer: LayerType;
  text: string;
  color: string;
}

export interface TakeData {
  id: string;
  audioUrl: string;
  timestamp: string;
  trimOffset?: number; // 手動設定オフセット (秒)
  trimEnd?: number; // 終了トリム位置 (秒)
  volume?: number; // ボリューム (0.0 〜 2.0、デフォルト1.0)
  pan?: number;    // パン左右バランス (-1.0左 〜 1.0右、デフォルト0.0)
  duration?: number; // オリジナルの音声の長さ (秒)
}

export interface LineTakes {
  takes: TakeData[];
  activeTakeId: string | null;
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
        weight: 70,
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
          },
          {
            type: "tab",
            id: "tab-sfx-design",
            name: "💣 効果音デザイン",
            component: "sfx"
          },
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
  const [layoutModel, setLayoutModel] = useState<Model>(() => {
    const saved = localStorage.getItem('oto_ide_layout');
    if (saved) {
      try {
        return Model.fromJson(JSON.parse(saved));
      } catch (e) {}
    }
    return Model.fromJson(initialLayout);
  });
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isBackendMenuOpen, setIsBackendMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number, total: number, status: 'running' | 'paused' } | null>(null);
  const batchStateRef = useRef<'running' | 'paused' | 'stopped'>('stopped');
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  
  // --- カスタムダイアログ用ステート ---
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  // --- プロジェクト用ステート ---
  const [lineTakesMap, setLineTakesMap] = useState<Record<string, LineTakes>>(() => {
    const saved = localStorage.getItem('oto_ide_linetakes');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {};
  });

  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});

  const [cursorPos, setCursorPos] = useState<number | null>(null);
  const [sfxAutocomplete, setSfxAutocomplete] = useState<{ active: boolean, lineIndex: number, colIndex: number } | null>(null);
  const isComposingRef = useRef(false);

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

  const [sfxs, setSfxs] = useState<SfxData[]>(() => {
    const saved = localStorage.getItem('oto_ide_sfxs');
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

  const GRID_HEIGHT = 60; // 1行あたりの高さ

  // オーディオマネージャーの初期化
  const { stopAll, tick } = useTimelineAudio(scripts, layers, sfxs, lineTakesMap);

  // 再生ヘッドが動いた時、または再生状態が変わった時にオーディオを制御
  useEffect(() => {
    if (isPlaying) {
      tick(playheadY / GRID_HEIGHT);
    } else {
      stopAll();
    }
  }, [playheadY, isPlaying, tick, stopAll]);

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

  useEffect(() => {
    localStorage.setItem('oto_ide_sfxs', JSON.stringify(sfxs));
  }, [sfxs]);

  useEffect(() => {
    localStorage.setItem('oto_ide_linetakes', JSON.stringify(lineTakesMap));
  }, [lineTakesMap]);

  // JSONファイルへの書き出し
  const handleExport = () => {
    const projectData = { scripts, characters, cuts, layers, voices, sfxs, lineTakesMap };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(projectData, null, 2));
    const downloadNode = document.createElement('a');
    downloadNode.setAttribute("href", dataStr);
    downloadNode.setAttribute("download", "oto_project.json");
    document.body.appendChild(downloadNode);
    downloadNode.click();
    downloadNode.remove();
  };

  const handleAudioExport = async (mode: ExportMode) => {
    setIsExportMenuOpen(false);
    try {
      await exportWavFiles(scripts, layers, sfxs, lineTakesMap, mode, (msg) => {
        setExportProgress(msg || null);
      });
    } catch (e) {
      console.error(e);
      setDialog({ type: 'alert', title: 'エラー', message: 'エクスポート中にエラーが発生しました。' });
      setExportProgress(null);
    }
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
          if (json.sfxs) setSfxs(json.sfxs);
          if (json.lineTakesMap) setLineTakesMap(json.lineTakesMap);
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
      setIsViewMenuOpen(false);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  // GRID_HEIGHT is already defined above

  const maxLines = Math.max(
    ...layers.map(l => (scripts[l.id] || "").split('\n').length),
    20
  );

  // 再生ヘッドのアニメーション（Web Workerを利用してバックグラウンドでも安定発火させる）
  useEffect(() => {
    const worker = new TimerWorker();
    let tickCount = 0;

    worker.onmessage = (e) => {
      if (e.data.type === 'tick') {
        const delta = e.data.delta;
        tickCount++;
        if (tickCount % 60 === 0) {
          console.log(`[TimerWorker] tick received. delta: ${delta}ms. current isPlaying:`, isPlaying);
        }
        // 1秒間に 60px (1行分) 進む想定
        setPlayheadY(prev => prev + (delta / 1000) * GRID_HEIGHT);
      }
    };

    if (isPlaying) {
      worker.postMessage({ command: 'start' });
    } else {
      worker.postMessage({ command: 'stop' });
    }

    return () => {
      worker.postMessage({ command: 'stop' });
      worker.terminate();
    };
  }, [isPlaying, GRID_HEIGHT]);

  // playheadY の位置に合わせてタイムラインのスクロール位置を自動追従させる
  useEffect(() => {
    if (timelineRef.current) {
      const container = timelineRef.current;
      const y = playheadY;
      const margin = 50; // 上下のマージン

      // 画面より下に隠れている場合
      if (y > container.scrollTop + container.clientHeight - margin) {
        container.scrollTop = y - container.clientHeight + margin;
      }
      // 画面より上に隠れている場合
      else if (y < container.scrollTop + margin) {
        container.scrollTop = y - margin;
      }
    }
  }, [playheadY]);

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

    // テイクデータも同期して入れ替える
    setLineTakesMap(prev => {
      const newMap = { ...prev };
      const fromId = `${layer}-${fromIndex}`;
      const toId = `${layer}-${toIndex}`;
      const tempTake = newMap[toId];
      
      if (newMap[fromId]) {
        newMap[toId] = newMap[fromId];
      } else {
        delete newMap[toId];
      }
      
      if (tempTake) {
        newMap[fromId] = tempTake;
      } else {
        delete newMap[fromId];
      }
      return newMap;
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

    // テイクデータも同期してシフトする
    setLineTakesMap(prev => {
      const newMap = { ...prev };
      layers.forEach(layer => {
        const layerId = layer.id;
        const maxKeys = Object.keys(newMap)
          .filter(k => k.startsWith(`${layerId}-`))
          .map(k => parseInt(k.split('-')[1], 10));
        
        const maxLine = maxKeys.length > 0 ? Math.max(...maxKeys) : 0;
        
        if (isDelete) {
          // 削除される範囲のテイクを消去
          const takesToDelete: TakeData[] = [];
          for (let i = 0; i < amount; i++) {
            const id = `${layerId}-${lineIndex + i}`;
            if (newMap[id]) {
              takesToDelete.push(...newMap[id].takes);
              delete newMap[id];
            }
          }
          if (takesToDelete.length > 0) {
            deleteAudioFiles(takesToDelete);
          }
          // 以降のテイクを上に詰める
          for (let i = lineIndex + amount; i <= maxLine; i++) {
            const oldId = `${layerId}-${i}`;
            const newId = `${layerId}-${i - amount}`;
            if (newMap[oldId]) {
              newMap[newId] = newMap[oldId];
              delete newMap[oldId];
            }
          }
        } else {
          // 下にずらす（重複を避けるため下から処理）
          for (let i = maxLine; i >= lineIndex + 1; i--) {
            const oldId = `${layerId}-${i}`;
            const newId = `${layerId}-${i + amount}`;
            if (newMap[oldId]) {
              newMap[newId] = newMap[oldId];
              delete newMap[oldId];
            }
          }
        }
      });
      return newMap;
    });

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

  const syncSfxNamesToLibrary = (text: string, cursor: number) => {
    const sfxPattern = /SFX(\d{3}):([^\n]+)/g;
    let match;
    const currentSfxNames: Record<string, string> = {};
    const allMatches = [];
    
    while ((match = sfxPattern.exec(text)) !== null) {
      allMatches.push({
        id: `SFX${match[1]}`,
        name: match[2],
        start: match.index,
        end: match.index + match[0].length
      });
    }

    for (const m of allMatches) {
      if (cursor >= m.start && cursor <= m.end) {
        currentSfxNames[m.id] = m.name;
      } else if (!currentSfxNames[m.id]) {
        currentSfxNames[m.id] = m.name;
      }
    }

    let updatedText = text;
    let sfxsUpdated = false;
    const newSfxs = [...sfxs];

    for (const [sfxId, newName] of Object.entries(currentSfxNames)) {
      const existing = newSfxs.find(s => s.id === sfxId);
      if (existing && existing.name !== newName) {
        existing.name = newName;
        sfxsUpdated = true;
      }
      
      const regex = new RegExp(`${sfxId}:[^\\n]+`, 'g');
      updatedText = updatedText.replace(regex, `${sfxId}:${newName}`);
    }

    if (sfxsUpdated) {
      setSfxs(newSfxs);
    }
    
    return updatedText;
  };

  const handleSfxNameChangeFromLibrary = (sfxId: string, newName: string) => {
    setSfxs(prev => prev.map(s => s.id === sfxId ? { ...s, name: newName } : s));
    
    let scriptsChanged = false;
    const newScripts = { ...scripts };
    for (const layerId of Object.keys(newScripts)) {
      const text = newScripts[layerId];
      if (text) {
        const regex = new RegExp(`${sfxId}:[^\\n]+`, 'g');
        const updatedText = text.replace(regex, `${sfxId}:${newName}`);
        if (updatedText !== text) {
          newScripts[layerId] = updatedText;
          scriptsChanged = true;
        }
      }
    }
    if (scriptsChanged) {
      setScripts(newScripts);
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const updateScriptAndSync = (layerId: string, newText: string) => {
    const oldText = scripts[layerId] || '';
    if (oldText === newText) return;

    setScripts(prev => ({ ...prev, [layerId]: newText }));

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    if (oldLines.length === newLines.length) return;

    let prefixCount = 0;
    while (prefixCount < oldLines.length && prefixCount < newLines.length && oldLines[prefixCount] === newLines[prefixCount]) {
      prefixCount++;
    }

    let suffixCount = 0;
    while (
      suffixCount < oldLines.length - prefixCount &&
      suffixCount < newLines.length - prefixCount &&
      oldLines[oldLines.length - 1 - suffixCount] === newLines[newLines.length - 1 - suffixCount]
    ) {
      suffixCount++;
    }

    const removedCount = oldLines.length - prefixCount - suffixCount;
    const addedCount = newLines.length - prefixCount - suffixCount;
    const changeIndex = prefixCount;
    const netShift = addedCount - removedCount;

    if (netShift !== 0) {
      setLineTakesMap(prev => {
        const newMap = { ...prev };
        const maxKeys = Object.keys(newMap)
          .filter(k => k.startsWith(`${layerId}-`))
          .map(k => parseInt(k.split('-')[1], 10));
        const maxLine = maxKeys.length > 0 ? Math.max(...maxKeys) : 0;

        if (addedCount === 0) {
          // 純粋な削除（1行以上消した）
          const takesToDelete: TakeData[] = [];
          for (let i = 0; i < removedCount; i++) {
            const id = `${layerId}-${changeIndex + i}`;
            if (newMap[id]) {
              takesToDelete.push(...newMap[id].takes);
              delete newMap[id];
            }
          }
          if (takesToDelete.length > 0) {
            deleteAudioFiles(takesToDelete);
          }
        } else if (removedCount > 0) {
          // 置換・分割（changeIndex は維持、その後ろの消された分を削除）
          const takesToDelete: TakeData[] = [];
          for (let i = 1; i < removedCount; i++) {
            const id = `${layerId}-${changeIndex + i}`;
            if (newMap[id]) {
              takesToDelete.push(...newMap[id].takes);
              delete newMap[id];
            }
          }
          if (takesToDelete.length > 0) {
            deleteAudioFiles(takesToDelete);
          }
        }

        if (netShift < 0) {
          // 上に詰める
          const shiftAmount = -netShift;
          for (let i = changeIndex + removedCount; i <= maxLine; i++) {
            const oldId = `${layerId}-${i}`;
            const newId = `${layerId}-${i - shiftAmount}`;
            if (newMap[oldId]) {
              newMap[newId] = newMap[oldId];
              delete newMap[oldId];
            }
          }
        } else if (netShift > 0) {
          // 下にずらす
          for (let i = maxLine; i >= changeIndex + removedCount; i--) {
            const oldId = `${layerId}-${i}`;
            const newId = `${layerId}-${i + netShift}`;
            if (newMap[oldId]) {
              newMap[newId] = newMap[oldId];
              delete newMap[oldId];
            }
          }
        }

        return newMap;
      });
    }
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const target = e.target as HTMLTextAreaElement;
    const newValue = target.value;
    const cursor = target.selectionStart;

    const updatedText = syncSfxNamesToLibrary(newValue, cursor);
    if (updatedText !== newValue) {
      setCursorPos(cursor);
    }
    updateScriptAndSync(activeTab, updatedText);
  };

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart;

    const textBeforeCursor = newValue.substring(0, cursor);
    if (textBeforeCursor.endsWith('SFX')) {
      const lines = textBeforeCursor.split('\n');
      const lineIndex = lines.length - 1;
      const colIndex = lines[lines.length - 1].length;
      setSfxAutocomplete({ active: true, lineIndex, colIndex });
    } else {
      setSfxAutocomplete(null);
    }

    if (isComposingRef.current) {
      setScripts(prev => ({ ...prev, [activeTab]: newValue }));
      return;
    }

    const updatedText = syncSfxNamesToLibrary(newValue, cursor);
    if (updatedText !== newValue) {
      setCursorPos(cursor);
    }
    updateScriptAndSync(activeTab, updatedText);
    updatePlayheadFromCursor(e.target);
  };

  useEffect(() => {
    if (cursorPos !== null && editorRef.current) {
      editorRef.current.setSelectionRange(cursorPos, cursorPos);
      setCursorPos(null);
    }
  }, [scripts, cursorPos]);

  const updatePlayheadFromCursor = (target: HTMLTextAreaElement) => {
    if (isPlaying) return; // 再生中は自動移動を優先
    
    const cursor = target.selectionStart;
    const text = target.value;
    
    const textBeforeCursor = text.substring(0, cursor);
    const lines = textBeforeCursor.split('\n');
    const lineIndex = lines.length - 1;
    const colIndex = lines[lines.length - 1].length;
    
    const allLines = text.split('\n');
    const currentLineText = allLines[lineIndex] || '';
    
    // 行内でのカーソル位置の割合 (0.0 〜 1.0)
    const ratio = currentLineText.length > 0 ? colIndex / currentLineText.length : 0;
    
    // この行の音声ブロックの長さを取得
    const blockId = `${activeTab}-${lineIndex}`;
    const takesData = lineTakesMap[blockId];
    
    let blockDurationLines = 1; 
    if (takesData && takesData.activeTakeId && audioDurations[takesData.activeTakeId]) {
      const duration = audioDurations[takesData.activeTakeId];
      blockDurationLines = Math.max(1, Math.ceil(duration));
    }
    
    const y = (lineIndex + (ratio * blockDurationLines)) * GRID_HEIGHT;
    setPlayheadY(y);
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

  const handleBatchGenerate = async () => {
    const blocksToGenerate = timelineBlocks.filter(block => {
      if (block.layer !== 'dialogue' && block.layer !== 'sfx') return false;
      const takesData = lineTakesMap[block.id];
      const hasActiveTake = takesData && takesData.activeTakeId;
      const isSfxOriginal = block.layer === 'sfx' && /^SFX(\d{3}):/.test(block.text);
      return !hasActiveTake && !isSfxOriginal;
    });

    if (blocksToGenerate.length === 0) {
      setDialog({ type: 'alert', title: '一括生成', message: '未生成のブロックはありません。' });
      return;
    }

    batchStateRef.current = 'running';
    setBatchProgress({ current: 0, total: blocksToGenerate.length, status: 'running' });
    let successCount = 0;
    
    // 各元の行ごとに、どれだけパディング（空行）を挿入したかを記録するマップ
    const paddingByOriginalLine: Record<number, number> = {};

    for (let i = 0; i < blocksToGenerate.length; i++) {
      if (batchStateRef.current === 'stopped') break;

      while (batchStateRef.current === 'paused') {
        await new Promise(r => setTimeout(r, 200));
        if (batchStateRef.current === 'stopped') break;
      }
      if (batchStateRef.current === 'stopped') break;

      const block = blocksToGenerate[i];
      setBatchProgress({ current: i + 1, total: blocksToGenerate.length, status: batchStateRef.current as 'running' | 'paused' });
      
      // 現在の実際の行インデックスを計算
      // 自分の元の行より「前」の行に挿入されたパディングの合計を足す
      let currentLineIndex = block.lineIndex;
      for (const [origLineStr, pad] of Object.entries(paddingByOriginalLine)) {
        const origLine = parseInt(origLineStr, 10);
        if (origLine < block.lineIndex) {
          currentLineIndex += pad;
        }
      }
      
      console.log(`\n[Batch] === 処理開始: ${i + 1}個目 / 全${blocksToGenerate.length}個 ===`);
      console.log(`[Batch] 対象テキスト: "${block.text}"`);
      console.log(`[Batch] 元の行番号(origLine): ${block.lineIndex + 1}行目 -> 現在の移動先行番号(currentLine): ${currentLineIndex + 1}行目`);

      const currentBlockId = `${block.layer}-${currentLineIndex}`;
      
      try {
        const fullScript = scripts[block.layer] || '';
        const controller = new AbortController();
        batchAbortControllerRef.current = controller;
        const newTake = await generateTake(block.layer, block.text, characters, fullScript, block.lineIndex, controller.signal);
        
        console.log(`[Batch] 音声生成完了: ${newTake.audioUrl}`);

        // 音声の長さを直接取得（生成時に算出されている）
        const duration = newTake.duration || 1;
        const durationLines = Math.max(1, Math.ceil(duration));
        const requiredPadding = durationLines - 1;
        
        console.log(`[Batch] -> 音声の長さ: ${duration.toFixed(2)}秒 (計算上の行数: ${durationLines}行, 必要なパディング: ${requiredPadding}行)`);

        // テイクの保存
        setLineTakesMap(prev => {
          const existing = prev[currentBlockId] || { takes: [], activeTakeId: null };
          return {
            ...prev,
            [currentBlockId]: {
              takes: [newTake, ...existing.takes],
              activeTakeId: newTake.id
            }
          };
        });
        
        // 音声の長さを記録（UI表示用）
        setAudioDurations(prev => ({
          ...prev,
          [newTake.id]: duration
        }));

        // パディングの差分計算（同じ行に複数ブロックがある場合の最大値を考慮）
        const alreadyPadded = paddingByOriginalLine[block.lineIndex] || 0;
        let newPaddingToAdd = 0;
        
        if (requiredPadding > alreadyPadded) {
          newPaddingToAdd = requiredPadding - alreadyPadded;
          paddingByOriginalLine[block.lineIndex] = requiredPadding;
        }

        // 次のテキストが被らないように空行を挿入する
        if (newPaddingToAdd > 0) {
          // 挿入位置: 現在の行の直下 + すでにこの行グループに挿入したパディングの後ろ
          const insertPos = currentLineIndex + 1 + alreadyPadded;
          
          console.log(`[Batch] -> 追加パディング: ${newPaddingToAdd}行 を L${insertPos + 1} の位置に挿入します。(既に ${alreadyPadded}行 挿入済み)`);

          // テキストに空行を挿入
          setScripts(prevScripts => {
            const nextScripts = { ...prevScripts };
            layers.forEach(layer => {
              const lines = (nextScripts[layer.id] || '').split('\n');
              const padding = Array(newPaddingToAdd).fill('');
              lines.splice(insertPos, 0, ...padding);
              nextScripts[layer.id] = lines.join('\n');
            });
            return nextScripts;
          });
          
          // lineTakesMap のシフト（下から順にずらす）
          setLineTakesMap(prev => {
            const newMap = { ...prev };
            layers.forEach(layer => {
              const layerId = layer.id;
              const keys = Object.keys(newMap).filter(k => k.startsWith(`${layerId}-`));
              const indices = keys.map(k => parseInt(k.split('-')[1], 10)).sort((a, b) => b - a);
              
              for (const idx of indices) {
                if (idx >= insertPos) {
                  const oldId = `${layerId}-${idx}`;
                  const newId = `${layerId}-${idx + newPaddingToAdd}`;
                  newMap[newId] = newMap[oldId];
                  delete newMap[oldId];
                }
              }
            });
            return newMap;
          });
          
          // カット(区切り線)のシフト
          setCuts(prevCuts => {
            const targetY = insertPos * GRID_HEIGHT;
            const shiftY = newPaddingToAdd * GRID_HEIGHT;
            return prevCuts.map(cutY => (cutY >= targetY ? cutY + shiftY : cutY));
          });
        } else {
          console.log(`[Batch] -> 追加の空行挿入は不要です。(既に ${alreadyPadded}行 挿入済み)`);
        }

        successCount++;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log("[Batch] 生成がキャンセルされました。");
          break;
        }
        console.error(error);
        if (!window.confirm(`ブロック(L${currentLineIndex + 1}: ${block.text})の生成に失敗しました。継続しますか？\n\nエラー詳細: ${error.message}`)) {
          break;
        }
      }
    }
    
    setBatchProgress(null);
    setDialog({ type: 'alert', title: '一括生成完了', message: `${successCount} 件のテイクを生成しました。` });
  };

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
            layoutModel.doAction(Actions.selectTab("tab-voice-design"));
          }}
          setDialog={setDialog}
        />
      );
    }

    if (component === "voice") {
      return <VoiceGenerator characters={characters} setCharacters={setCharacters} voices={voices} setVoices={setVoices} setDialog={setDialog} />;
    }

    if (component === "sfx") {
      return <SfxGenerator sfxs={sfxs} setSfxs={setSfxs} setDialog={setDialog} onSfxNameChange={handleSfxNameChangeFromLibrary} />;
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
            <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
              <textarea 
                ref={editorRef}
                value={scripts[activeTab] || ''}
                onChange={handleScriptChange}
                onClick={(e) => updatePlayheadFromCursor(e.currentTarget)}
                onKeyUp={(e) => {
                  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    updatePlayheadFromCursor(e.currentTarget);
                  }
                }}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                onScroll={handleScroll}
                spellCheck={false}
                style={{ flex: 1, backgroundColor: '#1e1e1e', color: '#d4d4d4', border: 'none', padding: '16px', fontSize: '14px', fontFamily: 'Consolas, Monaco, monospace', lineHeight: '21px', resize: 'none', outline: 'none', whiteSpace: 'pre', overflowY: 'auto' }}
                placeholder={`ここに ${layers.find(l => l.id === activeTab)?.name || ''} の台本を記述してください...`}
              />
              
              {sfxAutocomplete && (
                <div style={{
                  position: 'absolute',
                  top: `${16 + (sfxAutocomplete.lineIndex * 21) - (editorRef.current?.scrollTop || 0) + 24}px`,
                  left: `${16 + (sfxAutocomplete.colIndex * 7.7) - (editorRef.current?.scrollLeft || 0)}px`,
                  backgroundColor: '#2d3748',
                  border: '1px solid #4a5568',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  zIndex: 1000,
                  maxHeight: '200px',
                  overflowY: 'auto',
                  minWidth: '200px'
                }}>
                  <div style={{ padding: '4px 8px', fontSize: '11px', color: '#888', borderBottom: '1px solid #4a5568' }}>利用可能なSFX (クリックで挿入)</div>
                  {sfxs.length === 0 && <div style={{ padding: '8px', fontSize: '12px', color: '#aaa' }}>SFXがありません</div>}
                  {[...sfxs].sort((a, b) => a.id.localeCompare(b.id)).map(sfx => (
                    <div 
                      key={sfx.id}
                      style={{ padding: '8px', fontSize: '13px', color: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      onMouseDown={(e) => {
                        // Prevent textarea from losing focus before onClick
                        e.preventDefault();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!editorRef.current) return;
                        const cursor = editorRef.current.selectionStart;
                        const text = scripts[activeTab] || '';
                        
                        // "SFX" を削除して挿入
                        const before = text.substring(0, cursor - 3); 
                        const after = text.substring(cursor);
                        const insertText = `${sfx.id}:${sfx.name}`;
                        const newText = before + insertText + after;
                        
                        setScripts({ ...scripts, [activeTab]: newText });
                        setSfxAutocomplete(null);
                        setCursorPos(before.length + insertText.length);
                        editorRef.current.focus();
                      }}
                    >
                      <span style={{ color: '#e2a74a', fontWeight: 'bold' }}>{sfx.id}</span>
                      <span>{sfx.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

            <div 
              data-timeline-bg="true" 
              style={{ marginLeft: '50px', position: 'relative', height: '100%' }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const rowIndex = Math.floor(y / GRID_HEIGHT);
                if (rowIndex >= 0 && rowIndex < maxLines) {
                  if (dragOverIndex !== rowIndex) setDragOverIndex(rowIndex);
                }
              }}
              onDragLeave={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX >= rect.right || e.clientY < rect.top || e.clientY >= rect.bottom) {
                  setDragOverIndex(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverIndex(null);
                const data = e.dataTransfer.getData('text/plain');
                if (data) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const rowIndex = Math.floor(y / GRID_HEIGHT);
                  if (rowIndex >= 0 && rowIndex < maxLines) {
                    const [dragLayer, dragIndexStr] = data.split(':');
                    moveBlock(dragLayer as LayerType, parseInt(dragIndexStr, 10), rowIndex);
                  }
                }
              }}
            >
              {[...Array(maxLines)].map((_, i) => (
                <div 
                  key={i} 
                  data-timeline-bg="true"
                  style={{ 
                    height: `${GRID_HEIGHT}px`, 
                    borderBottom: '1px dashed #222', 
                    boxSizing: 'border-box',
                    backgroundColor: dragOverIndex === i ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    transition: 'background-color 0.1s',
                    pointerEvents: 'none'
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

                const takesData = lineTakesMap[block.id];
                let hasActiveTake = false;
                let activeTakeUrl = "";
                let activeTakeId = "";
                
                if (takesData && takesData.activeTakeId) {
                  const activeTake = takesData.takes.find(t => t.id === takesData.activeTakeId);
                  if (activeTake && activeTake.audioUrl) {
                    hasActiveTake = true;
                    activeTakeUrl = activeTake.audioUrl;
                    activeTakeId = activeTake.id;
                  }
                }
                
                let isSfxOriginal = false;
                if (block.layer === 'sfx' && !hasActiveTake) {
                  const sfxMatch = block.text.match(/^SFX(\d{3}):/);
                  if (sfxMatch) {
                    const sfx = sfxs.find(s => s.id === `SFX${sfxMatch[1]}`);
                    if (sfx && sfx.audioUrl) {
                      isSfxOriginal = true;
                      activeTakeUrl = sfx.audioUrl;
                      activeTakeId = sfx.id;
                    }
                  }
                }

                const hasTake = hasActiveTake || isSfxOriginal || block.layer === 'bgm';

                // ブロックの高さを音声の長さに合わせて計算 (トリミングを考慮)
                let blockDuration = 1;
                let activeTrimOffset = 0;
                let activeTrimEnd: number | undefined = undefined;

                if (activeTakeId && audioDurations[activeTakeId]) {
                  const totalDur = audioDurations[activeTakeId];
                  activeTrimEnd = totalDur;

                  if (hasActiveTake) {
                    const activeTake = takesData.takes.find(t => t.id === activeTakeId);
                    if (activeTake) {
                      activeTrimOffset = activeTake.trimOffset ?? 0;
                      activeTrimEnd = activeTake.trimEnd ?? totalDur;
                    }
                  } else if (isSfxOriginal) {
                    const sfxMatch = block.text.match(/^SFX(\d{3}):/);
                    if (sfxMatch) {
                      const sfx = sfxs.find(s => s.id === `SFX${sfxMatch[1]}`);
                      if (sfx) {
                        activeTrimOffset = sfx.trimOffset ?? 0;
                        activeTrimEnd = sfx.trimEnd ?? totalDur;
                      }
                    }
                  }
                  
                  const activeDur = Math.max(0.1, activeTrimEnd - activeTrimOffset);
                  blockDuration = Math.max(1, Math.ceil(activeDur));
                }

                const blockHeight = (blockDuration * GRID_HEIGHT) - 8;

                return (
                  <div 
                    key={block.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', `${block.layer}:${block.lineIndex}`);
                    }}
                    onDragEnd={() => {
                      setDragOverIndex(null);
                    }}
                    onClick={() => {
                      setActiveTab(block.layer);
                      setSelectedLine(block.lineIndex + 1);
                    }}
                    style={{ 
                      position: 'absolute', 
                      top: `${block.lineIndex * GRID_HEIGHT + 4}px`, 
                      height: `${blockHeight}px`, 
                      left: `${leftPercentage}%`, 
                      width: `${widthPercentage - 1}%`, // slightly smaller to leave gap
                      backgroundColor: hasTake ? block.color + '25' : 'transparent',
                      backgroundImage: hasTake ? 'none' : `repeating-linear-gradient(45deg, ${block.color}10, ${block.color}10 10px, transparent 10px, transparent 20px)`,
                      borderTop: hasTake ? 'none' : `1px dashed ${block.color}50`,
                      borderRight: hasTake ? 'none' : `1px dashed ${block.color}50`,
                      borderBottom: hasTake ? 'none' : `1px dashed ${block.color}50`,
                      borderLeft: `3px solid ${block.color}`, 
                      borderRadius: '2px', 
                      overflow: 'hidden', 
                      cursor: 'grab', 
                      boxShadow: '0 2px 5px rgba(0,0,0,0.2)', 
                      userSelect: 'none',
                      zIndex: blockDuration > 1 ? 5 : 10 // 長いブロック（BGM等）は下敷きにする
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.5)'}
                    onMouseLeave={(e) => e.currentTarget.style.filter = 'none'}
                  >
                    {activeTakeUrl && (
                      <TimelineWaveform 
                        audioUrl={activeTakeUrl} 
                        color={block.color}
                        trimOffset={activeTrimOffset}
                        trimEnd={activeTrimEnd}
                        onDurationLoaded={(duration) => {
                          setAudioDurations(prev => {
                            if (prev[activeTakeId] === duration) return prev;
                            return { ...prev, [activeTakeId]: duration };
                          });
                        }}
                      />
                    )}
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      padding: '4px 8px',
                      fontSize: '12px',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      width: '100%',
                      zIndex: 10,
                      pointerEvents: 'none'
                    }}>
                      {!hasTake && <span style={{ marginRight: '4px', fontSize: '10px' }} title="テイクが生成されていません">⚠️</span>}
                      {block.text}
                    </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '14px', color: '#ccc' }}>Oto IDE</h1>
          <button 
            onClick={() => setIsBackendMenuOpen(true)}
            style={{ background: 'none', border: '1px solid #4a5568', color: '#ccc', cursor: 'pointer', fontSize: '13px', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#4a5568'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#ccc'; }}
          >
            ⚙️ システム設定
          </button>
          <div style={{ position: 'relative' }}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsViewMenuOpen(!isViewMenuOpen);
              }}
              style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '13px', padding: '4px 8px', borderRadius: '4px' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#444'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              表示
            </button>
            {isViewMenuOpen && (
              <div style={{ position: 'absolute', top: '100%', left: 0, backgroundColor: '#2d3748', border: '1px solid #4a5568', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 1000, minWidth: '180px', marginTop: '4px' }}>
                <div 
                  style={{ padding: '8px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('表示状態を初期設定に戻しますか？')) {
                      localStorage.removeItem('oto_ide_layout');
                      setLayoutModel(Model.fromJson(initialLayout));
                    }
                    setIsViewMenuOpen(false);
                  }}
                >
                  表示状態のリセット
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            onClick={handleBatchGenerate}
            disabled={batchProgress !== null}
            style={{ 
              padding: '4px 12px', fontSize: '12px', 
              backgroundColor: batchProgress !== null ? '#555' : '#9b59b6', 
              color: batchProgress !== null ? '#aaa' : 'white', 
              border: 'none', borderRadius: '4px', 
              cursor: batchProgress !== null ? 'not-allowed' : 'pointer', 
              fontWeight: 'bold' 
            }}
          >
            {batchProgress !== null ? '⏳ 生成中...' : '🎲 未生成を一括生成'}
          </button>
          
          <button 
            onClick={handlePlayToggle}
            style={{ padding: '4px 16px', fontSize: '12px', backgroundColor: isPlaying ? '#e74c3c' : '#2ecc71', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginRight: '16px' }}
          >
            {isPlaying ? '⏸ Stop' : '▶ Play'}
          </button>
          
          <label style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#444', color: 'white', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            📥 Import JSON
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          <button onClick={handleExport} style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#4a90e2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            💾 Export JSON
          </button>
          
          <div style={{ position: 'relative', marginLeft: '8px' }}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsExportMenuOpen(!isExportMenuOpen);
              }}
              style={{ padding: '4px 12px', fontSize: '12px', backgroundColor: '#e2a74a', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              🎧 WAV一括出力 ▼
            </button>
            {isExportMenuOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, backgroundColor: '#2d3748', border: '1px solid #4a5568', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 1000, minWidth: '240px', marginTop: '4px' }}>
                <div 
                  style={{ padding: '12px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer', borderBottom: '1px solid #4a5568' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={() => handleAudioExport('mixdown')}
                >
                  <strong>🎙️ タイムライン・ミックスダウン</strong>
                  <div style={{ fontSize: '10px', color: '#a0aec0', marginTop: '4px' }}>全音声を配置通りに合成した1つのWAV</div>
                </div>
                <div 
                  style={{ padding: '12px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer', borderBottom: '1px solid #4a5568' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={() => handleAudioExport('cropped')}
                >
                  <strong>✂️ 個別カット済WAV (ZIP)</strong>
                  <div style={{ fontSize: '10px', color: '#a0aec0', marginTop: '4px' }}>ファイルごとの長さに切り抜きます</div>
                </div>
                <div 
                  style={{ padding: '12px 16px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  onClick={() => handleAudioExport('stem')}
                >
                  <strong>📏 無音埋めステム (ZIP)</strong>
                  <div style={{ fontSize: '10px', color: '#a0aec0', marginTop: '4px' }}>全ファイルが0秒開始になるよう頭を無音で埋めます</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* エクスポート進捗オーバレイ */}
      {exportProgress && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#2d3748', padding: '24px 32px', borderRadius: '8px', textAlign: 'center', border: '1px solid #4a5568' }}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', marginBottom: '16px' }}>WAVファイル出力中...</div>
            <div style={{ color: '#63b3ed', fontFamily: 'monospace', whiteSpace: 'pre-wrap', minHeight: '40px' }}>{exportProgress}</div>
          </div>
        </div>
      )}

      {batchProgress && (
        <div style={{ 
          position: 'fixed', 
          bottom: '24px', 
          right: '24px', 
          zIndex: 9999, 
          backgroundColor: '#2d3748', 
          padding: '16px 24px', 
          borderRadius: '8px', 
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', 
          border: '1px solid #4a5568',
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff', marginBottom: '8px' }}>
            🔄 テイク一括生成中... ({batchProgress.current} / {batchProgress.total})
          </div>
          <div style={{ color: '#63b3ed', fontSize: '12px', marginBottom: '12px' }}>
            バックグラウンドで処理中です。<br/>
            他の操作（編集や再生）を続けることができます。
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {batchProgress.status === 'running' ? (
              <button
                onClick={() => {
                  batchStateRef.current = 'paused';
                  setBatchProgress(prev => prev ? { ...prev, status: 'paused' } : null);
                }}
                style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: '#e2a74a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ⏸ 一時停止
              </button>
            ) : (
              <button
                onClick={() => {
                  batchStateRef.current = 'running';
                  setBatchProgress(prev => prev ? { ...prev, status: 'running' } : null);
                }}
                style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: '#2ecc71', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                ▶ 再開
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm('一括生成を停止しますか？\n※現在実行中の生成処理がキャンセルされ、未生成の行はスキップされます。')) {
                  batchStateRef.current = 'stopped';
                  if (batchAbortControllerRef.current) {
                    batchAbortControllerRef.current.abort();
                  }
                }
              }}
              style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: '#e74c3c', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              ⏹ 停止
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, position: 'relative' }}>
        <Layout 
          model={layoutModel} 
          factory={factory} 
          onModelChange={(model) => {
            localStorage.setItem('oto_ide_layout', JSON.stringify(model.toJson()));
          }}
        />
      </div>

      <SettingsModal 
        isOpen={selectedLine !== null} 
        onClose={() => setSelectedLine(null)} 
        lineNumber={selectedLine} 
        layer={activeTab}
        text={selectedLine ? (scripts[activeTab] || '').split('\n')[selectedLine - 1] : ''}
        fullScript={scripts[activeTab] || ''}
        blockId={selectedLine ? `${activeTab}-${selectedLine - 1}` : ''}
        lineTakesMap={lineTakesMap}
        setLineTakesMap={setLineTakesMap}
        characters={characters}
        sfxs={sfxs}
        setDialog={setDialog}
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

      <BackendManagerModal isOpen={isBackendMenuOpen} onClose={() => setIsBackendMenuOpen(false)} />

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
