// Vercel serverless function — keeps the Gemini API key server-side.
// Set GEMINI_API_KEY in your Vercel project's Environment Variables.
// Get a free key at https://aistudio.google.com/apikey
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const { prompt } = req.body || {};
  if (!prompt) {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }
  try {
    const model = "gemini-2.5-flash"; // free-tier model as of this writing
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: data.error?.message || "Gemini request failed" });
      return;
    }
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
