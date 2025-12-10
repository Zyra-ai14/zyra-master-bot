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

// Default business slug for now (later: one per salon/gym/barber etc)
const DEFAULT_BUSINESS_SLUG = "demo";

// Your existing Bun booking microservice
const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

/**
 * Simple Levenshtein distance for fuzzy matching
 */
function levenshtein(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();

  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Pick the best-matching service name given what the AI/user wrote.
 * We compare the "service" field to all known service names and choose
 * the one with the lowest Levenshtein distance, as long as it's not crazy far.
 */
function pickBestServiceName(rawName, serviceNames) {
  if (!rawName || serviceNames.length === 0) return rawName;

  let bestName = rawName;
  let bestScore = Infinity;

  for (const name of serviceNames) {
    const dist = levenshtein(rawName, name);
    if (dist < bestScore) {
      bestScore = dist;
      bestName = name;
    }
  }

  // Optional: if the distance is huge, maybe keep original
  // Here we allow some tolerance: if it's wildly different (e.g. > half the length)
  const maxReasonable = Math.max(3, Math.floor(bestName.length / 2));
  if (bestScore > maxReasonable) {
    // Too different, keep the raw value so we can see weird cases later
    return rawName;
  }

  return bestName;
}

app.post("/chat", async (req, res) => {
  try {
    const { message, businessSlug } = req.body;

    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    // 1) Figure out which business this chat belongs to (by slug)
    const slug = businessSlug || DEFAULT_BUSINESS_SLUG;

    const businessResult = await pool.query(
      "SELECT id, name, slug FROM businesses WHERE slug = $1",
      [slug]
    );

    const business = businessResult.rows[0];

    if (!business) {
      console.error("No business found for slug:", slug);
      return res.json({
        reply:
          "I couldn't find the business configuration for this chat. Please contact support.",
      });
    }

    const businessId = business.id;

    // 2) Load this business's services so Zyra can match user text to real services
    const servicesResult = await pool.query(
      "SELECT id, name FROM services WHERE business_id = $1 AND is_active = TRUE",
      [businessId]
    );

    const services = servicesResult.rows;
    const serviceNames = services.map((s) => s.name);

    let servicesText;
    if (services.length === 0) {
      servicesText =
        "This business has no services configured yet. If a user asks to book, politely explain that booking is not available yet.";
    } else {
      servicesText =
        services
          .map((s) => `- ${s.name}`)
          .join("\n") +
        "\n\nWhen you choose a service for a booking, you MUST set the service field to EXACTLY one of these names.";
    }

    // 3) Ask Zyra what to do
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `You are Zyra — an intelligent, friendly AI booking assistant used by service-based businesses.

You are currently talking on behalf of this business:
- Name: ${business.name}
- Slug: ${business.slug}

Here is the list of services this business offers. You MUST always choose the closest match from this list when creating a booking:

${servicesText}

Service matching rules (VERY IMPORTANT):
- Always set the "service" field in the JSON to EXACTLY one of the service names from the list above.
- If the user uses a slightly different phrase, pick the closest matching service.
  Examples for salons:
    - "trim", "just the ends", "hair cut" -> map to a Haircut-style service.
    - "colour", "dye", "tint", "bleach" -> map to a Hair Colour-style service.
    - "blowdry", "blow dry", "bouncy blow" -> map to a Blow Dry-style service.
- If nothing is even roughly close, ask a short clarification question instead of guessing wildly.

Your core responsibilities:
1. Help clients understand available services, prices, and booking options.
2. Guide first-time clients through a step-by-step booking flow (gather name, service, date, time, phone number).
3. For returning clients, allow fast, shorthand booking. If a user says something like "gel nails next Tuesday at 2pm, Sarah, 07123…", understand and process it.
4. Always confirm missing REQUIRED details (name, service, date, time, phone). Do NOT block on optional notes.

IMPORTANT BOOKING BEHAVIOUR (OVERRIDES EVERYTHING ELSE):
- If the user has already clearly provided name, phone, service, date, and time in a SINGLE message, you MUST immediately output booking JSON and NOTHING ELSE.
  - Do NOT ask follow-up questions about:
    - Clarifying the date or time (e.g. "next Thursday", "tomorrow at 2pm" is fine).
    - Whether they want to add notes.
    - Preferences or extra details.
- If the date or time is written in natural language (for example: "next Thursday", "tomorrow at 2pm", "this Friday morning"), DO NOT ask the user to clarify it into an exact calendar date. Just copy the phrase exactly as they wrote it into the "date" and "time" fields.

Concrete examples (you MUST follow this pattern):

User: "Can I book a Hair Colour next Thursday at 1pm? Name is Chloe, phone 07123456789."
Assistant (correct): 
{
  "name": "Chloe",
  "phone": "07123456789",
  "service": "Hair Colour",
  "date": "next Thursday",
  "time": "1pm",
  "notes": ""
}

User: "Can I book a trim next Friday at 4pm? Name is Emma, phone 07900000000."
Assistant (correct):
{
  "name": "Emma",
  "phone": "07900000000",
  "service": "Haircut",
  "date": "next Friday",
  "time": "4pm",
  "notes": ""
}

When a booking is ready and fully confirmed:
- Reply with ONLY a single JSON object.
- No backticks, no code fences, no extra text before or after.
- The JSON must look like this, with the placeholders replaced by real values:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",   // must be EXACTLY one of this business's service names
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

    // 4) Try to interpret the reply as booking JSON
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

    // 5) If Zyra returned booking JSON, normalise the service name using fuzzy matching,
    //    then save to DB + send to booking API
    if (booking) {
      // Fuzzy-match the chosen service to one of the real service names
      if (serviceNames.length > 0 && booking.service) {
        booking.service = pickBestServiceName(booking.service, serviceNames);
      }

      const notes = booking.notes || "";

      try {
        // Insert client row
        const clientResult = await pool.query(
          `INSERT INTO clients (business_id, name, phone, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [businessId, booking.name, booking.phone, notes]
        );

        const clientId = clientResult.rows[0].id;

        // Insert booking row
        await pool.query(
          `INSERT INTO bookings (business_id, client_id, service, date, time, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            businessId,
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

      // Send booking to your Bun microservice
      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(booking),
        });
      } catch (apiError) {
        console.error("Error calling booking API:", apiError);
      }

      // Friendly confirmation back to the user
      return res.json({
        reply: `You're booked for ${booking.service} on ${booking.date} at ${booking.time} under ${booking.name}. If anything is wrong, reply here and I'll adjust it.`,
      });
    }

    // 6) If it's not booking JSON, just send Zyra's text reply straight back
    return res.json({ reply: aiReply });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again in a moment.",
    });
  }
});

app.listen(process.env.PORT || 3000);
