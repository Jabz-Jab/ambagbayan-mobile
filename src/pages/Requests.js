import React, { useEffect, useState } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./List.css";

export default function Requests() {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    return onSnapshot(collection(db, "request"), async snap => {
      const reqs = await Promise.all(snap.docs.map(async d => {
        const data = d.data();
        let requester = "Unknown";
        try {
          const u = await getDoc(doc(db, "users", data.userId));
          if (u.exists()) requester = u.data().fullName;
        } catch {}
        return {
          id: d.id,
          donorName: data.donorName,
          category: data.category,
          description: data.description,
          requestedBy: requester,
          when: data.createdAt?.toDate?.().toLocaleString() || ""
        };
      }));
      setRequests(reqs);
    });
  }, []);

  return (
    <div>
      <h1>All Requests</h1>
      <table className="list-table">
        <thead>
          <tr>
            <th>Donor</th><th>Category</th><th>Description</th>
            <th>Requested By</th><th>When</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id}>
              <td>{r.donorName}</td>
              <td>{r.category}</td>
              <td className="description">{r.description}</td>
              <td>{r.requestedBy}</td>
              <td>{r.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
