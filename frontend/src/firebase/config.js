import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBZbD9kuod4vFRFOrvRZBww2pWz8p3nR08",
  authDomain: "hype-fun-f881d.firebaseapp.com",
  projectId: "hype-fun-f881d",
  storageBucket: "hype-fun-f881d.appspot.com",
  messagingSenderId: "997866831246",
  appId: "1:997866831246:web:39c2f1d7779247930538df",
  measurementId: "G-0JJH2TNWV9",
};

// Initialize Firebase once
const app = initializeApp(firebaseConfig);

// Get storage instance
export const storage = getStorage(app);

export default app;
