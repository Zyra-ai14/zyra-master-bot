import express from "express";
import { OpenAI } from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.json({ reply: "You didn’t send a message." });
  }

  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "You are Zyra, an AI assistant for service-based businesses." },
      { role: "user", content: message }
    ]
  });

  res.json({
    reply: completion.choices[0].message.content
  });
});

app.listen(process.env.PORT || 3000);
