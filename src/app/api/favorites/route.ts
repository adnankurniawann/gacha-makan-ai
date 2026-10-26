/**
 * POST   /api/favorites  { restaurant_id }  — simpan
 * DELETE /api/favorites  { restaurant_id }  — hapus dari simpanan
 *
 * Sesi anonim pun boleh menyimpan: `user_id`-nya sungguhan, dan kalau nanti
 * pengguna mengaitkan email, daftar ini ikut terbawa karena `user_id`-nya
 * tidak berubah (lihat supabase/AUTH.md).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientIp, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

async function readRestaurantId(
  request: Request,
): Promise<{ id: string } | { error: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      error: Response.json(
        { error: "Request body must be valid JSON.", code: "INVALID_INPUT" },
        { status: 400 },
      ),
    };
  }

  const restaurantId = (body as Record<string, unknown> | null)?.restaurant_id;

  if (typeof restaurantId !== "string" || !UUID_REGEX.test(restaurantId)) {
    return {
      error: Response.json(
        {
          error: 'Parameter "restaurant_id" must be a UUID.',
          code: "INVALID_INPUT",
        },
        { status: 400 },
      ),
    };
  }

  return { id: restaurantId };
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function POST(request: Request): Promise<Response> {
  const limit = rateLimit(
    `favorites:${clientIp(request)}`,
    RATE_LIMIT,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many requests.", code: "RATE_LIMITED" },
      { status: 429, headers: rateLimitHeaders(limit, RATE_LIMIT) },
    );
  }

  const parsed = await readRestaurantId(request);
  if ("error" in parsed) return parsed.error;

  const { supabase, user } = await requireUser();
  if (!user) {
    return Response.json(
      {
        error: "NO_SESSION",
        message: "Sesi belum siap. Muat ulang halaman lalu coba lagi.",
      },
      { status: 401 },
    );
  }

  // upsert, bukan insert: menekan "Simpan" dua kali bukan error yang perlu
  // diperlihatkan ke siapa pun.
  const { error } = await supabase
    .from("favorites")
    .upsert(
      { user_id: user.id, restaurant_id: parsed.id },
      { onConflict: "user_id,restaurant_id", ignoreDuplicates: true },
    );

  if (error) {
    console.error("[POST /api/favorites] Gagal menyimpan:", error.message);
    return Response.json(
      { error: "Gagal menyimpan.", code: "DATABASE_ERROR" },
      { status: 500 },
    );
  }

  return Response.json({ saved: true }, { status: 200 });
}

export async function DELETE(request: Request): Promise<Response> {
  const parsed = await readRestaurantId(request);
  if ("error" in parsed) return parsed.error;

  const { supabase, user } = await requireUser();
  if (!user) {
    return Response.json(
      { error: "NO_SESSION" },
      { status: 401 },
    );
  }

  // RLS sudah membatasi ke baris sendiri; filter user_id di sini membuat
  // maksudnya terbaca tanpa harus membuka file policy.
  const { error } = await supabase
    .from("favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("restaurant_id", parsed.id);

  if (error) {
    console.error("[DELETE /api/favorites] Gagal menghapus:", error.message);
    return Response.json(
      { error: "Gagal menghapus.", code: "DATABASE_ERROR" },
      { status: 500 },
    );
  }

  return Response.json({ saved: false }, { status: 200 });
}
