// 운영 화면(/control) + 웹 편집기(/editor) 공용 로직
const IS_EDITOR = location.pathname.startsWith('/editor');
const $ = s => document.querySelector(s);
const esc = WC.esc;
const TYPE = { song: '찬양', bible: '말씀', notice: '광고', ppt: 'PPT', score: '악보·PDF', html: 'HTML' };

let S = null;           // 서버 데이터
let snap = null;        // 송출 상태
let selId = null;       // 가운데에 보이는 자료
let search = '';

// ── 공통 ─────────────────────────────────────────
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.error || '오류가 발생했습니다'); throw new Error(j.error); }
  // 내가 바꾼 내용은 실시간 연결 상태와 상관없이 바로 화면에 반영
  if (method !== 'GET' && !url.startsWith('/api/live') && S) { clearTimeout(api._t); api._t = setTimeout(() => reload().catch(() => {}), 120); }
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
const item = id => S.items.find(i => i.id === id);
const service = () => S.services.find(s => s.id === S.currentServiceId);

async function reload() {
  S = await api('GET', '/api/state');
  if (!snap) snap = S.live;
  renderAll();
}

// ── 화면 그리기 ─────────────────────────────────
function renderAll() { renderServices(); renderLib(); renderSlides(); renderLive(); }

function renderServices() {
  const sel = $('#serviceSel');
  sel.innerHTML = S.services.map(s => `<option value="${s.id}" ${s.id === S.currentServiceId ? 'selected' : ''}>${esc(s.date)} ${esc(s.name)}</option>`).join('') || '<option>예배 순서 없음</option>';
  const svc = service();
  const ol = $('#serviceList');
  ol.innerHTML = '';
  (svc?.itemIds || []).forEach((id, i) => {
    const it = item(id); if (!it) return;
    const li = document.createElement('li');
    li.className = (id === selId ? 'sel ' : '') + (snap?.live.itemId === id ? 'live' : '');
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>${it.noBroadcast ? '<span class="badge tv" title="유튜브 방송에는 나가지 않음">TV만</span>' : ''}
      <span class="acts"><button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button><button class="icon" data-a="rm" title="순서에서 빼기">✕</button></span>`;
    li.onclick = e => {
      const a = e.target.dataset.a;
      if (!a) return select(id);
      e.stopPropagation();
      const ids = [...svc.itemIds];
      if (a === 'rm') ids.splice(i, 1);
      if (a === 'up' && i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      if (a === 'down' && i < ids.length - 1) [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
      saveService(ids);
    };
    ol.appendChild(li);
  });
}

// 자료실 분류: 찬양은 가나다순, 나머지는 최근 수정순
const LIB_CATS = [
  { key: 'all', name: '전체', has: () => true },
  { key: 'song', name: '찬양', has: i => i.type === 'song', abc: true },
  { key: 'notice', name: '광고', has: i => i.type === 'notice' },
  { key: 'etc', name: '그 외', has: i => i.type !== 'song' && i.type !== 'notice', title: '말씀·PPT·악보' },
];
let libCat = (() => { try { return localStorage.getItem('wc-libCat') || 'all'; } catch { return 'all'; } })();

function renderLibCats() {
  const box = $('#libCats');
  box.innerHTML = LIB_CATS.map(c => `<button class="${c.key === libCat ? 'on' : ''}" data-cat="${c.key}" title="${c.title || c.name}">${c.name} <span>${S.items.filter(c.has).length}</span></button>`).join('');
  box.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    libCat = b.dataset.cat;
    try { localStorage.setItem('wc-libCat', libCat); } catch {}
    renderLib();
  });
}

function renderLib() {
  renderLibCats();
  const ul = $('#libList');
  ul.innerHTML = '';
  const q = search.trim().toLowerCase();
  const cat = LIB_CATS.find(c => c.key === libCat) || LIB_CATS[0];
  const list = S.items.filter(cat.has).filter(i => !q || i.title.toLowerCase().includes(q) || i.slides.some(s => (s.text || '').toLowerCase().includes(q)))
    .sort(cat.abc ? (a, b) => a.title.localeCompare(b.title, 'ko') : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!list.length) ul.innerHTML = `<li class="muted small" style="cursor:default">${q ? '검색 결과가 없습니다' : `${cat.name} 자료가 없습니다`}</li>`;
  for (const it of list) {
    const li = document.createElement('li');
    li.className = (it.id === selId ? 'sel ' : '') + (snap?.live.itemId === it.id ? 'live' : '');
    li.innerHTML = `<span class="badge">${TYPE[it.type] || ''}</span><span class="t">${esc(it.title)}</span>${it.noBroadcast ? '<span class="badge tv" title="유튜브 방송에는 나가지 않음">TV만</span>' : ''}
      <span class="acts"><button class="icon" data-a="add" title="예배 순서에 추가">＋</button><button class="icon" data-a="del" title="삭제">🗑</button></span>`;
    li.onclick = async e => {
      const a = e.target.dataset.a;
      if (!a) return select(it.id);
      e.stopPropagation();
      if (a === 'add') { if (!service()) await newService(); saveService([...service().itemIds, it.id]); toast('예배 순서에 추가했습니다'); }
      if (a === 'del' && confirm(`'${it.title}' 을(를) 삭제할까요?`)) { await api('DELETE', '/api/items/' + it.id); if (selId === it.id) selId = null; }
    };
    ul.appendChild(li);
  }
}

function renderSlides() {
  const it = item(selId);
  $('#itemTitle').textContent = it ? it.title : '자료를 선택하세요';
  $('#editItem').disabled = !it;
  const grid = $('#slides');
  grid.innerHTML = '';
  if (!it) return;
  it.slides.forEach((s, i) => {
    const d = document.createElement('div');
    const isLive = snap?.live.itemId === it.id && snap.live.index === i;
    d.className = 'slide' + (isLive ? ' live' : '');
    d.innerHTML = `<span class="num">${i + 1}</span><div class="wc-screen"></div>`;
    WC.thumb(d.querySelector('.wc-screen'), s, S.style, it);
    d.onclick = () => IS_EDITOR ? openItemEditor(it.id, i) : goLive({ itemId: it.id, index: i });
    grid.appendChild(d);
  });
  if (!it.slides.length) grid.innerHTML = '<p class="muted">슬라이드가 없습니다. ✎ 편집에서 내용을 넣으세요.</p>';
}

// 글자 크기 바로 조절: 예배당 3~12, 방송 자막 2.5~9 (자막 스타일 창 슬라이더와 같은 범위)
const SIZE_RANGE = { main: [3, 12, 6.2], overlay: [2.5, 9, 4.6] };
let sizePending = null, sizeTimer = null;
function curStyle() { return sizePending || (snap && snap.style) || (S && S.style) || null; }
function bumpSize(grp, dir) {
  if (!curStyle()) return;
  const st = JSON.parse(JSON.stringify(curStyle()));
  const [lo, hi, def] = SIZE_RANGE[grp];
  st[grp].size = Math.round(Math.min(hi, Math.max(lo, (+st[grp].size || def) + dir * 0.3)) * 10) / 10;
  sizePending = st; showSizes();
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(async () => {   // 빠르게 여러 번 눌러도 한 번만 저장
    const send = sizePending;
    try { await api('PUT', '/api/style', send); } finally { if (sizePending === send) sizePending = null; }
  }, 150);
}
function showSizes() {
  const st = curStyle();
  if (!st) return;   // 아직 자료를 못 불러옴
  for (const g of ['main', 'overlay']) {
    const v = +st[g].size || SIZE_RANGE[g][2];
    document.querySelectorAll(`#sz_${g}, [data-szv="${g}"]`).forEach(el => {
      el.textContent = Math.round(v / SIZE_RANGE[g][2] * 100) + '%';
      el.title = `글자 크기 ${v} (기본 ${SIZE_RANGE[g][2]})`;
    });
  }
}

