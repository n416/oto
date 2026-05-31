import React, { useState, useEffect } from 'react';

interface ServerStatus {
  id: string;
  name: string;
  state: 'stopped' | 'starting' | 'ready';
}

interface BackendManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCleanup?: () => void;
}

export const BackendManagerModal: React.FC<BackendManagerModalProps> = ({ isOpen, onClose, onCleanup }) => {
  const [servers, setServers] = useState<ServerStatus[]>([]);
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      const eventSource = new EventSource('/api/backend/stream');
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setServers(data.map((s: any) => ({ id: s.id, name: s.name, state: s.state })));
          
          const newLogs: Record<string, string> = {};
          data.forEach((s: any) => {
            if (s.state !== 'stopped' && s.logs) {
              newLogs[s.id] = s.logs;
            }
          });
          setLogs(newLogs);
        } catch (e) {
          console.error('Failed to parse SSE data', e);
        }
      };

      return () => {
        eventSource.close();
      };
    }
  }, [isOpen]);

  const toggleServer = async (id: string, currentState: string) => {
    setIsLoading(prev => ({ ...prev, [id]: true }));
    try {
      const endpoint = currentState !== 'stopped' ? '/api/backend/stop' : '/api/backend/start';
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      // SSEが自動的に新しいステータスを受信します
    } catch (e) {
      console.error('Failed to toggle server:', e);
    } finally {
      setIsLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10000
    }}>
      <div style={{
        backgroundColor: '#252526',
        padding: '24px',
        borderRadius: '8px',
        width: '500px',
        color: '#d4d4d4',
        border: '1px solid #444',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        fontFamily: 'sans-serif'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>⚙️ システム設定 (バックエンド管理)</h2>
          <button 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {servers.length === 0 ? (
            <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>ステータスを取得中...</div>
          ) : (
            servers.map(server => (
              <React.Fragment key={server.id}>
                <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#1e1e1e',
                padding: '16px',
                borderRadius: '6px',
                border: '1px solid #333'
              }}>
                <div>
                  <div style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>{server.name}</div>
                  <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', 
                    color: server.state === 'ready' ? '#48bb78' : server.state === 'starting' ? '#e2a74a' : '#e53e3e' 
                  }}>
                    <div style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      backgroundColor: server.state === 'ready' ? '#48bb78' : server.state === 'starting' ? '#e2a74a' : '#e53e3e',
                      boxShadow: server.state === 'ready' ? '0 0 5px #48bb78' : server.state === 'starting' ? '0 0 5px #e2a74a' : 'none'
                    }} />
                    {server.state === 'ready' ? '稼働中 (Ready)' : server.state === 'starting' ? '起動処理中 (Starting...)' : '停止中 (Stopped)'}
                  </div>
                </div>

                <button
                  onClick={() => toggleServer(server.id, server.state)}
                  disabled={isLoading[server.id]}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: isLoading[server.id] ? '#4a5568' : (server.state !== 'stopped' ? '#e53e3e' : '#4a90e2'),
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isLoading[server.id] ? 'wait' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: '13px',
                    minWidth: '80px',
                    transition: 'all 0.2s'
                  }}
                >
                  {isLoading[server.id] ? '処理中...' : (server.state !== 'stopped' ? '■ 停止' : '▶ 起動')}
                </button>
              </div>
              
              {server.state !== 'stopped' && logs[server.id] && (
                <div style={{
                  backgroundColor: '#1a1a1a',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #333',
                  fontSize: '11px',
                  color: '#aaa',
                  fontFamily: 'monospace',
                  maxHeight: '100px',
                  overflowY: 'auto',
                  marginTop: '-12px',
                  marginBottom: '8px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {logs[server.id].trim()}
                </div>
              )}
            </React.Fragment>
            ))
          )}
        </div>
        
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid #333' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#fff' }}>🧹 ストレージのクリーンアップ</h3>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px', lineHeight: '1.5' }}>
            現在のプロジェクト（台本やボイスライブラリ）で使われていない古い音声ファイルを削除し、ディスク容量を解放します。
          </p>
          <button
            onClick={onCleanup}
            style={{
              padding: '8px 16px',
              backgroundColor: '#2d3748',
              color: '#fff',
              border: '1px solid #4a5568',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4a5568'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#2d3748'}
          >
            🗑️ 未使用ファイルを一括削除
          </button>
        </div>

        <p style={{ fontSize: '11px', color: '#888', marginTop: '24px', lineHeight: '1.5' }}>
          ※ 起動ボタンを押すと、裏でPythonサーバーが立ち上がります。起動が完了して実際に使えるようになるまで数十秒かかる場合があります。<br/>
          ※ 不要なサーバーは停止しておくことで、PCのメモリ・VRAMを節約できます。
        </p>
      </div>
    </div>
  );
};
