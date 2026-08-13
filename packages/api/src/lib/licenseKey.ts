import crypto from 'crypto';

// Unambiguous alphabet: no 0/O/1/I/L so keys survive being read aloud or handwritten
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function segment(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** e.g. TARO-K3NF-8WPQ-M2XZ */
export function generateLicenseKey(): string {
  return `TARO-${segment(4)}-${segment(4)}-${segment(4)}`;
}

export function normalizeLicenseKey(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}
