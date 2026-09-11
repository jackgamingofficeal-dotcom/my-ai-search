const corsHeaders = {
  "Access-Control-Allow-Origin": "https://jackgamingofficeal-dotcom.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ ok: true, service: "TOR AI API" });
    }

    if (url.pathname !== "/api/openai" || request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const body = await request.json();
      const question = String(body.question || "").trim();

      if (!question) {
        return json({ error: "Question is required." }, 400);
      }

      if (!env.OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY is not configured." }, 500);
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: question
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return json({
          error: data?.error?.message || "OpenAI request failed."
        }, response.status);
      }

      let answer = data.output_text || "";

      if (!answer && Array.isArray(data.output)) {
        answer = data.output
          .flatMap(item => item.content || [])
          .filter(item => item.type === "output_text")
          .map(item => item.text)
          .join("");
      }

      return json({
        answer: answer || "No answer received."
      });

    } catch (error) {
      return json({
        error: error?.message || "Server error."
      }, 500);
    }
  }
};
