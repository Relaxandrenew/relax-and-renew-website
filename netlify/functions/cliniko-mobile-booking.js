// netlify/functions/cliniko-mobile-booking.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const CLINIKO_BASE_URL =
  process.env.CLINIKO_BASE_URL || "https://api.au1.cliniko.com/v1";

function getClinikoAuthHeader() {
  const apiKey = process.env.CLINIKO_API_KEY;
  if (!apiKey) {
    throw new Error("Missing CLINIKO_API_KEY environment variable");
  }
  const token = Buffer.from(apiKey + ":").toString("base64");
  return "Basic " + token;
}

async function clinikoFetch(path, options = {}) {
  const url = CLINIKO_BASE_URL.replace(/\/+$/, "") + path;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: getClinikoAuthHeader(),
    ...options.headers
  };

  const res = await fetch(url, {
    ...options,
    headers
  });

  let bodyText;
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }

  let json = null;
  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch (e) {
      // leave json as null
    }
  }

  if (!res.ok) {
    const err = new Error(
      `Cliniko API error ${res.status}: ${bodyText || res.statusText}`
    );
    err.statusCode = res.status;
    err.body = bodyText;
    throw err;
  }

  return json;
}

function splitName(fullName) {
  if (!fullName) {
    return { first_name: "Client", last_name: "Relax & Renew" };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "Client" };
  }
  const first_name = parts[0];
  const last_name = parts.slice(1).join(" ");
  return { first_name, last_name };
}

async function findExistingPatientIdByEmail(email) {
  if (!email) return null;
  const q = encodeURIComponent(`email:${email}`);
  const data = await clinikoFetch(`/patients?q[]=${q}`, {
    method: "GET"
  });

  if (data && Array.isArray(data.patients) && data.patients.length > 0) {
    return data.patients[0].id;
  }
  return null;
}

async function createPatient({ full_name, email, phone }) {
  const nameParts = splitName(full_name);
  const payload = {
    first_name: nameParts.first_name,
    last_name: nameParts.last_name,
    email: email || null,
    phone_number: phone || null
  };

  const data = await clinikoFetch("/patients", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return data && data.id ? data.id : null;
}

async function ensurePatient({ full_name, email, phone }) {
  // Try find by email first
  let patientId = null;
  if (email) {
    try {
      patientId = await findExistingPatientIdByEmail(email);
    } catch (e) {
      console.error("Error searching patient by email:", e.message);
    }
  }

  if (patientId) return patientId;

  // Create new patient
  patientId = await createPatient({ full_name, email, phone });
  return patientId;
}

async function createIndividualAppointment({
  patient_id,
  slot,
  address,
  city,
  postal_code,
  treatment_type,
  phone,
  email,
  full_name
}) {
  const businessId = process.env.CLINIKO_BUSINESS_ID || null;

  const notesLines = [
    "Booked via Relax & Renew mobile booking page.",
    "",
    `Client: ${full_name || ""}`,
    `Email: ${email || ""}`,
    `Phone: ${phone || ""}`,
    "",
    "Service address:",
    address || "",
    city || "",
    postal_code || "",
    "",
    `Treatment type (client selection): ${treatment_type || ""}`
  ].filter(Boolean);

  const payload = {
    appointment_type_id: String(slot.appointment_type_id),
    patient_id: String(patient_id),
    practitioner_id: String(slot.practitioner_id),
    starts_at: slot.start,
    ends_at: slot.end || null,
    notes: notesLines.join("\n")
  };

  if (businessId) {
    payload.business_id = String(businessId);
  }

  const data = await clinikoFetch("/individual_appointments", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  return data;
}

exports.handler = async (event, context) => {
  try {
    // CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: CORS_HEADERS,
        body: ""
      };
    }

    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Method not allowed" })
      };
    }

    if (!process.env.CLINIKO_API_KEY) {
      console.error("CLINIKO_API_KEY not configured");
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Server configuration error (Cliniko API key missing)."
        })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "Invalid JSON body" })
      };
    }

    const {
      full_name,
      email,
      phone,
      treatment_type,
      address,
      city,
      postal_code,
      date,
      slot
    } = body;

    if (!full_name || !email || !slot || !slot.start || !slot.practitioner_id || !slot.appointment_type_id) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error:
            "Missing required fields (full_name, email, slot.start, slot.practitioner_id, slot.appointment_type_id)."
        })
      };
    }

    const addr = address || "";
    const ct = city || "";
    const pc = postal_code || "";

    console.log("Booking payload received:", {
      full_name,
      email,
      phone,
      treatment_type,
      date,
      slot,
      addr,
      ct,
      pc
    });

    // 1) Ensure patient exists
    const patientId = await ensurePatient({ full_name, email, phone });
    if (!patientId) {
      throw new Error("Unable to create or retrieve patient in Cliniko.");
    }

    // 2) Create individual appointment
    const appt = await createIndividualAppointment({
      patient_id: patientId,
      slot,
      address: addr,
      city: ct,
      postal_code: pc,
      treatment_type,
      phone,
      email,
      full_name
    });

    console.log("Cliniko appointment created:", appt && appt.id);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        message: "Appointment created in Cliniko.",
        appointment_id: appt && appt.id,
        patient_id: patientId
      })
    };
  } catch (err) {
    console.error("cliniko-mobile-booking error:", err.message || err);
    const status = err.statusCode && Number(err.statusCode) >= 400
      ? err.statusCode
      : 502;

    return {
      statusCode: status,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Failed to create Cliniko appointment.",
        details: err.message || String(err)
      })
    };
  }
};
