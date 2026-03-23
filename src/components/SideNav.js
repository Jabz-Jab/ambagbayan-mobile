import React from "react";
import { NavLink } from "react-router-dom";

export default function SideNav() {
  return (
    <div className="sidebar">
      <nav>
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/users">Users</NavLink>
        <NavLink to="/donations">Donations</NavLink>
        <NavLink to="/requests">Requests</NavLink>
      </nav>
    </div>
  );
}
