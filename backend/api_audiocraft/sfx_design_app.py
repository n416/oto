import gradio as gr
import torchaudio
import os
import uuid
import torch
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../audiocraft")))
from audiocraft.models import AudioGen

# モデルのロード
print("AudioGenモデルをロード中...")
model = AudioGen.get_pretrained('facebook/audiogen-medium')
model.set_generation_params(duration=5)  # デフォルト5秒

def generate_sfx(prompt):
    print(f"Generating SFX for: {prompt}")
    wavs = model.generate([prompt])
    one_wav = wavs[0]
    
    # 音割れ防止と音量最適化（正規化）
    max_val = one_wav.abs().max()
    if max_val > 0:
        one_wav = one_wav / max_val
        
    # 保存先ディレクトリ
    os.makedirs("../../outputs/sfx", exist_ok=True)
    filename = f"../../outputs/sfx/sfx_{uuid.uuid4().hex[:8]}.wav"
    
    # 保存
    torchaudio.save(filename, one_wav.cpu(), model.sample_rate)  # type: ignore
    print(f"生成完了: {filename}")
    return filename

def translate_to_english(text):
    from deep_translator import GoogleTranslator
    print(f"Translating: {text}")
    translated = GoogleTranslator(source='auto', target='en').translate(text)
    print(f"Translated to: {translated}")
    return translated

with gr.Blocks() as app:
    gr.Markdown("# 効果音生成API (AudioGen)")
    with gr.Row():
        prompt_input = gr.Textbox(label="プロンプト (例: a loud cinematic explosion, boom)")
        output_audio = gr.Audio(label="生成された音声", type="filepath")
    
    generate_btn = gr.Button("生成")
    generate_btn.click(
        fn=generate_sfx,
        inputs=[prompt_input],
        outputs=[output_audio],
        api_name="generate"
    )
    
    # フロントエンドから呼び出すための非表示エンドポイント
    dummy_input = gr.Textbox(visible=False)
    dummy_output = gr.Textbox(visible=False)
    dummy_btn = gr.Button(visible=False)
    dummy_btn.click(
        fn=translate_to_english,
        inputs=[prompt_input],
        outputs=[prompt_input],
        api_name="translate"
    )

if __name__ == "__main__":
    print("サーバーをポート7862で起動します...")
    app.launch(server_name="127.0.0.1", server_port=7862, allowed_paths=["../../outputs"])
