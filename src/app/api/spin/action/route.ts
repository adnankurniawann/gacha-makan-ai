/**
 * POST /api/spin/action
 *
 * Mencatat respons pengguna atas satu penayangan hasil spin.
 *
 * Lewat route handler, bukan RPC langsung dari browser, supaya klien Supabase
 * tidak perlu masuk bundle halaman spin — Fase C sengaja mengeluarkannya, dan
 * halaman itu yang paling sering dibuka di 4G goyah.
 */

import { recordSpinAction, type SpinAction } from "@/lib/supabase/events";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ACTIONS = ["accepted", "respun", "saved"] as const;

/** Longgar: satu spin bisa menghasilkan beberapa respons yang sah berturut-turut. */
const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  try {
    const limit = rateLimit(
      `spin-action:${clientIp(request)}`,
      RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS,
    );

    if (!limit.allowed) {
      return Response.json(
        { error: "Too many requests.", code: "RATE_LIMITED" },
        { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object.", code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    const { event_id, action } = body as Record<string, unknown>;

    if (typeof event_id !== "string" || !UUID_REGEX.test(event_id)) {
      return Response.json(
        { error: 'Parameter "event_id" must be a UUID.', code: "INVALID_INPUT" },
        { status: 400 },
      );
    }

    if (
      typeof action !== "string" ||
      !VALID_ACTIONS.includes(action as SpinAction)
    ) {
      return Response.json(
        {
          error: `Parameter "action" must be one of: ${VALID_ACTIONS.join(", ")}.`,
          code: "INVALID_INPUT",
        },
        { status: 400 },
      );
    }

    // Kepemilikan baris diperiksa di dalam fungsi database, bukan di sini:
    // `record_spin_action` hanya menyentuh baris milik auth.uid(). Jadi
    // menebak event_id orang lain tidak menghasilkan apa-apa.
    const recorded = await recordSpinAction(event_id, action as SpinAction);

    // `recorded: false` bukan error — biasanya berarti baris itu sudah punya
    // respons, dan respons pertama yang menang.
    return Response.json(
      { recorded },
      { status: 200, headers: rateLimitHeaders(limit, RATE_LIMIT) },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/spin/action] Unexpected error:", message);
    return Response.json(
      { error: "Internal server error.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
