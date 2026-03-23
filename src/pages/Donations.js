import React, { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./List.css";

export default function Donations() {
  const [dons, setDons] = useState([]);

  useEffect(() => {
    return onSnapshot(collection(db, "donations"), snap =>
      setDons(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, []);

  return (
    <div>
      <h1>All Donations</h1>
      <table className="list-table">
        <thead>
          <tr><th>Donor</th><th>Category</th><th>Description</th></tr>
        </thead>
        <tbody>
          {dons.map(d => (
            <tr key={d.id}>
              <td>{d.fullName}</td>
              <td>{d.category}</td>
              <td>{d.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
