import express from "express";
import { OpenAI } from "openai";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Postgres connection (Railway DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Your existing Bun booking microservice
const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

/**
 * Helper: find business_id by slug.
 * Falls back to 'zyra-test-salon' if slug is missing or not found.
 */
async function getBusinessIdFromSlug(slugFromRequest) {
  // Default slug if none provided
  const slug = slugFromRequest && slugFromRequest.trim()
    ? slugFromRequest.trim()
    : "zyra-test-salon";

  try {
    const result = await pool.query(
      "SELECT id FROM businesses WHERE slug = $1",
      [slug]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // If slug not found, fall back to zyra-test-salon
    const fallback = await pool.query(
      "SELECT id FROM businesses WHERE slug = $1",
      ["zyra-test-salon"]
    );

    if (fallback.rows.length > 0) {
      return fallback.rows[0].id;
    }

    // Last-resort fallback if DB is empty
    return 1;
  } catch (err) {
    console.error("Error looking up business by slug:", err);
    return 1;
  }
}

app.post("/chat", async (req, res) => {
  try {
    const { message, businessSlug } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    // Resolve which business this chat is for
    const BUSINESS_ID = await getBusinessIdFromSlug(businessSlug);

    // Ask Zyra what to do
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

    const aiReply = completion.choices[0]?.message?.content?.trim() || "";

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
    } catch {
      booking = null;
    }

    // If Zyra returned booking JSON, save to DB + send to booking API
    if (booking) {
      const notes = booking.notes || "";

      try {
        // 1) Insert client row
        const clientResult = await pool.query(
          `INSERT INTO clients (business_id, name, phone, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [BUSINESS_ID, booking.name, booking.phone, notes]
        );

        const clientId = clientResult.rows[0].id;

        // 2) Insert booking row
        await pool.query(
          `INSERT INTO bookings (business_id, client_id, service, date, time, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            BUSINESS_ID,
            clientId,
            booking.service,
            booking.date,
            booking.time,
            notes,
          ]
        );
      } catch (dbError) {
        console.error("Error saving booking to Postgres:", dbError);
        // We still continue and try to hit the booking API
      }

      // 3) Send booking to your Bun microservice (same as before)
      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(booking),
        });
      } catch (apiError) {
        console.error("Error calling booking API:", apiError);
      }

      // 4) Friendly confirmation back to the user
      return res.json({
        reply: `You're booked for ${booking.service} on ${booking.date} at ${booking.time} under ${booking.name}. If anything is wrong, reply here and I'll adjust it.`,
      });
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
