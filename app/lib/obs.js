// OBS 원격 제어 (obs-websocket v5, OBS 28 이상에 기본 포함) — '화면 가득 + 설교자 원'용
// 방송 화면에 이미지가 가득 나갈 때만 OBS의 '둥근 카메라'를 켜고, 원 위치·크기를 방송 화면의 구멍에 맞춤.
// 비밀번호는 OBS 설정 파일(global.ini)에서 읽음 → 따로 저장하지 않음. OBS가 꺼져 있으면 5초마다 다시 연결 시도.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const WebSocket = require('ws');

const BUBBLE = '설교자 원 (예배송출)';        // 카메라를 담은 장면 이름 = 방송 장면에 넣는 둥근 카메라 소스 이름
const MASK_FILTER = '원 모양 (예배송출)';
const CIRCLE_M = 4;                          // render.js 의 CIRCLE_M 과 같아야 함 (가장자리 여백, 화면 높이 %)
const CAMERA_KINDS = ['dshow_input', 'av_capture_input', 'v4l2_input', 'ndi_source', 'decklink-input'];

const obsDir = () => process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'obs-studio')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/obs-studio') : path.join(os.homedir(), '.config/obs-studio');
function readConfig() {
  try {
    const ini = fs.readFileSync(path.join(obsDir(), 'global.ini'), 'utf8');
    const sec = (ini.split(/^\[OBSWebSocket\]/m)[1] || '').split(/^\[/m)[0];
    const get = k => ((sec.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '').trim();
    return { enabled: get('ServerEnabled') === 'true', port: +get('ServerPort') || 4455, auth: get('AuthRequired') !== 'false', password: get('ServerPassword') };
  } catch { return null; }
}

let ws = null, connected = false, seq = 0, pending = new Map(), timer = null, getState = null, last = {}, maskPath = '';
const status = { connected: false, bubble: false, scene: '', error: '' };

function request(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || !connected) return reject(new Error('OBS에 연결되지 않음'));
    const requestId = String(++seq);
    const t = setTimeout(() => { pending.delete(requestId); reject(new Error('OBS 응답 없음')); }, 5000);
    pending.set(requestId, { resolve, reject, t });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}

function connect() {
  clearTimeout(timer);
  const cfg = readConfig();
  if (!cfg || !cfg.enabled) { status.error = 'OBS 원격 제어가 꺼져 있음'; return schedule(); }
  const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}`);
  sock.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.op === 0) { // Hello → 인증
      const d = { rpcVersion: 1, eventSubscriptions: 0 };
      const a = m.d.authentication;
      if (a) {
        const secret = crypto.createHash('sha256').update(cfg.password + a.salt).digest('base64');
        d.authentication = crypto.createHash('sha256').update(secret + a.challenge).digest('base64');
      }
      sock.send(JSON.stringify({ op: 1, d }));
    } else if (m.op === 2) { // Identified
      ws = sock; connected = true; status.connected = true; status.error = ''; last = {};
      queued(sync);
    } else if (m.op === 7) {
      const p = pending.get(m.d.requestId); if (!p) return;
      pending.delete(m.d.requestId); clearTimeout(p.t);
      m.d.requestStatus.result ? p.resolve(m.d.responseData || {}) : p.reject(Object.assign(new Error(m.d.requestStatus.comment || 'OBS 오류'), { code: m.d.requestStatus.code }));
    }
  });
  sock.on('close', () => { if (ws === sock) { ws = null; connected = false; status.connected = false; status.bubble = false; } schedule(); });
  sock.on('error', () => {});
}
function schedule() { clearTimeout(timer); timer = setTimeout(connect, 5000); }

// 원 모양 마스크 그림 (화면 크기, 가운데에 높이만큼의 원 — 이 장면을 정사각형으로 잘라 쓰면 꽉 찬 원이 됨)
function makeMask(W, H, file) {
  const r = H / 2, cx = W / 2, cy = H / 2, row = 1 + W * 4, raw = Buffer.alloc(row * H);
  for (let y = 0; y < H; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), a = Math.max(0, Math.min(1, r - d + 0.5));
      const o = y * row + 1 + x * 4; raw[o] = raw[o + 1] = raw[o + 2] = 255; raw[o + 3] = Math.round(a * 255);
    }
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4); len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

async function canvas() { const v = await request('GetVideoSettings'); return { W: v.baseWidth || 1920, H: v.baseHeight || 1080 }; }
async function programScene() { return (await request('GetCurrentProgramScene')).currentProgramSceneName; }
async function findItem(sceneName) {
  const { sceneItems } = await request('GetSceneItemList', { sceneName });
  return sceneItems.find(i => i.sourceName === BUBBLE);
}

// 처음 한 번: OBS에 '설교자 원' 장면(카메라)과 원 모양 필터를 만들고, 지금 방송 장면 맨 위에 둥근 카메라로 넣음
async function setup(dataDir) {
  const scene = await programScene(), { W, H } = await canvas();
  const { scenes } = await request('GetSceneList');
  if (!scenes.some(s => s.sceneName === BUBBLE)) {
    const { sceneItems } = await request('GetSceneItemList', { sceneName: scene });
    const cam = sceneItems.filter(i => CAMERA_KINDS.includes(i.inputKind)).sort((a, b) => b.sceneItemEnabled - a.sceneItemEnabled)[0];
    if (!cam) throw new Error(`'${scene}' 장면에서 카메라를 찾지 못했습니다`);
    await request('CreateScene', { sceneName: BUBBLE });
    await request('CreateSceneItem', { sceneName: BUBBLE, sourceName: cam.sourceName });
  }
  maskPath = path.join(dataDir, `obs-circle-mask-${W}x${H}.png`);
  if (!fs.existsSync(maskPath)) makeMask(W, H, maskPath);
  const { filters } = await request('GetSourceFilterList', { sourceName: BUBBLE });
  const fset = { type: 'mask_alpha_filter.effect', image_path: maskPath.replace(/\\/g, '/') };
  if (!filters.some(f => f.filterName === MASK_FILTER)) await request('CreateSourceFilter', { sourceName: BUBBLE, filterName: MASK_FILTER, filterKind: 'mask_filter_v2', filterSettings: fset });
  let item = await findItem(scene);
  if (!item) {
    const { sceneItemId } = await request('CreateSceneItem', { sceneName: scene, sourceName: BUBBLE, sceneItemEnabled: false });
    const { sceneItems } = await request('GetSceneItemList', { sceneName: scene });
    await request('SetSceneItemIndex', { sceneName: scene, sceneItemId, sceneItemIndex: sceneItems.length - 1 }); // 맨 위
    // 카메라 화면 가운데를 정사각형으로 잘라 씀 (설교자가 가운데에 있다고 보고). OBS에서 자르기를 바꿔도 다시 덮어쓰지 않음
    const side = Math.round((W - H) / 2);
    await request('SetSceneItemTransform', { sceneName: scene, sceneItemId, sceneItemTransform: { cropLeft: side, cropRight: side, cropTop: 0, cropBottom: 0 } });
  }
  last = {};
  await sync();
  return status;
}

// 송출 상태가 바뀔 때마다: 둥근 카메라 켜기/끄기, 원 위치·크기 맞추기
async function sync() {
  if (!connected || !getState) return;
  const { show, size, pos } = getState();
  const scene = await programScene();
  const item = await findItem(scene).catch(() => null);
  status.scene = scene; status.bubble = !!item;
  if (!item) return;
  const geo = `${size}|${pos}`;
  if (last.scene !== scene || last.geo !== geo) {
    const { W, H } = await canvas(), u = H / 100, D = size * u, m = CIRCLE_M * u;
    const t = (await request('GetSceneItemTransform', { sceneName: scene, sceneItemId: item.sceneItemId })).sceneItemTransform;
    const srcW = (t.sourceWidth || W) - (t.cropLeft || 0) - (t.cropRight || 0), srcH = (t.sourceHeight || H) - (t.cropTop || 0) - (t.cropBottom || 0);
    const k = D / Math.max(1, Math.min(srcW, srcH));
    await request('SetSceneItemTransform', { sceneName: scene, sceneItemId: item.sceneItemId, sceneItemTransform: {
      positionX: pos[1] === 'r' ? W - m - D : m, positionY: pos[0] === 'b' ? H - m - D : m, scaleX: k, scaleY: k, rotation: 0, alignment: 5, boundsType: 'OBS_BOUNDS_NONE' } });
    last.geo = geo;
  }
  if (last.scene !== scene || last.show !== show) {
    await request('SetSceneItemEnabled', { sceneName: scene, sceneItemId: item.sceneItemId, sceneItemEnabled: show });
    last.show = show;
  }
  last.scene = scene;
}

// 버튼을 빠르게 여러 번 눌러도 OBS 명령이 섞이지 않게 차례로
let chain = Promise.resolve();
const queued = fn => (chain = chain.then(fn).catch(() => {}));

module.exports = {
  start(fn) { getState = fn; connect(); },
  sync: () => queued(sync),
  setup,
  status: () => ({ ...status, config: (c => c ? { enabled: c.enabled, port: c.port } : null)(readConfig()) }),
};
