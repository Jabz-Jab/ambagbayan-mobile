// src/components/TopNav.jsx
import React from "react";
import { NavLink } from "react-router-dom";
import "../pages/Dashboard.css"; // keep shared nav styles

export default function TopNav({ title }) {
  const linkClass = ({ isActive }) => `cta${isActive ? " is-active" : ""}`;

  return (
    <header className="hero" role="banner">
      <h1 className="hero-title">{title}</h1>
      <nav className="hero-cta" role="navigation" aria-label="Primary">
        <NavLink to="/" end className={linkClass}>Home</NavLink>
        <NavLink to="/donors" className={linkClass}>Donors</NavLink>
        <NavLink to="/organizations" className={linkClass}>Organizations</NavLink>
        <NavLink to="/users" className={linkClass}>Users</NavLink>
      </nav>
    </header>
  );
}
