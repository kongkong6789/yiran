const HEX = "0123456789abcdef";

function randomHex(bytes: number) {
  const values = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < bytes; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(values, (value) => HEX[value >> 4] + HEX[value & 0x0f]).join("");
}

export function createTaskTraceId(length = 12) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, length);
  }
  return randomHex(Math.ceil(length / 2)).slice(0, length);
}
