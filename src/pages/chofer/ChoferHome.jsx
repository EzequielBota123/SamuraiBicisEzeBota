import { Redirect } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";

// Entrada al sector chofer: el chofer "de planta" arranca en el mapa; quien
// solo tiene la marca (ej. un distribuidor que también reparte) va directo a
// su grilla de viajes.
export default function ChoferHome() {
  const { profile } = useAuth();
  return <Redirect to={profile?.role === "chofer" || profile?.role === "admin" ? "/chofer/mapa" : "/chofer/grilla"} />;
}
