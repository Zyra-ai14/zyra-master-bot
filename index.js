import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use("/public", express.static(path.join(__dirname, "public")));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DEFAULT_BUSINESS_SLUG = "demo";

const BOOKING_API_URL =
  "https://function-bun-production-7b13.up.railway.app/api/book";

// Temporary in-memory pending bookings
// Keyed by business slug + user IP
const pendingBookings = new Map();
const PENDING_BOOKING_TTL_MS = 15 * 60 * 1000;

// Temporary in-memory session memory
// Keyed by business slug + user IP
const sessionMemory = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

function getPendingBookingKey(req, slug, phone = null, sessionId = null) {
  if (sessionId) {
    return `${slug}::session::${sessionId}`;
  }

  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.ip ||
    "unknown";

  return `${slug}::ip::${ip}`;
}
function cleanupPendingBooking(key) {
  const pending = pendingBookings.get(key);
  if (!pending) return null;

  const age = Date.now() - pending.createdAt;
  if (age > PENDING_BOOKING_TTL_MS) {
    pendingBookings.delete(key);
    return null;
  }

  return pending;
}

function getSessionMemory(key) {
  const session = sessionMemory.get(key);
  if (!session) return null;

  const age = Date.now() - session.createdAt;
  if (age > SESSION_TTL_MS) {
    sessionMemory.delete(key);
    return null;
  }

  return session;
}

function setSessionMemory(key, data) {
  const existing = getSessionMemory(key) || {};

  sessionMemory.set(key, {
    ...existing,
    ...data,
    createdAt: Date.now(),
  });
}

function findBestServiceMatch(userText, services) {
  if (!userText || services.length === 0) return null;

  const cleaned = userText.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const svc of services) {
    const name = (svc.name || "").toLowerCase();
    let score = 0;

    if (cleaned.includes(name)) {
      score = 1.0;
    } else {
      let i = 0;
      for (const c of name) {
        if (cleaned.includes(c)) i++;
      }
      score = i / Math.max(name.length, 1);
    }

    if (score > bestScore) {
      bestScore = score;
      best = svc;
    }
  }

  return bestScore >= 0.45 ? best : null;
}

function findProviderFromText(userText, providers) {
  if (!userText) return null;

  const cleaned = userText.toLowerCase();

  for (const p of providers) {
    if (cleaned.includes(p.name.toLowerCase())) {
      return p;
    }
  }

  return null;
}

function getOrdinalSuffix(day) {
  const remainder100 = day % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${day}th`;
  }

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatCustomerDate(dateText, locale = "en-GB") {
  if (!dateText || typeof dateText !== "string") return dateText;

  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateText;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);

  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(date);

  return `${weekday} ${getOrdinalSuffix(day)} ${monthName}`;
}

function normalizeTimeInput(timeText) {
  if (!timeText || typeof timeText !== "string") return null;

  const raw = timeText.trim().toLowerCase();

  let match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0"
      )}`;
    }
  }

  match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "00");
    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

    if (meridiem === "am") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}`;
  }

  match = raw.match(/^(\d{2})(\d{2})$/);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
        2,
        "0"
      )}`;
    }
  }

  return null;
}
function extractTimeFromText(text) {
  if (!text || typeof text !== "string") return null;

  const direct = normalizeTimeInput(text);
  if (direct) return direct;

  const raw = text.toLowerCase();

  let match = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (match) {
    return normalizeTimeInput(match[0]);
  }

  match = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match) {
    return normalizeTimeInput(match[0]);
  }

  return null;
}

function extractDateFromText(text) {
  if (!text || typeof text !== "string") return null;

  const raw = text.toLowerCase();

  if (raw.includes("tomorrow")) return "tomorrow";
  const numericDateMatch = raw.match(
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}\b/
);

if (numericDateMatch) {
  return numericDateMatch[0];
}
  if (raw.includes("today")) return "today";

  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  let bestMatch = null;
  let bestIndex = -1;

  for (const day of days) {
    const nextDay = `next ${day}`;

    const nextIndex = raw.lastIndexOf(nextDay);
    if (nextIndex > bestIndex) {
      bestIndex = nextIndex;
      bestMatch = nextDay;
    }


   const dayIndex = raw.lastIndexOf(day);
const isPartOfNextDay =
  dayIndex >= 5 && raw.slice(dayIndex - 5, dayIndex) === "next ";

if (dayIndex > bestIndex && !isPartOfNextDay) {
  bestIndex = dayIndex;
  bestMatch = day;
}
  }

  return bestMatch;
}