// 방송 자막 카드의 바로 조절 메뉴 (방송에 이미지·크기·위치 등) — 바꾸면 곧바로 저장·송출
function setOverlay(key, val) {
  if (!curStyle()) return;
  const st = JSON.parse(JSON.stringify(curStyle()));
  st.overlay[key] = val;
  sizePending = st; showOverlayQuick();
  if (snap) { snap = { ...snap, style: st }; WC.render($('#pvOverlay'), snap, 'overlay'); }
  clearTimeout(sizeTimer);
  sizeTimer = setTimeout(async () => {
    const send = sizePending;
    try { await api('PUT', '/api/style', send); } finally { if (sizePending === send) sizePending = null; }
  }, 200);
}
const OV_DEF = { media: 'none', pipSize: 30, pipPos: 'tr', position: 'bottom', boxOpacity: 0.72, showTitle: false };
function showOverlayQuick() {
  const st = curStyle(), box = document.querySelector('.ovq');
  if (!st || !box) return;
  const o = st.overlay || {};
  box.querySelectorAll('[data-ov]').forEach(el => {
    const k = el.dataset.ov, v = o[k] ?? OV_DEF[k];
    if (el === document.activeElement && el.type === 'range') return;   // 끄는 중에는 건드리지 않음
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  box.querySelectorAll('[data-ovv]').forEach(el => {
    const v = +(o[el.dataset.ovv] ?? OV_DEF[el.dataset.ovv]);
    el.textContent = el.dataset.ovv === 'boxOpacity' ? Math.round(v * 100) + '%' : v + '%';
  });
  box.classList.toggle('no-pip', (o.media || 'none') !== 'pip');
}
document.querySelectorAll('.ovq [data-ov]').forEach(el => el.addEventListener(el.type === 'range' ? 'input' : 'change', () =>
  setOverlay(el.dataset.ov, el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value)));

function renderLive() {
  showSizes();
  showOverlayQuick();
  if (IS_EDITOR || !snap) return;
  markMediaLive();
  WC.render($('#pvMain'), snap, 'main');
  WC.render($('#pvOverlay'), snap, 'overlay');
  const L = snap.live;
  for (const k of ['black', 'clear', 'logo', 'overlayOff']) $('#' + k).classList.toggle('on', !!L[k]);
  const ovOff = L.overlayOff || snap.item?.noBroadcast;
  $('#ovState').classList.toggle('hidden', !ovOff);
  $('#ovState').textContent = L.overlayOff ? '꺼짐 — 예배당 화면에만 나가는 중' : '이 자료는 방송에 내보내지 않음';
  $('#overlayOff').innerHTML = (L.overlayOff ? '🎥 방송 자막 다시 켜기' : '🎥 방송 자막 끄기') + ' <kbd>O</kbd>';
  $('#liveInfo').textContent = snap.item ? `· ${snap.item.title} ${L.index + 1}/${snap.item.count}` : '· 대기';
  $('#pvNext').textContent = snap.next ? snap.next.text : (snap.item ? '— 마지막 슬라이드 —' : '');
}

function select(id) { selId = id; renderServices(); renderLib(); renderSlides(); }

// ── 송출 ─────────────────────────────────────────
async function goLive(b) { if (!IS_EDITOR) snap = await api('POST', '/api/live', b); }

function connectWS() {
  const ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onopen = () => { if (S) reload().catch(() => {}); };  // 끊겼다 다시 연결되면 놓친 변경 반영
  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.type === 'live') {
      const changedItem = snap?.live.itemId !== m.live.itemId;
      snap = m;
      renderLive();
      if (S) { renderSlides(); if (changedItem) { renderServices(); renderLib(); } }
    }
    if (m.type === 'data') reload().catch(() => {});
    if (m.type === 'quit') {
      window._wcQuitting = true;
      closeOpenedWins();
      document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출이 종료되었습니다.</div>';
      setTimeout(() => window.close(), 800);   // 다른 곳에서 꺼도 이 운영 화면 창까지 닫힘
    }
  };
  ws.onclose = () => { if (!window._wcQuitting) setTimeout(connectWS, 1000); };
}

// ── 예배 순서 ───────────────────────────────────
async function saveService(ids) { await api('PUT', '/api/services/' + S.currentServiceId, { itemIds: ids }); }
async function newService() {
  const name = prompt('예배 이름', '주일 예배'); if (!name) return;
  const date = prompt('날짜 (YYYY-MM-DD)', new Date().toISOString().slice(0, 10)) || '';
  const s = await api('POST', '/api/services', { name, date });
  S.services.push(s); S.currentServiceId = s.id;
}

// ── 대화상자 ─────────────────────────────────────
const dlg = $('#dlg');
function openDlg(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); return $('#dlgBody'); }
function closeDlg() { dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });

// 자료 편집기
// HTML 파일 안의 슬라이드 수 세기: 숨긴 샌드박스 창에 열어 도우미 스크립트가 알려 주는 값을 받음
function countHtmlSlides(url) {
  return new Promise(resolve => {
    const f = document.createElement('iframe');
    f.sandbox = 'allow-scripts';
    f.style.cssText = 'position:fixed;left:-30000px;top:0;width:1920px;height:1080px;border:0;visibility:hidden';
    let done = false;
    const finish = r => { if (done) return; done = true; removeEventListener('message', onMsg); f.remove(); resolve(r); };
    const onMsg = e => { if (e.source === f.contentWindow && e.data?.wc === 'count') finish({ n: e.data.n, texts: (e.data.texts || []).map(String) }); };
    addEventListener('message', onMsg);
    setTimeout(() => finish({ n: 1, texts: [''] }), 10000);
    f.src = url + '#wc=count';
    document.body.append(f);
  });
}

