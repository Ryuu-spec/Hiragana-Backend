// 키 순환을 위한 인덱스
let currentKeyIndex = 0;

export default async function handler(req, res) {
    // CORS 및 기본 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { target, imageData } = req.body;
        const apiKeysString = process.env.GEMINI_API_KEYS;

        if (!apiKeysString) throw new Error('GEMINI_API_KEYS가 설정되지 않았습니다.');

        const apiKeys = apiKeysString.split(',').map(k => k.trim());
        const modelName = "gemini-1.5-flash";
        const systemPrompt = `Evaluate Hiragana '${target}'. Score(0-100) and short Korean feedback. JSON:{"score":number,"feedback":string}`;

        // API 키 순환 로직
        const apiKey = apiKeys[currentKeyIndex];
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

        // ✅ v1 정식 주소 사용
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: systemPrompt },
                            { inlineData: { mimeType: "image/jpeg", data: imageData } }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Gemini API 호출 실패');
        }

        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        return res.status(200).json(JSON.parse(resultText));

    } catch (error) {
        console.error('Server Error:', error);
        return res.status(500).json({ error: '서버 오류', details: error.message });
    }
}