function resolveRelativeDateToIso(
  dateText,
  timeZone = "Europe/London",
  locale = "en-GB"
) {  if (!dateText || typeof dateText !== "string") return dateText;

  const raw = dateText.trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
const numericDate = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
if (numericDate) {
  const first = Number(numericDate[1]);
  const second = Number(numericDate[2]);
  const year = Number(numericDate[3]);

  const usesMonthFirst = /^en-US\b/i.test(locale);

  const month = usesMonthFirst ? first : second;
  const day = usesMonthFirst ? second : first;

  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  const isValid =
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day;

  if (isValid) {
    return parsedDate.toISOString().slice(0, 10);
  }

  return dateText;
}
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
const monthNames = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const writtenDateMatch = raw.match(
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/
);

if (writtenDateMatch) {
  const writtenMonth = monthNames[writtenDateMatch[1]];
  const writtenDay = Number(writtenDateMatch[2]);
  let writtenYear = writtenDateMatch[3]
    ? Number(writtenDateMatch[3])
    : year;

  let parsedWrittenDate = new Date(
    Date.UTC(writtenYear, writtenMonth, writtenDay)
  );

  const currentBusinessDate = new Date(Date.UTC(year, month - 1, day));

  if (
    !writtenDateMatch[3] &&
    parsedWrittenDate < currentBusinessDate
  ) {
    writtenYear += 1;
    parsedWrittenDate = new Date(
      Date.UTC(writtenYear, writtenMonth, writtenDay)
    );
  }

  const isValidWrittenDate =
    parsedWrittenDate.getUTCFullYear() === writtenYear &&
    parsedWrittenDate.getUTCMonth() === writtenMonth &&
    parsedWrittenDate.getUTCDate() === writtenDay;

  if (isValidWrittenDate) {
    return parsedWrittenDate.toISOString().slice(0, 10);
  }

  return dateText;
}
  const baseDate = new Date(Date.UTC(year, month - 1, day));

  if (raw === "today") {
    return baseDate.toISOString().slice(0, 10);
  }

  if (raw === "tomorrow") {
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
    return baseDate.toISOString().slice(0, 10);
  }

  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const isNextWeek = raw.startsWith("next ");

const weekdayName = isNextWeek
  ? raw.replace("next ", "")
  : raw;

if (weekdays[weekdayName] !== undefined) {
  const currentDay = baseDate.getUTCDay();
  const targetDay = weekdays[weekdayName];

  let daysAhead = (targetDay - currentDay + 7) % 7;

  if (daysAhead === 0) {
    daysAhead = 7;
  }

  if (isNextWeek) {
    daysAhead += 7;
  }

    baseDate.setUTCDate(baseDate.getUTCDate() + daysAhead);

    return baseDate.toISOString().slice(0, 10);
  }

  return dateText;
}function formatTimeForHumans(normalizedTime) {
  if (!normalizedTime || typeof normalizedTime !== "string") return normalizedTime;

  const match = normalizedTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) return normalizedTime;

  let hour = Number(match[1]);
  const minute = match[2];

  const meridiem = hour >= 12 ? "pm" : "am";
  hour = hour % 12;
  if (hour === 0) hour = 12;

  if (minute === "00") {
    return `${hour}${meridiem}`;
  }

  return `${hour}:${minute}${meridiem}`;
}

function getNextAvailableTimes(bookedTimes, requestedTime) {
  const allSlots = [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
    "19:00",
    "20:00",
  ];

  const requestedIndex = allSlots.indexOf(requestedTime);
  if (requestedIndex === -1) return [];

  const suggestions = [];

  for (let i = requestedIndex - 1; i >= 0; i--) {
    if (!bookedTimes.includes(allSlots[i])) {
      suggestions.push(allSlots[i]);
      break;
    }
  }

  for (let i = requestedIndex + 1; i < allSlots.length; i++) {
    if (!bookedTimes.includes(allSlots[i])) {
      suggestions.push(allSlots[i]);
      break;
    }
  }

  return suggestions;
}

async function getLatestActiveBooking(clientId) {
  const result = await pool.query(
    `SELECT id, business_id, client_id, provider_id, service, date, time, notes, status
     FROM bookings
     WHERE client_id = $1
     AND COALESCE(status, 'booked') != 'cancelled'
     ORDER BY id DESC
     LIMIT 1`,
    [clientId]
  );

  return result.rows[0] || null;
}

