/**
 * Normalisation de texte partagée par l'anti-phishing, l'anti-spam et
 * l'anti-usurpation. Aucune dépendance Discord ni base : testable seule.
 */

/** Caractères qui imitent une lettre latine (chiffres, grec, cyrillique…). */
const CONFUSABLES: Record<string, string> = {
  "0": "o",
  "1": "l",
  "!": "l",
  "|": "l",
  i: "l",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "8": "b",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "l",
  ј: "j",
  ԁ: "d",
  һ: "h",
  ѕ: "s",
  ո: "n",
  ս: "u",
  ɡ: "g",
  ı: "l",
  ⅼ: "l",
  α: "a",
  ο: "o",
  ρ: "p",
  τ: "t",
  κ: "k",
  ι: "l",
  ν: "v",
};

/**
 * « Squelette » d'un nom : sans accents, sans décoration, en minuscules, les
 * sosies de lettres ramenés à la lettre qu'ils imitent. Deux noms au même
 * squelette se ressemblent à l'œil.
 */
export function skeleton(value: string): string {
  const folded = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  let out = "";
  for (const char of folded) out += CONFUSABLES[char] ?? char;
  return out
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/[^a-z]/g, "");
}

/** Distance d'édition, interrompue dès qu'elle dépasse `max`. */
export function levenshtein(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Empreinte d'un message pour repérer le même texte posté par plusieurs
 * comptes : casse, espaces, ponctuation et caractères invisibles ignorés, pour
 * qu'une variante cosmétique ne suffise pas à passer.
 */
export function contentFingerprint(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}
