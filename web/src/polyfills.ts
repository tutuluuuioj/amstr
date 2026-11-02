// Polyfill to ensure compatibility between near-api-js and @near-js/crypto
import * as borsh from "borsh";

try {
  const target = borsh as any;
  const original = target.serialize;
  if (original) {
    try {
      Object.defineProperty(target, "serialize", {
        value: function (schema: any, value: any, validate?: boolean) {
          if (value && typeof value === "object") {
            if (value.publicKey && typeof value.publicKey === "object" && "keyType" in value.publicKey && !("ed25519Key" in value.publicKey)) {
              const keyData = value.publicKey.data;
              const keyType = value.publicKey.keyType;
              if (keyType === 0) {
                value.publicKey = { ed25519Key: { data: keyData } };
              } else if (keyType === 1) {
                value.publicKey = { secp256k1Key: { data: keyData } };
              }
            }
          }
          return original(schema, value, validate);
        },
        writable: true,
        configurable: true,
      });
    } catch {
      // ignore if non-configurable
    }
  }
} catch {
  // ignore
}
