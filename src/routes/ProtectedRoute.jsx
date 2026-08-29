// src/routes/ProtectedRoute.jsx
import { Route, Redirect } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const STAFF_ROLES = ["admin"];

export default function ProtectedRoute({
  component: Component,
  render,
  allowedRoles = STAFF_ROLES,
  ...rest
}) {
  const { user, role, loading } = useAuth();

  return (
    <Route
      {...rest}
      render={(props) => {
        if (loading) {
          return (
            <div className="p-8 text-center text-slate-500">
              Verificando sesión…
            </div>
          );
        }

        const hasAccess = user && role && allowedRoles.includes(role);
        if (!hasAccess) {
          return (
            <Redirect
              to={{
                pathname: "/login",
                state: { from: props.location },
              }}
            />
          );
        }

        if (Component) {
          return <Component {...props} />;
        }

        if (typeof render === "function") {
          return render(props);
        }

        return null;
      }}
      />
      );
}