import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./components/Login";

import Dashboard from "./pages/Dashboard";
import Users from "./pages/Users";
import Donations from "./pages/Donations";
import Requests from "./pages/Requests";
import Organizations from "./pages/Organizations";
import Donors from "./pages/Donors";
import DonorDetail from "./pages/DonorDetail"; //  ⬅️ NEW
import OrganizationDetail from "./pages/OrganizationDetail";
import "./App.css";

export default function App() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<Login />} />

      {/* private */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/users" element={<Users />} />
        <Route path="/donations" element={<Donations />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/organizations" element={<Organizations />} />
        <Route path="/organizations/:uid" element={<OrganizationDetail />} />
        {/* donors pages */}
        <Route path="/donors" element={<Donors />} />
        <Route path="/donors/:uid" element={<DonorDetail />} /> {/* ⬅️ NEW */}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
