import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { amount } = await request.json();

    // Tempat yang harganya belum diketahui mengirim null. Tanpa pemeriksaan
    // ini, `saldo - null` dihitung sebagai `saldo - 0` dan tercatat sebagai
    // potongan yang berhasil.
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Jumlah harus bilangan bulat positif" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();
    
    // Pastikan user sudah login
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Satu UPDATE di database, supaya dua potongan yang berbarengan tidak
    // saling menimpa (lihat migrasi 20261027000003).
    const { data: newBalance, error: deductError } = await supabase.rpc(
      "deduct_wallet",
      { p_amount: amount }
    );

    if (deductError) {
      console.error("[POST /api/wallet/deduct]", deductError.message);
      return NextResponse.json({ error: "Gagal memotong saldo" }, { status: 500 });
    }

    if (newBalance === null) {
      return NextResponse.json({ error: "Dompet tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({ success: true, newBalance });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan sistem" }, { status: 500 });
  }
}