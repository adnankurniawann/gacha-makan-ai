import { describe, expect, it } from "vitest";

import { localTimeContext } from "@/lib/supabase/events";

/**
 * Konteks waktu dibekukan saat penayangan. Kalau nilai ini salah, seluruh
 * data jadi tidak sah untuk melatih model — jadi diuji terhadap jam dinding
 * Jatinangor, bukan terhadap zona waktu mesin yang kebetulan menjalankan tes.
 */
describe("localTimeContext", () => {
  it("memakai jam lokal Jatinangor, bukan UTC", () => {
    // 2026-08-04T17:30:00Z = 5 Agustus 2026 pukul 00:30 WIB.
    const context = localTimeContext(new Date("2026-08-04T17:30:00Z"));

    expect(context.hourLocal).toBe(0);
    // 5 Agustus 2026 adalah hari Rabu.
    expect(context.dayOfWeek).toBe(3);
    expect(context.isWeekend).toBe(false);
  });

  it("memetakan tengah malam ke 0, bukan 24", () => {
    const context = localTimeContext(new Date("2026-08-04T17:00:00Z"));
    expect(context.hourLocal).toBe(0);
  });

  it("memakai konvensi 0 = Minggu, sama dengan Postgres dan JavaScript", () => {
    // 2026-08-09 adalah hari Minggu; 03:00Z = 10:00 WIB hari yang sama.
    const sunday = localTimeContext(new Date("2026-08-09T03:00:00Z"));
    expect(sunday.dayOfWeek).toBe(0);
    expect(sunday.isWeekend).toBe(true);

    // 2026-08-08 adalah hari Sabtu.
    const saturday = localTimeContext(new Date("2026-08-08T03:00:00Z"));
    expect(saturday.dayOfWeek).toBe(6);
    expect(saturday.isWeekend).toBe(true);
  });

  it("menandai hari kerja sebagai bukan akhir pekan", () => {
    // 2026-08-07 adalah hari Jumat.
    const friday = localTimeContext(new Date("2026-08-07T05:00:00Z"));
    expect(friday.dayOfWeek).toBe(5);
    expect(friday.isWeekend).toBe(false);
  });

  it("membaca jam makan siang dengan benar", () => {
    // 05:00Z = 12:00 WIB, jam paling ramai untuk aplikasi ini.
    const context = localTimeContext(new Date("2026-08-05T05:00:00Z"));
    expect(context.hourLocal).toBe(12);
  });
});
