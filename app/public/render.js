// 공용 렌더러: 운영 화면 미리보기·썸네일과 실제 송출 화면이 같은 코드를 씀
// 크기 단위는 cqh/cqw(컨테이너 기준) → 어떤 크기에서도 같은 비율
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isVideo = u => /\.(mp4|mov|m4v|webm)$/i.test(u || '');

  // [패치] 오래된 브라우저(OBS 28 이하 내장 브라우저 등)는 cqh/cqw 단위를 몰라 글자가 아주 작게 나옴.
  // 송출 화면(/output·/overlay·/stage)은 화면을 꽉 채우므로 vh/vw 로 바꿔도 결과가 같음.
  const NO_CQ = !(window.CSS && CSS.supports && CSS.supports('height', '1cqh'));
  const toVp = s => s.replace(/(\d)cq([hw])\b/g, '$1v$2');
  if (NO_CQ) {
    fetch('/render.css').then(r => r.text()).then(t => {
      const el = document.createElement('style');
      el.textContent = toVp(t.replace(/@import[^;]*;/g, ''));
      document.head.appendChild(el);
    }).catch(() => {});
  }

  // ── 값 검증: 스타일 속성에 들어가는 값은 모두 여기서 걸러서 HTML/CSS 주입을 막음 ──
  const col = (c, d) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : d);
  const num = (n, d, lo = -1e4, hi = 1e4) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const DEFAULT_FONT = "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif";
  const font = f => (/^[\w\s',\-가-힣]{1,120}$/.test(String(f || '')) ? f : DEFAULT_FONT);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const safeMain = st => ({
    ...st, font: font(st.font), size: num(st.size, 6.2, 1, 30), color: col(st.color, '#ffffff'), stroke: col(st.stroke, '#000000'),
    strokeWidth: num(st.strokeWidth, 0, 0, 10), align: pick(st.align, ['left', 'center', 'right'], 'center'),
    valign: pick(st.valign, ['top', 'middle', 'bottom'], 'middle'), bg: col(st.bg, '#000000'), lineHeight: num(st.lineHeight, 1.45, 0.8, 3),
  });
  const safeOverlay = st => ({
    ...st, font: font(st.font), size: num(st.size, 4.6, 1, 20), color: col(st.color, '#ffffff'), box: col(st.box, '#0b1d3a'),
    boxOpacity: num(st.boxOpacity, 0.72, 0, 1), position: pick(st.position, ['top', 'bottom'], 'bottom'), lineHeight: num(st.lineHeight, 1.35, 0.8, 3),
    media: pick(st.media, ['none', 'full', 'pip'], 'none'),
    pipSize: num(st.pipSize, 30, 15, 70), pipPos: pick(st.pipPos, ['tr', 'mr', 'br', 'tl', 'ml', 'bl'], 'tr'),
  });
  const safeEl = e => ({
    ...e, x: num(e.x, 0), y: num(e.y, 0), w: num(e.w, 100, 0), h: num(e.h, 100, 0), size: num(e.size, 24, 1, 400),
    color: col(e.color, '#ffffff'), fill: col(e.fill, null), align: pick(e.align, ['left', 'center', 'right'], 'left'),
  });

  // 미디어 칸의 유튜브 배경: url = 'yt:영상번호@시작초'. 예배당 화면·방송 창에서만 실제 재생(반복), 나머지는 썸네일
  const YT_BG = /^yt:([\w-]{11})(?:@(\d+))?$/;
  function ytBgHTML(url) {
    const [, id, st] = url.match(YT_BG), start = +st || 0;
    if (PLAYER) {
      const q = `autoplay=1&loop=1&playlist=${id}&controls=0&rel=0&playsinline=1&modestbranding=1&disablekb=1&iv_load_policy=3&enablejsapi=1` +
        `&origin=${encodeURIComponent(location.origin)}${start ? `&start=${start}` : ''}${PLAYER === 'muted' ? '&mute=1' : ''}`;
      // wc-yt-wait: 실제로 재생이 시작될 때까지 감춤 (유튜브가 처음 몇 초 띄우는 제목·버튼·어두운 막이 안 보이게)
      return `<iframe class="wc-bg wc-yt wc-yt-wait" data-start="${start}" src="https://www.youtube.com/embed/${id}?${q}" allow="autoplay; encrypted-media"
        referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" style="border:0;pointer-events:none;background:#000"></iframe>`;
    }
    return `<div class="wc-bg" style="background:#000 url('https://i.ytimg.com/vi/${id}/hqdefault.jpg') center/contain no-repeat"></div>`;
  }

  function bgHTML(url, cover = true) {
    if (!url) return '';
    if (YT_BG.test(url)) return ytBgHTML(url);
    if (isVideo(url)) return `<video class="wc-bg" src="${esc(url)}" autoplay muted loop playsinline></video>`;
    return `<div class="wc-bg" style="background-image:url('${esc(url)}');background-size:${cover ? 'cover' : 'contain'}"></div>`;
  }

  // 유튜브 슬라이드: 실제 재생은 예배당 화면 창(/output, 소리 O)과 방송(/overlay, 소리 X · '방송에 이미지' 설정을 따름)에서만.
  // 운영 화면 미리보기·목록·프롬프터는 썸네일 그림 (여러 곳에서 소리가 나면 겹치므로 소리는 예배당 화면 한 곳에서만)
  const ytId = s => /^[\w-]{11}$/.test(String(s?.youtube || '')) ? s.youtube : null;
  let PLAYER = false; // 지금 그리는 화면이 실제 재생하는 예배당 화면인지 (render 의 opts.player)
  function youtubeHTML(s) {
    const id = ytId(s), start = Math.max(0, Math.floor(+s.start || 0));
    if (PLAYER) {
      // enablejsapi: 운영 화면의 재생·일시정지·10초 이동 버튼으로 조작할 수 있게
      const q = `autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${start ? `&start=${start}` : ''}${PLAYER === 'muted' ? '&mute=1' : ''}`;
      return `<div class="wc-layer" style="background:#000"><iframe class="wc-yt" data-start="${start}" src="https://www.youtube.com/embed/${id}?${q}"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"
        style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`;
    }
    return `<div class="wc-layer" style="background:#000"><div class="wc-bg" style="background-image:url('https://i.ytimg.com/vi/${id}/hqdefault.jpg');background-size:contain"></div>
      <div style="position:absolute;left:3%;bottom:5%;background:#e62117;color:#fff;font:700 5cqh sans-serif;padding:.6cqh 2cqh;border-radius:1cqh">▶ YouTube</div></div>`;
  }

  // HTML 슬라이드: 1920×1080 으로 그린 뒤 화면 크기에 맞춰 축소 (샌드박스 iframe)
  const isHtml = s => /^\/slides\/[a-f0-9]{12}\.html$/.test(String(s?.html || ''));
  function htmlSlideHTML(s) {
    const page = Math.max(0, Math.floor(num(s.page, 0, 0, 9999)));
    return `<iframe class="wc-html" src="${esc(s.html)}#wc=${page}" sandbox="allow-scripts" scrolling="no" tabindex="-1" loading="lazy"></iframe>`;
  }
  function postPage(f) {
    try { f.contentWindow && f.contentWindow.postMessage({ wc: 'show', page: f._wcPage }, '*'); } catch (e) {}
  }
  function fitHtml(container) {
    const k = container.clientWidth / 1920;
    container.querySelectorAll('iframe.wc-html').forEach(f => (f.style.transform = `scale(${k})`));
  }

  function textShadow(st) {
    const parts = [];
    if (st.shadow) parts.push('0 0.4cqh 1.2cqh rgba(0,0,0,.85)');
    return parts.join(',') || 'none';
  }

  // 자막 끄기(C) 중 설정이 '이미지도 같이 끄기'면 이미지 숨기기(I)와 똑같이 이미지를 뺌
  // 예배당 자막만 끄기(tvOff)도 같은 설정을 따름
  const textOff = L => !!L?.clear || !!L?.tvOff;
  const imagesOff = snap => !!snap.live?.noImage || (textOff(snap.live) && snap.clearImages === 'hide');
  const mediaOff = snap => textOff(snap.live) && snap.clearImages === 'hide';

  function elementsHTML(slide, noImage = false, imagesOnly = false) {
    const ptH = num(slide.ptH, 540, 1, 1e5);
    return (slide.elements || []).map(e0 => {
      const e = safeEl(e0);
      const box = `left:${e.x}%;top:${e.y}%;width:${e.w}%;height:${e.h}%`;
      if (e.type === 'image') return noImage ? '' : `<img class="wc-el" style="${box};object-fit:contain" src="${esc(e.src)}">`;
      if (imagesOnly) return ''; // 자막 끄기 + 이미지 계속 보이기: PPT 속 글자·표만 뺌
      const fs = ((e.size || 24) / ptH * 100).toFixed(2) + 'cqh';
      if (e.type === 'table') {
        return `<table class="wc-el wc-table" style="${box};font-size:${fs};color:${e.color}">` +
          e.rows.map(r => '<tr>' + r.map(c => `<td>${esc(c).replace(/\n/g, '<br>')}</td>`).join('') + '</tr>').join('') + '</table>';
      }
      return `<div class="wc-el wc-text" style="${box};font-size:${fs};color:${e.color};` +
        `font-weight:${e.bold ? 700 : 400};text-align:${e.align};${e.fill ? `background:${e.fill};` : ''}">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
    }).join('');
  }

  // mediaUnder: 미디어 배경(L.mediaBg)이 따로 깔려 있으면 슬라이드 바탕을 투명하게 해서 그 위에 글자만 얹음
  // [추가] L.noImage(이미지 OFF): 사진·악보·PPT 속 그림만 빼고 글자는 그대로. 미디어 배경(영상)은 계속 나옴
  // (미디어 배경까지 끄는 건 '자막 끄기 + 이미지도 같이 끄기' 설정일 때만)
  function mainHTML(snap, mediaUnder = false) {
    const st = safeMain(snap.style.main), s = snap.slide, L = snap.live, noImg = imagesOff(snap);
    if (L.allOff) return '<div class="wc-layer" style="background:#000"></div>'; // 모두 끄기: 로고까지 아무것도 없음
    const media = mediaUnder && L.mediaBg && !mediaOff(snap);
    if (L.black || (!s && !media)) {
      const logo = L.logo && snap.logo ? `<div class="wc-bg" style="background-image:url('${esc(snap.logo)}');background-size:contain;background-position:center;background-repeat:no-repeat;inset:20%"></div>` : '';
      return `<div class="wc-layer" style="background:#000">${logo}</div>`;
    }
    if (!s) return '<div class="wc-layer"></div>';
    // 유튜브는 이미지처럼: 이미지 OFF(또는 자막 끄기 + 이미지도 같이 끄기)면 배경 영상 또는 배경색만
    if (ytId(s)) return noImg ? `<div class="wc-layer" style="background:${media ? 'transparent' : st.bg}"></div>` : youtubeHTML(s);
    const under = media && (!s.bg || noImg); // 이미지를 껐으면 슬라이드 그림 대신 배경 영상이 보이게
    let inner = noImg ? '' : bgHTML(s.bg, s.fit !== 'contain');
    if (!textOff(L)) {
      if (isHtml(s)) inner += htmlSlideHTML(s);
      else if (s.elements && s.elements.length) inner += elementsHTML(s, noImg);
      else {
        const jc = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign] || 'center';
        const ref = s.ref ? `<div class="wc-ref" style="font-size:${(st.size * 0.6).toFixed(2)}cqh">${esc(s.ref)}</div>` : '';
        inner += `<div class="wc-textwrap" style="justify-content:${jc};text-align:${st.align}">
          <div class="wc-text-main" dir="auto" style="font-family:${st.font};font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};
            line-height:${st.lineHeight};text-shadow:${textShadow(st)};${st.strokeWidth ? `-webkit-text-stroke:${st.strokeWidth / 10}cqh ${st.stroke};paint-order:stroke fill;` : ''}">${esc(s.text).replace(/\n/g, '<br>')}</div>${ref}</div>`;
      }
    } else if (!noImg && !isHtml(s) && s.elements && s.elements.length) {
      inner += elementsHTML(s, false, true); // 자막은 끄고 PPT·악보 속 그림은 남김
    }
    // 이미지를 끈 사진·악보 장은 올릴 때 고른 바탕색(흰색 등)만 남아 어색함 → 자막 스타일 배경(기본 검정)으로
    // 글자가 있는 PPT 장은 글자가 잘 보이도록 원래 바탕색 유지
    const hasText = String(s.text || '').trim() || (s.elements || []).some(e => e && e.type !== 'image');
    const bgc = noImg && !hasText ? st.bg : col(s.bgColor, st.bg);
    return `<div class="wc-layer" style="background:${under ? 'transparent' : bgc}">${inner}</div>`;
  }

  // 미디어 배경: 슬라이드 층과 따로 두어서 슬라이드가 바뀌어도 영상이 처음부터 다시 시작하지 않음
  // fit: auto(영상=꽉 채우기, 사진=전체 보이기) / cover / contain / small(가운데 작게 — 로고용)
  function mediaFitOf(url, fit) {
    const f = ['cover', 'contain', 'small'].includes(fit) ? fit : (isVideo(url) ? 'cover' : 'contain');
    return f;
  }
  function syncMedia(container, url, fit) {
    let m = container.querySelector(':scope > .wc-media');
    const f = url ? mediaFitOf(url, fit) : null;
    const key = url ? url + '|' + f : null;
    if ((m?._wcKey || null) === key) return;
    // 같은 파일에서 맞춤만 바뀌면 영상을 다시 불러오지 않고 모양만 바꿈
    if (m && url && m._wcUrl === url) { applyFit(m, f); m._wcKey = key; return; }
    if (m) { const old = m; old.style.opacity = 0; setTimeout(() => old.remove(), 320); }
    if (!url) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = bgHTML(url, true);
    m = tmp.firstElementChild;
    m.classList.add('wc-media');
    m._wcUrl = url; m._wcKey = key;
    applyFit(m, f);
    m.style.opacity = 0;
    container.prepend(m);
    void m.offsetWidth;
    m.style.opacity = 1;
  }
  function applyFit(m, f) {
    const size = f === 'cover' ? 'cover' : 'contain';
    if (m.tagName === 'VIDEO') m.style.objectFit = size; else m.style.backgroundSize = size;
    // small: 화면 가운데 작게 (화면 높이의 40%)
    const box = f === 'small' ? { l: 30, t: 30, w: 40, h: 40 } : { l: 0, t: 0, w: 100, h: 100 };
    // 유튜브: 플레이어를 위아래로 15%씩 더 크게 → 영상은 가운데 그대로, 유튜브 제목 줄(위)·로고(아래)는 화면 밖으로
    const yt = m.tagName === 'IFRAME' ? box.h * 0.15 : 0;
    Object.assign(m.style, { left: box.l + '%', top: (box.t - yt) + '%', width: box.w + '%', height: (box.h + 2 * yt) + '%' });
    m.style.clipPath = yt && f === 'small' ? `inset(${(yt / (box.h + 2 * yt) * 100).toFixed(2)}% 0)` : ''; // 작게일 때는 잘라서 칸 밖으로 안 나가게
  }

  function hexA(hex, a) {
    const n = parseInt((hex || '#000000').slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }

  function overlayHTML(snap) {
    const st = safeOverlay(snap.style.overlay), s = snap.slide, L = snap.live;
    if (L.allOff || L.black || L.clear || L.overlayOff || snap.item?.noBroadcast || !s) return '<div class="wc-layer"></div>';
    // [패치] 이미지·악보·HTML·PPT·유튜브 슬라이드를 방송에도 내보내기 (자막 스타일의 '방송에 이미지' 설정)
    const visual = isHtml(s) || ytId(s) || (s.elements && s.elements.length) || (s.bg && !String(s.text || '').trim());
    if (visual && st.media !== 'none' && !L.ovNoImage) { // 방송 이미지 OFF면 이미지는 빼고 글자 자막만
      // 이미지 숨기기는 예배당 화면 전용 — 방송은 '방송에 이미지' 설정을 따름
      const inner = mainHTML({ ...snap, live: { ...L, noImage: false, tvOff: false } }); // 예배당 자막 끄기는 방송에 영향 없음
      if (st.media === 'full') return inner;
      // 원래 크기로 그린 뒤 축소 → 글자·HTML 비율이 그대로 유지됨
      // 위치: t 위 / m 중간 / b 아래 × r 오른쪽 / l 왼쪽
      const v = { t: 'top', m: 'center', b: 'bottom' }[st.pipPos[0]] || 'top', h = st.pipPos[1] === 'r' ? 'right' : 'left';
      const vCss = v === 'center' ? 'top:0' : `${v}:4%`;
      return `<div class="wc-layer"><div style="position:absolute;${vCss};${h}:3%;width:100%;height:100%;transform:scale(${st.pipSize / 100});transform-origin:${v} ${h};
        border-radius:24px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.6);outline:6px solid rgba(255,255,255,.85)">${inner}</div></div>`;
    }
    if (isHtml(s) || ytId(s) || !String(s.text || '').trim()) return '<div class="wc-layer"></div>';
    const title = st.showTitle && (s.ref || (snap.item?.type === 'song' ? snap.item.title : '')) ;
    const pos = st.position === 'top' ? 'top:4cqh' : 'bottom:5cqh';
    return `<div class="wc-layer"><div class="wc-ov" style="${pos};background:${hexA(st.box, st.boxOpacity)};font-family:${st.font}">
      ${title ? `<div class="wc-ov-title" style="font-size:${(st.size * 0.55).toFixed(2)}cqh">${esc(title)}</div>` : ''}
      <div class="wc-ov-text" dir="auto" style="font-size:${st.size}cqh;color:${st.color};font-weight:${st.bold ? 700 : 400};line-height:${st.lineHeight}">${esc(s.text).replace(/\n/g, '<br>')}</div>
    </div></div>`;
  }

  function stageHTML(snap) {
    const s = snap.slide, n = snap.next, L = snap.live;
    const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const status = (L.allOff ? '✖ 모두 꺼짐' : L.black ? '■ 검은 화면' : L.clear ? '◻ 모든 자막 꺼짐' : L.tvOff ? '📺 예배당 자막 꺼짐' : '● 송출 중') + (L.noImage ? ' · 이미지 숨김' : '') +
      (L.overlayOff || snap.item?.noBroadcast ? ' · 방송 자막 꺼짐' : '');
    return `<div class="wc-layer wc-stage">
      <div class="wc-st-top"><span>${esc(snap.item?.title || '대기')}</span><span>${snap.item ? `${L.index + 1} / ${snap.item.count}` : ''}</span><span class="wc-st-status">${status}</span><span class="wc-clock">${now}</span></div>
      <div class="wc-st-cur" dir="auto">${esc(s?.text || '').replace(/\n/g, '<br>')}${s?.ref ? `<div class="wc-st-ref">${esc(s.ref)}</div>` : ''}</div>
      <div class="wc-st-next"><b>다음</b> ${esc(n?.text || '— 끝 —').replace(/\n/g, ' / ')}</div>
    </div>`;
  }

  const RENDER = { main: mainHTML, overlay: overlayHTML, stage: stageHTML };

  // 페이드 전환 렌더
  function render(container, snap, mode, opts = {}) {
    const withMedia = mode === 'main' && opts.media !== false;
    const L = snap.live || {};
    // 실제 재생: 예배당 화면(/output)은 소리와 함께, 방송(/overlay)은 그림만(소리 항상 끔 — 소리는 한 곳에서만)
    PLAYER = opts.player ? (mode === 'overlay' ? 'muted' : 'sound') : false;
    if (withMedia) syncMedia(container, L.allOff || mediaOff(snap) ? null : L.mediaBg, L.mediaFit);
    // 방송(OBS)에도 미디어 배경: '방송에도' 가 켜져 있고, 검은화면·방송 자막 끄기가 아닐 때만
    if (mode === 'overlay' && opts.media !== false) syncMedia(container, L.mediaObs && !L.allOff && !L.black && !L.overlayOff ? L.mediaBg : null, L.mediaFit);
    const raw = withMedia ? mainHTML(snap, true) : RENDER[mode](snap);
    const html = NO_CQ ? toVp(raw) : raw;
    if (container._wcHTML === html) return;
    // [패치] 같은 HTML 파일에서 장만 바뀌면 iframe 을 다시 불러오지 않고 '이 장 보여줘' 신호만 보냄
    const frameKey = /iframe class="wc-html"/.test(html) ? html.replace(/#wc=\d+"/, '"') : null;
    const page = frameKey ? +(html.match(/#wc=(\d+)"/) || [0, 0])[1] : 0;
    if (frameKey && container._wcFrameKey === frameKey) {
      const f = container.querySelector(':scope > .wc-layer:last-child iframe.wc-html');
      if (f) { container._wcHTML = html; f._wcPage = page; postPage(f); return; }
    }
    container._wcFrameKey = frameKey;
    container._wcHTML = html;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const layer = tmp.firstElementChild;
    const fade = opts.fade !== false;
    if (fade) layer.style.opacity = 0;
    const olds = [...container.querySelectorAll(':scope > .wc-layer')];
    container.appendChild(layer);
    const frames = [...layer.querySelectorAll('iframe.wc-html')];
    // 불러오는 사이에 장이 바뀌었을 수 있으니, 다 불러온 뒤 지금 장을 한 번 더 알려 줌
    frames.forEach(f => { f._wcPage = page; f.addEventListener('load', () => postPage(f)); });
    if (frames.length) {
      fitHtml(container);
      if (!container._wcRO && window.ResizeObserver) (container._wcRO = new ResizeObserver(() => fitHtml(container))).observe(container);
    }
    const swap = () => {
      if (fade) {
        // [수정] requestAnimationFrame 은 창이 가려졌다고 판단되면 멈춤 → 새 화면이 투명한 채로 남던 문제.
        // 강제로 한 번 그린 뒤 바로 1로 바꿔서 페이드는 유지하고, 혹시 몰라 타이머로도 한 번 더 보장
        void layer.offsetWidth;
        layer.style.opacity = 1;
        setTimeout(() => { layer.style.opacity = 1; olds.forEach(o => o.remove()); }, 320);
      } else olds.forEach(o => o.remove());
    };
    // HTML 슬라이드는 다 그려진 뒤 전환 (깜빡임 방지, 최대 1.5초 대기)
    if (frames.length && fade) {
      let done = false;
      const go = () => { if (!done) { done = true; setTimeout(swap, 80); } };
      frames[0].addEventListener('load', go, { once: true });
      setTimeout(go, 1500);
    } else swap();
  }

  // 썸네일용: 특정 슬라이드를 즉시 렌더
  function thumb(container, slide, style, item) {
    render(container, { slide, style, live: { black: false, clear: false }, item }, 'main', { fade: false, media: false });
  }

  window.WC = { render, thumb, esc };
})();
