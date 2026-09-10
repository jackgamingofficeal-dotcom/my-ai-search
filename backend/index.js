const express = require("express");
const cors = require("cors");
require("dotenv").config();

const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// ===============================
// OpenAI API
// ===============================
app.post("/api/openai", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Question is required"
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OpenAI API key is not configured"
      });
    }

    const response = await openai.responses.create({
      model: "gpt-5.6-luna",
      input:
        "You are the AI assistant inside A My AI Search. " +
        "Answer clearly, accurately and helpfully.\n\nUser: " +
        question.trim()
    });

    res.json({
      answer: response.output_text || "No answer returned."
    });

  } catch (error) {
    console.error("OpenAI error:", error);

    res.status(500).json({
      error: error?.message || "OpenAI API request failed"
    });
  }
});


// ===============================
// Gemini API
// ===============================
app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Question is required"
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is not configured"
      });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      encodeURIComponent(process.env.GEMINI_API_KEY),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text:
                    "You are the AI assistant inside A My AI Search. " +
                    "Answer clearly and helpfully.\n\nUser: " +
                    question.trim()
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API request failed"
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") || "No answer returned.";

    res.json({
      answer: text
    });

  } catch (error) {
    console.error("Gemini error:", error);

    res.status(500).json({
      error: "Gemini server error"
    });
  }
});


// ===============================
// Start server
// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`A My AI backend running on port ${PORT}`);
});
