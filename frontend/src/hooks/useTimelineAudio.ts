import { useEffect, useRef, useCallback } from 'react';
import type { ScriptData, LayerInfo, SfxData, LineTakes } from '../App';

type AudioQueue = Record<number, { url: string; manualOffset?: number; manualEnd?: number }[]>;

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

        const items: { url: string; manualOffset?: number; manualEnd?: number }[] = [];

        // ボイス（テイク）の検索
        const blockId = `${layer.id}-${lineIndex}`;
        const takesData = lineTakesMap[blockId];
        if (takesData && takesData.activeTakeId) {
          const activeTake = takesData.takes.find(t => t.id === takesData.activeTakeId);
          if (activeTake && activeTake.audioUrl) {
            items.push({ url: activeTake.audioUrl, manualOffset: activeTake.trimOffset, manualEnd: activeTake.trimEnd });
          }
        }

        // SFXの検索
        const sfxPattern = /SFX(\d{3}):[^\n]+/g;
        let match;
        while ((match = sfxPattern.exec(lineText)) !== null) {
          const sfxId = `SFX${match[1]}`;
          const sfx = sfxs.find(s => s.id === sfxId);
          if (sfx && sfx.audioUrl) {
            items.push({ url: sfx.audioUrl, manualOffset: sfx.trimOffset, manualEnd: sfx.trimEnd });
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
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
  const playLine = useCallback((lineIndex: number) => {
    const items = queueRef.current[lineIndex];
    if (items && items.length > 0) {
      items.forEach(item => {
        const { url, manualOffset, manualEnd } = item;
        const audio = new Audio(url);
        activeAudioRef.current.push(audio);
        
        // 手動オフセットが設定されていれば優先、なければ自動解析のキャッシュを使用
        const offset = manualOffset !== undefined ? manualOffset : (trimCache.get(url) || 0);
        
        // メタデータがロードされたらオフセットを設定して再生
        audio.addEventListener('loadedmetadata', () => {
          // ロード中にstopAllが呼ばれていた場合は再生しない
          if (!activeAudioRef.current.includes(audio)) return;
          
          if (offset > 0) {
            audio.currentTime = offset;
          }
          
          if (manualEnd !== undefined) {
            audio.ontimeupdate = () => {
              if (audio.currentTime >= manualEnd) {
                audio.pause();
                audio.ontimeupdate = null;
                activeAudioRef.current = activeAudioRef.current.filter(a => a !== audio);
              }
            };
          }

          audio.play().catch(e => console.warn('Audio play blocked:', e));
        }, { once: true });
        
        audio.onended = () => {
          activeAudioRef.current = activeAudioRef.current.filter(a => a !== audio);
        };
        
        // ロードを開始
        audio.load();
      });
    }
  }, []);

  // 毎フレーム呼ばれる tick
  const tick = useCallback((currentTimeSeconds: number) => {
    if (prevTimeRef.current === null) {
      // 再生開始直後のフレーム
      // もし再生開始位置が「ちょうど整数秒（例: 0秒ジャスト）」ならその行を鳴らす
      if (currentTimeSeconds === Math.floor(currentTimeSeconds)) {
        playLine(Math.floor(currentTimeSeconds));
      }
    } else {
      const startIdx = Math.floor(prevTimeRef.current);
      const endIdx = Math.floor(currentTimeSeconds);

      // 行をまたいだ場合
      if (startIdx < endIdx) {
        for (let i = startIdx + 1; i <= endIdx; i++) {
          playLine(i);
        }
      }
    }
    prevTimeRef.current = currentTimeSeconds;
  }, [playLine]);

  return { stopAll, tick, resetTick: () => { prevTimeRef.current = null; } };
};
