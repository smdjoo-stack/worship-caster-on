// 가사 가져오기 (지니 음원 페이지) — 사용자가 버튼을 누를 때만 한 곡씩 조회
// 사이트 구조가 바뀌면 동작하지 않을 수 있음. 그때는 '구글/네이버 검색 → 붙여넣기'를 쓰면 됨.
// (2026-11: 벅스가 자동 접속 차단 페이지를 도입해서 지니로 바꿈)
const BASE = 'https://www.genie.co.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const unescape = s => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

const strip = s => unescape(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ''));
const oneLine = s => strip(s).replace(/\s+/g, ' ').trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, retry = true) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let status = 0;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: ctl.signal });
    status = r.status;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    // 429 = 짧은 시간에 너무 많이 요청함 → 잠깐 쉬었다가 한 번 더
    if (status === 429 && retry) { clearTimeout(timer); await sleep(2000); return get(url, false); }
    if (status === 429) throw new Error('가사 사이트(지니)가 잠시 요청을 막았습니다. 1~2분 뒤 다시 누르거나 [구글]·[네이버]로 찾아 주세요.');
    throw new Error(e.name === 'AbortError' ? '응답이 너무 느립니다 (인터넷 연결 확인)' : '가사 사이트에 연결하지 못했습니다: ' + e.message);
  } finally { clearTimeout(timer); }
}

// 제목 정리: '(G)', '가사', '[찬송가]' 같은 군더더기가 붙으면 결과가 안 나오는 경우가 많음
function cleanTitle(q) {
  return String(q || '')
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>|（[^）]*）/g, ' ')      // 괄호 안 (키·메모·영문 제목)
    .replace(/^\s*\d+\s*[.)\-:]\s*/, ' ')                                   // 앞 번호 "1. "
    .replace(/(가사|악보|코드|ppt|PPT|mr|MR|반주|찬양|찬송가?|\d+\s*장)(?=\s|$)/g, ' ') // 붙은 말
    .replace(/\b[A-G][#b]?m?(\s*key|\s*키)?(?=\s|$)/g, ' ')                  // 키 표기 "G", "Ab key"
    .replace(/[~!@#$%^&*_=+|\/;:"“”‘’'`,.?·…\-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function searchOnce(q, limit) {
  const html = await get(`${BASE}/search/searchSong?query=${encodeURIComponent(q)}`);
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<tr[^>]*class="list"[^>]*songid="(\d+)"([\s\S]*?)<\/tr>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = m[2].match(/<a[^>]*class="title ellipsis"[^>]*title="([^"]*)"/);
    const artist = m[2].match(/<a[^>]*class="artist ellipsis"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ id: m[1], title: title ? oneLine(title[1]) : '', artist: artist ? oneLine(artist[1]) : '' });
    if (out.length >= limit) break;
  }
  return out;
}

// 곡 검색 → [{ id, title, artist }]. 그대로 → 정리한 제목 → 띄어쓰기 없앤 제목 순으로 시도
async function search(q, limit = 20) {
  q = String(q || '').trim().slice(0, 100);
  if (!q) return [];
  const c = cleanTitle(q);
  const tries = [...new Set([q, c, c.replace(/\s+/g, '')].filter(Boolean))];
  for (const t of tries) {
    const out = await searchOnce(t, limit);
    if (out.length) return out;
  }
  return [];
}

// 가사 정리: 줄 끝 공백 제거, 빈 줄 여러 개 → 하나 (빈 줄 = 슬라이드 강제 나눔)
function tidy(t) {
  return t.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '').replace(/^\s+/, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 한 곡의 가사 → { id, title, artist, lyrics } (가사가 없으면 lyrics: '')
async function lyrics(id) {
  if (!/^\d{1,12}$/.test(String(id))) throw new Error('잘못된 곡 번호');
  const html = await get(`${BASE}/detail/songInfo?xgnm=${id}`);
  const t = html.match(/<meta property="og:title" content="([^"]*)"/);
  const [title = '', artist = ''] = t ? unescape(t[1]).replace(/\s*-\s*genie\s*$/i, '').split(/\s\/\s(?=[^/]*$)/) : [];
  const pre = html.match(/<pre id="pLyrics">([\s\S]*?)<\/pre>/);
  const p = pre && pre[1].match(/<p>([\s\S]*?)<\/p>/);
  let text = p ? tidy(strip(p[1])) : '';
  if (/가사\s*정보가\s*없|등록된\s*가사가\s*없/.test(text)) text = '';
  return { id: String(id), title: title.trim(), artist: artist.trim(), lyrics: text };
}

module.exports = { search, lyrics, cleanTitle };
