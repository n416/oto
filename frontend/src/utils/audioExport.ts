import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { ScriptData, LayerInfo, SfxData, LineTakes } from '../App';

export type ExportMode = 'cropped' | 'stem' | 'mixdown';

// AudioBufferをWAV形式のBlobに変換するユーティリティ関数
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const result = new Float32Array(buffer.length * numChannels);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      result[i * numChannels + channel] = channelData[i];
    }
  }

  const dataLength = result.length * (bitDepth / 8);
  const bufferArray = new ArrayBuffer(44 + dataLength);
  const view = new DataView(bufferArray);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < result.length; i++) {
    let s = Math.max(-1, Math.min(1, result[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, s, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

// 自動トリム用の無音検出関数（フロントエンド側）
async function detectSilenceEnd(buffer: AudioBuffer): Promise<number> {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  let startOffset = 0;
  
  // 0.5% (約 -46dB) を閾値とする
  const threshold = 0.005;
  for (let i = 0; i < channelData.length; i++) {
    if (Math.abs(channelData[i]) > threshold) {
      // 0.1秒手前（マージン）を計算
      const marginSamples = sampleRate * 0.1;
      startOffset = Math.max(0, (i - marginSamples) / sampleRate);
      break;
    }
  }
  return startOffset;
}

export async function exportWavFiles(
  scripts: ScriptData,
  layers: LayerInfo[],
  sfxs: SfxData[],
  lineTakesMap: Record<string, LineTakes>,
  mode: ExportMode,
  onProgress?: (msg: string) => void
) {
  const zip = new JSZip();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  if (onProgress) onProgress('タイムラインを解析中...');

  const filesToExport: {
    filename: string;
    url: string;
    manualStart?: number;
    manualEnd?: number;
    volume?: number;
    pan?: number;
    timelineStartOffset: number;
    layerName: string;
  }[] = [];

  // スクリプトを解析してエクスポート対象を抽出
  const maxLines = Math.max(...Object.values(scripts).map(t => t.split('\n').length));
  
  for (const layer of layers) {
    if (!layer.visibleInTimeline) continue;
    const text = scripts[layer.id] || "";
    const lines = text.split('\n');
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      if (!lineText.trim()) continue;

      const blockId = `${layer.id}-${lineIndex}`;
      const lineSeconds = lineIndex; // 1行 = 1秒
      
      const takesData = lineTakesMap[blockId];
      let hasActiveTake = false;
      if (takesData && takesData.activeTakeId) {
        const activeTake = takesData.takes.find(t => t.id === takesData.activeTakeId);
        if (activeTake && activeTake.audioUrl) {
          const charMatch = lineText.match(/^([^:]+):/);
          const charName = charMatch ? charMatch[1] : 'Voice';
          filesToExport.push({
            filename: `L${String(lineIndex + 1).padStart(3, '0')}_${layer.id}_${charName}.wav`,
            url: activeTake.audioUrl,
            manualStart: activeTake.trimOffset,
            manualEnd: activeTake.trimEnd,
            volume: activeTake.volume,
            pan: activeTake.pan,
            timelineStartOffset: lineSeconds,
            layerName: layer.id
          });
          hasActiveTake = true;
        }
      }

      if (!(layer.id === 'sfx' && hasActiveTake)) {
        const sfxPattern = /SFX(\d{3}):([^\n]+)/g;
        let match;
        while ((match = sfxPattern.exec(lineText)) !== null) {
          const sfxId = `SFX${match[1]}`;
          const sfx = sfxs.find(s => s.id === sfxId);
          if (sfx && sfx.audioUrl) {
            filesToExport.push({
              filename: `L${String(lineIndex + 1).padStart(3, '0')}_${layer.id}_${sfxId}.wav`,
              url: sfx.audioUrl,
              manualStart: sfx.trimOffset,
              manualEnd: sfx.trimEnd,
              volume: sfx.volume,
              pan: sfx.pan,
              timelineStartOffset: lineSeconds,
              layerName: layer.id
            });
          }
        }
      }
    }
  }

  if (filesToExport.length === 0) {
    alert('エクスポートする音声がありません。');
    return;
  }

  if (mode === 'mixdown') {
    // -----------------------------------------------------
    // 1. ミックスダウン（全音声を1つのWAVに結合）
    // -----------------------------------------------------
    if (onProgress) onProgress('全オーディオをデコード・配置計算中...');
    
    // 全ファイルをデコードして必要な情報を保持する
    const decodedFiles: {
      buffer: AudioBuffer;
      startCut: number;
      durationToKeep: number;
      timelineStartOffset: number;
      volume?: number;
      pan?: number;
    }[] = [];

    let maxDuration = 0;
    // ミックスダウン時には最大のサンプルレートをベースにする（一般的に44100か48000）
    let targetSampleRate = 44100; 

    for (let i = 0; i < filesToExport.length; i++) {
      const file = filesToExport[i];
      try {
        const response = await fetch(file.url);
        const arrayBuffer = await response.arrayBuffer();
        const decodedData = await audioCtx.decodeAudioData(arrayBuffer);
        
        targetSampleRate = Math.max(targetSampleRate, decodedData.sampleRate);

        let startCut = file.manualStart;
        if (startCut === undefined) {
          startCut = await detectSilenceEnd(decodedData);
        }
        let endCut = file.manualEnd;
        if (endCut === undefined || endCut > decodedData.duration) {
          endCut = decodedData.duration;
        }
        const durationToKeep = Math.max(0, endCut - startCut);
        if (durationToKeep === 0) continue;

        const endTimelineTime = file.timelineStartOffset + durationToKeep;
        maxDuration = Math.max(maxDuration, endTimelineTime);

        decodedFiles.push({
          buffer: decodedData,
          startCut,
          durationToKeep,
          timelineStartOffset: file.timelineStartOffset,
          volume: file.volume,
          pan: file.pan
        });
      } catch (e) {
        console.error(`Failed to decode ${file.filename}`, e);
      }
    }

    if (decodedFiles.length === 0) return;

    // 余白を少し足す
    const finalDuration = maxDuration + 0.5;
    
    if (onProgress) onProgress('タイムラインをミックスダウン中...');
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(finalDuration * targetSampleRate), targetSampleRate);

    for (const df of decodedFiles) {
      const source = offlineCtx.createBufferSource();
      source.buffer = df.buffer;
      
      const panNode = offlineCtx.createStereoPanner();
      panNode.pan.value = df.pan ?? 0;
      
      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = df.volume ?? 1;
      
      source.connect(panNode);
      panNode.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      
      source.start(df.timelineStartOffset, df.startCut, df.durationToKeep);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    
    if (onProgress) onProgress('WAVファイルを生成中...');
    const wavBlob = audioBufferToWav(renderedBuffer);
    saveAs(wavBlob, `Oto_Master_Mixdown.wav`);
    
    if (onProgress) onProgress('');
    return;
  }

  // -----------------------------------------------------
  // 2. ZIPエクスポート (cropped / stem)
  // -----------------------------------------------------
  for (let i = 0; i < filesToExport.length; i++) {
    const file = filesToExport[i];
    if (onProgress) onProgress(`音声処理中... (${i + 1}/${filesToExport.length})\n${file.filename}`);

    try {
      const response = await fetch(file.url);
      const arrayBuffer = await response.arrayBuffer();
      const decodedData = await audioCtx.decodeAudioData(arrayBuffer);

      // 開始と終了位置を決定
      let startCut = file.manualStart;
      if (startCut === undefined) {
        startCut = await detectSilenceEnd(decodedData);
      }
      let endCut = file.manualEnd;
      if (endCut === undefined || endCut > decodedData.duration) {
        endCut = decodedData.duration;
      }
      
      const durationToKeep = Math.max(0, endCut - startCut);
      if (durationToKeep === 0) continue;

      let renderedBuffer: AudioBuffer;

      // エクスポート時にボリュームとパンを適用する
      const applyNodes = (ctx: OfflineAudioContext, source: AudioBufferSourceNode) => {
        const panNode = ctx.createStereoPanner();
        panNode.pan.value = file.pan ?? 0;
        
        const gainNode = ctx.createGain();
        gainNode.gain.value = file.volume ?? 1;
        
        source.connect(panNode);
        panNode.connect(gainNode);
        gainNode.connect(ctx.destination);
      };

      if (mode === 'stem') {
        // 全ファイルを0秒開始のステム形式にするため、(タイムラインの開始位置 + 音声長) のバッファを作成
        const totalDuration = file.timelineStartOffset + durationToKeep;
        const offlineCtx = new OfflineAudioContext(
          decodedData.numberOfChannels || 2, // ステレオパン対応のため最低2チャンネル
          Math.ceil(totalDuration * decodedData.sampleRate),
          decodedData.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = decodedData;
        applyNodes(offlineCtx, source);
        // timelineStartOffset から再生開始、元のバッファの startCut の位置から、durationToKeep だけ再生
        source.start(file.timelineStartOffset, startCut, durationToKeep);
        
        renderedBuffer = await offlineCtx.startRendering();
      } else {
        // individual cropped files
        const offlineCtx = new OfflineAudioContext(
          decodedData.numberOfChannels || 2, // ステレオパン対応のため最低2チャンネル
          Math.ceil(durationToKeep * decodedData.sampleRate),
          decodedData.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = decodedData;
        applyNodes(offlineCtx, source);
        // 0秒目から再生開始、元のバッファの startCut の位置から、durationToKeep だけ再生
        source.start(0, startCut, durationToKeep);
        
        renderedBuffer = await offlineCtx.startRendering();
      }

      const wavBlob = audioBufferToWav(renderedBuffer);
      zip.file(file.filename, wavBlob);

    } catch (e) {
      console.error(`Failed to export ${file.filename}`, e);
    }
  }

  if (onProgress) onProgress('ZIPファイルを生成中...');
  const content = await zip.generateAsync({ type: 'blob' });
  saveAs(content, `Oto_Export_${mode}.zip`);
  if (onProgress) onProgress('');
}