function openItemEditor(id, focusIndex) {
  const src = id ? item(id) : null;
  const it = src ? JSON.parse(JSON.stringify(src)) : { type: 'song', title: '새 찬양', slides: [] };
  const body = openDlg(`
    <div class="dlg-head"><h3>${src ? '자료 편집' : '새 자료'}</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>제목</label><div class="row" style="margin:0"><input id="eTitle" class="grow" value="${esc(it.title)}">
        <button class="btn sm primary" id="eLyrGet" title="제목으로 가사를 찾아 아래 '가사 붙여넣기' 칸에 채움 (인터넷 필요)">🎵 가사 가져오기</button>
        <button class="btn sm" data-lyr="google" title="제목으로 가사를 웹에서 찾기 (새 창)">🔍 구글</button><button class="btn sm" data-lyr="naver" title="제목으로 가사를 웹에서 찾기 (새 창)">🔍 네이버</button></div>
      <div></div><div id="eLyrBox" hidden><div class="muted small" id="eLyrMsg"></div>
        <ul class="list" id="eLyrList" style="max-height:160px;overflow:auto;margin-top:4px"></ul></div>
      <label>종류</label><select id="eType">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${k === it.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="nobc-row">방송(OBS)</label><label class="row nobc-row" style="margin:0;color:inherit"><input type="checkbox" id="eNoBc" ${it.noBroadcast ? 'checked' : ''}> 유튜브 방송에는 내보내지 않기 <span class="muted small">(기도 제목·광고 등, 예배당 화면에만)</span></label>
      <label>가사 붙여넣기</label>
      <div><textarea id="ePaste" rows="5" placeholder="가사를 붙여넣으세요. 빈 줄에서는 반드시 나뉩니다."></textarea>
        <div class="row" style="margin-top:6px"><select id="eLines" style="width:auto">${[1, 2, 3, 4, 5, 6].map(n => `<option ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <span class="muted">줄씩</span><button class="btn sm" id="eSplit">나누어 슬라이드 만들기 (덮어쓰기)</button><button class="btn sm" id="eAppend">뒤에 추가</button></div></div>
      <label>모든 슬라이드 배경</label><div class="row"><button class="btn sm" id="eBgAll">배경 선택</button><button class="btn sm" id="eBgNone">배경 없애기</button></div>
    </div>
    <div id="eSlides"></div>
    <div class="row"><button class="btn sm" id="eAdd">＋ 빈 슬라이드</button></div>
    <div class="dlg-foot">${src ? '<button class="btn danger" id="eDel">삭제</button><div class="grow"></div>' : ''}<button class="btn" data-x>취소</button><button class="btn primary" id="eSave">저장</button></div>`);

  const list = body.querySelector('#eSlides');
  function draw() {
    list.innerHTML = '';
    it.slides.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'slide-edit';
      const elEdit = (s.elements || []).map((e, j) => e.type === 'text'
        ? `<div class="el-edit"><span class="muted small">글자 ${j + 1}</span><textarea data-el="${j}" rows="${Math.min(6, (e.text.match(/\n/g) || []).length + 1)}">${esc(e.text)}</textarea></div>`
        : e.type === 'image' ? `<div class="el-edit"><span class="muted small">그림</span><div class="row"><button class="btn sm" data-img="${j}">그림 바꾸기</button><button class="btn sm" data-imgdel="${j}">그림 삭제</button></div></div>`
        : e.type === 'table' ? `<div class="el-edit"><span class="muted small">표</span><textarea data-tbl="${j}" rows="3" title="칸은 | 로, 줄은 줄바꿈으로">${esc(e.rows.map(r => r.join(' | ')).join('\n'))}</textarea></div>` : '').join('');
      row.innerHTML = `<div class="wc-screen" style="border-radius:6px"></div>
        <div>${s.html ? `<div class="muted small" style="margin-bottom:4px">HTML 슬라이드 ${(+s.page || 0) + 1}번 · 아래 글은 프롬프터(설교자 화면)에만 보입니다</div>` : ''}${s.elements?.length ? elEdit : `<textarea data-text rows="4">${esc(s.text)}</textarea>`}
          ${it.type === 'bible' ? `<input data-ref placeholder="구절 표시 (예: 요한복음 3:16)" value="${esc(s.ref || '')}" style="margin-top:6px">` : ''}</div>
        <div class="tools">
          <button class="icon" data-a="up" title="위로">↑</button><button class="icon" data-a="down" title="아래로">↓</button>
          ${s.elements?.length || s.html ? '' : '<button class="icon" data-a="split" title="커서 위치에서 나누기">✂</button>'}
          <button class="icon" data-a="merge" title="다음 슬라이드와 합치기">⇣</button>
          <button class="icon" data-a="bg" title="배경">🖼</button>
          <button class="icon" data-a="rm" title="삭제">🗑</button></div>`;
      const pv = row.querySelector('.wc-screen');
      const repaint = () => { pv._wcHTML = null; WC.thumb(pv, s, S.style, it); };
      repaint();
      row.querySelector('[data-text]')?.addEventListener('input', e => { s.text = e.target.value; repaint(); });
      row.querySelector('[data-ref]')?.addEventListener('input', e => { s.ref = e.target.value; repaint(); });
      row.querySelectorAll('[data-el]').forEach(t => t.addEventListener('input', e => {
        s.elements[+t.dataset.el].text = e.target.value;
        s.text = s.elements.filter(x => x.type === 'text').map(x => x.text).join('\n');
        repaint();
      }));
      row.querySelectorAll('[data-tbl]').forEach(t => t.addEventListener('input', e => {
        s.elements[+t.dataset.tbl].rows = e.target.value.split('\n').map(l => l.split('|').map(c => c.trim())); repaint();
      }));
      row.querySelectorAll('[data-img]').forEach(b => b.onclick = () => pickMedia(url => { s.elements[+b.dataset.img].src = url; repaint(); }, () => openItemEditorResume()));
      row.querySelectorAll('[data-imgdel]').forEach(b => b.onclick = () => { s.elements.splice(+b.dataset.imgdel, 1); draw(); });
      row.querySelector('.tools').onclick = e => {
        const a = e.target.dataset.a; if (!a) return;
        const sl = it.slides;
        if (a === 'up' && i > 0) [sl[i - 1], sl[i]] = [sl[i], sl[i - 1]];
        if (a === 'down' && i < sl.length - 1) [sl[i + 1], sl[i]] = [sl[i], sl[i + 1]];
        if (a === 'rm') sl.splice(i, 1);
        if (a === 'split') {
          const ta = row.querySelector('[data-text]'); const p = ta.selectionStart;
          const before = s.text.slice(0, p).replace(/\n+$/, ''), after = s.text.slice(p).replace(/^\n+/, '');
          if (!before || !after) return toast('나눌 위치에 커서를 두세요');
          s.text = before; sl.splice(i + 1, 0, { ...s, id: undefined, text: after });
        }
        if (a === 'merge' && i < sl.length - 1) {
          const n = sl[i + 1];
          if (s.elements?.length || n.elements?.length) s.elements = [...(s.elements || []), ...(n.elements || [])];
          s.text = [s.text, n.text].filter(Boolean).join('\n'); sl.splice(i + 1, 1);
        }
        if (a === 'bg') return pickMedia(url => { s.bg = url; }, openItemEditorResume);
        draw();
      };
      list.appendChild(row);
    });
    if (focusIndex != null) { list.children[focusIndex]?.scrollIntoView({ block: 'center' }); focusIndex = null; }
  }
  // 미디어 고르기 뒤 다시 이 편집기로 돌아오기
  function openItemEditorResume() { dlg.showModal(); $('#dlgBody').replaceChildren(...saved); draw(); }
  let saved;
  const pickMedia = (onPick, back) => { saved = [...$('#dlgBody').childNodes]; openMediaPicker(url => { onPick(url); back(); }, back); };

  body.querySelector('#eTitle').oninput = e => (it.title = e.target.value);
  // 가사 검색: 새 창에서 "제목 가사" 검색 → 복사해서 아래 '가사 붙여넣기'에 붙여넣기
  const LYRIC_SEARCH = {
    google: q => 'https://www.google.com/search?q=' + encodeURIComponent(q),
    naver: q => 'https://search.naver.com/search.naver?query=' + encodeURIComponent(q),
  };
  body.querySelectorAll('[data-lyr]').forEach(b => b.onclick = () => {
    const title = body.querySelector('#eTitle').value.trim();
    if (!title || title === '새 찬양') { alert('먼저 곡 제목을 입력하세요.'); body.querySelector('#eTitle').focus(); return; }
    window.open(LYRIC_SEARCH[b.dataset.lyr](`${title} 가사`), 'wc-lyrics', 'width=1100,height=850,noopener');
    body.querySelector('#ePaste').focus();
  });
  // 가사 가져오기: 제목으로 검색 → 가사 있는 음원을 차례로 찾아 '가사 붙여넣기' 칸에 채움. 목록에서 다른 음원 선택 가능
  const lyrBox = body.querySelector('#eLyrBox'), lyrMsg = body.querySelector('#eLyrMsg'), lyrList = body.querySelector('#eLyrList');
  const lyrCache = {};
  const loadLyrics = async (r, li) => {
    lyrList.querySelectorAll('li').forEach(x => x.classList.toggle('sel', x === li));
    lyrMsg.textContent = `'${r.title} — ${r.artist}' 가사를 가져오는 중…`;
    const res = lyrCache[r.id] || await api('GET', '/api/lyrics/' + r.id).catch(e => ({ error: e.message || '가져오기 실패' }));
    if (res.error) { lyrMsg.textContent = res.error; return false; }
    lyrCache[r.id] = res;
    if (!res.lyrics) { li?.querySelector('.muted')?.append(' · 가사 없음'); lyrMsg.textContent = `'${r.artist}' 음원에는 가사가 없습니다. 다른 음원을 고르세요.`; return false; }
    body.querySelector('#ePaste').value = res.lyrics;
    lyrMsg.textContent = `✓ ${res.title} — ${res.artist} 가사를 채웠습니다. 확인·수정 후 '나누어 슬라이드 만들기'를 누르세요. (출처: 벅스)`;
    return true;
  };
  body.querySelector('#eLyrGet').onclick = async () => {
    const title = body.querySelector('#eTitle').value.trim();
    if (!title || title === '새 찬양') { alert('먼저 곡 제목을 입력하세요. (가수 이름을 같이 쓰면 더 정확합니다)'); body.querySelector('#eTitle').focus(); return; }
    lyrBox.hidden = false; lyrList.innerHTML = ''; lyrMsg.textContent = `'${title}' 검색 중…`;
    let results;
    try { results = await api('GET', '/api/lyrics/search?q=' + encodeURIComponent(title)); } catch (e) { lyrMsg.textContent = e.message || '검색 실패'; return; }
    if (!results.length) { lyrMsg.textContent = '검색 결과가 없습니다. 제목을 바꾸거나 구글·네이버로 찾아보세요.'; return; }
    const lis = results.map(r => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="t">${esc(r.title)} <span class="muted small">${esc(r.artist)}</span></span>`;
      li.onclick = () => loadLyrics(r, li);
      lyrList.append(li);
      return li;
    });
    // 반주·연주 음원은 가사가 없으므로 가사 있는 음원이 나올 때까지 최대 6개 확인
    for (let i = 0; i < Math.min(6, results.length); i++) if (await loadLyrics(results[i], lis[i])) return;
    lyrMsg.textContent = '앞쪽 음원들에 가사가 없습니다. 목록에서 다른 음원을 누르거나, 제목에 가수 이름을 더해 다시 찾아보세요.';
  };
  body.querySelector('#eType').onchange = e => { it.type = e.target.value; draw(); };
  body.querySelector('#eNoBc').onchange = e => { it.noBroadcast = e.target.checked; };
  // 찬양은 늘 방송에도 나가므로 '방송(OBS)' 선택을 숨김 (광고·말씀 등에서만 보임)
  const syncNoBc = () => {
    const song = body.querySelector('#eType').value === 'song';
    body.querySelectorAll('.nobc-row').forEach(el => (el.hidden = song));
    if (song) { it.noBroadcast = false; body.querySelector('#eNoBc').checked = false; }
  };
  body.querySelector('#eType').addEventListener('change', syncNoBc);
  syncNoBc();
  const doSplit = async append => {
    const slides = await api('POST', '/api/split', { text: body.querySelector('#ePaste').value, lines: body.querySelector('#eLines').value });
    const bg = it.slides[0]?.bg; if (bg) slides.forEach(s => (s.bg = bg));
    it.slides = append ? [...it.slides, ...slides] : slides;
    body.querySelector('#ePaste').value = ''; draw();
  };
  body.querySelector('#eSplit').onclick = () => doSplit(false);
  body.querySelector('#eAppend').onclick = () => doSplit(true);
  body.querySelector('#eAdd').onclick = () => { it.slides.push({ text: '' }); draw(); };
  body.querySelector('#eBgAll').onclick = () => pickMedia(url => it.slides.forEach(s => (s.bg = url)), openItemEditorResume);
  body.querySelector('#eBgNone').onclick = () => { it.slides.forEach(s => delete s.bg); draw(); };
  body.querySelector('#eDel')?.addEventListener('click', async () => {
    if (!confirm('이 자료를 삭제할까요?')) return;
    await api('DELETE', '/api/items/' + id); selId = null; closeDlg();
  });
  body.querySelector('#eSave').onclick = async () => {
    const saved = src ? await api('PUT', '/api/items/' + id, it) : await api('POST', '/api/items', it);
    selId = saved.id; closeDlg(); toast('저장했습니다');
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  draw();
}

