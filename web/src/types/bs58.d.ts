declare module "bs58" {
  const bs58: {
    encode(source: Uint8Array | number[] | Buffer): string;
    decode(string: string): Uint8Array;
  };
  export default bs58;
}
