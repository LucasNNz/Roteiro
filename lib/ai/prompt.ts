import type { AICommand } from "../../app/types.ts";

export function commandFromPrompt(prompt: string): AICommand {
  const normalized = prompt.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hex = prompt.match(/#[0-9a-fA-F]{6}/)?.[0];
  const colorNames: Record<string, string> = { amarelo: "#FFD43B", roxo: "#7C5CFC", azul: "#276EF1", verde: "#30C77B", vermelho: "#FF6B5F", branco: "#FFFFFF", preto: "#13151A" };
  const namedColor = Object.entries(colorNames).find(([name]) => normalized.includes(name))?.[1];
  const fill = hex ?? namedColor;
  const seconds = Number(normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundo|segundos)\b/)?.[1]?.replace(",", "."));
  if (normalized.includes("novo projeto")) return { action: "new_project" };
  if ((normalized.includes("adicion") || normalized.includes("cri")) && normalized.includes("transicao")) {
    const pair = normalized.match(/(?:cena\s*)?(\d+)\s*(?:e|para|ate|→|-)\s*(?:a\s*)?(?:cena\s*)?(\d+)/);
    return { action: "ensure_transition_scene", ...(pair ? { afterSceneId: Number(pair[1]), beforeSceneId: Number(pair[2]) } : {}) };
  }
  if ((normalized.includes("adicion") || normalized.includes("cri")) && normalized.includes("nova cena")) return { action: "add_scene" };
  const renameSceneMatch = prompt.match(/renome(?:ie|ar|ar a|ar o)?\s+(?:a\s+)?cena\s+([\w-]+)\s+(?:para|como)\s+["“]?(.+?)["”]?\s*$/i);
  if (renameSceneMatch) return { action: "rename_scene", scene: /^\d+$/.test(renameSceneMatch[1]) ? Number(renameSceneMatch[1]) : renameSceneMatch[1], newName: renameSceneMatch[2].trim() };
  const deleteSceneMatch = normalized.match(/(?:apag\w*|exclu\w*|remov\w*)\s+(?:a\s+)?cena\s+([\w-]+)/);
  if (deleteSceneMatch) return { action: "delete_scene", scene: /^\d+$/.test(deleteSceneMatch[1]) ? Number(deleteSceneMatch[1]) : deleteSceneMatch[1] };
  if ((normalized.includes("listar") || normalized.includes("mostrar") || normalized.includes("abrir")) && normalized.includes("cenas")) return { action: "list_scenes" };
  const selectedScene = normalized.match(/(?:selecion\w*|selecione|abrir|ir para|trocar para)\s+(?:a\s+)?cena\s+([\w-]+)/)?.[1];
  if (selectedScene) return { action: "select_scene", scene: /^\d+$/.test(selectedScene) ? Number(selectedScene) : selectedScene };
  if (normalized.includes("listar") && normalized.includes("projeto")) return { action: "list_projects" };
  if ((normalized.includes("salvar") || normalized.includes("guardar")) && normalized.includes("projeto")) return { action: "save_project" };
  if ((normalized.includes("zip") || normalized.includes("pacote")) && (normalized.includes("chat") || normalized.includes("ia") || normalized.includes("projeto"))) return { action: "export_project_zip" };
  if ((normalized.includes("mp4") || normalized.includes("video")) && (normalized.includes("export") || normalized.includes("render") || normalized.includes("prepar"))) return { action: normalized.includes("chat") || normalized.includes("ia") ? "export_to_ai" : "export", kind: "mp4" };
  if (normalized.includes("projetos") || normalized.includes("biblioteca de projeto")) return { action: "screen", screen: "projects" };
  if (normalized.includes("duracao") && Number.isFinite(seconds)) return { action: "set_duration", duration: seconds };
  if ((normalized.includes("divid") || normalized.includes("separ")) && (normalized.includes("audio") || normalized.includes("efeito"))) return { action: "split_audio_clip", ...(Number.isFinite(seconds) ? { time: seconds } : {}) };
  if (normalized.includes("entrada") || normalized.includes("abertura")) {
    const content = prompt.match(/["“](.+?)["”]/)?.[1];
    const url = prompt.match(/https?:\/\/[^\s"”]+/i)?.[0];
    if ((normalized.includes("mascote") || normalized.includes("imagem do logo") || normalized.includes("imagem da entrada")) && url) return { action: "update_intro_content", mascotSrc: url };
    if (content) {
      if (normalized.includes("nome do canal") || normalized.includes("nome canal")) return { action: "update_intro_content", channelName: content };
      if (normalized.includes("selo") || normalized.includes("apresenta")) return { action: "update_intro_content", badgeText: content };
      if (normalized.includes("subtitulo")) return { action: "update_intro_content", subtitle: content };
      if (normalized.includes("lembrete") || normalized.includes("sininho")) return { action: "update_intro_content", subscribeTip: content };
      if (normalized.includes("inscrito")) return { action: "update_intro_content", subscribeAfter: content };
      if (normalized.includes("inscreva")) return { action: "update_intro_content", subscribeBefore: content };
      if (normalized.includes("chamada") || normalized.includes("gostou")) return { action: "update_intro_content", ctaTitle: content };
      if (normalized.includes("titulo")) return { action: "update_intro_content", title: content };
    }
  }
  const mainPresetIntent = normalized.includes("preset") || normalized.includes("cena principal") || normalized.includes("modelo principal") || normalized.includes("modelo de quiz");
  const wantsPresetResult = normalized.includes("resultado") || normalized.includes("revelacao") || normalized.includes("revelar");
  if (mainPresetIntent && /\b(?:3|tres)\s+opcoes\b|\ba\s*b\s*c\b/.test(normalized)) return { action: "apply_main_scene_preset", preset: "quiz_3_options_8s" };
  if (mainPresetIntent && (normalized.includes("verdadeiro") && normalized.includes("falso") || /\bv\s*\/\s*f\b/.test(normalized))) return { action: "apply_main_scene_preset", preset: "true_false_8s" };
  if (normalized.includes("logo") && (normalized.includes("adivinhe") || normalized.includes("adivinhar") || mainPresetIntent)) return { action: "apply_main_scene_preset", preset: wantsPresetResult ? "guess_logo_result_5s" : "guess_logo_8s" };
  if ((normalized.includes("emoji") || normalized.includes("emojis")) && (normalized.includes("descubra") || normalized.includes("adivinhe") || normalized.includes("quiz") || mainPresetIntent)) return { action: "apply_main_scene_preset", preset: wantsPresetResult ? "emoji_quiz_result_5s" : "emoji_quiz_8s" };
  if (normalized.includes("filme") && (normalized.includes("adivinhe") || normalized.includes("adivinhar") || mainPresetIntent)) return { action: "apply_main_scene_preset", preset: wantsPresetResult ? "guess_movie_result_5s" : "guess_movie_8s" };
  if (normalized.includes("voce prefere") || normalized.includes("would you rather")) return { action: "apply_main_scene_preset", preset: "would_you_rather_8s" };
  if (normalized.includes("ache o ladrao") || normalized.includes("ache ladrao")) {
    if (wantsPresetResult) return { action: "apply_main_scene_preset", preset: normalized.includes("errad") || normalized.includes("erro") ? "game_find_thief_wrong_5s" : "game_find_thief_correct_5s", preserveContent: false };
    return { action: "apply_main_scene_preset", preset: "game_find_thief_ab_8s", preserveContent: false };
  }
  if (normalized.includes("perseguicao") || (normalized.includes("corrida") && normalized.includes("esquerda") && normalized.includes("direita"))) {
    if (wantsPresetResult) return { action: "apply_main_scene_preset", preset: normalized.includes("errad") || normalized.includes("erro") ? "game_chase_wrong_5s" : "game_chase_correct_5s", preserveContent: false };
    return { action: "apply_main_scene_preset", preset: "game_chase_lr_8s", preserveContent: false };
  }
  if (normalized.includes("toguro")) return { action: "create_scene", scene: "toguro_quiz", duration: Number.isFinite(seconds) ? seconds : undefined, background: fill, animatedBackground: true };
  if ((normalized.includes("quiz") || normalized.includes("pergunta")) && (normalized.includes("tela") || normalized.includes("cena") || normalized.includes("crie") || normalized.includes("criar"))) return { action: "create_scene", scene: "quiz_question", duration: Number.isFinite(seconds) ? seconds : undefined, background: fill, animatedBackground: true };
  const binaryResultIntent = normalized.includes("resultado") || normalized.includes("revelar") || normalized.includes("correto") || normalized.includes("certa");
  if (binaryResultIntent && /\b(?:vermelho|falso)\b/.test(normalized)) return { action: "apply_binary_quiz_result", correctButton: "red" };
  if (binaryResultIntent && /\b(?:verde|verdadeiro)\b/.test(normalized)) return { action: "apply_binary_quiz_result", correctButton: "green" };
  const resultOption = normalized.match(/\b(?:resultado|revelar(?:\s+(?:a\s+)?resposta)?|resposta\s+correta)\s*(?:da\s+)?(?:opcao|alternativa|resposta)?\s*([abc])\b/)?.[1]?.toUpperCase();
  if (resultOption) return { action: "apply_quiz_result", correctAnswer: resultOption };
  if (normalized.includes("desafio") && normalized.includes("letra")) return { action: "create_scene", scene: "letter_challenge" };
  if (normalized.includes("alternativa") || normalized.includes("resposta")) return { action: "add_component", component: "answer", text: "Alternativa", label: "A", color: fill };
  if (normalized.includes("progresso") || normalized.includes("cronometro")) return { action: "add_component", component: "progress" };
  if (normalized.includes("selo") || normalized.includes("badge")) return { action: "add_component", component: "badge", label: "1", color: fill };
  if (normalized.includes("painel") && normalized.includes("titulo")) return { action: "add_component", component: "title", text: "Novo desafio", color: fill };
  if (normalized.includes("retangulo")) return { action: "add", type: "rect", fill };
  if (normalized.includes("circulo") || normalized.includes("elipse")) return { action: "add", type: "ellipse", fill };
  if (normalized.includes("texto") || normalized.includes("titulo")) {
    const content = prompt.match(/["“](.+?)["”]/)?.[1] ?? (normalized.includes("titulo") ? "Novo título" : "Seu texto");
    return { action: "add", type: "text", text: content, name: "Texto IA", fill };
  }
  if (normalized.includes("vertical")) return { action: "canvas", format: "portrait" };
  if (normalized.includes("horizontal")) return { action: "canvas", format: "landscape" };
  if (normalized.includes("quadrado")) return { action: "canvas", format: "square" };
  if (normalized.includes("fundo")) return { action: "canvas", background: fill ?? "#F5F1E8" };
  if (normalized.includes("entrada") && normalized.includes("direita")) return { action: "animation_preset", preset: "enter_right" };
  if (normalized.includes("entrada") && normalized.includes("cima")) return { action: "animation_preset", preset: "enter_top" };
  if (normalized.includes("entrada") && normalized.includes("baixo")) return { action: "animation_preset", preset: "enter_bottom" };
  if (normalized.includes("entrada") || normalized.includes("animar")) return { action: "animation_preset", preset: normalized.includes("zoom") ? "zoom_in" : normalized.includes("giro") ? "spin_in" : "enter_left" };
  if (normalized.includes("centraliz")) return { action: "align", mode: "center" };
  if ((normalized.includes("distribu") || normalized.includes("espac")) && normalized.includes("alternativa")) return { action: "distribute_answers" };
  if ((normalized.includes("alinhar") || normalized.includes("corrigir")) && (normalized.includes("alternativa") || normalized.includes("botao"))) return { action: "align_component" };
  if ((normalized.includes("verificar") || normalized.includes("auditar")) && normalized.includes("alinh")) return { action: "audit_alignment" };
  if (normalized.includes("grade") || normalized.includes("organiz")) return { action: "arrange_grid" };
  if (normalized.includes("paleta")) return { action: "apply_palette" };
  if (normalized.includes("duplic")) return { action: "duplicate" };
  if (normalized.includes("apag") || normalized.includes("exclu")) return { action: "delete" };
  if (normalized.includes("desbloque") && normalized.includes("tudo")) return { action: "lock_all", value: false };
  if (normalized.includes("bloque") && normalized.includes("tudo")) return { action: "lock_all", value: true };
  if (normalized.includes("desbloque")) return { action: "lock", value: false };
  if (normalized.includes("bloque")) return { action: "lock", value: true };
  if (normalized.includes("camada")) return { action: "screen", screen: "layers" };
  if (normalized.includes("timeline") || normalized.includes("keyframe")) return { action: "screen", screen: "timeline" };
  if (normalized.includes("formato")) return { action: "screen", screen: "format" };
  if (normalized.includes("cor") || normalized.includes("cores")) return { action: "screen", screen: "colors" };
  if (normalized.includes("contorno")) return { action: "screen", screen: "outline" };
  if (normalized.includes("export")) return { action: "screen", screen: "export" };
  if (normalized.includes("desfazer")) return { action: "undo" };
  if (normalized.includes("refazer")) return { action: "redo" };
  if (normalized.includes("play") || normalized.includes("reprodu")) return { action: "play" };
  if (normalized.includes("paus")) return { action: "pause" };
  const rotation = normalized.match(/(?:girar|rotacionar)\s*(-?\d+)/)?.[1];
  if (rotation) return { action: "update", rotation: Number(rotation) };
  return { action: "unknown", prompt };
}
