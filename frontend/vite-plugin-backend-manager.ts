import type { Plugin } from 'vite';
import { spawn, ChildProcess, exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  args: string[];
  port: number;
}

const servers: ServerConfig[] = [
  {
    id: 'voice_cloning',
    name: 'ボイスクローニング (Irodori-TTS)',
    cwd: path.resolve(__dirname, '../backend/api_irodori'),
    command: 'cmd.exe',
    args: ['/c', '..\\Irodori-TTS\\.venv\\Scripts\\python.exe', 'irodori_cloning_app.py'],
    port: 7860
  },
  {
    id: 'voice_design',
    name: 'ボイスデザイン (Irodori-TTS)',
    cwd: path.resolve(__dirname, '../backend/api_irodori'),
    command: 'cmd.exe',
    args: ['/c', '..\\Irodori-TTS\\.venv\\Scripts\\python.exe', 'irodori_design_app.py'],
    port: 7861
  },
  {
    id: 'sfx_design',
    name: '効果音生成 (AudioGen)',
    cwd: path.resolve(__dirname, '../backend/api_audiocraft'),
    command: 'cmd.exe',
    args: ['/c', '..\\audiocraft\\.venv\\Scripts\\python.exe', 'sfx_design_app.py'],
    port: 7862
  }
];

const runningProcesses: Record<string, ChildProcess> = {};
const serverLogs: Record<string, string[]> = {};

function killProcessTree(pid: number) {
  return new Promise<void>((resolve) => {
    exec(`taskkill /pid ${pid} /T /F`, () => {
      console.log(`[Backend Manager] Killed tree for pid ${pid}`);
      resolve();
    });
  });
}

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, () => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function backendManagerPlugin(): Plugin {
  return {
    name: 'backend-manager',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/backend/')) {
          return next();
        }

        if (req.method === 'GET' && req.url === '/api/backend/stream') {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          const sendUpdate = async () => {
            try {
              const statusPromises = servers.map(async (s) => {
                const isAlive = !!runningProcesses[s.id];
                let state = 'stopped';
                if (isAlive) {
                  const isReady = await checkPort(s.port);
                  state = isReady ? 'ready' : 'starting';
                }
                return {
                  id: s.id,
                  name: s.name,
                  state: state,
                  logs: serverLogs[s.id] ? serverLogs[s.id].join('') : ''
                };
              });
              const status = await Promise.all(statusPromises);
              res.write(`data: ${JSON.stringify(status)}\n\n`);
            } catch (err) {
              // ignore
            }
          };

          sendUpdate();
          const interval = setInterval(sendUpdate, 2000);

          req.on('close', () => {
            clearInterval(interval);
          });
          return;
        }

        if (req.method === 'POST' && req.url === '/api/backend/upload') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const uploadsDir = path.resolve(__dirname, 'public/uploads');
              if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
              }
              const safeName = Date.now() + '_' + data.filename.replace(/[^a-zA-Z0-9.\-_]/g, '');
              const filePath = path.join(uploadsDir, safeName);
              const buffer = Buffer.from(data.base64, 'base64');
              fs.writeFileSync(filePath, buffer);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ url: `/uploads/${safeName}` }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.toString() }));
            }
          });
          return;
        }

        if (req.method === 'POST' && req.url === '/api/backend/delete') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (!data.url || !data.url.startsWith('/uploads/')) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid URL' }));
                return;
              }
              const filePath = path.join(path.resolve(__dirname, 'public'), data.url);
              const uploadsDir = path.resolve(__dirname, 'public/uploads');
              
              // パストラバーサル対策: ファイルが uploads ディレクトリ内にあるかチェック
              if (!filePath.startsWith(uploadsDir)) {
                res.statusCode = 403;
                res.end(JSON.stringify({ error: 'Forbidden' }));
                return;
              }
              
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.toString() }));
            }
          });
          return;
        }

        if (req.method === 'POST' && req.url === '/api/backend/cleanup') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const activeUrls: string[] = Array.isArray(data.activeUrls) ? data.activeUrls : [];
              const uploadsDir = path.resolve(__dirname, 'public/uploads');
              
              if (!fs.existsSync(uploadsDir)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, deletedCount: 0 }));
                return;
              }

              const files = fs.readdirSync(uploadsDir);
              let deletedCount = 0;

              for (const file of files) {
                const fileUrl = `/uploads/${file}`;
                if (!activeUrls.includes(fileUrl)) {
                  fs.unlinkSync(path.join(uploadsDir, file));
                  deletedCount++;
                }
              }
              
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, deletedCount }));
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.toString() }));
            }
          });
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            const data = JSON.parse(body);
            const serverId = data.id;
            const targetServer = servers.find(s => s.id === serverId);

            if (!targetServer) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Server not found' }));
              return;
            }

            if (req.url === '/api/backend/start') {
              if (runningProcesses[serverId]) {
                res.end(JSON.stringify({ success: true, message: 'Already running' }));
                return;
              }

              console.log(`[Backend Manager] Starting ${targetServer.name}...`);
              serverLogs[serverId] = [];
              const child = spawn(targetServer.command, targetServer.args, {
                cwd: targetServer.cwd,
                detached: false,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
              });

              child.stdout?.on('data', (data) => {
                const text = data.toString();
                serverLogs[serverId].push(text);
                if (serverLogs[serverId].length > 50) serverLogs[serverId].shift();
                process.stdout.write(text);
              });

              child.stderr?.on('data', (data) => {
                const text = data.toString();
                serverLogs[serverId].push(text);
                if (serverLogs[serverId].length > 50) serverLogs[serverId].shift();
                process.stderr.write(text);
              });

              runningProcesses[serverId] = child;

              child.on('exit', () => {
                console.log(`[Backend Manager] ${targetServer.name} stopped.`);
                delete runningProcesses[serverId];
              });

              res.end(JSON.stringify({ success: true }));
              return;
            }

            if (req.url === '/api/backend/stop') {
              const child = runningProcesses[serverId];
              if (child && child.pid) {
                console.log(`[Backend Manager] Stopping ${targetServer.name}...`);
                await killProcessTree(child.pid);
                delete runningProcesses[serverId];
              }
              res.end(JSON.stringify({ success: true }));
              return;
            }

            res.statusCode = 400;
            res.end();
          });
          return;
        }

        next();
      });
    }
  };
}
