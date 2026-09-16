const ALLOWED_ORIGIN =
  "https://jackgamingofficeal-dotcom.github.io";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 120000;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
  "Vary": "Origin"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders
    }
  });
}

function isAllowedOrigin(request) {
  return request.headers.get("Origin") === ALLOWED_ORIGIN;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function randomHex(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    key,
    256
  );

  return {
    hash: bytesToHex(new Uint8Array(bits)),
    salt: bytesToHex(salt)
  };
}

async function verifyPassword(password, stored) {
  const parts = stored.split("$");

  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];

  if (!Number.isInteger(iterations) || iterations < 10000) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  const actual = bytesToHex(new Uint8Array(bits));

  return actual === expected;
}

function makePasswordHash(hash, salt) {
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[name] = value;
  }

  return cookies;
}

function sessionCookie(token) {
  return [
    `tor_ai_session=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}`
  ].join("; ");
}

function clearSessionCookie() {
  return [
    "tor_ai_session=",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    "Path=/",
    "Max-Age=0"
  ].join("; ");
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.tor_ai_session;

  if (!token) return null;

  const tokenHash = await sha256(token);

  const row = await env.DB.prepare(`
    SELECT
      sessions.id AS session_id,
      users.id,
      users.name,
      users.email,
      users.created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ?
      AND sessions.expires_at > ?
    LIMIT 1
  `)
    .bind(tokenHash, Date.now())
    .first();

  return row || null;
}

