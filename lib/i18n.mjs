function languageFromLocale(value) {
  if (!value || /^(C|POSIX)(?:[._@-]|$)/i.test(value)) return undefined;
  return /^pt(?:[-_]|$)/i.test(value.trim()) ? "pt" : "en";
}

export function detectLanguage(env = process.env, systemLocale = new Intl.DateTimeFormat().resolvedOptions().locale) {
  return languageFromLocale(env.TASKROOT_LANG)
    ?? [env.LC_ALL, env.LC_MESSAGES, env.LANG, systemLocale].map(languageFromLocale).find(Boolean)
    ?? "en";
}

export const language = detectLanguage();

const messages = {
  en: {
    table: {
      none: "(none)", id: "ID", status: "STATUS", phase: "PHASE", priority: "PRIORITY",
      milestone: "MILESTONE", title: "TITLE", state: "STATE", dependencies: "DEPENDENCIES", projectRepo: "PROJECT/REPO", missing: "MISSING",
      project: "PROJECT", total: "TOTAL", pending: "PENDING", inProgress: "IN PROGRESS", blocked: "BLOCKED", completed: "COMPLETED",
    },
    status: { pending: "pending", in_progress: "in progress", blocked: "blocked", completed: "completed", cancelled: "cancelled", ready: "ready", blocked_by_dependency: "blocked by dependency" },
    priority: { high: "high", medium: "medium", low: "low" },
    list: {
      projectCount: "{project} ({repo}) — {shown} of {total}",
      empty: "No projects found in {root}. Run: tasks init <project>.",
      summary: "Summary",
    },
    next: { ready: "Ready to start: {count}", blocked: "Blocked by dependencies: {count}" },
    errors: {
      repeatedOption: "Repeated option: --{name}",
      unknownProject: "Unknown project: {project}",
      emptyTable: "(no tasks)",
      unknownCommand: "Unknown command: {command} (use --help)",
      invalidData: "Invalid data; run tasks check:\n{problems}",
      invalidProject: "Invalid project. Choose one of: {projects}",
      missingTitle: "Missing required option: --title \"...\".",
      emptyDependency: "--depends contains an empty ID.",
      missingDependency: "Dependency not found: {id}",
      unknownMilestone: "Unknown milestone: {milestone} (available: {milestones})",
      invalidStatus: "Invalid status: {status} (choose: {values})",
      invalidPriority: "Invalid priority: {priority} (choose: {values})",
      emptySearch: "--search requires non-empty text.",
      initUsage: "Usage: tasks init <project> [--prefix APP] [--repo name] [--project \"...\"]",
      invalidPrefix: "--prefix may contain only letters and numbers.",
      duplicatePrefix: "Prefix {prefix} is already used by {project}.",
      fileExists: "Already exists: {file}",
      notFound: "Task not found: {id}",
      ambiguousTask: "Task not found or ID is ambiguous: {id}",
      editFields: "Specify fields: --title, --description, --status, --priority, --phase, --milestone, --depends, or --repo.",
      noMilestones: "No milestones.json found.",
      orphanMilestones: "Tasks without a milestone: {count}",
      alreadyCompleted: "{id} is already completed.",
      taskSummary: "Tasks: {total} | pending {pending} | in progress {inProgress} | blocked {blocked} | completed {completed}",
      problemCount: "{count} problem(s):",
      checkOk: "OK: no problems found.",
      invalidJson: "{file}: invalid JSON ({error})",
      invalidDocument: "{file}: document must be a JSON object.",
      invalidTasks: "{file}: tasks must be an array.",
      invalidMilestone: "{file}: invalid JSON ({error})",
      invalidMilestoneDocument: "{file}: document must be an object.",
      invalidMilestoneEntry: "{file}: {id} must be an object.",
      unsupportedSchema: "{file}: schema version {version} is unsupported; this CLI supports version {supported}.",
      invalidMilestonesSchema: "{file}: schema_version 1 requires a milestones object.",
      lockBusy: "Backlog is locked: {file}. Another taskroot command may still be running.",
    },
    success: {
      createdTask: "Created {id} in {project}: {title}",
      createdProject: "Created {file} (prefix {prefix})",
      nextTask: "Next: tasks new {project} --title \"first task\"",
      updatedTask: "Updated {id}: {fields}",
      completedTask: "{id} marked completed",
    },
    details: {
      project: "Project", title: "Title", description: "Description", milestone: "Milestone",
      dependencies: "Dependencies", evidence: "Current evidence", completedAt: "Completed at",
      history: "History", new: "new", evidenceHistory: "evidence", noMilestones: "No milestones.json found.",
      milestoneHeading: "{id} — {name} ({completed}/{total} completed, {open} open)",
      milestoneBlocked: "blocked (missing {ids})", milestoneReady: "ready", orphanCount: "Tasks without a milestone: {count}",
    },
    validation: {
      requiresText: "--{flag} requires text{nonEmpty}", nonEmpty: " that is not empty",
      invalidProjectName: "Invalid project name: {project}. Use letters, numbers, dot, hyphen, or underscore.",
      invalidPrefix: "{project}: prefix may contain only letters and numbers.",
      duplicatePrefix: "Duplicate prefix {prefix}: {first}, {second}.",
      invalidTask: "{project}/tasks[{index}] must be an object.",
      invalidId: "{project}/tasks[{index}]: id must be non-empty text.",
      duplicateId: "Duplicate ID: {id} ({first}, {second}).",
      invalidTitle: "{project}/{id}: title must be non-empty text.",
      invalidTaskStatus: "{project}/{id}: invalid status \"{status}\".",
      invalidTaskPriority: "{project}/{id}: invalid priority \"{priority}\".",
      invalidDescription: "{project}/{id}: description must be text.",
      invalidEvidence: "{project}/{id}: evidence must be text.",
      invalidHistory: "{project}/{id}: history must be a list of valid events.",
      invalidPhase: "{project}/{id}: phase must be text.",
      invalidTaskMilestone: "{project}/{id}: milestone must be text.",
      unknownTaskMilestone: "{project}/{id}: unknown milestone \"{milestone}\".",
      invalidDependencies: "{project}/{id}: depends_on must be a list of text IDs.",
      missingTaskDependency: "{project}/{id}: dependency \"{dependency}\" does not exist.",
      cycle: "Dependency cycle: {path}.",
      unknownOption: "Unknown option for {command}: --{name}",
      booleanValue: "--{name} does not accept a value.",
      optionValue: "--{name} requires a value.",
      emptyMilestone: "--milestone requires non-empty text.",
      invalidPositionals: "Invalid positional arguments for {command}.",
      invalidLimit: "--limit must be an integer greater than zero.",
    },
  },
  pt: {
    table: {
      none: "(nenhuma)", id: "ID", status: "STATUS", phase: "FASE", priority: "PRIORIDADE",
      milestone: "MARCO", title: "TÍTULO", state: "SITUAÇÃO", dependencies: "DEPENDÊNCIAS", projectRepo: "PROJETO/REPO", missing: "FALTAM",
      project: "PROJETO", total: "TOTAL", pending: "PENDENTES", inProgress: "EM ANDAMENTO", blocked: "BLOQUEADAS", completed: "CONCLUÍDAS",
    },
    status: { pending: "pendente", in_progress: "em andamento", blocked: "bloqueada", completed: "concluída", cancelled: "cancelada", ready: "pronta", blocked_by_dependency: "bloqueada por dependência" },
    priority: { high: "alta", medium: "média", low: "baixa" },
    list: {
      projectCount: "{project} ({repo}) — {shown} de {total}",
      empty: "Nenhum projeto em {root}. Rode: tasks init <projeto>.",
      summary: "Resumo",
    },
    next: { ready: "Prontas para começar: {count}", blocked: "Bloqueadas por dependência: {count}" },
    errors: {
      repeatedOption: "Opção repetida: --{name}",
      unknownProject: "Projeto desconhecido: {project}",
      emptyTable: "(nenhuma tarefa)",
      unknownCommand: "Comando desconhecido: {command} (use --help)",
      invalidData: "Dados inválidos; rode tasks check:\n{problems}",
      invalidProject: "Projeto inválido. Escolha um destes: {projects}",
      missingTitle: "Falta a opção obrigatória: --title \"...\".",
      emptyDependency: "--depends contém um ID vazio.",
      missingDependency: "Dependência não encontrada: {id}",
      unknownMilestone: "Marco desconhecido: {milestone} (disponíveis: {milestones})",
      invalidStatus: "Status inválido: {status} (escolha: {values})",
      invalidPriority: "Prioridade inválida: {priority} (escolha: {values})",
      emptySearch: "--search exige um texto não vazio.",
      initUsage: "Uso: tasks init <projeto> [--prefix APP] [--repo nome] [--project \"...\"]",
      invalidPrefix: "--prefix aceita apenas letras e números.",
      duplicatePrefix: "O prefixo {prefix} já pertence a {project}.",
      fileExists: "Já existe: {file}",
      notFound: "Tarefa não encontrada: {id}",
      ambiguousTask: "Tarefa não encontrada ou ID ambíguo: {id}",
      editFields: "Informe os campos: --title, --description, --status, --priority, --phase, --milestone, --depends ou --repo.",
      noMilestones: "Não há milestones.json.",
      orphanMilestones: "Tarefas sem marco: {count}",
      alreadyCompleted: "{id} já está concluída.",
      taskSummary: "Tarefas: {total} | pendentes {pending} | em andamento {inProgress} | bloqueadas {blocked} | concluídas {completed}",
      problemCount: "{count} problema(s):",
      checkOk: "OK: nenhum problema encontrado.",
      invalidJson: "{file}: JSON inválido ({error})",
      invalidDocument: "{file}: o documento deve ser um objeto JSON.",
      invalidTasks: "{file}: tasks deve ser uma lista.",
      invalidMilestone: "{file}: JSON inválido ({error})",
      invalidMilestoneDocument: "{file}: o documento deve ser um objeto.",
      invalidMilestoneEntry: "{file}: {id} deve ser um objeto.",
      unsupportedSchema: "{file}: a versão de esquema {version} não é compatível; esta CLI aceita a versão {supported}.",
      invalidMilestonesSchema: "{file}: schema_version 1 exige um objeto milestones.",
      lockBusy: "O backlog está bloqueado: {file}. Outro comando tasks pode estar em execução.",
    },
    success: {
      createdTask: "Criada {id} em {project}: {title}",
      createdProject: "Criado {file} (prefixo {prefix})",
      nextTask: "Próximo passo: tasks new {project} --title \"primeira tarefa\"",
      updatedTask: "Atualizada {id}: {fields}",
      completedTask: "{id} marcada como concluída",
    },
    details: {
      project: "Projeto", title: "Título", description: "Descrição", milestone: "Marco",
      dependencies: "Dependências", evidence: "Evidência atual", completedAt: "Concluída em",
      history: "Histórico", new: "nova", evidenceHistory: "evidência", noMilestones: "Não há milestones.json.",
      milestoneHeading: "{id} — {name} ({completed}/{total} concluídas, {open} em aberto)",
      milestoneBlocked: "bloqueada (faltam {ids})", milestoneReady: "pronta", orphanCount: "Tarefas sem marco: {count}",
    },
    validation: {
      requiresText: "--{flag} exige texto{nonEmpty}", nonEmpty: " não vazio",
      invalidProjectName: "Nome de projeto inválido: {project}. Use letras, números, ponto, hífen ou sublinhado.",
      invalidPrefix: "{project}: o prefixo aceita apenas letras e números.",
      duplicatePrefix: "Prefixo duplicado {prefix}: {first}, {second}.",
      invalidTask: "{project}/tasks[{index}] deve ser um objeto.",
      invalidId: "{project}/tasks[{index}]: o ID deve ser texto não vazio.",
      duplicateId: "ID duplicado: {id} ({first}, {second}).",
      invalidTitle: "{project}/{id}: o título deve ser texto não vazio.",
      invalidTaskStatus: "{project}/{id}: status inválido \"{status}\".",
      invalidTaskPriority: "{project}/{id}: prioridade inválida \"{priority}\".",
      invalidDescription: "{project}/{id}: description deve ser texto.",
      invalidEvidence: "{project}/{id}: evidence deve ser texto.",
      invalidHistory: "{project}/{id}: history deve ser uma lista de eventos válidos.",
      invalidPhase: "{project}/{id}: phase deve ser texto.",
      invalidTaskMilestone: "{project}/{id}: milestone deve ser texto.",
      unknownTaskMilestone: "{project}/{id}: marco desconhecido \"{milestone}\".",
      invalidDependencies: "{project}/{id}: depends_on deve ser uma lista de IDs em texto.",
      missingTaskDependency: "{project}/{id}: a dependência \"{dependency}\" não existe.",
      cycle: "Ciclo de dependências: {path}.",
      unknownOption: "Opção desconhecida para {command}: --{name}",
      booleanValue: "--{name} não aceita valor.",
      optionValue: "--{name} exige valor.",
      emptyMilestone: "--milestone exige texto não vazio.",
      invalidPositionals: "Argumentos posicionais inválidos para {command}.",
      invalidLimit: "--limit deve ser um número inteiro maior que zero.",
    },
  },
};

export function t(path, values = {}) {
  const template = path.split(".").reduce((value, key) => value?.[key], messages[language])
    ?? path.split(".").reduce((value, key) => value?.[key], messages.en)
    ?? path;
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? `{${key}}`));
}

export function displayStatus(status) {
  return messages[language].status[status] ?? status;
}

export function displayPriority(priority) {
  return messages[language].priority[priority] ?? priority ?? "-";
}