app.post("/chat", async (req, res) => {
  try {
const { message, businessSlug, sessionId } = req.body;
    if (!message) {
      return res.json({ reply: "You didn't send a message." });
    }

    const slug = businessSlug || DEFAULT_BUSINESS_SLUG;
    const earlyPhoneMatch = message.match(/\b0\d{10,14}\b/);
const earlyPhone = earlyPhoneMatch ? earlyPhoneMatch[0] : null;
const pendingKey = getPendingBookingKey(req, slug, earlyPhone, sessionId);
   const businessResult = await pool.query(
  "SELECT id, name, timezone, locale FROM businesses WHERE slug = $1",
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
const businessTimezone = business.timezone || "Europe/London";
    const businessLocale = business.locale || "en-GB";

const businessCurrentDateTime = new Intl.DateTimeFormat(businessLocale, {
  timeZone: businessTimezone,
  dateStyle: "full",
  timeStyle: "long",
}).format(new Date());
    const servicesResult = await pool.query(
      "SELECT id, name, description, price_cents, duration_minutes FROM services WHERE business_id = $1 AND is_active = TRUE",
      [businessId]
    );

    const services = servicesResult.rows;

    const providersResult = await pool.query(
      `SELECT 
         p.id,
         p.name,
         ARRAY_REMOVE(ARRAY_AGG(s.name), NULL) AS services
       FROM providers p
       LEFT JOIN provider_services ps ON ps.provider_id = p.id
       LEFT JOIN services s ON s.id = ps.service_id
       WHERE p.business_id = $1 AND p.is_active = TRUE
       GROUP BY p.id, p.name
       ORDER BY p.name`,
      [businessId]
    );

    const providers = providersResult.rows;

    let booking = null;
    let knownClient = null;
    let lastBooking = null;

    let existingActiveBooking = null;

const wantsToReschedule =
  /\b(reschedule|rearrange|move|change)\b/i.test(message) &&
  /\b(appointment|booking|time|date|slot|it)\b/i.test(message);

    // Detect returning customer by phone number in the message or session
    const phoneMatch = message.match(/\b0\d{10,14}\b/);
    let phoneToUse = null;

    if (phoneMatch) {
      phoneToUse = phoneMatch[0];
      setSessionMemory(pendingKey, { phone: phoneToUse });
    } else if (session?.phone) {
      phoneToUse = session.phone;
    }

    if (phoneToUse) {
      const knownClientResult = await pool.query(
        `SELECT id, name, phone
         FROM clients
         WHERE business_id = $1 AND phone = $2
         LIMIT 1`,
        [businessId, phoneToUse]
      );

      if (knownClientResult.rows.length > 0) {
        knownClient = knownClientResult.rows[0];
        setSessionMemory(pendingKey, {
          phone: knownClient.phone,
          name: knownClient.name,
        });
      }
    }

    if (knownClient) {
      const lastBookingResult = await pool.query(
        `SELECT service, provider_id
         FROM bookings
         WHERE client_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [knownClient.id]
      );

      if (lastBookingResult.rows.length > 0) {
        lastBooking = lastBookingResult.rows[0];
      }
    }

if (knownClient && wantsToReschedule) {
  existingActiveBooking = await getLatestActiveBooking(knownClient.id);

  if (!existingActiveBooking) {
    return res.json({
      reply: "I couldn't find any active bookings to change.",
    });
  }
}
    
    const pending = cleanupPendingBooking(pendingKey);
    const possibleTime = extractTimeFromText(message);
const possibleDate = resolveRelativeDateToIso(
  extractDateFromText(message),
  businessTimezone,
  businessLocale
);

if (
  existingActiveBooking &&
  wantsToReschedule &&
  possibleDate &&
  !possibleTime
) {
  pendingBookings.set(pendingKey, {
    createdAt: Date.now(),
    name: knownClient.name,
    phone: knownClient.phone,
    service: existingActiveBooking.service,
    date: possibleDate,
    time: null,
    notes: existingActiveBooking.notes || "",
    providerId: existingActiveBooking.provider_id,
    isReschedule: true,
    existingBookingId: existingActiveBooking.id,
  });

  return res.json({
    reply: `What time would you like for your appointment on ${possibleDate}?`,
  });
}
if (existingActiveBooking && wantsToReschedule && (possibleTime || possibleDate)) {
  booking = {
    name: knownClient.name,
    phone: knownClient.phone,
    service: existingActiveBooking.service,
    date: possibleDate || existingActiveBooking.date,
    time: possibleTime || existingActiveBooking.time,
    notes: existingActiveBooking.notes || "",
  };
} else if (pending && (possibleTime || possibleDate)) {
      booking = {
        name: pending.name,
        phone: pending.phone,
        service: pending.service,
date: possibleDate || pending.date,
time: possibleTime || pending.time,
        notes: pending.notes || "",
      };
    } else {
      const servicesText = services
        .map(
          (s) =>
            `- ${s.name} (£${(s.price_cents / 100).toFixed(
              2
            )}, ${s.duration_minutes} mins)`
        )
        .join("\n");

      const providersText = providers
        .map(
          (p) =>
            `${p.name} offers: ${
              p.services && p.services.length
                ? p.services.join(", ")
                : "No services assigned"
            }`
        )
        .join("\n");

      const completion = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `
You are Zyra — the intelligent AI booking assistant for service-based businesses.
BUSINESS TIMEZONE: ${businessTimezone}
CURRENT BUSINESS DATE AND TIME: ${businessCurrentDateTime}
Interpret all dates and times using this business timezone.
Words such as "today", "tomorrow", and weekdays must refer to the business's local date, not the server's date.
Do not calculate, invent or state the calendar date for relative date phrases such as "today", "tomorrow", "Tuesday" or "next Wednesday".
When the customer gives a relative date phrase, preserve that phrase exactly in the booking JSON date field.
The backend is responsible for converting relative date phrases into the correct calendar date.
WRITING STYLE:
Use natural, everyday British English.
Write like a professional human receptionist, not like an AI assistant.
Use normal punctuation such as full stops, commas, question marks and contractions.
Do not use em dashes (—) or en dashes (–) in customer-facing replies.
Keep replies warm, clear and conversational.
Avoid robotic, overly formal or stereotypical AI phrasing.

Here is the live list of services:

${servicesText || "(No services found yet)"}

Here are the staff members:

${providersText || "(No providers found yet)"}

Known returning client:
${
  knownClient
    ? `Name: ${knownClient.name}, Phone: ${knownClient.phone}`
    : "None"
}

Last booking:
${
  lastBooking
    ? `Service: ${lastBooking.service}, Provider: ${
        providers.find((p) => p.id === lastBooking.provider_id)?.name || "Unknown"
      }`
    : "None"
}

Current appointment being changed:
${
  existingActiveBooking
    ? `Service: ${existingActiveBooking.service}
Date: ${existingActiveBooking.date}
Time: ${existingActiveBooking.time}
Status: ${existingActiveBooking.status}`
    : "None"
}

Rules:
1. Users may ask for a specific staff member.
2. Users may ask "who does X service".
3. Users may ask "book with Emma".
4. Users may ask for the next available appointment with a specific provider.
5. Users may ask for any provider, any stylist, any barber, or next available.
6. Users may change provider during the conversation, for example "book with Olivia instead".
7. You must respect which provider offers which services.
8. If a user provides enough booking details to create a booking, return ONLY JSON.
9. If the user mentions a provider, put that provider name into the notes field exactly like this: "provider: Emma"
10. If the user asks for any provider or next available without naming someone, leave notes empty unless the user adds other notes.
11. If a known returning client is shown above and the phone number matches, you may use their stored name even if the user does not type their name again.
12. If the user gives phone + service + date + time, that is enough for a booking when the known returning client is available above.
13. If the user does not specify a provider, you may still return booking JSON. Do not ask for a provider unless the user explicitly asks for a specific staff member or asks who does a service.
14. If the user says "same", "same as last time", or similar:
- If a last booking exists, use it.
- If no last booking is available, ask for their phone number to retrieve it.
15. If the user says "same" or "same as last time":
- If a last booking exists AND the user provides a time or date, proceed directly to booking without asking for confirmation.
- If the user does NOT provide a time or date, ask for confirmation before booking.
16. If a known returning client replies with "yes", "yes please", "sure", "okay", or similar, and gives a new date or time without naming a service or provider, treat this as confirmation to use their last booking's service and provider with the new date or time. Do not ask them to confirm the service or provider again.
17. If a known returning client is shown above, and the user does not type their phone number again, continue using that known returning client for this session.
18. NEVER mention provider IDs to the user. Always use provider names only.
19. If "Current appointment being changed" is not None, the user is rescheduling an existing booking.
20. If the user provides BOTH a new date and a new time, immediately return booking JSON using the existing service, provider and client details.
21. If the user provides ONLY a new time, keep the existing date and return booking JSON.
22. If the user provides ONLY a new date when rescheduling, DO NOT return booking JSON. Instead, reply with a normal conversational message asking what time they would like on that date. Wait for their reply before returning booking JSON.
23. Do not return booking JSON until both the new date and new time are known, unless only the time changed.
24. Always preserve the existing service, provider, client and phone number during a reschedule unless the user explicitly asks to change them.
25. Never ask which service they want when rescheduling unless they explicitly ask to change the service.

Return booking JSON like this:

{
  "name": "<name>",
  "phone": "<phone>",
  "service": "<service>",
  "date": "<date>",
  "time": "<time>",
  "notes": "<notes or empty string>"
}

Otherwise respond normally in plain text.
`,
          },
          { role: "user", content: message },
        ],
      });

      const aiReply = completion.choices[0]?.message?.content?.trim() || "";

      try {
        const parsed = JSON.parse(aiReply);
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.service &&
          parsed.date &&
          parsed.time &&
          (parsed.phone || knownClient?.phone || session?.phone)
        ) {
          booking = {
            ...parsed,
            phone: parsed.phone || knownClient?.phone || session?.phone,
          };
        }
      } catch {
        booking = null;
      }

      if (!booking) {
        const isOnlyPhone = /^0\d{10,14}$/.test(message.trim());

        if (isOnlyPhone && knownClient && lastBooking) {
          const providerName =
            providers.find((p) => p.id === lastBooking.provider_id)?.name ||
            "your usual stylist";

          return res.json({
reply: `Welcome back ${knownClient.name}. Would you like to book ${lastBooking.service} with ${providerName} again?`,          });
        }
const requestedService = findBestServiceMatch(message, services);
const requestedProvider = findProviderFromText(message, providers);

const requestedNameMatch = message.match(
  /\b(?:my name is|i am|i'm)\s+([a-z][a-z'-]*)/i
);

const requestedName =
  requestedNameMatch?.[1] ||
  knownClient?.name ||
  session?.name ||
  null;

const requestedPhone =
  earlyPhone ||
  knownClient?.phone ||
  session?.phone ||
  null;

const providerOffersService =
  requestedProvider &&
  requestedService &&
  requestedProvider.services?.some(
    (serviceName) =>
      serviceName.toLowerCase() === requestedService.name.toLowerCase()
  );

if (
  requestedProvider &&
  requestedService &&
  !providerOffersService &&
  requestedName &&
  requestedPhone &&
  possibleDate &&
  possibleTime
) {
  pendingBookings.set(pendingKey, {
    createdAt: Date.now(),
    name: requestedName,
    phone: requestedPhone,
    service: requestedService.name,
    date: possibleDate,
    time: possibleTime,
    notes: "",
    providerId: requestedProvider.id,
  });
}
        return res.json({ reply: aiReply });
      }
    }

    // Force correct stored name for returning clients
    if (
      knownClient &&
      booking &&
      (!booking.name || booking.name.toLowerCase() === "new client")
    ) {
      booking.name = knownClient.name;
    }

    // Force correct stored phone from session/known client if needed
    if (!booking.phone && (knownClient?.phone || session?.phone)) {
      booking.phone = knownClient?.phone || session?.phone;
    }

    if (booking && services.length > 0) {
      const match = findBestServiceMatch(booking.service, services);
      if (match) booking.service = match.name;
    }

    if (booking) {
      const notes = booking.notes || "";

      const providerFromMessage = findProviderFromText(message, providers);

const providerMatch =
  providerFromMessage ||
  (pending
    ? providers.find((p) => p.id === pending.providerId) || null
    : null);

      let providerId = providerMatch ? providerMatch.id : null;

      if (!providerId && lastBooking?.provider_id) {
        providerId = lastBooking.provider_id;
      }

      if (!providerId) {
        const providerResult = await pool.query(
          `SELECT p.id
           FROM providers p
           JOIN provider_services ps ON ps.provider_id = p.id
           JOIN services s ON s.id = ps.service_id
           WHERE p.business_id = $1
           AND p.is_active = TRUE
           AND s.name = $2
           LIMIT 1`,
          [businessId, booking.service]
        );

        providerId = providerResult.rows[0]?.id || null;
      }

      const assignedProvider =
        providers.find((p) => p.id === providerId) || providerMatch || null;

booking.date = resolveRelativeDateToIso(
  booking.date,
  businessTimezone,
  businessLocale
);      const normalizedTime = normalizeTimeInput(booking.time);

      if (!normalizedTime) {
        return res.json({
          reply:
            "I couldn't understand that time. Please use something like 3pm or 15:00.",
        });
      }

      if (providerId) {
        const existingBookingResult = await pool.query(
      `SELECT id
FROM bookings
WHERE business_id = $1
AND provider_id = $2
AND LOWER(date) = LOWER($3)
AND time = $4
AND status = 'booked'
LIMIT 1`,
[businessId, providerId, booking.date, normalizedTime]
        );

        if (existingBookingResult.rows.length > 0) {
          const bookedTimesResult = await pool.query(
       `SELECT time
FROM bookings
WHERE business_id = $1
AND provider_id = $2
AND LOWER(date) = LOWER($3)
AND status = 'booked'`,
[businessId, providerId, booking.date]
          );

          const bookedTimes = bookedTimesResult.rows.map((r) => r.time);
          const suggestions = getNextAvailableTimes(bookedTimes, normalizedTime);

          pendingBookings.set(pendingKey, {
            createdAt: Date.now(),
            name: booking.name,
            phone: booking.phone,
            service: booking.service,
            date: booking.date,
            notes,
            providerId,
          });

          const suggestionText = suggestions.length
            ? `${assignedProvider?.name || "They"}'s available at ${suggestions
                .map(formatTimeForHumans)
                .join(" or ")}.`
            : "No nearby slots available.";

          return res.json({
            reply: `${assignedProvider?.name || "This staff member"} is already booked at ${formatTimeForHumans(
              normalizedTime
            )}. ${suggestionText} Would you like to book one of those?`,
          });
        }
      }

      let clientId;

      const existingClient = await pool.query(
        `SELECT id FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
        [businessId, booking.phone]
      );

      if (existingClient.rows.length > 0) {
        clientId = existingClient.rows[0].id;
      } else {
        const clientResult = await pool.query(
          `INSERT INTO clients (business_id, name, phone, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [businessId, booking.name, booking.phone, notes]
        );

        clientId = clientResult.rows[0].id;
      }
const rescheduleBookingId =
  existingActiveBooking?.id ||
  (pending?.isReschedule ? pending.existingBookingId : null);

const rescheduleProviderId =
  pending?.isReschedule && pending?.providerId
    ? pending.providerId
    : providerId;

const shouldUpdateExistingBooking =
  (existingActiveBooking && wantsToReschedule) ||
  (pending?.isReschedule && pending?.existingBookingId);
   if (shouldUpdateExistingBooking) {
  await pool.query(
    `UPDATE bookings
     SET
       provider_id = $1,
       service = $2,
       date = $3,
       time = $4,
       notes = $5,
       updated_at = NOW()
     WHERE id = $6`,
    [
rescheduleProviderId,
      booking.service,
      booking.date,
      normalizedTime,
      notes,
rescheduleBookingId,
    ]
  );
} else {
  await pool.query(
    `INSERT INTO bookings (business_id, client_id, provider_id, service, date, time, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      businessId,
      clientId,
      providerId,
      booking.service,
      booking.date,
      normalizedTime,
      notes,
    ]
  );
}

      pendingBookings.delete(pendingKey);

      if (booking.phone || booking.name) {
        setSessionMemory(pendingKey, {
          phone: booking.phone,
          name: booking.name,
        });
      }

      try {
        await fetch(BOOKING_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...booking,
            time: normalizedTime,
          }),
        });
      } catch (apiError) {
        console.error("Error calling Booking API:", apiError);
      }

      const providerName = assignedProvider ? assignedProvider.name : null;
      const humanTime = formatTimeForHumans(normalizedTime);
const customerDate = formatCustomerDate(booking.date, businessLocale);
   const dateText = `on ${customerDate} at ${humanTime}`;

      const replyText = providerName
        ? `You're booked for ${booking.service} with ${providerName} ${dateText} under ${booking.name}. Let me know if you'd like to change anything.`
        : `You're booked for ${booking.service} ${dateText} under ${booking.name}. Let me know if you'd like to change anything.`;

      return res.json({
        reply: replyText,
      });
    }

    return res.json({ reply: "Something went wrong on my side. Please try again." });
  } catch (err) {
    console.error("Chat endpoint error:", err);
    return res.status(500).json({
      reply: "Something went wrong on my side. Please try again.",
    });
  }
});

app.listen(process.env.PORT || 3000);
