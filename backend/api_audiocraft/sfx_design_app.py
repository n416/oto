from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("../../outputs/sfx", exist_ok=True)
app.mount("/outputs", StaticFiles(directory="../../outputs"), name="outputs")

class SfxRequest(BaseModel):
    prompt: str

class TranslateRequest(BaseModel):
    text: str

@app.get("/")
def api_root():
    return {"status": "ok"}

@app.post("/generate")
def api_generate_sfx(req: SfxRequest):
    filename = generate_sfx(req.prompt)
    url_path = filename.replace("../../outputs", "/outputs").replace("\\", "/")
    url = f"http://127.0.0.1:7862{url_path}"
    return {"url": url}

@app.post("/translate")
def api_translate(req: TranslateRequest):
    translated = translate_to_english(req.text)
    return {"translated": translated}

if __name__ == "__main__":
    print("サーバーをポート7862で起動します...")
    uvicorn.run(app, host="0.0.0.0", port=7862, access_log=False)
