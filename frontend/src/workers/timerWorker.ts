let timerId: ReturnType<typeof setInterval> | null = null;
let lastTime: number = 0;

self.onmessage = (e: MessageEvent) => {
  if (e.data.command === 'start') {
    if (timerId) clearInterval(timerId);
    lastTime = Date.now();
    // ブラウザがバックグラウンドに回っても確実にタイマーを発火させるため
    // 約60fps（16ms）間隔でメッセージをメインスレッドに送る
    timerId = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTime;
      lastTime = now;
      self.postMessage({ type: 'tick', delta });
    }, 16);
  } else if (e.data.command === 'stop') {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};
