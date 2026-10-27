# Hasil evaluasi kategorisasi nama warung

Dibuat ulang oleh `npm run ml:eval-categorize`. Jangan disunting tangan.

```
{
  "split": "dev",
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
    "n": 402,
    "tanpaKataKunci": 228,
    "nonWaralaba": 392
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
| keyword | 402 | 37.6% (32.8%–42.5%) | 0.46 (0.37–0.50) | 0.0% | 43.3% | 79.9% | 43.3% | 79.9% |
| naive-bayes (α=0.3) | 402 | 55.0% (50.0%–59.7%) | 0.46 (0.41–0.55) | 0.0% | 91.8% | 56.1% | 82.8% | 59.5% |
| gemini/gemini-3.5-flash-lite | 402 | 63.7% (59.0%–68.4%) | 0.67 (0.60–0.71) | 0.0% | 78.4% | 75.9% | 54.7% | 83.6% |

### tanpa_kata_kunci

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 228 | 5.3% (2.6%–7.9%) | 0.01 (0.00–0.01) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| naive-bayes (α=0.3) | 228 | 41.2% (34.6%–47.8%) | 0.36 (0.29–0.42) | 0.0% | 87.3% | 40.7% | 73.7% | 44.6% |
| gemini/gemini-3.5-flash-lite | 228 | 48.7% (42.1%–54.8%) | 0.52 (0.44–0.58) | 0.0% | 62.3% | 66.2% | 24.6% | 76.8% |

### non_waralaba

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 392 | 37.8% (33.2%–42.6%) | 0.47 (0.37–0.50) | 0.0% | 43.6% | 79.5% | 43.6% | 79.5% |
| naive-bayes (α=0.3) | 392 | 54.8% (50.0%–59.9%) | 0.46 (0.41–0.55) | 0.0% | 91.8% | 55.8% | 83.2% | 59.2% |
| gemini/gemini-3.5-flash-lite | 392 | 63.0% (57.9%–67.9%) | 0.67 (0.60–0.70) | 0.0% | 78.1% | 75.2% | 54.1% | 83.0% |

## Seluruh split (hanya metode tanpa LLM)

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 765 | 28.0% (24.7%–31.1%) | 0.39 (0.32–0.44) | 0.0% | 39.7% | 66.4% | 39.7% | 66.4% |
| naive-bayes (α=0.3) | 765 | 58.7% (55.6%–62.1%) | 0.43 (0.39–0.51) | 0.0% | 91.8% | 61.0% | 84.2% | 64.3% |

## Biaya dan latensi (subset berimbang)

| Metode | Token in/item | Token out/item | USD per 1.000 warung | Batch p50 | Batch p95 | Waktu per 1.000 warung |
|---|---|---|---|---|---|---|
| gemini/gemini-3.5-flash-lite | 47 | 60 | $0.164 | 5.5 s | 140.4 s | 8.1 menit |

## Uji McNemar (subset berimbang)

| A | B | Hanya A benar | Hanya B benar | p |
|---|---|---|---|---|
| keyword | naive-bayes (α=0.3) | 32 | 102 | <0,001 |
| keyword | gemini/gemini-3.5-flash-lite | 4 | 109 | <0,001 |
| naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite | 26 | 61 | <0,001 |

## F1 per slot (subset berimbang)

| Slot | n | keyword | naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite |
|---|---|---|---|---|
| ayam | 50 | 0.60 | 0.72 | 0.82 |
| mie | 45 | 0.64 | 0.60 | 0.75 |
| nusantara | 50 | 0.00 | 0.43 | 0.53 |
| sunda | 1 | 1.00 | 0.00 | 1.00 |
| padang | 9 | 0.67 | 0.33 | 0.86 |
| chinese | 33 | 0.21 | 0.44 | 0.54 |
| jepang_korea | 38 | 0.45 | 0.60 | 0.77 |
| barat | 50 | 0.57 | 0.58 | 0.70 |
| seafood | 50 | 0.48 | 0.49 | 0.56 |
| kopi_minuman | 50 | 0.64 | 0.70 | 0.73 |
| manis_roti | 14 | 0.22 | 0.33 | 0.57 |
| lainnya | 12 | 0.10 | 0.33 | 0.25 |

## Confusion matrix (subset berimbang)

Baris = label OSM, kolom = tebakan.

<details><summary>keyword</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 25 | · | · | · | 1 | · | · | · | · | · | · | 24 | · |
| **mie** | 6 | 26 | · | · | · | · | · | · | · | · | · | 13 | · |
| **nusan** | 1 | 3 | · | · | · | · | · | · | · | 3 | · | 43 | · |
| **sunda** | · | · | · | 1 | · | · | · | · | · | · | · | · | · |
| **padan** | · | · | · | · | 5 | · | · | · | · | · | · | 4 | · |
| **chine** | 1 | 4 | · | · | · | 4 | · | · | 1 | 2 | · | 21 | · |
| **jepan** | · | 2 | · | · | · | 1 | 11 | · | · | 2 | · | 22 | · |
| **barat** | · | · | · | · | · | · | · | 20 | · | 3 | 1 | 26 | · |
| **seafo** | 1 | 1 | · | · | · | · | · | · | 16 | 1 | · | 31 | · |
| **kopi_** | · | · | · | · | · | · | · | · | · | 29 | 1 | 20 | · |
| **manis** | · | · | · | · | · | · | · | · | · | · | 2 | 12 | · |
| **lainn** | · | · | · | · | · | · | · | · | · | · | · | 12 | · |

</details>

<details><summary>naive-bayes (α=0.3)</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 32 | 1 | 5 | · | 1 | 1 | 2 | 4 | · | 2 | 2 | · | · |
| **mie** | · | 24 | 10 | · | · | 2 | 6 | 1 | · | 1 | · | 1 | · |
| **nusan** | · | 3 | 32 | · | · | 3 | · | 2 | 1 | 6 | 2 | 1 | · |
| **sunda** | · | · | 1 | · | · | · | · | · | · | · | · | · | · |
| **padan** | · | · | 6 | · | 2 | 1 | · | · | · | · | · | · | · |
| **chine** | 2 | 5 | 4 | · | · | 14 | 1 | 2 | 3 | 2 | · | · | · |
| **jepan** | 2 | 1 | 2 | · | · | 4 | 21 | 4 | · | 3 | · | 1 | · |
| **barat** | 1 | · | 10 | · | · | · | · | 31 | 2 | 4 | 1 | 1 | · |
| **seafo** | · | 1 | 20 | · | · | 3 | · | 4 | 19 | 1 | · | 2 | · |
| **kopi_** | 2 | · | 5 | · | · | · | · | 2 | 1 | 38 | 1 | 1 | · |
| **manis** | · | · | 3 | · | · | 1 | 1 | 3 | 1 | · | 4 | 1 | · |
| **lainn** | · | · | 1 | · | · | 1 | 1 | 3 | · | 2 | · | 4 | · |

</details>

<details><summary>gemini/gemini-3.5-flash-lite</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 38 | · | 2 | · | 1 | · | 1 | 1 | · | · | · | 7 | · |
| **mie** | · | 33 | 4 | · | · | · | 1 | · | · | 1 | · | 6 | · |
| **nusan** | 1 | 3 | 31 | · | 2 | · | · | · | · | 3 | 1 | 9 | · |
| **sunda** | · | · | · | 1 | · | · | · | · | · | · | · | · | · |
| **padan** | · | · | · | · | 9 | · | · | · | · | · | · | · | · |
| **chine** | 2 | 5 | 3 | · | · | 13 | · | · | 1 | 2 | · | 7 | · |
| **jepan** | 1 | 1 | 1 | · | · | 2 | 25 | 1 | · | 2 | 1 | 4 | · |
| **barat** | 1 | · | 6 | · | · | · | · | 30 | · | 5 | 1 | 7 | · |
| **seafo** | · | 1 | 15 | · | · | · | · | 2 | 20 | 1 | · | 11 | · |
| **kopi_** | · | · | 3 | · | · | · | · | · | · | 38 | 3 | 6 | · |
| **manis** | · | · | 1 | · | · | · | · | 2 | · | 1 | 8 | 2 | · |
| **lainn** | · | · | 1 | · | · | · | · | · | · | 1 | · | 10 | · |

</details>
