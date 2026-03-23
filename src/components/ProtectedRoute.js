import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc }                from 'firebase/firestore';
import { auth, db }                   from '../firebaseConfig';
import { Navigate, Outlet }           from 'react-router-dom';

export default function ProtectedRoute() {
  const [checking, setChecking] = useState(true);
  const [allowed,  setAllowed]  = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data = snap.exists() ? snap.data() : {};

        // only allow if user isAdmin AND isVerified
        if (data.isAdmin && data.isVerified) {
          setAllowed(true);
        } else {
          // kick them out if not an admin or not yet verified
          await signOut(auth);
          setAllowed(false);
        }
      } else {
        setAllowed(false);
      }

      setChecking(false);
    });

    return unsubscribe;
  }, []);

  if (checking) {
    // you can swap this out for a spinner if you like
    return <div style={{ padding: 20 }}>Checking credentials…</div>;
  }

  return allowed
    ? <Outlet />           // render the protected routes
    : <Navigate to="/login" replace />;
}
