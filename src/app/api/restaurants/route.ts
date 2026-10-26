/**
 * GET /api/restaurants
 *
 * Returns all restaurants with parsed coordinates and hygiene status.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 10.1, 10.2, 10.5, 10.6, 10.7
 */

import { getAllRestaurants } from "@/lib/supabase/queries";

export async function GET(): Promise<Response> {
  try {
    const restaurants = await getAllRestaurants();
    return Response.json({ data: restaurants }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error";
    return Response.json(
      { error: message, code: "DATABASE_ERROR" },
      { status: 500 }
    );
  }
}
