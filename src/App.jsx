// src/App.jsx
import { lazy, Suspense } from 'react'
import { Switch, Route, Redirect } from 'react-router-dom'
import ProtectedRoute from "./routes/ProtectedRoute";
import Layout from './components/layout/Layout';
import AdminLayout from './components/layout/AdminLayout'
import ChoferLayout from './components/layout/ChoferLayout'
import IntroSplash from './components/intro/IntroSplash'
import InstallPWAButton from './components/pwa/InstallPWAButton'
import UpdateToast from './components/pwa/UpdateToast'
import AccessTracker from './components/tracking/AccessTracker'
import ForegroundPushListener from './components/notifications/ForegroundPushListener'
import { LoadingOverlay } from './components/ui/LoadingIndicators'

// Cada página pasa a cargarse sola, al toque, en vez de venir todas
// empaquetadas juntas en un solo archivo gigante — antes, alguien que
// entraba solo al catálogo público igual descargaba el código de todo el
// panel admin, el CRM, el sector chofer, etc. (más de 1MB de JS de más).
// Con React.lazy cada ruta es su propio archivo, así que el navegador solo
// baja el código de la pantalla que realmente se está mirando.
const Home = lazy(() => import('./pages/home/Home'))
const CatalogPage = lazy(() => import("./pages/catalog/CatalogPage"))
const QuieroSerClienteForm = lazy(() => import("./pages/nuevocliente/QuieroSerClienteForm"))
const OrderStatusPage = lazy(() => import("./pages/orderstatus/OrderStatusPage")) // fusiona "Mis pedidos" y "Mis comprobantes" en pestañas
const MiStockPage = lazy(() => import("./pages/mistock/MiStockPage"))
const MisVendedoresPage = lazy(() => import("./pages/mistock/MisVendedoresPage"))
const DepositoPage = lazy(() => import("./pages/mistock/DepositoPage"))
const MapaVendedoresPage = lazy(() => import("./pages/mistock/MapaVendedoresPage"))
const TransferirStockPage = lazy(() => import("./pages/mistock/TransferirStockPage"))
const StreetHome = lazy(() => import("./pages/mistock/StreetHome"))
const MiCuentaPage = lazy(() => import("./pages/micuenta/MiCuentaPage"))
const Login = lazy(() => import("./pages/auth/Login"))
const ResetPassword = lazy(() => import("./pages/auth/ResetPassword"))
const ImpersonarPage = lazy(() => import("./pages/admin/ImpersonarPage"))

// ADMIN pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const Users = lazy(() => import('./pages/admin/Users'))
const StockConsignado = lazy(() => import('./pages/admin/StockConsignado'))
const SaleRequests = lazy(() => import('./pages/admin/SaleRequests'))
const Cobranzas = lazy(() => import('./pages/admin/Cobranzas'))
const MovimientosBancarios = lazy(() => import('./pages/admin/MovimientosBancarios'))
const Clientes360 = lazy(() => import('./pages/admin/Clientes360'))
const ClientesReporte = lazy(() => import('./pages/admin/ClientesReporte'))
const DashboardNegocio = lazy(() => import('./pages/admin/DashboardNegocio'))
const ContadorDiario = lazy(() => import('./pages/admin/ContadorDiario'))
const ReporteSemanal = lazy(() => import('./pages/admin/ReporteSemanal'))
const RemitosReporte = lazy(() => import('./pages/admin/RemitosReporte'))
const PedidosPendientes = lazy(() => import('./pages/admin/PedidosPendientes'))
const Vendedores = lazy(() => import('./pages/admin/Vendedores'))
const Products = lazy(() => import('./pages/admin/Products'))
const Orders = lazy(() => import('./pages/admin/Orders'))
const COTs = lazy(() => import('./pages/admin/COTs'))
const CustomerTypes = lazy(() => import("./pages/admin/CustomerTypes"))
const ProductTypes = lazy(() => import("./pages/admin/ProductTypes"))
const Settings = lazy(() => import("./pages/admin/Settings"))
const AdminNotFound = lazy(() => import('./pages/admin/AdminNotFound'))
const CrmLayout = lazy(() => import("./pages/admin/crm/CrmLayout"))

// CHOFER pages
const ChoferMapa = lazy(() => import("./pages/chofer/ChoferMapa"))
const ChoferNotas = lazy(() => import("./pages/chofer/ChoferNotas"))
const ChoferChequeoVehiculo = lazy(() => import("./pages/chofer/ChoferChequeoVehiculo"))
const ChoferGrillaLogistica = lazy(() => import("./pages/chofer/ChoferGrillaLogistica"))
const ChoferSector = lazy(() => import("./pages/admin/ChoferSector"))
const ChoferHome = lazy(() => import("./pages/chofer/ChoferHome"))


