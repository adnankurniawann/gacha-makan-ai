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
  "promptHash": "05555da87498",
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
| gemini/gemini-3.5-flash-lite | 509 | 64.0% (60.1%–68.2%) | 0.65 (0.60–0.69) | 0.0% | 75.2% | 72.8% | 51.5% | 82.4% |
| ollama/qwen2.5:3b | 509 | 20.2% (16.9%–23.8%) | 0.23 (0.19–0.27) | 34.6% | 32.0% | 51.5% | 15.1% | 67.5% |
| ollama/qwen2.5:7b | 509 | 47.0% (42.6%–51.3%) | 0.46 (0.41–0.50) | 0.0% | 78.8% | 54.6% | 54.0% | 67.6% |

### tanpa_kata_kunci

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 323 | 14.6% (10.8%–18.6%) | 0.02 (0.02–0.03) | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| naive-bayes (α=0.3) | 323 | 46.1% (40.9%–51.7%) | 0.41 (0.34–0.46) | 0.0% | 79.9% | 44.6% | 72.4% | 46.2% |
| gemini/gemini-3.5-flash-lite | 323 | 52.6% (47.4%–58.2%) | 0.53 (0.46–0.58) | 0.0% | 61.9% | 62.0% | 28.5% | 73.9% |
| ollama/qwen2.5:3b | 323 | 10.2% (6.8%–13.6%) | 0.10 (0.06–0.14) | 34.4% | 21.1% | 29.4% | 5.3% | 47.1% |
| ollama/qwen2.5:7b | 323 | 30.3% (25.4%–35.3%) | 0.26 (0.21–0.30) | 0.0% | 68.4% | 35.3% | 35.6% | 47.0% |

### non_waralaba

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 497 | 37.8% (33.8%–42.1%) | 0.39 (0.34–0.45) | 0.0% | 37.0% | 76.6% | 37.0% | 76.6% |
| naive-bayes (α=0.3) | 497 | 56.5% (52.3%–61.2%) | 0.52 (0.48–0.56) | 0.0% | 85.5% | 57.9% | 80.1% | 59.8% |
| gemini/gemini-3.5-flash-lite | 497 | 63.6% (59.6%–67.6%) | 0.65 (0.60–0.69) | 0.0% | 74.8% | 72.3% | 51.1% | 81.9% |
| ollama/qwen2.5:3b | 497 | 20.7% (17.3%–24.5%) | 0.24 (0.20–0.27) | 34.0% | 32.4% | 52.2% | 15.5% | 67.5% |
| ollama/qwen2.5:7b | 497 | 46.9% (42.7%–51.1%) | 0.46 (0.42–0.50) | 0.0% | 78.9% | 54.3% | 53.7% | 67.4% |

## Seluruh split (hanya metode tanpa LLM)

| Metode | n | Akurasi (95% CI) | Macro-F1 (95% CI) | Gagal | Ditulis ≥sedang | Presisi | Ditulis ≥tinggi | Presisi |
|---|---|---|---|---|---|---|---|---|
| keyword | 1479 | 26.8% (24.6%–29.0%) | 0.34 (0.30–0.38) | 0.0% | 35.0% | 67.4% | 35.0% | 67.4% |
| naive-bayes (α=0.3) | 1479 | 62.9% (60.4%–65.3%) | 0.50 (0.47–0.53) | 0.0% | 89.5% | 66.0% | 83.3% | 68.3% |

## Biaya dan latensi (subset berimbang)

| Metode | Token in/item | Token out/item | USD per 1.000 warung | Batch p50 | Batch p95 | Waktu per 1.000 warung |
|---|---|---|---|---|---|---|
| gemini/gemini-3.5-flash-lite | 45 | 62 | $0.168 | 26.8 s | 49.6 s | 14.4 menit |
| ollama/qwen2.5:3b | 90 | 33 | — | 68.5 s | 75.9 s | 89.3 menit |
| ollama/qwen2.5:7b | 90 | 44 | — | 130.5 s | 173.7 s | 229.6 menit |

## Uji McNemar (subset berimbang)

| A | B | Hanya A benar | Hanya B benar | p |
|---|---|---|---|---|
| keyword | naive-bayes (α=0.3) | 46 | 144 | <0,001 |
| keyword | gemini/gemini-3.5-flash-lite | 22 | 159 | <0,001 |
| keyword | ollama/qwen2.5:3b | 116 | 30 | <0,001 |
| keyword | ollama/qwen2.5:7b | 47 | 97 | <0,001 |
| naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite | 49 | 88 | 0.0011 |
| naive-bayes (α=0.3) | ollama/qwen2.5:3b | 200 | 16 | <0,001 |
| naive-bayes (α=0.3) | ollama/qwen2.5:7b | 93 | 45 | <0,001 |
| gemini/gemini-3.5-flash-lite | ollama/qwen2.5:3b | 232 | 9 | <0,001 |
| gemini/gemini-3.5-flash-lite | ollama/qwen2.5:7b | 105 | 18 | <0,001 |
| ollama/qwen2.5:3b | ollama/qwen2.5:7b | 19 | 155 | <0,001 |

## F1 per slot (subset berimbang)

