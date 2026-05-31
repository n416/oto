import React, { useEffect, useRef } from 'react';

interface TimelineWaveformProps {
  audioUrl: string;
  color: string;
  trimOffset?: number;
  trimEnd?: number;
  onDurationLoaded?: (duration: number) => void;
}

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ audioUrl, color, trimOffset, trimEnd, onDurationLoaded }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let isCancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !audioUrl || audioUrl === '#') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fetchAndDraw = async () => {
      try {
        // メタデータから長さを取得 (高速)
        const audio = new Audio(audioUrl);
        await new Promise<void>((resolve, reject) => {
          audio.addEventListener('loadedmetadata', () => {
            if (isCancelled) return;
            if (onDurationLoaded) onDurationLoaded(audio.duration);
            resolve();
          });
          audio.addEventListener('error', reject);
        });

        if (isCancelled) return;

        // 波形描画のためのデータ取得
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        if (!(window as any).sharedAudioCtx) {
          (window as any).sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const audioCtx = (window as any).sharedAudioCtx as AudioContext;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        if (isCancelled) return;

        const channelData = audioBuffer.getChannelData(0);
        
        // キャンバスのサイズ設定
        const width = canvas.width = canvas.parentElement?.clientWidth || 200;
        const height = canvas.height = canvas.parentElement?.clientHeight || 60;
        
        ctx.clearRect(0, 0, width, height);
        
        // 波形の描画 (縦向き)
        const sampleRate = audioBuffer.sampleRate;
        const startIndex = trimOffset !== undefined ? Math.floor(trimOffset * sampleRate) : 0;
        let endIndex = channelData.length;
        if (trimEnd !== undefined) {
           endIndex = Math.min(channelData.length, Math.floor(trimEnd * sampleRate));
        }
        if (endIndex <= startIndex) endIndex = startIndex + 1;
        
        const targetDataLength = endIndex - startIndex;
        const step = Math.max(1, Math.floor(targetDataLength / height));
        
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3; // 半透明でブロックの背景になじませる
        
        for (let i = 0; i < height; i++) {
          let min = 1.0;
          let max = -1.0;
          const offset = startIndex + i * step;
          for (let j = 0; j < step && (offset + j) < channelData.length; j++) {
            const datum = channelData[offset + j]; 
            if (datum < min) min = datum;
            if (datum > max) max = datum;
          }
          const x1 = (1 + min) * width / 2;
          const x2 = (1 + max) * width / 2;
          ctx.fillRect(x1, i, Math.max(1, x2 - x1), 1);
        }
      } catch (e) {
        console.warn("Failed to load waveform for timeline:", e);
      }
    };

    fetchAndDraw();

    return () => {
      isCancelled = true;
    };
  }, [audioUrl, color, trimOffset, trimEnd]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        width: '100%', 
        height: '100%', 
        pointerEvents: 'none',
        borderRadius: '2px'
      }} 
    />
  );
};
