import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectWithError(requestUrl: URL, message?: string): NextResponse {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("error", "auth_callback_failed");

  if (message) {
    loginUrl.searchParams.set("message", message);
  }

  return NextResponse.redirect(loginUrl);
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const authError = requestUrl.searchParams.get("error");
  const authErrorDescription = requestUrl.searchParams.get("error_description");

  if (authError) {
    return redirectWithError(
      requestUrl,
      authErrorDescription ?? authError,
    );
  }

  if (!code) {
    return redirectWithError(requestUrl, "Kode login tidak ditemukan.");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[GET /auth/callback] exchangeCodeForSession:", error.message);
      return redirectWithError(requestUrl, error.message);
    }

    return NextResponse.redirect(new URL("/", requestUrl.origin));
  } catch (callbackError) {
    const message =
      callbackError instanceof Error
        ? callbackError.message
        : "Gagal memproses login.";
    console.error("[GET /auth/callback] Unexpected error:", message);
    return redirectWithError(requestUrl, message);
  }
}
