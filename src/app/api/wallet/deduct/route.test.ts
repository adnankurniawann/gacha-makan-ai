import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSupabaseServerClientMock } = vi.hoisted(() => ({
  createSupabaseServerClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/wallet/deduct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wallet/deduct", () => {
  beforeEach(() => {
    createSupabaseServerClientMock.mockReset();
  });

  function mockSupabase(rpcResult: { data: number | null; error: { message: string } | null }) {
    const rpc = vi.fn().mockResolvedValue(rpcResult);
    createSupabaseServerClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    });
    return rpc;
  }

  it("memotong lewat satu fungsi database, bukan baca-lalu-tulis", async () => {
    const rpc = mockSupabase({ data: 35000, error: null });

    const response = await POST(request({ amount: 15000 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, newBalance: 35000 });
    expect(rpc).toHaveBeenCalledWith("deduct_wallet", { p_amount: 15000 });
  });

  it("404 kalau pengguna belum punya dompet", async () => {
    mockSupabase({ data: null, error: null });
    const response = await POST(request({ amount: 15000 }));
    expect(response.status).toBe(404);
  });

  it("tidak membocorkan pesan error database", async () => {
    mockSupabase({ data: null, error: { message: "relation wallets does not exist" } });
    const response = await POST(request({ amount: 15000 }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("relation");
  });

  it.each([null, 0, -5000, 12.5, "15000"])(
    "menolak jumlah yang bukan bilangan bulat positif (%s) tanpa menyentuh dompet",
    async (amount) => {
      const response = await POST(request({ amount }));
      expect(response.status).toBe(400);
      expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    }
  );
});
