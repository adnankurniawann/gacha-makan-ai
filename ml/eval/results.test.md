# Hasil evaluasi kategorisasi nama warung

Dibuat ulang oleh `npm run ml:eval-categorize`. Jangan disunting tangan.

```
{
  "split": "test",
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
    "n": 509,
    "tanpaKataKunci": 323,
    "nonWaralaba": 497
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
| keyword | 509 | 37.1% (32.8%–41.5%) | 0.39 (0.33–0.44) | 0.0% | 36.5% | 76.3% | 36.5% | 76.3% |
| naive-bayes (α=0.3) | 509 | 56.4% (52.1%–60.5%) | 0.52 (0.47–0.56) | 0.0% | 85.5% | 57.9% | 80.0% | 59.7% |
| gemini/gemini-3.5-flash-lite | 509 | 65.4% (61.1%–69.4%) | 0.66 (0.62–0.70) | 0.0% | 73.5% | 73.5% | 49.7% | 84.2% |

### tanpa_kata_kunci

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 323 | 14.6% (10.8%–18.6%) | 0.02 (0.02–0.03) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| naive-bayes (α=0.3) | 323 | 46.1% (40.9%–51.7%) | 0.41 (0.34–0.46) | 0.0% | 79.9% | 44.6% | 72.4% | 46.2% |
| gemini/gemini-3.5-flash-lite | 323 | 54.2% (48.9%–59.1%) | 0.53 (0.46–0.59) | 0.0% | 58.8% | 62.1% | 26.3% | 72.9% |

### non_waralaba

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 497 | 37.8% (33.8%–42.1%) | 0.39 (0.34–0.45) | 0.0% | 37.0% | 76.6% | 37.0% | 76.6% |
| naive-bayes (α=0.3) | 497 | 56.5% (52.3%–61.2%) | 0.52 (0.48–0.56) | 0.0% | 85.5% | 57.9% | 80.1% | 59.8% |
| gemini/gemini-3.5-flash-lite | 497 | 65.2% (61.0%–69.6%) | 0.66 (0.62–0.71) | 0.0% | 73.8% | 73.3% | 50.1% | 83.9% |

## Seluruh split (hanya metode tanpa LLM)

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 1479 | 26.8% (24.6%–29.0%) | 0.34 (0.30–0.38) | 0.0% | 35.0% | 67.4% | 35.0% | 67.4% |
| naive-bayes (α=0.3) | 1479 | 62.9% (60.4%–65.3%) | 0.50 (0.47–0.53) | 0.0% | 89.5% | 66.0% | 83.3% | 68.3% |

## Biaya dan latensi (subset berimbang)

| Metode | Token in/item | Token out/item | USD per 1.000 warung | Batch p50 | Batch p95 | Waktu per 1.000 warung |
|---|---|---|---|---|---|---|
| gemini/gemini-3.5-flash-lite | 46 | 60 | $0.165 | 5.7 s | 6.9 s | 2.5 menit |

## Uji McNemar (subset berimbang)

| A | B | Hanya A benar | Hanya B benar | p |
|---|---|---|---|---|
| keyword | naive-bayes (α=0.3) | 46 | 144 | <0,001 |
| keyword | gemini/gemini-3.5-flash-lite | 15 | 159 | <0,001 |
| naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite | 43 | 89 | <0,001 |

## F1 per slot (subset berimbang)

| Slot | n | keyword | naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite |
|---|---|---|---|---|
| ayam | 50 | 0.58 | 0.65 | 0.82 |
| mie | 50 | 0.62 | 0.70 | 0.76 |
| nusantara | 50 | 0.08 | 0.40 | 0.43 |
| sunda | 7 | 0.25 | 0.00 | 0.38 |
| padang | 18 | 0.62 | 0.44 | 0.84 |
| chinese | 50 | 0.18 | 0.55 | 0.62 |
| jepang_korea | 50 | 0.28 | 0.71 | 0.86 |
| barat | 50 | 0.49 | 0.50 | 0.69 |
| seafood | 50 | 0.48 | 0.58 | 0.63 |
| kopi_minuman | 50 | 0.60 | 0.62 | 0.66 |
| manis_roti | 34 | 0.24 | 0.50 | 0.78 |
| lainnya | 50 | 0.25 | 0.61 | 0.50 |

## Confusion matrix (subset berimbang)

Baris = label OSM, kolom = tebakan.

<details><summary>keyword</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 28 | · | · | · | · | · | · | · | · | · | · | 22 | · |
| **mie** | 11 | 25 | · | · | · | · | · | · | · | 1 | 1 | 12 | · |
| **nusan** | 3 | 1 | 2 | · | · | · | · | · | · | 3 | 1 | 40 | · |
| **sunda** | · | · | · | 1 | · | · | · | · | · | · | · | 6 | · |
| **padan** | · | · | · | · | 8 | · | · | 1 | · | · | · | 9 | · |
| **chine** | 2 | 3 | · | · | · | 5 | · | · | · | 1 | · | 39 | · |
| **jepan** | 1 | 1 | · | · | · | 2 | 8 | · | · | · | · | 38 | · |
| **barat** | · | 1 | · | · | · | · | · | 17 | · | 6 | · | 26 | · |
| **seafo** | 1 | · | · | · | · | · | · | 1 | 16 | · | · | 32 | · |
| **kopi_** | · | · | · | · | · | · | · | · | · | 27 | · | 23 | · |
| **manis** | · | · | · | · | · | · | · | · | · | · | 5 | 29 | · |
| **lainn** | · | · | 1 | · | · | · | · | · | · | 2 | · | 47 | · |

</details>

<details><summary>naive-bayes (α=0.3)</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 31 | 1 | 11 | · | 1 | 2 | · | 4 | · | · | · | · | · |
| **mie** | 1 | 32 | 6 | · | · | 2 | 5 | · | · | 3 | · | 1 | · |
| **nusan** | 3 | · | 33 | · | · | 2 | 1 | 2 | 1 | 6 | · | 2 | · |
| **sunda** | · | · | 3 | · | · | · | · | · | 2 | 1 | 1 | · | · |
| **padan** | · | · | 11 | · | 6 | · | · | · | · | 1 | · | · | · |
| **chine** | · | 5 | 8 | · | 1 | 25 | 1 | 2 | 3 | 3 | 1 | 1 | · |
| **jepan** | 3 | · | 6 | · | · | 1 | 34 | 4 | 1 | · | · | 1 | · |
| **barat** | 1 | · | 7 | · | · | 2 | 1 | 26 | 2 | 7 | 2 | 2 | · |
| **seafo** | 1 | 1 | 14 | · | 1 | 2 | · | 3 | 25 | 2 | · | 1 | · |
| **kopi_** | 1 | 1 | 4 | · | · | 2 | · | 3 | 1 | 36 | 1 | 1 | · |
| **manis** | 1 | 1 | 8 | · | · | 1 | 2 | 5 | · | 3 | 13 | · | · |
| **lainn** | 3 | 1 | 5 | · | · | 2 | 2 | 6 | 1 | 4 | · | 26 | · |

</details>

<details><summary>gemini/gemini-3.5-flash-lite</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 37 | · | 8 | 1 | · | 1 | · | · | · | · | · | 3 | · |
| **mie** | · | 37 | 4 | · | · | · | 2 | · | · | 2 | 1 | 4 | · |
| **nusan** | 3 | · | 28 | 2 | · | 1 | · | · | 2 | 4 | 2 | 8 | · |
| **sunda** | · | · | 1 | 3 | · | · | · | · | · | 1 | · | 2 | · |
| **padan** | · | · | 1 | 1 | 13 | · | · | · | · | · | · | 3 | · |
| **chine** | · | 8 | 8 | · | · | 24 | · | · | · | 1 | · | 9 | · |
| **jepan** | · | 1 | 1 | · | · | 1 | 39 | 1 | · | · | 1 | 6 | · |
| **barat** | · | · | 5 | · | · | · | · | 29 | · | 6 | 2 | 8 | · |
| **seafo** | · | · | 14 | 1 | · | · | · | · | 24 | 3 | · | 8 | · |
| **kopi_** | · | · | 4 | · | · | · | · | 1 | · | 35 | 1 | 9 | · |
| **manis** | · | · | 2 | 1 | · | · | · | · | · | 1 | 26 | 4 | · |
| **lainn** | · | 1 | 5 | · | · | · | · | 3 | · | 3 | · | 38 | · |

</details>
