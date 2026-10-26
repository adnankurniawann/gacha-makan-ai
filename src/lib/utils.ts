import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Menggabungkan class Tailwind dengan aman.
 *
 * `clsx` mengurus class bersyarat, `twMerge` menyelesaikan konflik: kalau
 * sebuah komponen punya `p-4` bawaan lalu dipanggil dengan `p-6`, yang menang
 * harus yang terakhir. Tanpa twMerge keduanya ikut terpasang dan yang menang
 * ditentukan urutan di CSS — bukan urutan yang kamu tulis.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