async function createSession(userId, env) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_MAX_AGE;

  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `)
    .bind(tokenHash, userId, expiresAt)
    .run();

  return token;
}

async function deleteCurrentSession(request, env) {
  const cookies = parseCookies(request);
  const token = cookies.tor_ai_session;

  if (!token) return;

  const tokenHash = await sha256(token);

  await env.DB.prepare(
    "DELETE FROM sessions WHERE id = ?"
  )
    .bind(tokenHash)
    .run();
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

    /*
     * Health check
     */
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        service: "TOR AI API"
      });
    }

    /*
     * REGISTER
     */
    if (
      url.pathname === "/auth/register" &&
      request.method === "POST"
    ) {
      if (!isAllowedOrigin(request)) {
        return json({ error: "Forbidden origin." }, 403);
      }

      try {
        const body = await request.json();

        const name = String(body.name || "").trim();
        const email = String(body.email || "")
          .trim()
          .toLowerCase();
        const password = String(body.password || "");

        if (!name || name.length < 2) {
          return json(
            { error: "Please enter a valid name." },
            400
          );
        }

        if (!email || !email.includes("@")) {
          return json(
            { error: "Please enter a valid email." },
            400
          );
        }

        if (password.length < 8) {
          return json(
            { error: "Password must be at least 8 characters." },
            400
          );
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email = ? LIMIT 1"
        )
          .bind(email)
          .first();

        if (existing) {
          return json(
            { error: "An account with this email already exists." },
            409
          );
        }

        const { hash, salt } = await hashPassword(password);

        const passwordHash = makePasswordHash(hash, salt);

        const result = await env.DB.prepare(`
          INSERT INTO users
            (name, email, password_hash)
          VALUES
            (?, ?, ?)
        `)
          .bind(name, email, passwordHash)
          .run();

        return json({
          message: "Account created successfully.",
          userId: result.meta.last_row_id
        }, 201);

      } catch (error) {
        return json({
          error: error?.message || "Registration failed."
        }, 500);
      }
    }

    /*
     * LOGIN
     */
    if (
      url.pathname === "/auth/login" &&
      request.method === "POST"
    ) {
      if (!isAllowedOrigin(request)) {
        return json({ error: "Forbidden origin." }, 403);
      }

      try {
        const body = await request.json();

        const email = String(body.email || "")
          .trim()
          .toLowerCase();

        const password = String(body.password || "");

        if (!email || !password) {
          return json(
            { error: "Email and password are required." },
            400
          );
        }

        const user = await env.DB.prepare(`
          SELECT id, name, email, password_hash
          FROM users
          WHERE email = ?
          LIMIT 1
        `)
          .bind(email)
          .first();

        if (!user) {
          return json(
            { error: "Invalid email or password." },
            401
          );
        }

        const valid = await verifyPassword(
          password,
          user.password_hash
        );

        if (!valid) {
          return json(
            { error: "Invalid email or password." },
            401
          );
        }

        await deleteCurrentSession(request, env);

        const token = await createSession(user.id, env);

        return json(
          {
            message: "Login successful.",
            user: {
              id: user.id,
              name: user.name,
              email: user.email
            }
          },
          200,
          {
            "Set-Cookie": sessionCookie(token)
          }
        );

      } catch (error) {
        return json({
          error: error?.message || "Login failed."
        }, 500);
      }
    }

    /*
     * PROFILE
     */
    if (
      url.pathname === "/auth/profile" &&
      request.method === "GET"
    ) {
      try {
        const user = await getSessionUser(request, env);

        if (!user) {
          return json(
            { error: "Not authenticated." },
            401
          );
        }

        return json({
          authenticated: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            created_at: user.created_at
          }
        });

      } catch (error) {
        return json({
          error: error?.message || "Profile request failed."
        }, 500);
      }
    }

    /*
     * LOGOUT
     */
    if (
      url.pathname === "/auth/logout" &&
      request.method === "POST"
    ) {
      if (!isAllowedOrigin(request)) {
        return json({ error: "Forbidden origin." }, 403);
      }

      try {
        await deleteCurrentSession(request, env);

        return json(
          {
            message: "Logout successful."
          },
          200,
          {
            "Set-Cookie": clearSessionCookie()
          }
        );

      } catch (error) {
        return json({
          error: error?.message || "Logout failed."
        }, 500);
      }
    }

    /*
     * EXISTING OPENAI API
     */
    if (
      url.pathname !== "/api/openai" ||
      request.method !== "POST"
    ) {
      return json(
        { error: "Not found" },
        404
      );
    }

    if (!isAllowedOrigin(request)) {
      return json(
        { error: "Forbidden origin." },
        403
      );
    }

    try {
      const body = await request.json();

      const question = String(
        body.question || ""
      ).trim();

      const image =
        typeof body.image === "string"
          ? body.image
          : "";

      if (!question && !image) {
        return json(
          { error: "Question or image is required." },
          400
        );
      }

      if (image) {
        if (!image.startsWith("data:image/")) {
          return json(
            { error: "Invalid image format." },
            400
          );
        }

        if (image.length > 8_000_000) {
          return json(
            {
              error:
                "Image is too large. Please choose a smaller image."
            },
            400
          );
        }
      }

      if (!env.OPENAI_API_KEY) {
        return json(
          {
            error:
              "OPENAI_API_KEY is not configured."
          },
          500
        );
      }

      const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization":
              `Bearer ${env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-5.6-luna",
            input: image
              ? [
                  {
                    role: "user",
                    content: [
                      {
                        type: "input_text",
                        text:
                          question ||
                          "Please analyze the attached image and explain what you can see."
                      },
                      {
                        type: "input_image",
                        image_url: image
                      }
                    ]
                  }
                ]
              : question
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return json(
          {
            error:
              data?.error?.message ||
              "OpenAI request failed."
          },
          response.status
        );
      }

      let answer =
        data.output_text || "";

      if (
        !answer &&
        Array.isArray(data.output)
      ) {
        answer = data.output
          .flatMap(
            item => item.content || []
          )
          .filter(
            item =>
              item.type === "output_text"
          )
          .map(
            item => item.text
          )
          .join("");
      }

      return json({
        answer:
          answer ||
          "No answer received."
      });

    } catch (error) {
      return json({
        error:
          error?.message ||
          "Server error."
      }, 500);
    }
  }
};
