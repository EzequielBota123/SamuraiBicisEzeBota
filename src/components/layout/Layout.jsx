import Navbar from "../navbar/Navbar";
import Footer from "../footer/Footer";
import ImpersonandoBanner from "./ImpersonandoBanner";

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-black">
      <ImpersonandoBanner />
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}

