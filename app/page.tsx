"use client";

import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";

type Format = "REELS" | "VÍDEO COMPLETO";
type Quantity = "1 VÍDEO" | "LOTE";
type Mode = "RÁPIDO" | "PESQUISAR ANTES";
type Project = { id:string; title:string; topic:string; format:Format; quantity:Quantity; mode:Mode; stage:number; createdAt:string };

const initialProjects: Project[] = [
  { id:"DESERTO_SOBREVIVENCIA_01", title:"VOCÊ SOBREVIVERIA NO DESERTO?", topic:"sobrevivência", format:"REELS", quantity:"1 VÍDEO", mode:"RÁPIDO", stage:4, createdAt:"HOJE, 10:42" },
  { id:"ANIMAIS_IMPOSSIVEIS_02", title:"QUAL ANIMAL FARIA ISSO?", topic:"animais curiosos", format:"REELS", quantity:"LOTE", mode:"PESQUISAR ANTES", stage:2, createdAt:"ONTEM, 18:15" },
];
const steps = ["IDEIA", "ROTEIRO", "PROMPTS", "IMAGENS", "PACOTE"];

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36);
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>(() => {
    if (typeof window === "undefined") return initialProjects;
    try {
      const parsed = JSON.parse(window.localStorage.getItem("corvoquiz-projects-v01") ?? "[]") as Project[];
      return parsed.length ? parsed : initialProjects;
    } catch { return initialProjects; }
  });
  const [activeId, setActiveId] = useState(() => {
    if (typeof window === "undefined") return initialProjects[0].id;
    try {
      const parsed = JSON.parse(window.localStorage.getItem("corvoquiz-projects-v01") ?? "[]") as Project[];
      return parsed[0]?.id ?? initialProjects[0].id;
    } catch { return initialProjects[0].id; }
  });
  const [isModalOpen, setModalOpen] = useState(false);
  const [format, setFormat] = useState<Format>("REELS");
  const [quantity, setQuantity] = useState<Quantity>("1 VÍDEO");
  const [mode, setMode] = useState<Mode>("RÁPIDO");
  const [topic, setTopic] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { window.localStorage.setItem("corvoquiz-projects-v01", JSON.stringify(projects)); }, [projects]);
  useEffect(() => {
    if (!isModalOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setModalOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [isModalOpen]);

  const active = useMemo(() => projects.find((project) => project.id === activeId) ?? projects[0], [activeId, projects]);

  function createProject() {
    if (!topic.trim()) { setNotice("DIGITE UM TEMA PARA CONTINUAR."); return; }
    const id = `${slugify(topic)}_${String(projects.length + 1).padStart(2, "0")}`;
    const project: Project = { id, title:`NOVO QUIZ: ${topic.trim().toUpperCase()}`, topic:topic.trim(), format, quantity, mode, stage:1, createdAt:"AGORA" };
    setProjects((current) => [project, ...current]);
    setActiveId(id); setTopic(""); setNotice(""); setModalOpen(false);
  }

  async function downloadProject(project: Project) {
    const zip = new JSZip();
    const roteiro = `PROJETO: ${project.id}\nENTRADA: NAO\nTRANSICOES: SIM\n\n[1]\nTIPO: 3_OPCOES\nPERGUNTA: PRIMEIRA PERGUNTA SOBRE ${project.topic.toUpperCase()}?\nA: OPCAO A\nB: OPCAO B\nC: OPCAO C\nCORRETA: A\nIMAGEM: cena_01.jpg\n`;
    const prompts = `CENA 01\nILUSTRACAO 2D SEMIRREALISTA E LIMPA SOBRE ${project.topic.toUpperCase()}, COMPOSICAO SIMPLES, BOA LEITURA PARA QUIZ, SEM TEXTO, SEM LOGOS E SEM MARCA-D'AGUA.\n`;
    zip.file("projeto.json", JSON.stringify(project, null, 2));
    zip.folder("roteiro")?.file(`${project.id}.txt`, roteiro);
    zip.folder("prompts")?.file(`PROMPTS_${project.id}.txt`, prompts);
    zip.folder("imagens")?.file("ADICIONE_AS_IMAGENS_AQUI.txt", "Use cena_01.jpg, cena_02.jpg e assim por diante.");
    zip.folder("forma")?.file("LEIA-ME.txt", "O pacote final para o Forma será montado após a validação das imagens.");
    const blob = await zip.generateAsync({ type:"blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${project.id}.zip`; link.click();
    URL.revokeObjectURL(url);
  }

  function registerUpload(files: FileList | null) {
    if (!files?.length || !active) return;
    setProjects((current) => current.map((project) => project.id === active.id ? { ...project, stage:Math.max(project.stage, 4) } : project));
    setNotice(`${files.length} ARQUIVO(S) RECEBIDO(S). NOMES PRONTOS PARA CONFERÊNCIA.`);
    window.setTimeout(() => setNotice(""), 3600);
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CorvoQuiz Produção"><span className="brand-mark">C</span><span><strong>CORVO</strong>QUIZ <small>PRODUÇÃO</small></span></a>
        <nav className="nav-links" aria-label="Navegação principal"><a className="active" href="#producao">PRODUÇÃO</a><a href="#projetos">PROJETOS</a><a href="#arquivos">ARQUIVOS</a></nav>
        <div className="header-actions"><a className="corvo-link" href="https://chatgpt.com/" target="_blank" rel="noreferrer"><span className="online-dot" /> FALAR COM O CORVO</a><button className="icon-button" aria-label="Configurações">•••</button></div>
      </header>

      <section className="hero" id="top">
        <div><span className="eyebrow"><i /> CENTRAL DE PRODUÇÃO</span><h1>DA IDEIA AO <em>PACOTE FINAL.</em></h1><p>Organize roteiros, prompts e imagens em um fluxo simples.<br />No fim, tudo pronto para importar no Forma.</p></div>
        <button className="new-project" onClick={() => setModalOpen(true)}><span>＋</span><b>NOVA PRODUÇÃO</b><small>COMEÇAR DO ZERO</small></button>
      </section>

      <section className="workspace" id="producao">
        <div className="section-heading"><div><span className="section-number">01</span><h2>EM PRODUÇÃO</h2></div><button className="text-button" onClick={() => setModalOpen(true)}>CRIAR OUTRA <span>↗</span></button></div>
        {active && <article className="production-card">
          <div className="card-main">
            <div className="project-meta"><span className="format-tag">{active.format}</span><span>{active.quantity}</span><span>{active.createdAt}</span></div>
            <h3>{active.title}</h3><p>{active.id}</p>
            <div className="stepper" aria-label={`Etapa ${active.stage} de 5`}>
              {steps.map((step, index) => {
                const complete = index + 1 < active.stage; const current = index + 1 === active.stage;
                return <div className={`step ${complete ? "complete" : ""} ${current ? "current" : ""}`} key={step}><span>{complete ? "✓" : String(index + 1).padStart(2, "0")}</span><small>{step}</small></div>;
              })}
            </div>
            <div className="card-actions">
              <button className="primary-action" onClick={() => setProjects((current) => current.map((p) => p.id === active.id ? { ...p, stage:Math.min(5, p.stage + 1) } : p))}>CONTINUAR PRODUÇÃO <span>→</span></button>
              <button className="secondary-action" onClick={() => downloadProject(active)}>↓ BAIXAR ZIP</button>
            </div>
          </div>
          <aside className="card-side" id="arquivos">
            <div className="mini-title"><span>ARQUIVOS</span><b>{active.stage >= 4 ? "4/4" : "2/4"}</b></div>
            <div className="file-row done"><span>▤</span><div><b>ROTEIRO.TXT</b><small>REVISADO</small></div><i>✓</i></div>
            <div className="file-row done"><span>✦</span><div><b>PROMPTS.TXT</b><small>4 CENAS</small></div><i>✓</i></div>
            <label className="upload-box"><input type="file" accept=".zip,image/*" multiple onChange={(e) => registerUpload(e.target.files)} /><span>＋</span><b>ADICIONAR IMAGENS</b><small>ZIP, JPG OU PNG</small></label>
          </aside>
        </article>}
      </section>

      <section className="projects" id="projetos">
        <div className="section-heading"><div><span className="section-number">02</span><h2>PROJETOS RECENTES</h2></div><span className="project-count">{String(projects.length).padStart(2, "0")} PRODUÇÕES</span></div>
        <div className="project-list">{projects.map((project) =>
          <button className={`project-row ${project.id === activeId ? "selected" : ""}`} key={project.id} onClick={() => setActiveId(project.id)}>
            <span className="project-icon">{project.format === "REELS" ? "▯" : "▭"}</span><span className="project-name"><b>{project.title}</b><small>{project.id}</small></span><span className="project-format">{project.format}</span><span className="progress"><i style={{ width:`${project.stage * 20}%` }} /></span><span className="stage-label">ETAPA {project.stage}/5</span><span className="row-arrow">→</span>
          </button>)}</div>
      </section>

      <footer><span>CORVOQUIZ PRODUÇÃO <i>V0.1</i></span><span>IDEIA → ROTEIRO → PROMPTS → IMAGENS → FORMA</span></footer>
      {notice && <div className="toast" role="status">{notice}</div>}
      {isModalOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
        <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Fechar">×</button><div className="modal-symbol">✦</div><span className="modal-kicker">NOVA PRODUÇÃO</span><h2 id="modal-title">O QUE VAMOS CRIAR?</h2><p>Escolha o formato e conte o tema. O Corvo organiza o restante.</p>
          <div className="field-group"><label>FORMATO</label><div className="segmented">{(["REELS", "VÍDEO COMPLETO"] as Format[]).map((item) => <button className={format === item ? "selected" : ""} onClick={() => setFormat(item)} key={item}>{item === "REELS" ? "▯" : "▭"} {item}</button>)}</div></div>
          <div className="modal-grid">
            <div className="field-group"><label>QUANTIDADE</label><div className="segmented compact">{(["1 VÍDEO", "LOTE"] as Quantity[]).map((item) => <button className={quantity === item ? "selected" : ""} onClick={() => setQuantity(item)} key={item}>{item}</button>)}</div></div>
            <div className="field-group"><label>MODO</label><div className="segmented compact">{(["RÁPIDO", "PESQUISAR ANTES"] as Mode[]).map((item) => <button className={mode === item ? "selected" : ""} onClick={() => setMode(item)} key={item}>{item}</button>)}</div></div>
          </div>
          <div className="field-group topic-field"><label htmlFor="topic">TEMA OU TÍTULO</label><input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createProject()} placeholder="EX: SOBREVIVÊNCIA NO DESERTO" autoFocus /><small>USE UMA IDEIA SIMPLES. VOCÊ PODERÁ REFINAR DEPOIS.</small></div>
          <button className="modal-submit" onClick={createProject}>COMEÇAR PRODUÇÃO <span>→</span></button>
          <a className="modal-corvo" href="https://chatgpt.com/" target="_blank" rel="noreferrer"><span className="online-dot" /> PREFERE CONVERSAR? FALAR COM O CORVO</a>
        </section>
      </div>}
    </main>
  );
}