export default function App() {
  return (
    <>
    <AccessTracker />
    <ForegroundPushListener />
    <IntroSplash />
    <InstallPWAButton />
    <UpdateToast />
    <Suspense fallback={<LoadingOverlay className="min-h-screen" />}>
    <Switch>
      {/* Bloque ADMIN con su layout */}
      <ProtectedRoute
        path="/admin"
        allowedRoles={["admin"]}
        render={() => (
          <AdminLayout>
            <Switch>
              <Route exact path="/admin" component={AdminDashboard} />
              <Route path="/admin/users" component={Users} />
              <Route path="/admin/stock-consignado" component={StockConsignado} />
              <Route path="/admin/ventas-reportadas" component={SaleRequests} />
              <Route path="/admin/cobranzas" component={Cobranzas} />
              <Route path="/admin/movimientos-bancarios" component={MovimientosBancarios} />
              <Route path="/admin/clientes-360" component={Clientes360} />
              <Route path="/admin/reporte-clientes" component={ClientesReporte} />
              <Route path="/admin/dashboard-negocio" component={DashboardNegocio} />
              <Route path="/admin/contador-diario" component={ContadorDiario} />
              <Route path="/admin/reporte-semanal" component={ReporteSemanal} />
              <Route path="/admin/remitos-reporte" component={RemitosReporte} />
              <Route path="/admin/pedidos-pendientes" component={PedidosPendientes} />
              <Route path="/admin/vendedores" component={Vendedores} />
              <Route path="/admin/products" component={Products} />
              <Route path="/admin/orders" component={Orders} />
              <Route path="/admin/cots" component={COTs} />
              <Route path="/admin/product-types" component={ProductTypes} />
              <Route path="/admin/customer-types" component={CustomerTypes} />
              <Route path="/admin/crm" component={CrmLayout} />
              <Route path="/admin/chofer" component={ChoferSector} />
              <Redirect from="/admin/chequeos-vehiculo" to="/admin/chofer/chequeos" />
              <Redirect from="/admin/grilla-logistica" to="/admin/chofer/grilla" />
              <Redirect from="/admin/ubicacion-choferes" to="/admin/chofer/ubicacion" />
              <Route path="/admin/settings" component={Settings} />
              <Route component={AdminNotFound} />
            </Switch>
          </AdminLayout>
        )}
      />

      {/* Sector chofer: mapa, stock consignado y notas de entrega, nada más */}
      <ProtectedRoute
        path="/chofer"
        allowedRoles={["admin", "chofer"]}
        render={() => (
          <ChoferLayout>
            <Switch>
              <Route exact path="/chofer" component={ChoferHome} />
              <Route path="/chofer/chequeo-vehiculo" component={ChoferChequeoVehiculo} />
              <Route path="/chofer/grilla" component={ChoferGrillaLogistica} />
              <Route path="/chofer/mapa" component={ChoferMapa} />
              <Route path="/chofer/stock-consignado" component={StockConsignado} />
              <Route path="/chofer/notas" component={ChoferNotas} />
              <Route component={AdminNotFound} />
            </Switch>
          </ChoferLayout>
        )}
      />

      {/* Público con layout general */}
      <Route
        render={() => (
          <Layout>
            <Switch>
              <Route exact path="/" component={Home} />
              <Route path="/catalogo" component={CatalogPage} />
              <Route path="/quiero-ser-cliente" component={QuieroSerClienteForm} />
              <Route path="/estado-de-pedido" component={OrderStatusPage} />
              <Route path="/mis-pedidos" component={OrderStatusPage} />
              <Route path="/mi-stock" component={MiStockPage} />
              <Route path="/mis-vendedores" component={MisVendedoresPage} />
              <Route path="/deposito" component={DepositoPage} />
              <Route path="/mapa-vendedores" component={MapaVendedoresPage} />
              <Route path="/transferir-stock" component={TransferirStockPage} />
              <Route path="/app" component={StreetHome} />
              <Route path="/mi-cuenta" component={MiCuentaPage} />
              <Route path="/login" component={Login} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/impersonar" component={ImpersonarPage} />
            </Switch>
          </Layout>
        )}
      />
    </Switch>
    </Suspense>
    </>
  )
}
