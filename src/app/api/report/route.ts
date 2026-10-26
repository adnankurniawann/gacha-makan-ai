/**
 * POST /api/report
 *
 * Submit a hygiene report for a restaurant. Validates input, then hands the
 * whole operation to the `submit_hygiene_report` database function, which
 * enforces the cooldown, writes the report, and applies the score change in a
 * single transaction.
 *
 * The client has no write privilege on `hygiene_reports` or `restaurants`, so
 * this route is not the only thing standing between a stranger and the data —
 * see supabase/migrations/20260804000001_rls_hardening.sql.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 *               6.7, 10.1, 10.2, 10.3, 10.4, 10.6, 10.7
 */

import { HygieneReportError, submitHygieneReport } from "@/lib/supabase/queries";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_REPORT_TYPES = ["RED_FLAG", "CLEAN"] as const;
type ReportType = (typeof VALID_REPORT_TYPES)[number];

/**
 * Ceiling across all restaurants. The per-restaurant 24h cooldown lives in the
 * database; this only stops someone walking the whole catalogue in a loop.
 */
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  try {
    // ------------------------------------------------------------------
    // 1. Rate limit before touching the database
    // ------------------------------------------------------------------
    const limit = rateLimit(
      `report:${clientIp(request)}`,
      RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS,
    );

    if (!limit.allowed) {
      return Response.json(
        {
          error: "RATE_LIMITED",
          message: "Kebanyakan laporan dalam waktu singkat. Coba lagi nanti ya.",
          code: "RATE_LIMITED",
        },
        { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
      );
    }

    // ------------------------------------------------------------------
    // 2. Parse JSON body
    // ------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "Request body must be valid JSON.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { error: "Request body must be a JSON object.", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    const params = body as Record<string, unknown>;

    // ------------------------------------------------------------------
    // 3. Validate restaurant_id — required, must be a valid UUID string
    // ------------------------------------------------------------------
    const { restaurant_id, report_type, description } = params;

    if (
      restaurant_id === undefined ||
      restaurant_id === null ||
      typeof restaurant_id !== "string" ||
      !UUID_REGEX.test(restaurant_id)
    ) {
      return Response.json(
        {
          error:
            'Parameter "restaurant_id" is required and must be a valid UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 4. Validate report_type — required, must be "RED_FLAG" or "CLEAN"
    // ------------------------------------------------------------------
    if (
      report_type === undefined ||
      report_type === null ||
      !VALID_REPORT_TYPES.includes(report_type as ReportType)
    ) {
      return Response.json(
        {
          error:
            'Parameter "report_type" is required and must be "RED_FLAG" or "CLEAN".',
          code: "INVALID_REPORT_TYPE",
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 5. Validate description — optional, max 1000 characters
    // ------------------------------------------------------------------
    if (
      description !== undefined &&
      description !== null &&
      (typeof description !== "string" || description.length > 1000)
    ) {
      return Response.json(
        {
          error:
            'Parameter "description" must be a string with at most 1000 characters.',
          code: "INVALID_INPUT",
        },
        { status: 400 }
      );
    }

    // Cast to concrete types after validation
    const restaurantId = restaurant_id;
    const reportType = report_type as ReportType;
    const descriptionValue =
      typeof description === "string" ? description : undefined;

    // ------------------------------------------------------------------
    // 6. Record the report — cooldown and score update happen atomically
    //    inside the database function.
    // ------------------------------------------------------------------
    try {
      const restaurant = await submitHygieneReport(
        restaurantId,
        reportType,
        descriptionValue,
      );

      return Response.json(
        { data: restaurant },
        { status: 200, headers: rateLimitHeaders(limit, RATE_LIMIT) },
      );
    } catch (reportError) {
      if (!(reportError instanceof HygieneReportError)) throw reportError;

      switch (reportError.failure) {
        case "RESTAURANT_NOT_FOUND":
          return Response.json(
            {
              error: `Restaurant with id "${restaurantId}" was not found.`,
              code: "RESTAURANT_NOT_FOUND",
            },
            { status: 404 },
          );

        case "COOLDOWN_ACTIVE":
          return Response.json(
            {
              error: "COOLDOWN_ACTIVE",
              message:
                "Kamu sudah melaporkan warung ini hari ini. Coba lagi besok ya.",
            },
            { status: 429 },
          );

        case "INVALID_REPORT":
          return Response.json(
            { error: reportError.message, code: "INVALID_INPUT" },
            { status: 400 },
          );

        default:
          return Response.json(
            { error: reportError.message, code: "DATABASE_ERROR" },
            { status: 500 },
          );
      }
    }
  } catch (error) {
    // ------------------------------------------------------------------
    // 7. Catch-all: unexpected errors → INTERNAL_ERROR
    // ------------------------------------------------------------------
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "";
    console.error("[POST /api/report] Unexpected error:", { message, stack });
    return Response.json(
      {
        error: `Internal server error: ${message}`,
        code: "INTERNAL_ERROR",
        details: process.env.NODE_ENV === "development" ? stack : undefined,
      },
      { status: 500 }
    );
  }
}
