import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title:"CorvoQuiz Produção", description:"Da ideia ao pacote final para o Forma.", other:{ "codex-preview":"development" } };
export default function RootLayout({ children }: Readonly<{ children:React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
