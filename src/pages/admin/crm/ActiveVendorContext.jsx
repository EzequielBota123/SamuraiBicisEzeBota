import { createContext, useContext, useState } from "react";

const STORAGE_KEY = "crm_active_vendedor";
const ActiveVendorContext = createContext({ activeVendedor: "", setActiveVendedor: () => {} });

export function ActiveVendorProvider({ children }) {
  const [activeVendedor, setActiveVendedorState] = useState(() => localStorage.getItem(STORAGE_KEY) || "");

  function setActiveVendedor(nombre) {
    setActiveVendedorState(nombre);
    if (nombre) localStorage.setItem(STORAGE_KEY, nombre);
    else localStorage.removeItem(STORAGE_KEY);
  }

  return <ActiveVendorContext.Provider value={{ activeVendedor, setActiveVendedor }}>{children}</ActiveVendorContext.Provider>;
}

export function useActiveVendor() {
  return useContext(ActiveVendorContext);
}
