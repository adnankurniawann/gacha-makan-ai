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

  it.each([null, 0, -5000, 12.5, "15000"])(
    "menolak jumlah yang bukan bilangan bulat positif (%s) tanpa menyentuh dompet",
    async (amount) => {
      const response = await POST(request({ amount }));
      expect(response.status).toBe(400);
      expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    }
  );
});
