import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export function checksum(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
