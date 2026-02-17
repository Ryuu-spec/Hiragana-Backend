let currentKeyIndex = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { target, imageData } = req.body;
    const apiKeys = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim());
    const apiKey = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: `Evaluate Hiragana '${target}'. Give a score(0-100) and short Korean feedback. JSON:{"score":number,"feedback":"string"}` },
            { inlineData: { mimeType: "image/jpeg", data: imageData } }
          ] }]
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'API Error');
    
    let resultText = data.candidates[0].content.parts[0].text;
    const jsonMatch = resultText.match(/\{.*\}/s);
    if (jsonMatch) resultText = jsonMatch[0];
    
    return res.status(200).json(JSON.parse(resultText));
  } catch (error) {
    return res.status(500).json({ error: '서버 오류', details: error.message });
  }
}
