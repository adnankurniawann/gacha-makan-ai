# Hasil evaluasi kategorisasi nama warung

Dibuat ulang oleh `npm run ml:eval-categorize`. Jangan disunting tangan.

```
{
  "split": "train",
  "osmBase": "2026-10-26T14:57:05Z",
  "dataset": {
    "places": 12174,
    "dropped": {
      "tidak_dipetakan": 550,
      "hanya_umum": 644,
      "multi_slot": 993,
      "label_bertentangan": 268
    },
    "items": 7346,
    "bySplit": {
      "train": 5102,
      "dev": 765,
      "test": 1479
    }
  },
  "subset": {
    "perClass": 50,
    "seed": 20261026,
    "n": 578,
    "tanpaKataKunci": 378,
    "nonWaralaba": 568
  },
  "promptHash": "5988fb42f0d5",
  "prices": {
    "gemini/gemini-3.5-flash-lite": {
      "input": 0.3,
      "output": 2.5,
      "checked": "2026-10-26"
    },
    "gemini/gemini-3.8-flash": {
      "input": 0.75,
      "output": 3.75,
      "checked": "2026-10-26",
      "note": "naik ke $1,50/$7,50 mulai 1 Jan 2027"
    }
  }
}
```

## Subset berimbang (semua metode, item yang sama)

### semua

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 578 | 37.4% (33.4%–41.5%) | 0.40 (0.36–0.43) | 0.0% | 34.6% | 84.5% | 34.6% | 84.5% |
| naive-bayes (α=0.3) | 578 | 82.7% (79.9%–85.6%) | 0.83 (0.80–0.86) | 0.0% | 90.7% | 82.3% | 87.0% | 83.5% |
| gemini/gemini-3.5-flash-lite | 578 | 66.6% (62.8%–70.4%) | 0.68 (0.64–0.72) | 0.0% | 76.8% | 76.6% | 51.6% | 87.2% |

### tanpa_kata_kunci

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 378 | 12.4% (9.3%–16.1%) | 0.02 (0.01–0.02) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| naive-bayes (α=0.3) | 378 | 79.9% (75.9%–83.9%) | 0.82 (0.77–0.85) | 0.0% | 87.6% | 78.5% | 82.5% | 80.4% |
| gemini/gemini-3.5-flash-lite | 378 | 54.8% (50.0%–60.3%) | 0.55 (0.49–0.60) | 0.0% | 64.8% | 66.1% | 29.4% | 81.1% |

### non_waralaba

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 568 | 37.3% (33.5%–41.2%) | 0.40 (0.36–0.44) | 0.0% | 34.3% | 84.6% | 34.3% | 84.6% |
| naive-bayes (α=0.3) | 568 | 82.4% (79.2%–85.2%) | 0.83 (0.80–0.86) | 0.0% | 90.5% | 81.9% | 86.8% | 83.2% |
| gemini/gemini-3.5-flash-lite | 568 | 66.0% (62.0%–69.7%) | 0.68 (0.64–0.71) | 0.0% | 76.4% | 76.0% | 51.4% | 87.0% |

## Seluruh split (hanya metode tanpa LLM)

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 5102 | 27.3% (26.1%–28.6%) | 0.33 (0.31–0.35) | 0.0% | 36.0% | 67.1% | 36.0% | 67.1% |
| naive-bayes (α=0.3) | 5102 | 83.0% (81.9%–84.0%) | 0.79 (0.77–0.81) | 0.0% | 94.1% | 84.0% | 90.8% | 85.3% |

## Biaya dan latensi (subset berimbang)

| Metode | Token in/item | Token out/item | USD per 1.000 warung | Batch p50 | Batch p95 | Waktu per 1.000 warung |
|---|---|---|---|---|---|---|
| gemini/gemini-3.5-flash-lite | 46 | 61 | $0.166 | 12.2 s | 151.4 s | 11.0 menit |

## Uji McNemar (subset berimbang)

| A | B | Hanya A benar | Hanya B benar | p |
|---|---|---|---|---|
| keyword | naive-bayes (α=0.3) | 20 | 282 | <0,001 |
| keyword | gemini/gemini-3.5-flash-lite | 10 | 179 | <0,001 |
| naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite | 127 | 34 | <0,001 |

## F1 per slot (subset berimbang)

