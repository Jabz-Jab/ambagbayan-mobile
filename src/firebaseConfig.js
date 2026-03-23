import { initializeApp }    from "firebase/app";
import { getFirestore }     from "firebase/firestore";
import { getAuth }          from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDCs_DUw3b7F3aYgpw26RZKbeY2mOLI9Dc",
  authDomain: "project-montero.firebaseapp.com",
  projectId: "project-montero",
  storageBucket: "project-montero.firebasestorage.app",
  messagingSenderId: "358910689799",
  appId: "1:358910689799:web:d53bba6e0d2315e991a0a2"
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);