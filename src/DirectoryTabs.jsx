import { NavLink } from "react-router-dom";

export default function DirectoryTabs() {
  return (
    <nav className="tabs" role="tablist" aria-label="Directory tabs">
      <NavLink end to="/"              className="tab home">Home</NavLink>
      <NavLink    to="/donors"        className="tab donors">Donors</NavLink>
      <NavLink    to="/organizations" className="tab orgs">Organizations</NavLink>
      <NavLink    to="/users"         className="tab users">Users</NavLink>
    </nav>
  );
}
