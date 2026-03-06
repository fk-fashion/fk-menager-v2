// api/imagekit-auth.js
// Place at project ROOT: /api/imagekit-auth.js (not inside /src)
//
// Vercel Environment Variable required:
//   IMAGEKIT_PRIVATE_KEY  →  from ImageKit Dashboard → Developer → API Keys

import crypto from "crypto";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    return res.status(500).json({ error: "IMAGEKIT_PRIVATE_KEY env variable not set" });
  }

  // token: any unique string
  const token = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  // expire: Unix timestamp in SECONDS, must be within 1 hour from now
  const expire = Math.floor(Date.now() / 1000) + 2400; // 40 minutes from now

  // signature: HMAC-SHA1 of (token + expire) using private key
  // expire must be converted to string for concatenation
  const signature = crypto
    .createHmac("sha1", privateKey)
    .update(token + String(expire))
    .digest("hex");

  return res.status(200).json({ token, expire, signature });
}