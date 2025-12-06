import express from "express";
import { OpenAI } from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.json({ reply: "You didn’t send a message." });
  }

  // Ask Zyra for a response
  const completion = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `You are Zyra — an intelligent, friendly AI booking assistant used by service-based businesses.

Your core responsibilities:
1. Help clients understand available services, prices, and booking options.
2. Guide first-time clients through a step-by-step booking flow (gather name, service, date, time, phone number).
3. For returning clients, allow fast, shorthand booking. If a user says something like “gel nails next Tuesday at 2pm, Sarah, 07123…”, understand and process it.
4. Always confirm missing REQUIRED details (name, service, date, time, phone). Do NOT block on optional notes.

Important booking rules:
- If the user has already clearly provided name, phone, service, date, and time in a SINGLE message, DO NOT ask any extra follow-up questions about preferences or notes. Assume notes can be an empty string ("") unless the user explicitly includes them.
- If the date or time is written in natural language (for example: "next Tuesday", "tomorrow at 2pm", "this Friday morning"), DO NOT ask the user to clarify it into an exact calendar date. Just copy the phrase exactly as they wrote it into the "date" and "time" fields.

When a booking is ready:
5. Prepare a booking summary in clean JSON format, even if you also surround it with normal text. The JSON MUST be valid and look like:
{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

You do NOT actually call external APIs yourself. Instead, when a booking is clearly confirmed, you include that JSON block in your reply so that the backend system can extract it and send it to:
POST https://function-bun-production-7b13.up.railway.app/api/book (Content-Type: application/json).

Tone:
- Warm, professional, helpful.
- Speak in short, clean sentences.
- If a client just asks a question (not booking), respond normally with helpful info instead of JSON.`,
      },
      { role: "user", content: message },
    ],
  });

  const content = completion.choices[0]?.message?.content || "";
  let finalReply = content;

  // Try to extract JSON booking from Zyra's reply
  let bookingData = null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    const jsonText = content.slice(start, end + 1);
    try {
      const parsed = JSON.parse(jsonText);

      if (
        parsed.name &&
        parsed.phone &&
        parsed.service &&
        parsed.date &&
        parsed.time
      ) {
        bookingData = parsed;
      }
    } catch (err) {
      // JSON parse failed – ignore and fall back to normal reply
      console.error("Failed to parse booking JSON:", err);
    }
  }

  // If we have valid booking JSON, send it to the booking API
  if (bookingData) {
    try {
      const apiResponse = await fetch(
        "https://function-bun-production-7b13.up.railway.app/api/book",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bookingData),
        }
      );

      if (!apiResponse.ok) {
        throw new Error(`Booking API error: ${apiResponse.status}`);
      }

      const apiJson = await apiResponse.json();
      console.log("Booking created:", apiJson);

      // Clean confirmation message for the client
      finalReply = `You're booked for ${bookingData.service} on ${bookingData.date} at ${bookingData.time} under ${bookingData.name}. If anything is wrong, reply here and I'll help adjust it.`;
    } catch (error) {
      console.error("Error calling booking API:", error);
      finalReply =
        "I tried to create your booking but something went wrong on the system side. Please try again in a moment or contact the business directly.";
    }
  }

  res.json({
    reply: finalReply,
  });
});

app.listen(process.env.PORT || 3000);
