import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/900.css";
import "./forma.css";

export default function FormaEmbeddedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div data-forma-embedded-root>{children}</div>;
}
