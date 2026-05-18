import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

interface WaveformTrimmerProps {
  audioUrl: string;
  trimOffset: number | undefined;
  trimEnd: number | undefined;
  onChangeOffset: (start: number | undefined, end: number | undefined) => void;
}

export const WaveformTrimmer: React.FC<WaveformTrimmerProps> = ({ audioUrl, trimOffset, trimEnd, onChangeOffset }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // 波形が生成される前の色（カットされる部分＝暗い灰色）
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#2d3748',
      progressColor: '#4a5568',
      cursorColor: '#fff',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 60,
      normalize: true,
      url: audioUrl,
      interact: false, // クリックでのシークを無効化
    });

    const regions = RegionsPlugin.create();
    ws.registerPlugin(regions);
    regionsRef.current = regions;

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => {
      setIsPlaying(false);
      const regionsList = regions.getRegions();
      if (regionsList.length > 0) {
        ws.setTime(regionsList[0].start);
      } else {
        ws.setTime(0);
      }
    });
    
    ws.on('ready', (dur) => {
      setDuration(dur);
      
      const start = trimOffset !== undefined ? trimOffset : 0;
      const end = trimEnd !== undefined ? trimEnd : dur;
      
      regions.addRegion({
        start: start,
        end: end,
        color: 'rgba(74, 144, 226, 0.4)',
        drag: false, 
        resize: true, 
      });
      
      if (trimOffset !== undefined && trimOffset > 0 && trimOffset < dur) {
        ws.setTime(trimOffset);
      }
    });

    regions.on('region-updated', (region) => {
      const start = Number(region.start.toFixed(3));
      const end = Number(region.end.toFixed(3));
      onChangeOffset(start, end);
    });

    regions.on('region-out', (region) => {
      // リージョンの終了位置に達したら一時停止して先頭に戻る
      // ただし end が duration とほぼ同じ場合は finish イベントに任せる
      if (ws.isPlaying() && region.end < ws.getDuration() - 0.05) {
        ws.pause();
        ws.setTime(region.start);
      }
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [audioUrl]);

  useEffect(() => {
    if (regionsRef.current && wavesurferRef.current) {
      const currentDuration = wavesurferRef.current.getDuration();
      if (currentDuration > 0) {
        const regions = regionsRef.current.getRegions();
        if (regions.length > 0) {
          const region = regions[0];
          const newStart = trimOffset !== undefined ? trimOffset : 0;
          const newEnd = trimEnd !== undefined ? trimEnd : currentDuration;
          
          if (Math.abs(region.start - newStart) > 0.01 || Math.abs(region.end - newEnd) > 0.01) {
            region.setOptions({ start: newStart, end: newEnd });
          }
        }
      }
    }
  }, [trimOffset, trimEnd, duration]);

  const togglePlay = () => {
    if (wavesurferRef.current && regionsRef.current) {
      if (wavesurferRef.current.isPlaying()) {
        wavesurferRef.current.pause();
      } else {
        const regions = regionsRef.current.getRegions();
        if (regions.length > 0) {
          const region = regions[0];
          // 既にリージョンの終端付近にいる場合は先頭に戻す
          if (wavesurferRef.current.getCurrentTime() >= region.end - 0.05) {
            wavesurferRef.current.setTime(region.start);
          } else if (wavesurferRef.current.getCurrentTime() < region.start) {
            wavesurferRef.current.setTime(region.start);
          }
          wavesurferRef.current.play();
        } else {
          wavesurferRef.current.play();
        }
      }
    }
  };

  const clearOffset = () => {
    onChangeOffset(undefined, undefined);
  };

  return (
    <div style={{ backgroundColor: '#1a202c', padding: '12px', borderRadius: '6px', border: '1px solid #2d3748' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <button 
          onClick={togglePlay}
          style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#4a90e2', color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          title="選択範囲（青い部分）のみを再生します"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#a0aec0', display: 'flex', alignItems: 'center' }}>
            ※青い枠をドラッグしてカット範囲を調整
          </span>
          <button 
            onClick={clearOffset}
            style={{ padding: '4px 12px', backgroundColor: '#4a5568', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
            title="手動カットを解除して全体を再生対象にします"
          >
            リセット
          </button>
        </div>
      </div>

      {/* 波形コンテナ */}
      <div style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%' }} />
      </div>

      {/* ステータス */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#a0aec0', marginTop: '8px' }}>
        <span>
          {trimOffset !== undefined || trimEnd !== undefined ? (
            <>
              カット済: <strong style={{ color: '#63b3ed' }}>{trimOffset ?? 0}秒 〜 {trimEnd ?? duration.toFixed(2)}秒</strong> を使用
            </>
          ) : (
            '元の音声をそのまま使用'
          )}
        </span>
        <span>全体: {duration.toFixed(2)}秒</span>
      </div>
    </div>
  );
};