// 성경
function openBible() {
  const body = openDlg(`
    <div class="dlg-head"><h3>성경 구절 불러오기</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>구절</label><input id="bQ" placeholder="예: 요 3:16, 시 23:1-6, 롬 8장" autofocus>
      <label>번역본</label><select id="bV">${S.bibleVersions.map(v => `<option ${v === S.bibleDefault ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <label>함께 보일 번역본</label><select id="bV2"><option value="">없음</option>${S.bibleVersions.map(v => `<option>${esc(v)}</option>`).join('')}</select>
      <label>슬라이드당 절 수</label><select id="bN"><option>1</option><option>2</option><option>3</option></select>
    </div>
    <p class="muted small">성경 본문은 ⚙︎ 설정 → 성경 폴더 또는 성경 텍스트 가져오기로 연결합니다.</p>
    <div id="bOut" class="verse-list muted">구절을 입력하고 Enter</div>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button><button class="btn primary" id="bMake" disabled>슬라이드 만들기</button></div>`);
  let res = null, res2 = null;
  const q = body.querySelector('#bQ');
  const run = async () => {
    const get = v => api('GET', `/api/bible?q=${encodeURIComponent(q.value)}&v=${encodeURIComponent(v)}`);
    const v2 = body.querySelector('#bV2').value;
    res = await get(body.querySelector('#bV').value);
    res2 = v2 && !res.error ? await get(v2) : null;
    const out = body.querySelector('#bOut');
    out.dir = 'auto';
    if (res.error) { out.textContent = res.error; body.querySelector('#bMake').disabled = true; return; }
    const v2map = Object.fromEntries((res2 && !res2.error ? res2.verses : []).map(v => [v.v, v.text]));
    out.textContent = `${res.title} (${res.version}${res2 && !res2.error ? ' + ' + res2.version : ''})\n\n` +
      res.verses.map(v => `${v.v} ${v.text}` + (v2map[v.v] ? `\n   ${v2map[v.v]}` : '')).join('\n');
    if (res2?.error) out.textContent += `\n\n※ ${res2.error}`;
    body.querySelector('#bMake').disabled = false;
  };
  q.onkeydown = e => { if (e.key === 'Enter') run(); };
  q.onchange = run;
  body.querySelector('#bV').onchange = run;
  body.querySelector('#bV2').onchange = run;
  body.querySelector('#bMake').onclick = async () => {
    const n = +body.querySelector('#bN').value, slides = [];
    for (let i = 0; i < res.verses.length; i += n) {
      const g = res.verses.slice(i, i + n);
      const r = g.length > 1 ? `${g[0].v}-${g[g.length - 1].v}` : g[0].v;
      const v2map = Object.fromEntries((res2 && !res2.error ? res2.verses : []).map(v => [v.v, v.text]));
      const line = (v, t) => (n > 1 ? `${v.v} ` : '') + t;
      let text = g.map(v => line(v, v.text)).join('\n');
      const t2 = g.filter(v => v2map[v.v]).map(v => line(v, v2map[v.v])).join('\n');
      if (t2) text += '\n\n' + t2;
      slides.push({ text, ref: `${res.book} ${res.ch}:${r} (${res.version}${t2 ? ' · ' + res2.version : ''})` });
    }
    const it = await api('POST', '/api/items', { type: 'bible', title: `${res.title} ${res.version}`, slides });
    if (service()) await saveService([...service().itemIds, it.id]);
    selId = it.id; closeDlg(); toast('말씀 슬라이드를 만들고 예배 순서에 넣었습니다');
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  setTimeout(() => q.focus(), 50);
}

// PDF·악보: 브라우저에서 PDF 페이지/사진을 이미지로 만들어 슬라이드로
let pdfjsLib = null;
async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return pdfjsLib;
}
const canvasBlob = c => new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
async function loadImageCanvas(file) {
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0); return c;
}
// 한 페이지를 위→아래 n칸으로 자르기 (겹침 4%로 줄 끊김 방지)
function sliceCanvas(c, n) {
  if (n <= 1) return [c];
  const out = [], h = c.height / n, ov = n > 1 ? c.height * 0.04 : 0;
  for (let i = 0; i < n; i++) {
    const y0 = Math.max(0, i * h - ov), y1 = Math.min(c.height, (i + 1) * h + ov);
    const p = document.createElement('canvas'); p.width = c.width; p.height = y1 - y0;
    p.getContext('2d').drawImage(c, 0, y0, c.width, y1 - y0, 0, 0, c.width, y1 - y0);
    out.push(p);
  }
  return out;
}
// 흰 여백 자동 잘라내기
function trimCanvas(c) {
  const ctx = c.getContext('2d'), { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  let top = h, bottom = 0, left = w, right = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4;
    if (d[i] < 225 || d[i + 1] < 225 || d[i + 2] < 225) { if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x; }
  }
  if (bottom <= top || right <= left) return c;
  const pad = Math.round(Math.min(w, h) * 0.02);
  top = Math.max(0, top - pad); left = Math.max(0, left - pad); bottom = Math.min(h, bottom + pad); right = Math.min(w, right + pad);
  const o = document.createElement('canvas'); o.width = right - left; o.height = bottom - top;
  o.getContext('2d').drawImage(c, left, top, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

function openScore() {
  const body = openDlg(`
    <div class="dlg-head"><h3>PDF·악보 가져오기</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>파일</label><input type="file" id="scFiles" multiple accept="application/pdf,image/*">
      <label>제목</label><input id="scTitle" placeholder="비우면 파일 이름">
      <label>한 페이지 나누기</label><select id="scSplit"><option value="1">나누지 않음 (PDF 문서·주보)</option><option value="2" selected>위·아래 2칸 (악보 권장)</option><option value="3">3칸</option><option value="4">4칸</option></select>
      <label>흰 여백 잘라내기</label><input type="checkbox" id="scTrim" checked>
      <label>배경색</label><div class="row"><select id="scBg" style="width:auto"><option value="#ffffff">흰색 (악보)</option><option value="#000000">검정</option></select></div>
    </div>
    <p class="muted small">PDF는 페이지마다, 사진(jpg·png)은 장마다 슬라이드가 됩니다. 악보는 화면 비율(16:9)에 맞게 위·아래로 나누면 TV에서 훨씬 크게 보입니다.
    악보 슬라이드는 기본으로 예배당 화면에만 나갑니다. 방송(OBS)에도 보내려면 🎨 자막 스타일 → '방송에 이미지'를 바꾸세요.</p>
    <div id="scProg" class="muted"></div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="scGo">가져오기</button></div>`);
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#scGo').onclick = async () => {
    const files = [...body.querySelector('#scFiles').files];
    if (!files.length) return toast('파일을 고르세요');
    const n = +body.querySelector('#scSplit').value, trim = body.querySelector('#scTrim').checked, bgColor = body.querySelector('#scBg').value;
    const prog = body.querySelector('#scProg'), go = body.querySelector('#scGo'); go.disabled = true;
    const pages = []; // { canvas, name }
    try {
      for (const f of files) {
        const base = f.name.replace(/\.[^.]+$/, '');
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          const lib = await loadPdfjs();
          const pdf = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let p = 1; p <= pdf.numPages; p++) {
            prog.textContent = `${f.name}: ${p}/${pdf.numPages} 페이지 변환 중…`;
            const page = await pdf.getPage(p);
            const v1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(4, 2400 / Math.max(v1.width, v1.height)) }); // 긴 변 약 2400px
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            pages.push({ canvas: c, name: `${base}_p${p}` });
          }
        } else pages.push({ canvas: await loadImageCanvas(f), name: base });
      }
      const slides = [];
      let k = 0;
      for (const pg of pages) {
        const parts = sliceCanvas(trim ? trimCanvas(pg.canvas) : pg.canvas, n).map(c => trim ? trimCanvas(c) : c);
        const fd = new FormData();
        for (let i = 0; i < parts.length; i++) fd.append('files', await canvasBlob(parts[i]), `${pg.name}${parts.length > 1 ? '_' + (i + 1) : ''}.jpg`);
        prog.textContent = `올리는 중… ${++k}/${pages.length}`;
        const up = await api('POST', '/api/media', fd);
        up.forEach(u => slides.push({ text: '', bg: u.url, fit: 'contain', bgColor }));
      }
      const title = body.querySelector('#scTitle').value || files[0].name.replace(/\.[^.]+$/, '');
      const it = await api('POST', '/api/items', { type: 'score', title, slides });
      if (service()) await saveService([...service().itemIds, it.id]);
      selId = it.id; closeDlg(); toast(`슬라이드 ${slides.length}장을 만들었습니다`);
    } catch (e) { console.error(e); prog.textContent = '가져오기 실패: ' + e.message; go.disabled = false; }
  };
}

// 미디어
async function openMediaPicker(onPick, onCancel) {
  const files = await api('GET', '/api/media');
  const body = openDlg(`
    <div class="dlg-head"><h3>${onPick ? '배경·그림 선택' : '미디어 관리'}</h3><button class="icon" data-x>✕</button></div>
    <div class="row"><label class="btn primary">＋ 사진·영상 올리기<input type="file" id="mUp" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,video/*,audio/*" hidden></label>
      <span class="muted small">jpg·png·mp4·mov·webm 등. 영상 배경은 소리 없이 반복 재생됩니다.</span></div>
    <div class="media-grid">${files.map(f => `<div class="m" data-url="${esc(f.url)}">
      ${/\.(mp4|mov|m4v|webm)$/i.test(f.url) ? `<video src="${esc(f.url)}" muted preload="metadata"></video>` : /\.(mp3|m4a|wav|aac)$/i.test(f.url) ? '<div style="aspect-ratio:16/9;display:grid;place-items:center;font-size:28px">🎵</div>' : `<img src="${esc(f.url)}" loading="lazy">`}
      <div class="n">${esc(f.name)}</div>${onPick ? '' : `<button class="icon" data-del="${esc(f.name)}" title="삭제">🗑</button>`}</div>`).join('') || '<p class="muted">아직 올린 파일이 없습니다.</p>'}</div>
    <div class="dlg-foot"><button class="btn" data-x>${onPick ? '취소' : '닫기'}</button></div>`);
  body.querySelector('#mUp').onchange = async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('files', f));
    toast('올리는 중…'); await api('POST', '/api/media', fd); loadMediaBin().catch(() => {}); openMediaPicker(onPick, onCancel);
  };
  body.querySelectorAll('.m').forEach(m => m.onclick = async e => {
    if (e.target.dataset.del) { if (confirm('삭제할까요?')) { await api('DELETE', '/api/media/' + encodeURIComponent(e.target.dataset.del)); loadMediaBin().catch(() => {}); openMediaPicker(onPick, onCancel); } return; }
    if (onPick) onPick(m.dataset.url);
  });
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = () => onCancel ? onCancel() : closeDlg()));
}

// ── 미디어 칸 (아래쪽): 누르면 예배당 화면 배경으로 계속 나옴 ──────────
const isVid = u => /\.(mp4|mov|m4v|webm)$/i.test(u);
let mbFiles = [], mbFilter = 'all';
const fitMem = () => { try { return JSON.parse(localStorage.getItem('wc-mb-fit') || '{}') || {}; } catch (e) { return {}; } };
async function loadMediaBin() {
  if (IS_EDITOR) return;
  mbFiles = (await api('GET', '/api/media')).filter(f => !/\.(mp3|m4a|wav|aac)$/i.test(f.url));
  renderMediaBin();
}
function renderMediaBin() {
  const grid = $('#mbGrid'); if (!grid) return;
  const list = mbFiles.filter(f => mbFilter === 'all' || (mbFilter === 'video') === isVid(f.url));
  grid.innerHTML = list.map((f, i) => `<div class="mb-item" data-url="${esc(f.url)}" title="${esc(f.name)}">
      <div class="mb-th">${isVid(f.url) ? `<video src="${esc(f.url)}#t=0.5" muted loop playsinline preload="metadata"></video><span class="mb-dur">영상</span>` : `<img class="fit" src="${esc(f.url)}" loading="lazy">`}<span class="mb-tag">LIVE</span><button class="mb-del" data-del="${esc(f.name)}" title="이 파일 삭제">🗑</button></div>
      <div class="mb-name"><span>${i + 1}</span><span class="t">${esc(f.name)}</span>${isVid(f.url) ? '<span title="반복 재생">🔁</span>' : ''}</div>
    </div>`).join('') || '<div class="mbin-empty">사진·영상을 ＋ 올리기로 넣으면 여기에 나옵니다.</div>';
  grid.querySelectorAll('.mb-item').forEach(el => {
    const v = el.querySelector('video');
    if (v) {
      v.addEventListener('loadedmetadata', () => {
        const s = Math.round(v.duration || 0);
        el.querySelector('.mb-dur').textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      });
      el.addEventListener('mouseenter', () => v.play().catch(() => {}));   // 마우스를 올리면 미리 재생
      el.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0.5; });
    }
    el.querySelector('.mb-del').onclick = e => { e.stopPropagation(); deleteMedia(el.dataset.url, e.currentTarget.dataset.del); };
    el.onclick = () => goLive({ mediaBg: el.dataset.url, mediaFit: fitMem()[el.dataset.url] || 'auto' }).then(() => toast('예배당 화면 배경으로 내보냈습니다')).catch(() => {});
  });
  markMediaLive();
}
// 미디어 파일 삭제: 슬라이드에서 쓰는 중이면 몇 곳에서 쓰는지 알려 주고, 송출 중인 배경이면 먼저 끔
async function deleteMedia(url, name) {
  const used = (S?.items || []).filter(it => (it.slides || []).some(s => s.bg === url || (s.elements || []).some(e => e.src === url)));
  const isLive = snap?.live?.mediaBg === url;
  let msg = `'${name}' 파일을 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`;
  if (snap?.logo === url) msg += '\n\n※ 설정에서 로고로 쓰고 있는 파일입니다. 삭제하면 로고(L)가 안 나옵니다.';
  if (isLive) msg += '\n\n※ 지금 예배당 화면 배경으로 나가는 중입니다. 배경을 끄고 삭제합니다.';
  if (used.length) msg += `\n\n※ 이 파일을 쓰는 자료가 ${used.length}개 있습니다 (${used.slice(0, 3).map(i => i.title).join(', ')}${used.length > 3 ? ' 등' : ''}).\n삭제하면 그 슬라이드에서는 그림이 안 나옵니다.`;
  if (!confirm(msg)) return;
  if (isLive) await goLive({ mediaBg: null }).catch(() => {});
  await api('DELETE', '/api/media/' + encodeURIComponent(name));
  await loadMediaBin();
  toast('삭제했습니다');
}
function markMediaLive() {
  const cur = snap?.live?.mediaBg || null;
  document.querySelectorAll('#mbGrid .mb-item').forEach(el => el.classList.toggle('live', el.dataset.url === cur));
  const lab = $('#mbLive'); if (!lab) return;
  lab.classList.toggle('on', !!cur);
  lab.textContent = cur ? '● 배경: ' + decodeURIComponent(cur.split('/').pop()) : '배경 없음';
  $('#mbOff').disabled = !cur;
  const obs = !!snap?.live?.mediaObs;
  $('#mbObs').classList.toggle('on', obs);
  $('#mbObs').textContent = obs ? '🎥 방송에도 나가는 중' : '🎥 방송에도';
  $('#ovMediaObs').checked = obs;
  $('#mbFit').value = snap?.live?.mediaFit || 'auto';
}
function initMediaBin() {
  if (IS_EDITOR) return;
  $('#mbFilter').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    mbFilter = b.dataset.f;
    $('#mbFilter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderMediaBin();
  };
  const size = $('#mbSize');
  try { size.value = localStorage.getItem('wc-mb-size') || size.value; } catch (e) {}
  const applySize = () => { $('.mbin').style.setProperty('--mb', size.value + 'px'); try { localStorage.setItem('wc-mb-size', size.value); } catch (e) {} };
  size.oninput = applySize; applySize();
  $('#mbUp').onchange = async e => {
    const fd = new FormData(); [...e.target.files].forEach(f => fd.append('files', f));
    e.target.value = '';
    toast('올리는 중…'); await api('POST', '/api/media', fd); await loadMediaBin(); toast('올렸습니다');
  };
  $('#mbOff').onclick = () => goLive({ mediaBg: null });
  // 미디어 배경을 방송(OBS)에도 — 미디어 칸 버튼과 방송 자막 카드 체크박스가 같은 설정
  $('#mbObs').onclick = () => goLive({ mediaObs: !snap?.live?.mediaObs }).catch(() => {});
  // 맞춤은 파일마다 기억 (로고는 '작게', 영상은 '자동' 처럼) — 이 컴퓨터에 저장
  $('#mbFit').onchange = e => {
    const cur = snap?.live?.mediaBg;
    if (cur) { const m = fitMem(); m[cur] = e.target.value; try { localStorage.setItem('wc-mb-fit', JSON.stringify(m)); } catch (err) {} }
    goLive({ mediaFit: e.target.value }).catch(() => {});
  };
  $('#ovMediaObs').onchange = e => goLive({ mediaObs: e.target.checked }).catch(() => {});
  loadMediaBin().catch(() => {});
}

// 스타일
function openStyle() {
  const st = JSON.parse(JSON.stringify(S.style));
  const fonts = [["'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif", '본고딕 (Noto Sans KR)'], ["'Apple SD Gothic Neo', sans-serif", '애플 SD 고딕'], ["'Nanum Myeongjo', 'AppleMyungjo', serif", '나눔명조'], ["'AppleMyungjo', serif", '애플 명조']];
  const fontSel = (cur, id) => `<select id="${id}">${fonts.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const sample = { text: '주님의 은혜가 오늘도\n나의 삶을 덮으시네' };
  const body = openDlg(`
    <div class="dlg-head"><h3>자막 스타일</h3><button class="icon" data-x>✕</button></div>
    <div class="two">
      <div><h4>예배당 화면 (HDMI)</h4><div class="form">
        <label>글꼴</label>${fontSel(st.main.font, 'm_font')}
        <label>글자 크기</label><input type="range" id="m_size" min="3" max="12" step="0.1" value="${esc(st.main.size)}">
        <label>글자 색</label><input type="color" id="m_color" value="${esc(st.main.color)}">
        <label>굵게</label><input type="checkbox" id="m_bold" ${st.main.bold ? 'checked' : ''}>
        <label>그림자</label><input type="checkbox" id="m_shadow" ${st.main.shadow ? 'checked' : ''}>
        <label>테두리 두께</label><input type="range" id="m_strokeWidth" min="0" max="5" step="0.5" value="${esc(st.main.strokeWidth)}">
        <label>테두리 색</label><input type="color" id="m_stroke" value="${esc(st.main.stroke)}">
        <label>가로 정렬</label><select id="m_align">${['left', 'center', 'right'].map(v => `<option value="${v}" ${v === st.main.align ? 'selected' : ''}>${{ left: '왼쪽', center: '가운데', right: '오른쪽' }[v]}</option>`).join('')}</select>
        <label>세로 위치</label><select id="m_valign">${['top', 'middle', 'bottom'].map(v => `<option value="${v}" ${v === st.main.valign ? 'selected' : ''}>${{ top: '위', middle: '가운데', bottom: '아래' }[v]}</option>`).join('')}</select>
        <label>배경색</label><input type="color" id="m_bg" value="${esc(st.main.bg)}">
      </div><div id="sPvMain" class="wc-screen pv" style="margin-top:10px"></div></div>
      <div><h4>방송 자막 (OBS)</h4><div class="form">
        <label>글꼴</label>${fontSel(st.overlay.font, 'o_font')}
        <label>글자 크기</label><input type="range" id="o_size" min="2.5" max="9" step="0.1" value="${esc(st.overlay.size)}">
        <label>글자 색</label><input type="color" id="o_color" value="${esc(st.overlay.color)}">
        <label>굵게</label><input type="checkbox" id="o_bold" ${st.overlay.bold ? 'checked' : ''}>
        <label>자막 바 색</label><input type="color" id="o_box" value="${esc(st.overlay.box)}">
        <label>바 불투명도</label><input type="range" id="o_boxOpacity" min="0" max="1" step="0.05" value="${esc(st.overlay.boxOpacity)}">
        <label>위치</label><select id="o_position"><option value="bottom" ${st.overlay.position === 'bottom' ? 'selected' : ''}>아래</option><option value="top" ${st.overlay.position === 'top' ? 'selected' : ''}>위</option></select>
        <label>곡명·구절 표시</label><input type="checkbox" id="o_showTitle" ${st.overlay.showTitle ? 'checked' : ''}>
        <label>방송에 이미지</label><select id="o_media" title="악보·사진·HTML·PPT 슬라이드를 방송(OBS)에도 내보낼지">
          ${[['none', '내보내지 않음 (자막만)'], ['full', '화면 가득'], ['pip', '화면 일부 (설교자 보이게)']].map(([v, t]) => `<option value="${v}" ${(st.overlay.media || 'none') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label>일부 — 크기</label><input type="range" id="o_pipSize" min="15" max="70" step="1" value="${esc(st.overlay.pipSize ?? 30)}">
        <label>일부 — 위치</label><select id="o_pipPos">
          ${[['tr', '오른쪽 위'], ['mr', '오른쪽 중간'], ['br', '오른쪽 아래'], ['tl', '왼쪽 위'], ['ml', '왼쪽 중간'], ['bl', '왼쪽 아래']].map(([v, t]) => `<option value="${v}" ${(st.overlay.pipPos || 'tr') === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div><div id="sPvOv" class="wc-screen pv checker" style="margin-top:10px"></div></div>
    </div>
    <div class="dlg-foot"><button class="btn" data-x>취소</button><button class="btn primary" id="sSave">적용</button></div>`);
  const paint = () => {
    const fake = { slide: sample, next: null, style: st, live: { black: false, clear: false }, item: { type: 'song', title: '예시 찬양' } };
    WC.render(body.querySelector('#sPvMain'), fake, 'main', { fade: false });
    WC.render(body.querySelector('#sPvOv'), fake, 'overlay', { fade: false });
  };
  // 슬라이더 옆에 현재 값 표시
  body.querySelectorAll('input[type=range]').forEach(el => {
    const out = document.createElement('span'); out.className = 'muted small'; out.style.cssText = 'min-width:36px;text-align:right';
    const wrap = document.createElement('div'); wrap.className = 'row'; wrap.style.margin = '0';
    el.replaceWith(wrap); wrap.append(el, out);
    const upd = () => (out.textContent = el.id.endsWith('Opacity') ? Math.round(el.value * 100) + '%' : el.value);
    el.addEventListener('input', upd); upd();
  });
  body.querySelectorAll('[id^=m_],[id^=o_]').forEach(el => el.addEventListener('input', () => {
    const [grp, key] = [el.id[0] === 'm' ? 'main' : 'overlay', el.id.slice(2)];
    st[grp][key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    paint();
  }));
  body.querySelector('#sSave').onclick = async () => { await api('PUT', '/api/style', st); closeDlg(); toast('스타일을 적용했습니다'); };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  paint();
}

// OBS 안내
// [패치] 예배당 화면·프롬프터를 띄울 모니터 고르기 (엣지/크롬의 '창 관리' 권한 사용)
// [추가] 이 운영 화면이 연 창들 — 종료할 때 함께 닫음
const openedWins = new Set();
const track = w => { if (w) openedWins.add(w); return w; };
function closeOpenedWins() { openedWins.forEach(w => { try { w.close(); } catch (e) {} }); openedWins.clear(); }
async function openOnScreen(url) {
  const name = url === '/output' ? '📺 예배당 화면' : '🎤 프롬프터';
  const plain = () => track(window.open(url, url, 'width=1280,height=720'));
  if (!('getScreenDetails' in window)) return plain();
  let det;
  try { det = await window.getScreenDetails(); } catch (e) {
    toast('창 관리 권한이 없어 기본 창으로 엽니다 (주소창 왼쪽 자물쇠 → 창 관리 허용)');
    return plain();
  }
  const screens = det.screens;
  const key = 'wc-screen:' + url;
  let last = null; try { last = localStorage.getItem(key); } catch (e) {}
  const id = s => `${s.left},${s.top},${s.width},${s.height}`;
  // 모니터 배치도 (실제 위치 비율대로)
  const minX = Math.min(...screens.map(s => s.left)), minY = Math.min(...screens.map(s => s.top));
  const maxX = Math.max(...screens.map(s => s.left + s.width)), maxY = Math.max(...screens.map(s => s.top + s.height));
  const k = Math.min(440 / (maxX - minX), 160 / (maxY - minY));
  const map = screens.map((s, i) => `<button class="scr-box${id(s) === last ? ' last' : ''}" data-scr="${i}"
      style="left:${(s.left - minX) * k}px;top:${(s.top - minY) * k}px;width:${s.width * k - 4}px;height:${s.height * k - 4}px">${i + 1}</button>`).join('');
  const list = screens.map((s, i) => `<button class="btn scr-btn${id(s) === last ? ' primary' : ''}" data-scr="${i}">
      <b>${i + 1}. ${esc(s.label || '모니터 ' + (i + 1))}</b> <span class="muted small">${s.width}×${s.height}
      ${s.isPrimary ? '· 주 모니터' : ''}${s === det.currentScreen ? ' · 지금 운영 화면이 있는 곳' : ''}${id(s) === last ? ' · 지난번 선택' : ''}</span></button>`).join('');
  openDlg(`
    <div class="dlg-head"><h3>${name}을 띄울 모니터</h3><button class="icon" data-x>✕</button></div>
    <style>
      .scr-map { position: relative; height: ${Math.ceil((maxY - minY) * k) + 4}px; width: ${Math.ceil((maxX - minX) * k) + 4}px; margin: 6px auto 14px; }
      .scr-box { position: absolute; border: 2px solid #4a5670; background: #1b2232; color: #fff; font: 700 22px sans-serif; border-radius: 6px; cursor: pointer; }
      .scr-box:hover, .scr-box.last { border-color: #6aa8ff; background: #23345a; }
      .scr-btn { display: block; width: 100%; text-align: left; margin: 6px 0; }
    </style>
    <div class="scr-map">${map}</div>
    ${list}
    <p class="muted small">창이 그 모니터에 꽉 차게 열립니다. 전체화면은 새 창에서 <b>F 키</b> 또는 <b>더블클릭</b>.</p>
    <div class="dlg-foot"><button class="btn" id="scrPlain">그냥 창으로 열기</button><button class="btn" data-x>취소</button></div>`);
  const body = $('#dlgBody');
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
  body.querySelector('#scrPlain').onclick = () => { closeDlg(); plain(); };
  body.querySelectorAll('[data-scr]').forEach(b => b.onclick = () => {
    const s = screens[+b.dataset.scr];
    try { localStorage.setItem(key, id(s)); } catch (e) {}
    closeDlg();
    const w = track(window.open(url, url, `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`));
    // 이미 열려 있던 창이면 위치 옵션이 무시되므로 직접 옮김
    try { w.moveTo(s.availLeft, s.availTop); w.resizeTo(s.availWidth, s.availHeight); w.focus(); } catch (e) {}
    toast(`${name}을 ${+b.dataset.scr + 1}번 모니터에 열었습니다`);
  });
}

function openOBS() {
  const urls = S.lan.map(ip => `http://${ip}:${S.port}/overlay`);
  openDlg(`
    <div class="dlg-head"><h3>🎥 OBS에 자막 얹기</h3><button class="icon" data-x>✕</button></div>
    <p>방송 PC(맥/윈도우)의 OBS에서 <b>소스 ＋ → 브라우저</b>를 추가하고 아래 주소를 넣으세요. 너비 <b>1920</b>, 높이 <b>1080</b>.
    카메라 소스 <b>위에</b> 두면 자막만 투명하게 얹힙니다. (캡처 장비·NDI 플러그인 필요 없음)</p>
    ${urls.map(u => `<div class="copy row"><input readonly value="${u}"><button class="btn" data-copy="${u}">복사</button></div>`).join('') || '<p class="err">네트워크 주소를 찾지 못했습니다. 와이파이/랜 연결을 확인하세요. 같은 맥에서 OBS를 쓰면: http://localhost:' + S.port + '/overlay</p>'}
    <p class="muted small">· 같은 맥에서 OBS를 돌릴 때: <code>http://localhost:${S.port}/overlay</code><br>
    · 방송 PC와 이 맥은 같은 공유기(네트워크)에 있어야 합니다. 맥 방화벽이 묻으면 "허용"을 누르세요.<br>
    · 웹 편집기(주중 준비): <code>${S.lan[0] ? `http://${S.lan[0]}:${S.port}/editor` : '-'}</code> · PIN <b>${esc(S.settings.pin || '')}</b> (⚙︎ 설정에서 변경)</p>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  $('#dlgBody').querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('복사했습니다'); });
  $('#dlgBody').querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// 설정
function openSettings() {
  const body = openDlg(`
    <div class="dlg-head"><h3>설정</h3><button class="icon" data-x>✕</button></div>
    <div class="form">
      <label>웹 편집기 PIN</label><div class="row"><input id="stPin" value="${esc(S.settings.pin || '')}" maxlength="12" placeholder="6~12자리"><button class="btn" id="stPinSave">저장</button></div>
      <label>로고 (L 키)</label><div class="row">${S.settings.logo ? `<img src="${esc(S.settings.logo)}" style="height:40px">` : '<span class="muted">없음</span>'}<button class="btn" id="stLogo">로고 선택</button></div>
      <label>성경 폴더</label><div>
        <div id="stFolders"></div>
        <div class="row"><input id="stFolderNew" placeholder="폴더 경로 (Finder에서 폴더를 이 칸으로 끌어다 놓아도 됩니다)"><button class="btn" id="stFolderAdd">추가</button></div>
        <p class="muted small">하위 폴더마다 번역본 하나: "한글 (개역개정)/43-요한복음(John) - 개역개정.md" 형식, 절은 "**3:16** 본문". 원본 파일은 읽기만 합니다.</p></div>
      <label>기본 번역본</label><div class="muted">${esc(S.bibleDefault || '-')} (개역개정이 있으면 자동 선택)</div>
      <label>성경 텍스트 가져오기</label><div>
        <div class="row"><input id="stBName" placeholder="번역본 이름 (예: 개역한글)"><label class="btn">파일 선택<input type="file" id="stBFile" accept=".txt,.tsv" hidden></label></div>
        <p class="muted small">형식: 한 줄에 한 절. "창1:1 본문…" 또는 "창세기[탭]1[탭]1[탭]본문". UTF-8 또는 EUC-KR.
        현재 번역본: ${S.bibleVersions.map(esc).join(', ')}</p></div>
    </div>
    <p class="muted small" style="margin-top:16px">예배송출 v0.3.1 · 만든 사람: <b>쉬운목사 이광복</b> · 무료로 나눕니다</p>
    <div class="dlg-foot"><button class="btn" data-x>닫기</button></div>`);
  const folders = [...(S.settings.bibleFolders || [])];
  const saveFolders = async list => { const r = await api('PUT', '/api/bible/folders', { folders: list }); toast(`번역본 ${r.versions.length}개를 읽었습니다`); await reload(); openSettings(); };
  body.querySelector('#stFolders').innerHTML = folders.map((f, i) => `<div class="row"><code class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(f)}">${esc(f)}</code><button class="icon" data-rmf="${i}" title="빼기">✕</button></div>`).join('') || '<p class="muted small">추가된 폴더 없음</p>';
  body.querySelectorAll('[data-rmf]').forEach(b => (b.onclick = () => { folders.splice(+b.dataset.rmf, 1); saveFolders(folders); }));
  const nf = body.querySelector('#stFolderNew');
  nf.addEventListener('dragover', e => e.preventDefault());
  nf.addEventListener('drop', e => { const t = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list'); if (t) { e.preventDefault(); nf.value = decodeURIComponent(t.replace(/^file:\/\//, '')).replace(/\/$/, ''); } });
  body.querySelector('#stFolderAdd').onclick = () => { const v = nf.value.trim().replace(/^['"]|['"]$/g, ''); if (v) saveFolders([...folders, v]); };
  body.querySelector('#stPinSave').onclick = async () => { await api('PUT', '/api/settings', { pin: body.querySelector('#stPin').value }); toast('PIN을 바꿨습니다 (기존 접속은 로그아웃)'); };
  body.querySelector('#stLogo').onclick = () => openMediaPicker(async url => { await api('PUT', '/api/settings', { logo: url }); await reload(); openSettings(); }, openSettings);
  body.querySelector('#stBFile').onchange = async e => {
    const fd = new FormData(); fd.append('file', e.target.files[0]); fd.append('name', body.querySelector('#stBName').value || e.target.files[0].name);
    const r = await api('POST', '/api/bible/upload', fd);
    toast(r.ok ? `'${r.name}' ${r.books}권을 읽었습니다` : r.error);
    await reload(); openSettings();
  };
  body.querySelectorAll('[data-x]').forEach(b => (b.onclick = closeDlg));
}

// ── 이벤트 연결 ─────────────────────────────────
function bind() {
  $('#search').oninput = e => { search = e.target.value; renderLib(); };
  $('#serviceSel').onchange = async e => { await api('PUT', '/api/current-service', { id: e.target.value }); };
  $('#svcNew').onclick = newService;
  $('#svcEdit').onclick = async () => {
    const s = service(); if (!s) return;
    const name = prompt('예배 이름', s.name); if (name == null) return;
    const date = prompt('날짜', s.date) ?? s.date;
    await api('PUT', '/api/services/' + s.id, { name, date });
  };
  $('#svcDel').onclick = async () => { const s = service(); if (s && confirm(`'${s.name}' 순서를 삭제할까요? (자료는 남습니다)`)) await api('DELETE', '/api/services/' + s.id); };
  $('#newSong').onclick = () => openItemEditor(null);
  $('#newNotice').onclick = () => { openItemEditor(null); $('#eType').value = 'notice'; $('#eType').dispatchEvent(new Event('change')); $('#eTitle').value = '광고'; $('#eTitle').dispatchEvent(new Event('input')); };
  $('#newBible').onclick = openBible;
  $('#newScore').onclick = openScore;
  $('#pptFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    toast('PPT 가져오는 중…');
    const it = await api('POST', '/api/pptx', fd);
    e.target.value = ''; selId = it.id;
    if (service()) await saveService([...service().itemIds, it.id]);
    toast(`슬라이드 ${it.slides.length}장을 가져왔습니다`);
  };
  $('#htmlFile').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      try {
        toast(`'${f.name}' 가져오는 중…`);
        const fd = new FormData(); fd.append('file', f);
        const { url } = await api('POST', '/api/html', fd);
        const info = await countHtmlSlides(url);
        const slides = info.texts.map((text, page) => ({ text, html: url, page }));
        const it = await api('POST', '/api/items', { type: 'html', title: f.name.replace(/\.html?$/i, ''), slides, noBroadcast: true });
        selId = it.id;
        if (service()) await saveService([...service().itemIds, it.id]);
        toast(`HTML 슬라이드 ${slides.length}장을 가져왔습니다`);
      } catch (err) { toast('HTML 가져오기 실패: ' + (err.message || '')); }
    }
  };
  $('#editItem').onclick = () => selId && openItemEditor(selId);
  $('#styleBtn').onclick = openStyle;
  $('#mediaBtn').onclick = () => openMediaPicker(null, null);
  document.querySelectorAll('.sz-b').forEach(b => (b.onclick = () => bumpSize(b.dataset.sz, +b.dataset.d)));
  showSizes();
  if (IS_EDITOR) return;

  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openOnScreen(b.dataset.open));
  $('#obsBtn').onclick = openOBS;
  $('#settingsBtn').onclick = openSettings;
  $('#quitBtn').onclick = async () => {
    if (!confirm('예배송출 프로그램을 끌까요?\n(예배당 화면·프롬프터 창도 함께 닫히고, OBS 자막도 꺼집니다)')) return;
    window._wcQuitting = true;
    await api('POST', '/api/quit');   // 서버가 모든 화면에 '종료'를 알림 → 예배당 화면·프롬프터 창이 스스로 닫힘
    closeOpenedWins();                // 혹시 남은 창은 여기서 한 번 더 닫음
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100vh;font-size:18px">예배송출을 종료했습니다. 이 창은 닫으셔도 됩니다.</div>';
    setTimeout(() => window.close(), 800);
  };
  $('#prev').onclick = () => goLive({ step: -1 });
  $('#next').onclick = () => goLive({ step: 1 });
  $('#black').onclick = () => goLive({ black: !snap.live.black });
  $('#clear').onclick = () => goLive({ clear: !snap.live.clear });
  $('#logo').onclick = () => goLive({ logo: !snap.live.logo, black: !snap.live.logo });
  $('#reset').onclick = () => goLive({ reset: true });
  $('#overlayOff').onclick = () => goLive({ overlayOff: !snap.live.overlayOff });

  addEventListener('keydown', e => {
    if (dlg.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const k = e.key;
    if (['ArrowRight', ' ', 'PageDown', 'ArrowDown'].includes(k)) { e.preventDefault(); goLive({ step: 1 }); }
    else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(k)) { e.preventDefault(); goLive({ step: -1 }); }
    else if (k === 'b' || k === 'B') $('#black').click();
    else if (k === 'c' || k === 'C') $('#clear').click();
    else if (k === 'l' || k === 'L') $('#logo').click();
    else if (k === 'o' || k === 'O') $('#overlayOff').click();
    else if (k === 'Escape') $('#reset').click();
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') { e.preventDefault(); bumpSize(e.shiftKey ? 'overlay' : 'main', e.code === 'BracketRight' ? 1 : -1); }
    else if (/^[1-9]$/.test(k) && selId) goLive({ itemId: selId, index: +k - 1 }).catch(() => {});
  });
  // 슬라이드 클릭 시 다른 자료로 넘어가면 그 자료 기준으로 이동
}

// ── 시작 ─────────────────────────────────────────
(async function start() {
  document.body.classList.toggle('editor', IS_EDITOR);
  $('#modeTag').textContent = IS_EDITOR ? '웹 편집기 · 준비 전용' : '운영 · 송출';
  const me = await fetch('/api/me').then(r => r.json());
  if (!me.authed) {
    $('#login').classList.remove('hidden');
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pin').value }) });
      if (r.ok) location.reload(); else $('#loginErr').textContent = (await r.json().catch(() => ({}))).error || 'PIN이 맞지 않습니다';
    };
    return;
  }
  bind();
  await reload();
  const first = service()?.itemIds[0];
  if (first) select(first);
  initMediaBin();
  connectWS();
})();
