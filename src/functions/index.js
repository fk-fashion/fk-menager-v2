const functions = require("firebase-functions");
const ImageKit = require("imagekit");

const imagekit = new ImageKit({
  publicKey:   "public_AYglbaxTsZGRiapGe3SKLdy2Z6s=",          // your ImageKit public key
  privateKey:  "private_bk49LKguoWJaByLeMqvdTXWU8tw=",         // your ImageKit private key
  urlEndpoint: "https://ik.imagekit.io/jwpfdkm8y", // your ImageKit URL endpoint
});

exports.ikAuth = functions.https.onRequest((req, res) => {
  // Allow your frontend domain — replace * with your domain in production
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  const result = imagekit.getAuthenticationParameters();
  res.json(result);
});