
import type { CharacterData } from '../components/CharacterSettings';
import type { TakeData } from '../App';

export async function generateTake(
  layer: string,
  text: string,
  characters: CharacterData[],
  fullScript?: string,
  lineIndex?: number
): Promise<TakeData> {
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

    // 既存のURL/Blobからファイルデータを取得
    const response = await fetch(character.refAudioPath);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append("text", speechText);
    formData.append("uploaded_audio", blob, "reference.wav");

    const res = await fetch("http://127.0.0.1:7860/generate", {
      method: "POST",
      body: formData
    });
    
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const resultData = await res.json();
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
        body: JSON.stringify({ text: promptText })
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
      body: JSON.stringify({ prompt: finalPrompt })
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
    const audioRes = await fetch(audioUrl);
    const arrayBuffer = await audioRes.arrayBuffer();
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedData = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      duration = decodedData.duration;
    } catch (e) {
      console.warn("Failed to decode audio duration in generateTake", e);
    }

    // ArrayBuffer to Base64 (巨大ファイルには適さないが、音声なら問題ない範囲)
    const base64 = btoa(
      new Uint8Array(arrayBuffer)
        .reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const uploadRes = await fetch('/api/backend/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `take_${Date.now()}.wav`, base64 })
    });
    if (uploadRes.ok) {
      const data = await uploadRes.json();
      audioUrl = data.url; // 永続化されたURLに差し替え
    }
  } catch (e) {
    console.warn("生成された音声の永続化に失敗しました。GradioのURLをフォールバックとして使用します。", e);
  }

  return {
    id: `take_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    audioUrl: audioUrl,
    timestamp: new Date().toLocaleTimeString(),
    duration: duration
  };
}
