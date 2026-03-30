import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

import config from "./firebase.json";

const app = initializeApp(config);
export const db = getFirestore(app);
export const auth = getAuth(app);