| Slot | n | keyword | naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite |
|---|---|---|---|---|
| ayam | 50 | 0.67 | 0.91 | 0.82 |
| mie | 50 | 0.69 | 0.89 | 0.81 |
| nusantara | 50 | 0.00 | 0.55 | 0.40 |
| sunda | 28 | 0.13 | 0.63 | 0.60 |
| padang | 50 | 0.55 | 0.80 | 0.85 |
| chinese | 50 | 0.11 | 0.85 | 0.66 |
| jepang_korea | 50 | 0.46 | 0.96 | 0.82 |
| barat | 50 | 0.52 | 0.94 | 0.64 |
| seafood | 50 | 0.48 | 0.81 | 0.57 |
| kopi_minuman | 50 | 0.60 | 0.87 | 0.77 |
| manis_roti | 50 | 0.34 | 0.88 | 0.79 |
| lainnya | 50 | 0.22 | 0.87 | 0.47 |

## Confusion matrix (subset berimbang)

Baris = label OSM, kolom = tebakan.

<details><summary>keyword</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 30 | · | · | · | · | · | · | · | · | · | · | 20 | · |
| **mie** | 6 | 29 | · | · | · | · | · | · | · | 1 | · | 14 | · |
| **nusan** | 2 | · | · | 1 | · | · | · | · | · | 1 | 1 | 45 | · |
| **sunda** | · | 1 | · | 2 | · | · | · | · | · | · | · | 25 | · |
| **padan** | · | · | · | · | 19 | · | · | · | · | · | · | 31 | · |
| **chine** | 1 | 1 | 1 | · | · | 3 | · | · | · | · | · | 44 | · |
| **jepan** | · | 2 | · | · | · | 1 | 15 | · | · | 1 | · | 31 | · |
| **barat** | · | · | · | · | · | · | · | 18 | · | 1 | 1 | 30 | · |
| **seafo** | · | 1 | · | · | · | · | · | · | 16 | 3 | 1 | 29 | · |
| **kopi_** | · | · | · | · | · | · | · | · | · | 26 | · | 24 | · |
| **manis** | · | · | · | · | · | · | · | 1 | · | · | 11 | 38 | · |
| **lainn** | · | · | · | · | · | · | · | · | · | 3 | · | 47 | · |

</details>

<details><summary>naive-bayes (α=0.3)</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 43 | · | 5 | · | · | · | · | · | · | 1 | · | 1 | · |
| **mie** | · | 45 | 4 | · | · | · | · | · | · | 1 | · | · | · |
| **nusan** | 1 | 1 | 42 | · | · | 3 | · | · | · | 2 | 1 | · | · |
| **sunda** | · | 2 | 10 | 13 | 1 | · | · | · | · | 1 | · | 1 | · |
| **padan** | · | · | 14 | · | 35 | 1 | · | · | · | · | · | · | · |
| **chine** | · | 1 | 5 | · | · | 43 | · | 1 | · | · | · | · | · |
| **jepan** | · | · | 1 | · | 1 | · | 46 | · | 1 | 1 | · | · | · |
| **barat** | · | · | · | · | · | 2 | · | 47 | 1 | · | · | · | · |
| **seafo** | · | 1 | 9 | · | · | 1 | · | · | 36 | 3 | · | · | · |
| **kopi_** | · | · | 2 | · | · | 1 | · | · | · | 47 | · | · | · |
| **manis** | · | · | 6 | · | · | · | · | 1 | · | 2 | 40 | 1 | · |
| **lainn** | · | 1 | 6 | · | · | · | · | 1 | 1 | · | · | 41 | · |

</details>

<details><summary>gemini/gemini-3.5-flash-lite</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 37 | · | 7 | · | · | · | · | · | · | · | · | 6 | · |
| **mie** | · | 38 | 5 | · | · | · | 1 | · | · | 3 | · | 3 | · |
| **nusan** | 2 | 1 | 28 | 1 | · | 2 | 1 | · | · | 5 | 2 | 8 | · |
| **sunda** | · | 1 | 8 | 14 | · | · | · | · | 1 | · | 2 | 2 | · |
| **padan** | · | · | 5 | 3 | 37 | · | · | · | · | · | · | 5 | · |
| **chine** | · | 1 | 9 | · | · | 26 | 1 | 3 | 1 | · | · | 9 | · |
| **jepan** | · | 2 | 2 | · | · | · | 37 | 1 | 1 | 3 | · | 4 | · |
| **barat** | 1 | · | 2 | · | · | · | · | 27 | 1 | · | 2 | 17 | · |
| **seafo** | · | 1 | 12 | · | · | 1 | · | 1 | 22 | 3 | 1 | 9 | · |
| **kopi_** | · | · | 2 | · | · | · | · | · | · | 43 | 1 | 4 | · |
| **manis** | · | · | 4 | 1 | · | · | · | 1 | · | · | 38 | 6 | · |
| **lainn** | · | · | 5 | · | · | · | · | 1 | 1 | 5 | · | 38 | · |

</details>
