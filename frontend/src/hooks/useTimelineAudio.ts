import { useEffect, useRef, useCallback } from 'react';
import type { ScriptData, LayerInfo, SfxData, LineTakes } from '../App';

type AudioQueue = Record<number, { url: string; manualOffset?: number; manualEnd?: number; volume?: number; pan?: number; }[]>;

// 無音部分をスキップするためのオフセットをキャッシュする
const trimCache = new Map<string, number>();

export const useTimelineAudio = (
  scripts: ScriptData,
  layers: LayerInfo[],
  sfxs: SfxData[],
  lineTakesMap: Record<string, LineTakes>
) => {
  const queueRef = useRef<AudioQueue>({});
  const activeAudioRef = useRef<HTMLAudioElement[]>([]);
  const prevTimeRef = useRef<number | null>(null);

  // 1. 辞書の事前構築
  useEffect(() => {
    const newQueue: AudioQueue = {};

    layers.forEach(layer => {
      const text = scripts[layer.id] || "";
      const lines = text.split('\n');

      lines.forEach((lineText, lineIndex) => {
        if (!lineText.trim()) return;

        const items: { url: string; manualOffset?: number; manualEnd?: number; volume?: number; pan?: number; }[] = [];

        // ボイス（テイク）の検索
        const blockId = `${layer.id}-${lineIndex}`;
        const takesData = lineTakesMap[blockId];
        let hasActiveTake = false;
        if (takesData && takesData.activeTakeId) {
          const activeTake = takesData.takes.find(t => t.id === takesData.activeTakeId);
          if (activeTake && activeTake.audioUrl) {
            items.push({ 
              url: activeTake.audioUrl, 
              manualOffset: activeTake.trimOffset, 
              manualEnd: activeTake.trimEnd,
              volume: activeTake.volume,
              pan: activeTake.pan
            });
            hasActiveTake = true;
          }
        }

        // SFXの検索 (SFXレイヤーでTakeがある場合は上書きとして扱い、ライブラリの音は鳴らさない)
        if (!(layer.id === 'sfx' && hasActiveTake)) {
          const sfxPattern = /SFX(\d{3}):[^\n]+/g;
          let match;
          while ((match = sfxPattern.exec(lineText)) !== null) {
            const sfxId = `SFX${match[1]}`;
            const sfx = sfxs.find(s => s.id === sfxId);
            if (sfx && sfx.audioUrl) {
              items.push({ 
                url: sfx.audioUrl, 
                manualOffset: sfx.trimOffset, 
                manualEnd: sfx.trimEnd,
                volume: sfx.volume,
                pan: sfx.pan
              });
            }
          }
        }

        // TODO: BGMの検索等も後で追加できる

        if (items.length > 0) {
          if (!newQueue[lineIndex]) newQueue[lineIndex] = [];
          newQueue[lineIndex].push(...items);
        }
      });
    });

    queueRef.current = newQueue;

    // 非同期で新しく追加された音声の無音区間（頭出し）を解析する
    const allItems = Object.values(newQueue).flat();
    allItems.forEach(async (item) => {
      const url = item.url;
      if (!trimCache.has(url)) {
        try {
          if (!(window as any).decodeCtx) {
            (window as any).decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          }
          const audioContext = (window as any).decodeCtx as AudioContext;
          
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          const channelData = audioBuffer.getChannelData(0);
          const sampleRate = audioBuffer.sampleRate;
          
          // 振幅が0.5%（0.005）を超える最初のサンプルを探す
          // ※2%（0.02）だと「サ行」や「ハ行」などの静かな子音がカットされてしまうため
          const threshold = 0.005;
          let offset = 0;
          for (let i = 0; i < channelData.length; i++) {
            if (Math.abs(channelData[i]) > threshold) {
              offset = i / sampleRate;
              break;
            }
          }
          
          // プツッというノイズを防いだり、子音の立ち上がりを完全に保護するため、0.1秒（100ms）余裕を持たせる
          const finalOffset = Math.max(0, offset - 0.1);
          trimCache.set(url, finalOffset);
          console.log(`[Audio Manager] Auto-cued ${url} at ${finalOffset.toFixed(3)}s`);
        } catch (e) {
          console.warn("Failed to analyze audio for auto-cue:", e);
          trimCache.set(url, 0);
        }
      }
    });

  }, [scripts, layers, sfxs, lineTakesMap]);

  // 全て停止
  const stopAll = useCallback(() => {
    activeAudioRef.current.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    activeAudioRef.current = [];
    prevTimeRef.current = null;
  }, []);

  // 行の音声を再生するヘルパー
  const playLine = useCallback((lineIndex: number, seekOffset: number = 0) => {
    const items = queueRef.current[lineIndex];
    if (items && items.length > 0) {
      console.log(`[playLine] lineIndex: ${lineIndex}, seekOffset: ${seekOffset}, itemsCount: ${items.length}`);
      if (!(window as any).audioCtx) {
        (window as any).audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = (window as any).audioCtx as AudioContext;
      if (ctx.state === 'suspended') ctx.resume();

      items.forEach(item => {
        const { url, manualOffset, manualEnd, volume, pan } = item;
        console.log(`[playLine] Loading audio: ${url}`);
        const audio = new Audio(url);
        audio.crossOrigin = "anonymous";
        activeAudioRef.current.push(audio);
        
        let sourceNode: MediaElementAudioSourceNode | null = null;
        try {
          sourceNode = ctx.createMediaElementSource(audio);
          const panNode = ctx.createStereoPanner();
          panNode.pan.value = pan ?? 0;
          
          const gainNode = ctx.createGain();
          gainNode.gain.value = volume ?? 1;
          
          sourceNode.connect(panNode);
          panNode.connect(gainNode);
          gainNode.connect(ctx.destination);
        } catch (e) {
          console.warn("Web Audio API routing failed, fallback to basic volume:", e);
          audio.volume = Math.min(Math.max(volume ?? 1, 0), 1);
        }
        
        // 手動オフセットが設定されていれば優先、なければ自動解析のキャッシュを使用
        const baseOffset = manualOffset !== undefined ? manualOffset : (trimCache.get(url) || 0);
        const finalOffset = baseOffset + seekOffset;
        
        // メタデータがロードされたらオフセットを設定して再生
        audio.addEventListener('loadedmetadata', () => {
          // ロード中にstopAllが呼ばれていた場合は再生しない
          if (!activeAudioRef.current.includes(audio)) {
            if (sourceNode) sourceNode.disconnect();
            return;
          }
          
          if (finalOffset > 0) {
            if (finalOffset >= audio.duration) {
              // 既に再生終了している長さの場合はスキップ
              activeAudioRef.current = activeAudioRef.current.filter(a => a !== audio);
              if (sourceNode) sourceNode.disconnect();
              return;
            }
            audio.currentTime = finalOffset;
          }
          
          if (manualEnd !== undefined) {
            audio.ontimeupdate = () => {
              if (audio.currentTime >= manualEnd) {
                audio.pause();
                if (sourceNode) sourceNode.disconnect();
              }
            };
          }
          
          audio.play().catch(e => console.error("Playback failed:", e));
        });
        
        audio.addEventListener('ended', () => {
          if (sourceNode) sourceNode.disconnect();
          activeAudioRef.current = activeAudioRef.current.filter(a => a !== audio);
        });
        
        // ロードを開始
        audio.load();
      });
    }
  }, []);

  // 毎フレーム呼ばれる tick
  const tick = useCallback((currentTimeSeconds: number) => {
    if (prevTimeRef.current === null) {
      // 再生開始直後 または シーク後
      const currentLine = Math.floor(currentTimeSeconds);
      const subSecondSeek = currentTimeSeconds - currentLine;

      // 過去30秒 (30行) 分遡って、現在再生中のはずのオーディオを探す（数百行遡るとAudioContextがクラッシュするため）
      const maxLookBack = 30;
      const startIdx = Math.max(0, currentLine - maxLookBack);
      
      for (let i = startIdx; i <= currentLine; i++) {
        const timePassed = currentLine - i + subSecondSeek;
        playLine(i, timePassed);
      }
    } else {
      const startIdx = Math.floor(prevTimeRef.current);
      const endIdx = Math.floor(currentTimeSeconds);

      // 行をまたいだ場合
      if (startIdx < endIdx) {
        for (let i = startIdx + 1; i <= endIdx; i++) {
          playLine(i, 0);
        }
      }
    }
    prevTimeRef.current = currentTimeSeconds;
  }, [playLine]);

  return { stopAll, tick, resetTick: () => { prevTimeRef.current = null; } };
};
