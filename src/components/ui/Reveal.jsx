import { useReveal } from "../../hooks/useReveal";

/**
 * Envuelve contenido y lo anima con fade + slide-up cuando entra al viewport.
 * `delay` en ms para escalonar varios Reveal juntos.
 */
export default function Reveal(props) {
  const { as: Component = "div", delay = 0, className = "", children, ...rest } = props;
  const [ref, visible] = useReveal();

  return (
    <Component
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
      {...rest}
    >
      {children}
    </Component>
  );
}
