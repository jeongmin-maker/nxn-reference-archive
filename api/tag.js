// Vercel 서버리스 함수 — Gemini 자동 태깅
// Vercel 프로젝트 설정에서 환경변수 GEMINI_API_KEY 추가 필요

const MODEL = 'gemini-3-flash-preview';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY 미설정' });
    return;
  }

  try {
    const { imageId, category, groups } = req.body || {};
    if (!imageId || !category || !groups) {
      res.status(400).json({ error: 'imageId, category, groups 필요' });
      return;
    }

    // 1. 구글 드라이브에서 이미지 가져오기
    const imgRes = await fetch(`https://drive.google.com/thumbnail?id=${imageId}&sz=w400`);
    if (!imgRes.ok) throw new Error('이미지 로드 실패');
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    // 2. 태그 목록 프롬프트 구성
    const tagList = Object.entries(groups)
      .map(([group, tags]) => `${group}: ${tags.join(', ')}`)
      .join('\n');
    const prompt =
      `Tag this "${category}" reference image. From the list below, pick ONLY the tags that clearly apply. ` +
      `Return a JSON array of tag strings, using the exact spelling from the list.\n\n${tagList}`;

    // 3. Gemini 호출
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const gRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const data = await gRes.json();
    if (!gRes.ok) {
      res.status(500).json({ error: data.error?.message || 'Gemini 오류' });
      return;
    }

    // 4. 응답 파싱
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    let tags;
    try { tags = JSON.parse(text); }
    catch { const m = text.match(/\[[\s\S]*\]/); tags = m ? JSON.parse(m[0]) : []; }

    // 5. 허용된 태그만 필터
    const allowed = new Set(Object.values(groups).flat());
    tags = (Array.isArray(tags) ? tags : []).filter(t => allowed.has(t));

    res.status(200).json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
