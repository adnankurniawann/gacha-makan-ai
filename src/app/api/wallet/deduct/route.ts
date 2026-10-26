import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { amount } = await request.json();
    const supabase = await createSupabaseServerClient();
    
    // Pastikan user sudah login
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Cek saldo saat ini
    const { data: wallet, error: fetchError } = await supabase
      .from('wallets')
      .select('current_balance')
      .eq('user_id', user.id)
      .single();

    if (fetchError || !wallet) {
      return NextResponse.json({ error: "Dompet tidak ditemukan" }, { status: 404 });
    }

    // 2. Kalkulasi saldo baru
    const newBalance = wallet.current_balance - amount;

    // 3. Update database
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ current_balance: newBalance })
      .eq('user_id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, newBalance });
  } catch (error) {
    return NextResponse.json({ error: "Terjadi kesalahan sistem" }, { status: 500 });
  }
}