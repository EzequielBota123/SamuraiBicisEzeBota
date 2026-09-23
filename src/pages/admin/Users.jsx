import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useHistory } from "react-router-dom";
import {
  subscribeClients,
  updateAccount,
  toggleAccountStatus,
  syncClientContabiliumProfile,
} from "../../services/accounts";
import { BusyButtonContent, LoadingOverlay } from "../../components/ui/LoadingIndicators";
import { subscribeCustomerTypes } from "../../services/customerTypes";
import { getContabiliumDepositos, labelDeposito, matchDeposito } from "../../services/contabiliumDepositos";
import { getDepositoStockAdmin, createUserWithPassword, adminSetUserPassword, auditLegacyUsers, adminRenameUsername, adminDeleteUser, adminLinkDepositoClientes } from "../../services/comprobantes";

const statusStyles = {
  activo: "border border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  suspendido: "border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
  pending: "border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400",
  rejected: "border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
};

function formatDiscount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0%";
  return `${num.toFixed(num % 1 === 0 ? 0 : 2)}%`;
}

export default function Users() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerTypes, setCustomerTypes] = useState([]);

  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [auditing, setAuditing] = useState(false);

  async function handleAudit() {
    setAuditing(true);
    try {
      const result = await auditLegacyUsers();
      alert(
        `Revisados: ${result.totalRevisados}\n` +
        `Sin cuenta creada (hay que borrar y recrear): ${result.sinCuenta.length}\n` +
        `Con cuenta real pero id distinto (NO borrar): ${result.conCuentaDistinta.length}`
      );
    } catch (e) {
      alert(e.message || "No se pudo auditar.");
    } finally {
      setAuditing(false);
    }
  }

  const location = useLocation();
  const history = useHistory();

  useEffect(() => {
    if (new URLSearchParams(location.search).get("new") === "1") {
      setEditing(null);
      setModalOpen(true);
      history.replace("/admin/users");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);

    const unsub = subscribeClients(
      "all",
      (items) => {
        setRows(items);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setLoading(false);
        alert("No se pudieron cargar los usuarios.");
      }
    );
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeCustomerTypes(
      (items) => {
        setCustomerTypes(items);
      },
      (error) => {
        console.error(error);
        alert("No se pudieron cargar las categorías de cliente.");
      }
    );

    return () => unsub && unsub();
  }, []);

  const customerTypeMap = useMemo(() => {
    const map = new Map();
    customerTypes.forEach((type) => {
      if (type?.id) map.set(type.id, type);
    });
    return map;
  }, [customerTypes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((u) => {
      const matchText = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
      const matchRole = role === "all" ? true : u.role === role;
      const matchStatus = status === "all" ? true : u.status === status;
      return matchText && matchRole && matchStatus;
    });
  }, [rows, query, role, status]);

  async function onSubmitUser(data) {
    try {
      if (editing?.id) {
        const { newPassword, newUsername, ...patch } = data;
        await updateAccount(editing.id, patch);
        if (newPassword) {
          await adminSetUserPassword(editing.id, newPassword);
        }
        if (newUsername) {
          await adminRenameUsername(editing.id, newUsername);
        }
      } else {
        await createUserWithPassword(data.name, data.password, { cuit: data.cuit, telefono: data.telefono });
      }
      setModalOpen(false);
      setEditing(null);
    } catch (e) {
      console.error(e);
      alert(e.message || "No se pudo guardar el usuario.");
    }
  }

  async function onToggle(u) {
    const next = u.status === "activo" ? "suspendido" : "activo";
    try {
      await toggleAccountStatus(u.id, next);
    } catch (e) {
      console.error(e);
      alert("No se pudo cambiar el estado.");
    }
  }

  const [linkingDepositos, setLinkingDepositos] = useState(false);
  const [linkPreview, setLinkPreview] = useState(null);
  const [applyingLink, setApplyingLink] = useState(false);

  async function handleLinkDepositoClientes() {
    setLinkingDepositos(true);
    try {
      const preview = await adminLinkDepositoClientes(false);
      console.log("[adminLinkDepositoClientes] preview", preview);
      setLinkPreview(preview);
    } catch (e) {
      console.error(e);
      alert(e.message || "Error al vincular clientes.");
    } finally {
      setLinkingDepositos(false);
    }
  }

  async function handleApplyLinkDepositos() {
    if (!confirm(`¿Vincular los ${linkPreview.matchedCount} depósito(s) nuevos?`)) return;
    setApplyingLink(true);
    try {
      const result = await adminLinkDepositoClientes(true);
      console.log("[adminLinkDepositoClientes] applied", result);
      setLinkPreview(null);
      alert(`Listo: ${result.matchedCount} depósito(s) vinculado(s).`);
    } catch (e) {
      console.error(e);
      alert(e.message || "Error al vincular clientes.");
    } finally {
      setApplyingLink(false);
    }
  }

  async function onDelete(u) {
    if (!confirm(`¿Eliminar a ${u.name || u.email}?`)) return;
    try {
      await adminDeleteUser(u.id);
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_45px_80px_-50px_rgba(15,23,42,0.2)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="absolute -right-28 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-emerald-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
              Gestión de usuarios
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Usuarios</h1>
              <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-neutral-400">
                Administrá cuentas y permisos con un flujo que refleja los estados de carga y guardado en tiempo real.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-400 hover:text-slate-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
              onClick={handleAudit}
              disabled={auditing}
            >
              {auditing ? "Auditando…" : "Auditar cuentas legacy"}
            </button>
            <button
              className="inline-flex items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-700 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400"
              onClick={handleLinkDepositoClientes}
              disabled={linkingDepositos}
            >
              {linkingDepositos ? "Buscando…" : "Vincular depósitos"}
            </button>
            <button
              className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200/60 transition hover:-translate-y-0.5"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Nuevo usuario
            </button>
          </div>
        </div>
      </section>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_35px_65px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        <div className="grid gap-4 sm:grid-cols-3">
          <input
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white dark:placeholder:text-neutral-500"
            placeholder="Buscar por nombre…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="all">Todos los roles</option>
            <option value="admin">Admin</option>
            <option value="chofer">Chofer</option>
            <option value="viewer">Viewer</option>
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Rechazado</option>
          </select>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_40px_70px_-45px_rgba(15,23,42,0.18)] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none dark:ring-1 dark:ring-white/5">
        {loading && (
          <LoadingOverlay
            label="Cargando usuarios…"
            className="rounded-[inherit] border border-slate-200 bg-white text-slate-600"
            labelClassName="text-slate-600"
          />
        )}
        {loading && (
          <p className="p-8 text-center text-sm text-slate-500 dark:text-neutral-400">Cargando…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="p-12 text-center text-sm text-slate-500 dark:text-neutral-400">Sin resultados.</p>
        )}

        {!loading && filtered.length > 0 && (
          <>
            {/* Mobile: tarjetas apiladas, sin scroll horizontal */}
            <ul className="divide-y divide-slate-100 md:hidden dark:divide-neutral-800">
              {filtered.map((row) => (
                <li key={row.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{row.name || "-"}</p>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
                        statusStyles[row.status] || "border border-slate-200 bg-slate-50 text-slate-500"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {row.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 capitalize dark:bg-neutral-800 dark:text-neutral-300">{row.role}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-neutral-800 dark:text-neutral-300">
                      {customerTypeMap.get(row.customerTypeId)?.title || "Sin tipo de cliente"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => {
                        setEditing(row);
                        setModalOpen(true);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-amber-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => onToggle(row)}
                    >
                      {row.status === "activo" ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                      onClick={() => onDelete(row)}
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabla completa */}
            <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm text-slate-600 dark:divide-neutral-800 dark:text-neutral-300">
              <thead className="bg-slate-100 text-slate-500 dark:bg-neutral-800 dark:text-neutral-400">
                <tr>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">Rol</th>
                  <th className="px-4 py-3 text-left">Tipo de cliente</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-4 text-slate-600 dark:text-neutral-300">{row.name || "-"}</td>
                    <td className="px-4 py-4 capitalize text-slate-500 dark:text-neutral-400">{row.role}</td>
                    <td className="px-4 py-4 text-slate-500 dark:text-neutral-400">
                      {customerTypeMap.get(row.customerTypeId)?.title || "-"}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                          statusStyles[row.status] || "border border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-sky-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => {
                            setEditing(row);
                            setModalOpen(true);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-amber-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => onToggle(row)}
                        >
                          {row.status === "activo" ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-rose-400 hover:text-slate-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:text-white"
                          onClick={() => onDelete(row)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      <UserModal
        open={modalOpen}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={onSubmitUser}
        customerTypes={customerTypes}
      />

      <LinkDepositosModal
        preview={linkPreview}
        onClose={() => setLinkPreview(null)}
        onApply={handleApplyLinkDepositos}
        applying={applyingLink}
      />
    </div>
  );
}

function UserModal({ open, onClose, onSubmit, initial, customerTypes }) {
  const isNew = !initial?.id;
  const [name, setName]               = useState(initial?.name || "");
  const [password, setPassword]       = useState("");
  const [cuitNuevo, setCuitNuevo]     = useState("");
  const [telefonoNuevo, setTelefonoNuevo] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [username, setUsername] = useState(initial?.username || "");
  const [role, setRole]               = useState(initial?.role || "viewer");
  const [esChofer, setEsChofer]       = useState(initial?.esChofer === true);
  const [status, setStatus]           = useState(initial?.status || "activo");
  const [customerTypeId, setCustomerTypeId] = useState(initial?.customerTypeId || "");
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit?.toString() || "");
  const [contabiliumId, setContabiliumId]   = useState(initial?.contabiliumId?.toString() || "");
  const [depositoId, setDepositoId] = useState(initial?.contabiliumDepositoId?.toString() || "");
  const [depositos, setDepositos] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState("");
  const [stockItems, setStockItems] = useState(null);
  const [contabiliumInfo, setContabiliumInfo] = useState(
    initial?.idListaPrecio != null
      ? { idListaPrecio: initial.idListaPrecio, condicionIva: initial.condicionIva }
      : null
  );
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [saving, setSaving] = useState(false);
  const [depositoSearch, setDepositoSearch] = useState("");
  const [depositoPickerOpen, setDepositoPickerOpen] = useState(false);
  const depositoPickerRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (depositoPickerRef.current && !depositoPickerRef.current.contains(e.target)) {
        setDepositoPickerOpen(false);
      }
    }
    if (depositoPickerOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [depositoPickerOpen]);

  const filteredDepositos = useMemo(() => {
    const q = depositoSearch.trim().toLowerCase();
    if (!q) return depositos;
    return depositos.filter((d) => matchDeposito(d, q));
  }, [depositos, depositoSearch]);

  const selectedDeposito = depositos.find((d) => String(d.id) === depositoId);
  const selectedDepositoNombre = selectedDeposito?.nombre || "";

  useEffect(() => {
    if (!open) return;
    getContabiliumDepositos()
      .then(setDepositos)
      .catch((e) => console.error("Error cargando depósitos de Contabilium:", e));
  }, [open]);

  useEffect(() => {
    setName(initial?.name || "");
    setPassword("");
    setCuitNuevo("");
    setTelefonoNuevo("");
    setNewPassword("");
    setUsername(initial?.username || "");
    setRole(initial?.role || "viewer");
    setEsChofer(initial?.esChofer === true);
    setStatus(initial?.status || "activo");
    setCustomerTypeId(initial?.customerTypeId || "");
    setCreditLimit(initial?.creditLimit?.toString() || "");
    setContabiliumId(initial?.contabiliumId?.toString() || "");
    setDepositoId(initial?.contabiliumDepositoId?.toString() || "");
    setContabiliumInfo(
      initial?.idListaPrecio != null
        ? { idListaPrecio: initial.idListaPrecio, condicionIva: initial.condicionIva }
        : null
    );
    setSyncError("");
    setStockItems(null);
    setStockError("");
  }, [initial, open]);

  async function handleVerStock() {
    if (!depositoId) return;
    setStockLoading(true);
    setStockError("");
    setStockItems(null);
    try {
      const result = await getDepositoStockAdmin(Number(depositoId));
      setStockItems(result.items);
    } catch (e) {
      setStockError(e.message || "Error al consultar el stock");
    } finally {
      setStockLoading(false);
    }
  }

  async function handleSyncContabilium() {
    if (!initial?.id) return;
    setSyncing(true);
    setSyncError("");
    try {
      await updateAccount(initial.id, { contabiliumId: contabiliumId ? Number(contabiliumId) : null });
      const result = await syncClientContabiliumProfile(initial.id);
      setContabiliumId(result.contabiliumId.toString());
      setContabiliumInfo({ idListaPrecio: result.idListaPrecio, condicionIva: null });
    } catch (e) {
      setSyncError(e.message || "Error al sincronizar con Contabilium");
    } finally {
      setSyncing(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {initial?.id ? "Editar usuario" : "Nuevo usuario"}
          </h2>
          <button onClick={onClose} className="rounded-2xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">
            Cerrar
          </button>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            if (isNew) {
              await onSubmit({ name, password, cuit: cuitNuevo.trim() || null, telefono: telefonoNuevo.trim() || null });
            } else {
              await onSubmit({
                name,
                role,
                esChofer: role === "chofer" ? false : esChofer,
                status,
                customerTypeId:  customerTypeId || null,
                contabiliumId:   contabiliumId ? Number(contabiliumId) : null,
                contabiliumDepositoId: depositoId ? Number(depositoId) : null,
                contabiliumDepositoNombre:
                  (depositos.find((d) => String(d.id) === depositoId)?.nombre) || null,
                creditLimit: creditLimit !== "" ? Number(creditLimit) : null,
                newPassword: newPassword || null,
                newUsername: username && username !== initial?.username ? username : null,
              });
            }
            setSaving(false);
          }}
        >
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre</label>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {isNew && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Contraseña</label>
              <input
                type="password"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <p className="text-[11px] text-slate-500">
                Mínimo 6 caracteres. Después de crear el usuario podés asignarle rol, tipo de cliente y depósito consignado editándolo.
              </p>
            </div>
          )}

          {isNew && (
            <div className="space-y-2 rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                CUIT (opcional) — crea el cliente en Contabilium automáticamente
              </label>
              <input
                placeholder="Ej: 20304050607"
                inputMode="numeric"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={cuitNuevo}
                onChange={(e) => setCuitNuevo(e.target.value)}
              />
              <input
                placeholder="Teléfono (opcional)"
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={telefonoNuevo}
                onChange={(e) => setTelefonoNuevo(e.target.value)}
              />
              <p className="text-[11px] text-slate-500">
                Si completás el CUIT, se busca al padrón de AFIP y se crea la ficha de Cliente en Contabilium sola, ya vinculada
                a esta cuenta. El depósito de consignación todavía hay que crearlo a mano en Contabilium.
              </p>
            </div>
          )}

          {!isNew && (
          <>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Usuario (para loguearse)</label>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              Con esto entra el cliente, no con su mail. Poné algo simple y fácil de recordar.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Nueva contraseña</label>
            <input
              type="password"
              placeholder="Dejar vacío para no cambiarla"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
            />
          </div>
          </>
          )}
          {!isNew && (
          <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Rol</label>
              <select
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="viewer">Viewer (cliente, sin acceso a admin)</option>
                <option value="admin">Admin (acceso total al panel)</option>
                <option value="chofer">Chofer (mapa, stock consignado y notas de entrega)</option>
              </select>
              {role !== "chofer" && (
                <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
                  <input type="checkbox" className="mt-0.5" checked={esChofer} onChange={(e) => setEsChofer(e.target.checked)} />
                  <span>
                    También es chofer — entra al sector chofer (chequeo de vehículo y viajes) sin perder lo que ya ve con su rol.
                  </span>
                </label>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado</label>
              <select
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="activo">Activo</option>
                <option value="suspendido">Suspendido</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Tipo de cliente</label>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
              value={customerTypeId || ""}
              onChange={(e) => setCustomerTypeId(e.target.value)}
            >
              <option value="">Sin asignar</option>
              {customerTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.title} ({formatDiscount(type.discount)})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Límite de crédito</label>
            <input
              type="number"
              min="0"
              step="1000"
              placeholder="Sin límite"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              Tope en pesos del valor total que puede tener consignado. Vacío = sin límite.
            </p>
          </div>

          {/* ── Contabilium ── */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contabilium</p>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="ID de cliente en Contabilium"
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                value={contabiliumId}
                onChange={(e) => setContabiliumId(e.target.value)}
              />
              {initial?.id && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleSyncContabilium}
                  className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-600 transition hover:bg-sky-100 disabled:opacity-60"
                >
                  {syncing ? "Sincronizando…" : "Sincronizar"}
                </button>
              )}
            </div>
            {syncError && (
              <p className="text-xs text-rose-500">{syncError}</p>
            )}
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Depósito consignado
              </label>
              <div className="relative" ref={depositoPickerRef}>
                <button
                  type="button"
                  onClick={() => {
                    setDepositoPickerOpen((v) => !v);
                    setDepositoSearch("");
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm text-slate-700 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/40"
                >
                  <span className={selectedDepositoNombre ? "text-slate-900" : "text-slate-400"}>
                    {selectedDeposito ? labelDeposito(selectedDeposito) : "Sin depósito asignado"}
                  </span>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-400">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </button>

                {depositoPickerOpen && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_25px_50px_-20px_rgba(15,23,42,0.35)]">
                    <div className="border-b border-slate-100 p-2">
                      <input
                        autoFocus
                        value={depositoSearch}
                        onChange={(e) => setDepositoSearch(e.target.value)}
                        placeholder="Buscar depósito por nombre, número propio o ID de Contabilium…"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-400"
                      />
                    </div>
                    <ul className="max-h-64 overflow-y-auto py-1 text-sm">
                      <li>
                        <button
                          type="button"
                          onClick={() => {
                            setDepositoId("");
                            setDepositoPickerOpen(false);
                          }}
                          className={`block w-full px-4 py-2 text-left transition hover:bg-slate-50 ${
                            !depositoId ? "font-semibold text-sky-600" : "text-slate-500"
                          }`}
                        >
                          Sin depósito asignado
                        </button>
                      </li>
                      {filteredDepositos.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setDepositoId(String(d.id));
                              setDepositoPickerOpen(false);
                            }}
                            className={`block w-full truncate px-4 py-2 text-left transition hover:bg-slate-50 ${
                              String(d.id) === depositoId ? "font-semibold text-sky-600" : "text-slate-700"
                            }`}
                          >
                            {labelDeposito(d)}
                          </button>
                        </li>
                      ))}
                      {filteredDepositos.length === 0 && (
                        <li className="px-4 py-6 text-center text-xs text-slate-400">Sin resultados.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Si asignás un depósito, este usuario va a poder ver su stock consignado en el sitio.
              </p>
              {depositoId && (
                <button
                  type="button"
                  disabled={stockLoading}
                  onClick={handleVerStock}
                  className="mt-1 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-600 transition hover:bg-sky-100 disabled:opacity-60"
                >
                  {stockLoading ? "Consultando…" : "Ver stock consignado"}
                </button>
              )}
              {stockError && (
                <p className="text-xs text-rose-500">{stockError}</p>
              )}
              {stockItems && (
                stockItems.length === 0 ? (
                  <p className="text-xs text-slate-500">No hay stock disponible en este depósito ahora mismo.</p>
                ) : (
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">
                    {stockItems.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs">
                        <span className="text-slate-700">{item.name}</span>
                        <span className="shrink-0 font-semibold text-emerald-600">{item.stockDisponible}</span>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
            {contabiliumInfo && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-emerald-600 font-medium">
                  ✓ Vinculado
                </span>
                {contabiliumInfo.idListaPrecio != null && (
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-600">
                    Lista de precios: #{contabiliumInfo.idListaPrecio}
                  </span>
                )}
                {contabiliumInfo.condicionIva && (
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-600">
                    IVA: {contabiliumInfo.condicionIva}
                  </span>
                )}
              </div>
            )}
          </div>
          </>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              disabled={saving}
              className="rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-200/60 transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 disabled:opacity-60"
            >
              <BusyButtonContent busy={saving} busyLabel="Guardando…" label="Guardar" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LinkDepositosModal({ preview, onClose, onApply, applying }) {
  if (!preview) return null;

  const sections = [
    { key: "alreadyLinked", title: `Ya vinculados (${preview.alreadyLinkedCount})`, color: "text-emerald-600", items: preview.alreadyLinked, render: (m) => `${m.nombre} — id ${m.contabiliumId}` },
    { key: "matched", title: `Nuevos para vincular (${preview.matchedCount})`, color: "text-sky-600", items: preview.matched, render: (m) => `${m.nombre} → ${m.razonSocial}` },
    { key: "unresolved", title: `Sin resolver (${preview.unresolvedCount})`, color: "text-amber-600", items: preview.unresolved, render: (m) => m.nombre },
    { key: "sinCuenta", title: `Sin cuenta vinculada (${preview.sinCuentaCount})`, color: "text-slate-400", items: preview.sinCuenta, render: (m) => m.nombre },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Vincular depósitos</h2>
            <p className="text-xs text-slate-500">Total depósitos en Contabilium: {preview.totalDepositos}</p>
          </div>
          <button onClick={onClose} className="rounded-2xl px-3 py-2 text-xs text-slate-500 hover:bg-slate-100">
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {sections.map((s) =>
            s.items.length === 0 ? null : (
              <div key={s.key}>
                <p className={`mb-2 text-xs font-bold uppercase tracking-wide ${s.color}`}>{s.title}</p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {s.items.map((it, i) => (
                    <li key={i} className="truncate">{s.render(it)}</li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          {preview.matchedCount > 0 ? (
            <button
              onClick={onApply}
              disabled={applying}
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-sky-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200/60 transition disabled:opacity-60"
            >
              {applying ? "Vinculando…" : `Vincular los ${preview.matchedCount} nuevos`}
            </button>
          ) : (
            <p className="text-center text-sm text-slate-400">No hay depósitos nuevos para vincular.</p>
          )}
        </div>
      </div>
    </div>
  );
}