| Slot | n | keyword | naive-bayes (α=0.3) | gemini/gemini-3.5-flash-lite | ollama/qwen2.5:3b | ollama/qwen2.5:7b |
|---|---|---|---|---|---|---|
| ayam | 50 | 0.58 | 0.65 | 0.81 | 0.29 | 0.72 |
| mie | 50 | 0.62 | 0.70 | 0.77 | 0.51 | 0.62 |
| nusantara | 50 | 0.08 | 0.40 | 0.44 | 0.21 | 0.33 |
| sunda | 7 | 0.25 | 0.00 | 0.38 | 0.00 | 0.00 |
| padang | 18 | 0.62 | 0.44 | 0.84 | 0.00 | 0.55 |
| chinese | 50 | 0.18 | 0.55 | 0.61 | 0.18 | 0.30 |
| jepang_korea | 50 | 0.28 | 0.71 | 0.85 | 0.18 | 0.59 |
| barat | 50 | 0.49 | 0.50 | 0.62 | 0.34 | 0.51 |
| seafood | 50 | 0.48 | 0.58 | 0.61 | 0.32 | 0.56 |
| kopi_minuman | 50 | 0.60 | 0.62 | 0.67 | 0.30 | 0.56 |
| manis_roti | 34 | 0.24 | 0.50 | 0.79 | 0.33 | 0.49 |
| lainnya | 50 | 0.25 | 0.61 | 0.44 | 0.12 | 0.26 |

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
| **ayam** | 36 | 1 | 9 | 1 | · | 1 | · | · | · | · | · | 2 | · |
| **mie** | · | 38 | 3 | · | · | · | 3 | · | · | 1 | 1 | 4 | · |
| **nusan** | 3 | · | 29 | 2 | · | 1 | · | 1 | 2 | 4 | 2 | 6 | · |
| **sunda** | · | · | 2 | 3 | · | · | · | · | · | 1 | · | 1 | · |
| **padan** | · | · | 2 | · | 13 | · | · | · | · | · | · | 3 | · |
| **chine** | · | 9 | 9 | · | · | 23 | · | · | · | 1 | · | 8 | · |
| **jepan** | · | 1 | · | · | · | 1 | 40 | · | · | · | 1 | 7 | · |
| **barat** | · | · | 3 | · | · | · | · | 28 | · | 6 | 1 | 12 | · |
| **seafo** | · | · | 15 | 2 | · | · | · | · | 23 | 3 | · | 7 | · |
| **kopi_** | · | · | 4 | · | · | · | · | 1 | · | 35 | 1 | 9 | · |
| **manis** | · | · | 2 | 1 | · | · | · | · | · | 1 | 26 | 4 | · |
| **lainn** | · | · | 4 | · | · | · | 1 | 10 | · | 3 | · | 32 | · |

</details>

<details><summary>ollama/qwen2.5:3b</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 9 | · | 9 | · | · | · | · | · | · | 1 | · | 12 | 19 |
| **mie** | · | 19 | 4 | · | · | · | · | · | · | 1 | 1 | 9 | 16 |
| **nusan** | 1 | · | 10 | · | · | · | 1 | 1 | · | 2 | · | 20 | 15 |
| **sunda** | · | · | 1 | · | · | · | · | · | · | · | · | 2 | 4 |
| **padan** | · | · | 5 | 2 | · | · | · | · | · | · | · | 3 | 8 |
| **chine** | · | 2 | 4 | · | · | 6 | · | · | 1 | 2 | · | 23 | 12 |
| **jepan** | 1 | 2 | 2 | · | · | 4 | 5 | 2 | · | · | · | 18 | 16 |
| **barat** | · | · | 1 | · | · | 5 | · | 13 | · | 3 | · | 15 | 13 |
| **seafo** | 1 | · | 5 | · | · | · | 1 | 5 | 10 | · | · | 13 | 15 |
| **kopi_** | · | · | 2 | · | · | · | · | · | · | 12 | · | 14 | 22 |
| **manis** | · | · | · | · | · | · | · | · | · | 5 | 7 | 9 | 13 |
| **lainn** | · | 2 | 2 | 1 | · | 1 | · | 5 | 1 | 3 | · | 12 | 23 |

</details>

<details><summary>ollama/qwen2.5:7b</summary>

| | ayam | mie | nusan | sunda | padan | chine | jepan | barat | seafo | kopi_ | manis | lainn | tanpa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ayam** | 31 | · | 8 | · | · | 2 | · | 1 | 1 | 1 | 3 | 3 | · |
| **mie** | · | 25 | 10 | 1 | · | 1 | 6 | 2 | · | 1 | 1 | 3 | · |
| **nusan** | 4 | · | 26 | 1 | 1 | · | · | 4 | · | 3 | 1 | 10 | · |
| **sunda** | · | · | 4 | · | · | · | · | · | · | 1 | · | 2 | · |
| **padan** | · | · | 6 | · | 8 | · | · | · | · | · | · | 4 | · |
| **chine** | · | 4 | 11 | · | · | 11 | 1 | 4 | · | 4 | 2 | 13 | · |
| **jepan** | · | 2 | 4 | · | · | 4 | 25 | 7 | 1 | 3 | · | 4 | · |
| **barat** | · | · | 3 | · | 1 | 1 | 1 | 30 | · | 5 | 2 | 7 | · |
| **seafo** | 1 | · | 20 | · | · | · | · | 2 | 22 | · | · | 5 | · |
| **kopi_** | · | · | 5 | · | · | 1 | · | 3 | · | 28 | 1 | 12 | · |
| **manis** | · | · | 5 | · | · | 2 | 1 | · | · | 3 | 15 | 8 | · |
| **lainn** | · | · | 7 | · | 1 | 2 | 1 | 14 | 4 | 1 | 2 | 18 | · |

</details>
