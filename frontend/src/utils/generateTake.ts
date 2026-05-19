import { Client, handle_file } from '@gradio/client';
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
    const file = new File([blob], "reference.wav", { type: "audio/wav" });

    // ポート7860 (ボイスクローニング) に接続
    const client = await Client.connect("http://127.0.0.1:7860/");
    const result = await client.predict("/generate", [
      "Aratako/Irodori-TTS-500M-v3", // checkpoint
      "cuda", // model_device
      "bf16", // model_precision
      "cuda", // codec_device
      "bf16", // codec_precision
      speechText, // text
      handle_file(file), // uploaded_audio
      40, // num_steps
      1, // num_candidates
      "", // seed_raw
      "", // seconds_raw
      1.0, // duration_scale
      "linear", // t_schedule_mode
      -1.0, // sway_coeff
      "independent", // cfg_guidance_mode
      3.0, // cfg_scale_text
      5.0, // cfg_scale_speaker
      "", // cfg_scale_raw
      0.5, // cfg_min_t
      1.0, // cfg_max_t
      true, // context_kv_cache
      "", // truncation_factor_raw
      "", // rescale_k_raw
      "", // rescale_sigma_raw
      "", // speaker_kv_scale_raw
      "0.9", // speaker_kv_min_t_raw
      "", // speaker_kv_max_layers_raw
      "", // lora_adapter_raw
    ]);

    // @ts-ignore
    const audioData = result.data?.[0];
    const rawValue = (audioData && typeof audioData === "object" && audioData.__type__ === "update") ? audioData.value : audioData;
    
    if (typeof rawValue === "string") {
      audioUrl = rawValue.startsWith("http") ? rawValue : `http://127.0.0.1:7860/file=${rawValue}`;
    } else if (rawValue && typeof rawValue === "object") {
      // @ts-ignore
      audioUrl = rawValue.url || (rawValue.path ? `http://127.0.0.1:7860/file=${rawValue.path}` : "#");
    }

  } else if (layer === 'sfx') {
    // SFX000: どおおおおおおおんあああああ -> "どおおおおおおおんあああああ"
    const match = text.match(/^(.+?)[：:]\s*(.+)$/);
    let promptText = text;
    if (match) {
      promptText = match[2].trim();
    }

    const client = await Client.connect("http://127.0.0.1:7862/");
    
    // 生成前に自動翻訳を挟む (日本語が含まれている場合や、常に翻訳を通す)
    let finalPrompt = promptText;
    if (/[ぁ-んァ-ヶ亜-熙]/.test(promptText)) {
      const transResult = await client.predict("/translate", [promptText]);
      if (transResult.data?.[0]) {
        finalPrompt = transResult.data[0] as string;
      }
    }

    const result = await client.predict("/generate", [finalPrompt]);
    
    // @ts-ignore
    const audioData = result.data?.[0];
    
    const rawValue = (audioData && typeof audioData === "object" && audioData.__type__ === "update") 
      ? audioData.value 
      : audioData;

    if (typeof rawValue === "string") {
      audioUrl = rawValue.startsWith("http") ? rawValue : `http://127.0.0.1:7862/file=${rawValue}`;
    } else if (rawValue && typeof rawValue === "object") {
      // @ts-ignore
      audioUrl = rawValue.url || (rawValue.path ? `http://127.0.0.1:7862/file=${rawValue.path}` : "#");
    }
  } else {
    throw new Error('現在、このレイヤーでの生成には対応していません。');
  }

  return {
    id: `take_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    audioUrl: audioUrl,
    timestamp: new Date().toLocaleTimeString()
  };
}
