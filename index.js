import express from "express";
import { OpenAI } from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// URL of your booking micro-service
const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are Zyra — an intelligent, friendly AI booking assistant used by service-based businesses.

Your core responsibilities:
1. Help clients understand available services, prices, and booking options.
2. Guide first-time clients through a step-by-step booking flow (gather name, service, date, time, phone number).
3. For returning clients, allow fast, shorthand booking. If a user says something like "gel nails next Tuesday at 2pm, Sarah, 07123…", understand and process it.
4. Always confirm missing REQUIRED details (name, service, date, time, phone). Do NOT block on optional notes.

Important booking rules:
- If the user has already clearly provided name, phone, service, date, and time in a SINGLE message, DO NOT ask any extra follow-up questions about preferences or notes. Assume notes can be an empty string ("") unless the user explicitly includes them.
- If the date or time is written in natural language (for example: "next Tuesday", "tomorrow at 2pm", "this Friday morning"), DO NOT ask the user to clarify it into an exact calendar date. Just copy the phrase exactly as they wrote it into the "date" and "time" fields.

When a booking is ready and fully confirmed:
- Reply with ONLY a single JSON object.
- No backticks, no code fences, no extra text before or after.
- The JSON must look like this, with the placeholders replaced by real values:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

If you are NOT creating or updating a booking, answer normally in plain text (no JSON).`,
        },
        { role: "user", content: message },
      ],
    });

    const aiReply =
      completion.choices[0]?.message?.content?.trim() || "";

    // Try to interpret the reply as booking JSON
    let booking = null;

    try {
      const parsed = JSON.parse(aiReply);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.name &&
        parsed.phone &&
        parsed.service &&
        parsed.date &&
        parsed.time
      ) {
        booking = parsed;
      }
    } catch (err) {
      booking = null;
    }

    // If Zyra returned booking JSON, send it to the booking API
    if (booking) {
      try {
        const bookingResponse = await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(booking),
        });

        if (!bookingResponse.ok) {
          console.error(
            "Booking API error:",
            bookingResponse.status,
            await bookingResponse.text()
          );
          return res.json({
            reply:
              "I tried to create your booking but something went wrong on the booking system. Please try again in a moment or contact the business directly.",
          });
        }

        // Friendly confirmation back to the user
        return res.json({
          reply: `You're booked for ${booking.service} on ${booking.date} at ${booking.time} under ${booking.name}. If anything is wrong, reply here and I'll adjust it.`,
        });
      } catch (error) {
        console.error("Booking API request failed:", error);
        return res.json({
          reply:
            "I couldn't reach the booking system just now. Please try again in a moment or contact the business directly.",
        });
      }
    }

    // If it's not booking JSON, just send Zyra's text reply straight back
    return res.json({ reply: aiReply });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again in a moment.",
    });
  }
});

app.listen(process.env.PORT || 3000);
