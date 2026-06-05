
import type { CharacterData } from '../components/CharacterSettings';
import type { TakeData } from '../App';

export async function generateTake(
  layer: string,
  text: string,
  characters: CharacterData[],
  fullScript?: string,
  lineIndex?: number,
  signal?: AbortSignal
): Promise<TakeData> {
  console.log(`[generateTake] Start -> layer: ${layer}, text: "${text}"`);
  let audioUrl = "#";

  if (layer === 'dialogue') {
    // キャラクター名とセリフを分離 ("XX: こんにちは" -> charName: "XX", speechText: "こんにちは")
    const match = text.match(/^(.+?)[：:]\s*(.+)$/);
    let charId = "";
    let speechText = "";

    if (match) {
      charId = match[1].trim();
      speechText = match[2].trim();
    } else {
      // プレフィックスがない場合、上を探索する
      speechText = text.trim();
      if (fullScript && lineIndex !== undefined) {
        const lines = fullScript.split('\n');
        for (let i = lineIndex - 1; i >= 0; i--) {
          const prevMatch = lines[i].match(/^(.+?)[：:]\s*(.+)$/);
          if (prevMatch) {
            charId = prevMatch[1].trim();
            break;
          }
        }
      }
      if (!charId) {
        throw new Error('キャラクターが特定できませんでした。上の行に「キャラID: セリフ」の形式で記述するか、対象のキャラクターを設定してください。');
      }
    }

    const character = characters.find(c => c.id === charId);
    if (!character || !character.refAudioPath) {
      throw new Error(`キャラクター「${charId}」が見つからないか、参考音声が割り当てられていません。ボイスライブラリから割り当てを行ってください。`);
    }

    console.log(`[generateTake] Character resolved: ${charId}, fetching refAudioPath: ${character.refAudioPath.substring(0, 50)}...`);

    // 既存のURL/Blobからファイルデータを取得
    let blob: Blob;
    try {
      const response = await fetch(character.refAudioPath, { signal });
      blob = await response.blob();
      console.log(`[generateTake] Fetched refAudio size: ${blob.size} bytes`);
    } catch (e: any) {
      console.error(`[generateTake] Failed to fetch refAudioPath. Is the Blob URL expired? Error:`, e);
      throw e;
    }

    const formData = new FormData();
    formData.append("text", speechText);
    formData.append("uploaded_audio", blob, "reference.wav");

    console.log(`[generateTake] Sending request to Irodori API (http://127.0.0.1:7860/generate)`);
    const res = await fetch("http://127.0.0.1:7860/generate", {
      method: "POST",
      body: formData,
      signal
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.error("[generateTake] Irodori API Error:", res.status, errText);
      throw new Error(`HTTP error! status: ${res.status}. Detail: ${errText}`);
    }
    const resultData = await res.json();
    console.log(`[generateTake] Irodori API response received:`, resultData);
    audioUrl = resultData.urls?.[0] || "#";

  } else if (layer === 'sfx') {
    // SFX000: どおおおおおおおんあああああ -> "どおおおおおおおんあああああ"
    const match = text.match(/^(.+?)[：:]\s*(.+)$/);
    let promptText = text;
    if (match) {
      promptText = match[2].trim();
    }

    // 生成前に自動翻訳を挟む (日本語が含まれている場合や、常に翻訳を通す)
    let finalPrompt = promptText;
    if (/[ぁ-んァ-ヶ亜-熙]/.test(promptText)) {
      const transRes = await fetch("http://127.0.0.1:7862/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: promptText }),
        signal
      });
      if (transRes.ok) {
        const transData = await transRes.json();
        if (transData.translated) {
          finalPrompt = transData.translated;
        }
      }
    }

    const res = await fetch("http://127.0.0.1:7862/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: finalPrompt }),
      signal
    });
    
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const resultData = await res.json();
    audioUrl = resultData.url || "#";
  } else {
    throw new Error('現在、このレイヤーでの生成には対応していません。');
  }

  let duration: number | undefined;

  // GradioのテンポラリURLはバックエンド再起動で消えるため、生成直後に永続化(アップロード)する
  try {
    console.log(`[generateTake] Fetching generated audio for persistence: ${audioUrl}`);
    const audioRes = await fetch(audioUrl + (audioUrl.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal });
    const arrayBuffer = await audioRes.arrayBuffer();
    console.log(`[generateTake] Fetched generated audio size: ${arrayBuffer.byteLength} bytes`);
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedData = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      duration = decodedData.duration;
      // AudioContextの上限（6個等）に達してクラッシュするのを防ぐため必ずcloseする
      await audioCtx.close();
    } catch (e) {
      console.warn("Failed to decode audio duration in generateTake", e);
    }

    // FileReaderを使って安全にBase64文字列を取得する
    console.log(`[generateTake] Converting ArrayBuffer to Base64 using FileReader...`);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // data:audio/wav;base64,..... から base64データ部分だけを抽出
        const base64Data = dataUrl.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(new Blob([arrayBuffer]));
    });
    
    console.log(`[generateTake] Base64 conversion done, length: ${base64.length}. Sending to /api/backend/upload...`);
    const uploadRes = await fetch('/api/backend/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `take_${Date.now()}.wav`, base64 }),
      signal
    });
    if (uploadRes.ok) {
      const data = await uploadRes.json();
      console.log(`[generateTake] Persistence successful:`, data.url);
      audioUrl = data.url; // 永続化されたURLに差し替え
    } else {
      console.warn(`[generateTake] Persistence API returned non-ok status: ${uploadRes.status}`);
    }
  } catch (e: any) {
    console.warn(`[generateTake] 生成された音声の永続化ステップでエラー発生:`, e);
    // AbortErrorの場合はそのまま上に投げる（一括生成のキャンセルを正しくハンドルするため）
    if (e.name === 'AbortError') {
      throw e;
    }
  }

  console.log(`[generateTake] Done. Returning audioUrl: ${audioUrl}, duration: ${duration}`);
  return {
    id: `take_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    audioUrl: audioUrl,
    timestamp: new Date().toLocaleTimeString(),
    duration: duration
  };
}
