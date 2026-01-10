/**
 * EasyParcel Malaysia requires the state's "short code" (Appendix III).
 * Reference: `file://Malaysia_Individual_1.4.0.0.pdf`
 */
export const MY_STATE_CODE_BY_NORMALIZED_NAME: Record<string, string> = {
  johor: "jhr",
  kedah: "kdh",
  kelantan: "ktn",
  melaka: "mlk",
  malacca: "mlk",
  "negerisembilan": "nsn",
  pahang: "phg",
  perak: "prk",
  perlis: "pls",
  "pulaubinang": "png",
  penang: "png",
  selangor: "sgr",
  terengganu: "trg",
  "kualalumpur": "kul",
  "putrajaya": "pjy",
  sarawak: "srw",
  sabah: "sbh",
  labuan: "lbn",
}

export function normalizeStateName(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[.\-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s/g, "")
}

export function resolveMalaysiaStateCode(stateOrCode: string | undefined): string | undefined {
  if (!stateOrCode) {
    return undefined
  }

  const raw = String(stateOrCode).trim().toLowerCase()

  // If caller already passed a known code.
  const validCodes = new Set(Object.values(MY_STATE_CODE_BY_NORMALIZED_NAME))
  if (validCodes.has(raw)) {
    return raw
  }

  const normalized = normalizeStateName(raw)
  return MY_STATE_CODE_BY_NORMALIZED_NAME[normalized]
}


