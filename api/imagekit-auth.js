// api/imagekit-auth.js
// ─────────────────────────────────────────────────────────────────────────────
// Vercel Serverless Function — runs on Node.js, never in the browser.
// Called by App.jsx at: fetch("/api/imagekit-auth", { headers: { Authorization: "Bearer <token>" } })
//
// REQUIRED environment variables (set in Vercel dashboard → Settings → Environment Variables):
//   IMAGEKIT_PUBLIC_KEY      — your ImageKit public key
//   IMAGEKIT_PRIVATE_KEY     — your ImageKit PRIVATE key (secret, never share)
//   IMAGEKIT_URL_ENDPOINT    — e.g. https://ik.imagekit.io/jwpfdkm8y
//   FIREBASE_PROJECT_ID      — fk-fshion
//   FIREBASE_CLIENT_EMAIL    — from Firebase service account JSON
//   FIREBASE_PRIVATE_KEY     — from Firebase service account JSON
// ─────────────────────────────────────────────────────────────────────────────

import ImageKit from "imagekit";
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// ── Initialize Firebase Admin once per cold start ─────────────────────────────
function getAdminApp() {
  if (getApps().length > 0) return getApp();
  return initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel stores \n literally in env vars — convert back to real newlines
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

// ── ImageKit instance — private key stays server-side only ────────────────────
function getImageKit() {
  return new ImageKit({
    publicKey:   process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey:  process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow only GET
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Extract Firebase ID token ──────────────────────────────────────────────
  const authHeader = req.headers["authorization"] || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!idToken) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "No Firebase ID token provided. You must be logged in.",
    });
  }

  // ── Verify token with Firebase Admin ──────────────────────────────────────
  try {
    const adminApp = getAdminApp();
    await getAuth(adminApp).verifyIdToken(idToken);

    // Token valid — generate ImageKit auth params
    const ik = getImageKit();
    const authParams = ik.getAuthenticationParameters();
    // authParams = { token, expire, signature }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(authParams);

  } catch (err) {
    if (err.code === "auth/id-token-expired" || err.code === "auth/id-token-revoked") {
      return res.status(401).json({
        error: "Token expired",
        message: "Your session has expired. Please sign in again.",
      });
    }
    if (err.code?.startsWith("auth/")) {
      return res.status(401).json({
        error: "Invalid token",
        message: "Authentication failed.",
      });
    }
    console.error("imagekit-auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}