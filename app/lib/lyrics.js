// 가사 가져오기 (벅스 음원 페이지) — 사용자가 버튼을 누를 때만 한 곡씩 조회
// 사이트 구조가 바뀌면 동작하지 않을 수 있음. 그때는 '구글/네이버 검색 → 붙여넣기'를 쓰면 됨.
const BASE = 'https://music.bugs.co.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const unescape = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '응답이 너무 느립니다 (인터넷 연결 확인)' : '가사 사이트에 연결하지 못했습니다: ' + e.message);
  } finally { clearTimeout(timer); }
}

// 곡 검색 → [{ id, title, artist }]
async function search(q, limit = 20) {
  q = String(q || '').trim().slice(0, 100);
  if (!q) return [];
  const html = await get(`${BASE}/search/track?q=${encodeURIComponent(q)}`);
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<tr[^>]*trackId="(\d+)"([\s\S]*?)<\/tr>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = m[2].match(/<p class="title"[^>]*>\s*<a[^>]*title="([^"]*)"/);
    const artist = m[2].match(/<p class="artist"[^>]*>\s*<a[^>]*title="([^"]*)"/);
    out.push({ id: m[1], title: title ? unescape(title[1]) : '', artist: artist ? unescape(artist[1]) : '' });
    if (out.length >= limit) break;
  }
  return out;
}

// 가사 정리: 줄 끝 공백 제거, 빈 줄 여러 개 → 하나 (빈 줄 = 슬라이드 강제 나눔)
function tidy(t) {
  return t.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '').replace(/^\s+/, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 한 곡의 가사 → { id, title, artist, lyrics } (가사가 없으면 lyrics: '')
async function lyrics(id) {
  if (!/^\d{1,12}$/.test(String(id))) throw new Error('잘못된 곡 번호');
  const html = await get(`${BASE}/track/${id}`);
  const t = html.match(/<title>([^<]*)<\/title>/);
  const [title = '', artist = ''] = t ? unescape(t[1]).replace(/\s*-\s*벅스\s*$/, '').split(/\/(?=[^/]*$)/) : [];
  const x = html.match(/<xmp>([\s\S]*?)<\/xmp>/);
  return { id: String(id), title: title.trim(), artist: artist.trim(), lyrics: x ? tidy(unescape(x[1])) : '' };
}

module.exports = { search, lyrics };
