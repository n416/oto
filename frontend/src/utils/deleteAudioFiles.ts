import type { TakeData } from '../App';

export const deleteAudioFiles = async (takes: TakeData[]) => {
  for (const take of takes) {
    // 実際にバックエンドに保存されたファイル(/uploads/xxx.wav)のみを対象とする
    if (take.audioUrl && take.audioUrl.startsWith('/uploads/')) {
      try {
        await fetch('/api/backend/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: take.audioUrl })
        });
      } catch (e) {
        console.error("Failed to delete audio file:", take.audioUrl, e);
      }
    }
  }
};
