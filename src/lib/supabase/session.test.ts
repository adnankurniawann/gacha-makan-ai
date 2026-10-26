import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, signInAnonymouslyMock, updateUserMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    signInAnonymouslyMock: vi.fn(),
    updateUserMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      signInAnonymously: signInAnonymouslyMock,
      updateUser: updateUserMock,
    },
  },
}));

import { ensureSession, isAnonymous, linkEmailToSession } from "@/lib/supabase/session";

const anonSession = {
  user: { id: "anon-1", is_anonymous: true },
} as never;

const namedSession = {
  user: { id: "user-1", is_anonymous: false },
} as never;

describe("ensureSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("memakai sesi yang sudah ada tanpa membuat yang baru", async () => {
    getSessionMock.mockResolvedValue({ data: { session: namedSession } });

    await expect(ensureSession()).resolves.toBe(namedSession);
    expect(signInAnonymouslyMock).not.toHaveBeenCalled();
  });

  it("membuat sesi anonim kalau belum ada", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    signInAnonymouslyMock.mockResolvedValue({
      data: { session: anonSession },
      error: null,
    });

    await expect(ensureSession()).resolves.toBe(anonSession);
  });

  it("tidak membuat dua user saat dipanggil berbarengan", async () => {
    // Beberapa komponen memanggil ini bersamaan saat halaman dibuka.
    getSessionMock.mockResolvedValue({ data: { session: null } });
    signInAnonymouslyMock.mockResolvedValue({
      data: { session: anonSession },
      error: null,
    });

    const [first, second, third] = await Promise.all([
      ensureSession(),
      ensureSession(),
      ensureSession(),
    ]);

    expect(signInAnonymouslyMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(anonSession);
    expect(second).toBe(anonSession);
    expect(third).toBe(anonSession);
  });

  it("mengembalikan null, bukan melempar, saat sesi anonim dimatikan", async () => {
    // Menjelajah dan spin tidak butuh login, jadi kegagalan di sini tidak
    // boleh menghalangi siapa pun memakai aplikasinya.
    getSessionMock.mockResolvedValue({ data: { session: null } });
    signInAnonymouslyMock.mockResolvedValue({
      data: { session: null },
      error: { message: "Anonymous sign-ins are disabled" },
    });

    await expect(ensureSession()).resolves.toBeNull();
  });

  it("mengembalikan null saat jaringannya gagal total", async () => {
    getSessionMock.mockRejectedValue(new Error("offline"));

    await expect(ensureSession()).resolves.toBeNull();
  });

  it("mencoba lagi setelah kegagalan sebelumnya", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("offline"));
    await expect(ensureSession()).resolves.toBeNull();

    getSessionMock.mockResolvedValue({ data: { session: namedSession } });
    await expect(ensureSession()).resolves.toBe(namedSession);
  });
});

describe("isAnonymous", () => {
  it("membedakan sesi anonim, sesi bernama, dan tanpa sesi", () => {
    expect(isAnonymous(anonSession)).toBe(true);
    expect(isAnonymous(namedSession)).toBe(false);
    expect(isAnonymous(null)).toBe(false);
  });
});

describe("linkEmailToSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("memakai updateUser supaya user_id-nya tidak berubah", async () => {
    // Kalau ini diganti signInWithOtp, riwayat spin yang sudah terkumpul
    // hilang diam-diam — dan itu data latih model rekomendasi nanti.
    updateUserMock.mockResolvedValue({ error: null });

    await expect(
      linkEmailToSession("nama@kampus.ac.id", "https://app.test/auth/callback"),
    ).resolves.toEqual({ error: null });

    expect(updateUserMock).toHaveBeenCalledWith(
      { email: "nama@kampus.ac.id" },
      { emailRedirectTo: "https://app.test/auth/callback" },
    );
  });

  it("meneruskan pesan error apa adanya", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "email sudah dipakai" } });

    await expect(
      linkEmailToSession("nama@kampus.ac.id", "https://app.test/auth/callback"),
    ).resolves.toEqual({ error: "email sudah dipakai" });
  });
});
