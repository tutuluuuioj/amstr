const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Pure TypeScript Base58 encoder (Bitcoin / Solana alphabet).
 * Zero dependencies, zero Buffer requirement, runs safely in all browser environments.
 */
export function encodeBase58(source: Uint8Array | number[]): string {
  if (!source || source.length === 0) return "";
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) {
    str += "1";
  }
  for (let q = digits.length - 1; q >= 0; q--) {
    str += ALPHABET[digits[q]];
  }
  return str;
}

/**
 * Pure TypeScript Base58 decoder (Bitcoin / Solana alphabet).
 * Zero dependencies, zero Buffer requirement, runs safely in all browser environments.
 */
export function decodeBase58(string: string): Uint8Array {
  if (!string || string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    const value = ALPHABET.indexOf(c);
    if (value === -1) {
      throw new Error(`Invalid Base58 character: ${c}`);
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < string.length && string[k] === "1"; k++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}
