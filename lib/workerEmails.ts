/**
 * E-mails aos trabalhadores da folha de ponto.
 *
 * Regras de segurança (o link e o código são secretos e pessoais):
 *   1. Um e-mail individual por trabalhador — nunca vários destinatários.
 *   2. O texto usa marcadores ({nome}, {link}, {codigo}, {instrucoes}) e é
 *      o SERVIDOR que os preenche, trabalhador a trabalhador, com os dados
 *      lidos da base de dados. O navegador nunca recebe os segredos.
 *   3. "Dados de acesso" vai sem CC. "Mensagem livre" leva os administradores
 *      em CC, como o resto da app — por isso não pode conter {link}/{codigo}.
 *   4. No registo de e-mails enviados o link fica cortado e o código tapado.
 *
 * Este ficheiro não depende de nada do servidor: o envio e o registo são
 * injetados, o que permite simular tudo sem enviar e-mails.
 */

import { applySubjectPrefix } from '@/lib/emailConfig'
import { emailValido, PHONE_OS_LABELS, type PhoneOs, type Worker } from '@/lib/ponto'

export type WorkerEmailTemplate = 'acesso' | 'livre'

export const WORKER_EMAIL_TEMPLATES: Record<WorkerEmailTemplate, { label: string; subject: string; body: string }> = {
  acesso: {
    label: 'Dados de acesso',
    subject: 'Folha de ponto — os teus dados de acesso',
    body: `Olá {nome},

Este é o teu acesso pessoal à folha de ponto, para registares as tuas horas de trabalho pelo telemóvel.

Link: {link}
Código: {codigo}

Na primeira vez que abrires o link, escreve o código de 4 dígitos. Depois fica guardado no telemóvel.

{instrucoes}

O link e o código são só teus: não os partilhes com ninguém.`,
  },
  livre: {
    label: 'Mensagem livre',
    subject: '',
    body: `Olá {nome},

`,
  },
}

/** Marcadores aceites e para que servem (mostrados no ecrã). */
export const MARCADORES: { chave: string; descricao: string; soAcesso: boolean }[] = [
  { chave: '{nome}', descricao: 'nome do trabalhador', soAcesso: false },
  { chave: '{link}', descricao: 'link secreto dele', soAcesso: true },
  { chave: '{codigo}', descricao: 'código de 4 dígitos dele', soAcesso: true },
  { chave: '{instrucoes}', descricao: 'instruções de instalação para o telemóvel dele', soAcesso: true },
]

export const CONTEXTO_REGISTO: Record<WorkerEmailTemplate, string> = {
  acesso: 'folha_ponto_acesso',
  livre: 'folha_ponto_livre',
}

const INSTRUCOES: Record<PhoneOs, string> = {
  iphone: `Para instalar a folha de ponto no iPhone, como se fosse uma aplicação:
1. Abre o link no Safari.
2. Toca no botão Partilhar (o quadrado com a seta para cima).
3. Escolhe "Adicionar ao ecrã principal" e confirma.`,
  android: `Para instalar a folha de ponto no Android, como se fosse uma aplicação:
1. Abre o link no Chrome.
2. Toca no menu (os três pontos, em cima à direita).
3. Escolhe "Instalar aplicação" e confirma.`,
}

/** Instruções conforme o telemóvel. Por definir → as duas versões. */
export function instrucoesInstalacao(os: PhoneOs | null | undefined): string {
  if (os && INSTRUCOES[os]) return INSTRUCOES[os]
  return `Se tiveres ${PHONE_OS_LABELS.iphone}:\n${INSTRUCOES.iphone}\n\nSe tiveres ${PHONE_OS_LABELS.android}:\n${INSTRUCOES.android}`
}

export function linkPonto(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/ponto/${token}`
}

/** Versões tapadas, para o registo e para a pré-visualização. */
export function linkTapado(origin: string, token: string): string {
  return `${linkPonto(origin, String(token).slice(0, 6))}…`
}
export const CODIGO_TAPADO = '••••'

const RE_MARCADOR = /\{[^{}\s]{1,30}\}/g

/** Uma só passagem: o texto que entra (ex.: um nome) nunca é reinterpretado como marcador. */
function preencher(texto: string, valores: Record<string, string>): string {
  return texto.replace(RE_MARCADOR, m => (Object.prototype.hasOwnProperty.call(valores, m) ? valores[m] : m))
}

function assinatura(senderName: string): string {
  return `\n\nCom os melhores cumprimentos,\n${senderName}`
}

/**
 * Pré-visualização no navegador, que não tem os segredos: o link e o código
 * aparecem como [link pessoal de X]. O e-mail real é construído no servidor.
 */
export function preVisualizarEmail({ template, subject, body, worker, senderName, subjectPrefix }: {
  template: WorkerEmailTemplate
  subject: string
  body: string
  worker: Pick<Worker, 'name' | 'email' | 'phone_os'>
  senderName: string
  subjectPrefix?: string
}): { to: string; subject: string; body: string } {
  const valores: Record<string, string> = {
    '{nome}': worker.name,
    '{instrucoes}': instrucoesInstalacao(worker.phone_os),
    ...(template === 'acesso'
      ? { '{link}': `[link pessoal de ${worker.name}]`, '{codigo}': `[código de ${worker.name}]` }
      : {}),
  }
  return {
    to: worker.email ?? '',
    subject: applySubjectPrefix(preencher(subject, valores), subjectPrefix),
    body: preencher(body, valores).trimEnd() + assinatura(senderName),
  }
}

/**
 * Valida o texto antes de enviar. Devolve a mensagem de erro, ou null.
 * Apanha marcadores mal escritos (ex.: {codgo}) para não saírem literais.
 */
export function validarModelo(template: WorkerEmailTemplate, subject: string, body: string): string | null {
  if (!String(subject ?? '').trim()) return 'Escreve o assunto.'
  if (!String(body ?? '').trim()) return 'Escreve a mensagem.'

  const conhecidos = new Set(MARCADORES.map(m => m.chave))
  const usados = `${subject}\n${body}`.match(RE_MARCADOR) ?? []
  const desconhecido = usados.find(m => !conhecidos.has(m))
  if (desconhecido) return `Marcador desconhecido: ${desconhecido}. Os aceites são ${[...conhecidos].join(', ')}.`

  if (template === 'acesso') {
    if (!body.includes('{link}') || !body.includes('{codigo}')) {
      return 'O e-mail de dados de acesso tem de incluir {link} e {codigo} na mensagem.'
    }
    if (subject.includes('{link}') || subject.includes('{codigo}')) {
      return 'O link e o código não podem ir no assunto.'
    }
  } else {
    const secreto = MARCADORES.find(m => m.soAcesso && `${subject}\n${body}`.includes(m.chave))
    if (secreto) {
      return `A mensagem livre vai com cópia para os administradores, por isso não pode usar ${secreto.chave}. Usa o modelo "Dados de acesso".`
    }
  }
  return null
}

export type WorkerEmailRecipient = Pick<Worker, 'id' | 'name' | 'email' | 'access_token' | 'pin' | 'phone_os' | 'active'>

export interface EmailConstruido {
  to: string
  toName: string
  /** Assunto com o prefixo da propriedade. */
  subject: string
  /** O que o trabalhador recebe — com o link e o código verdadeiros. */
  body: string
  /** O que fica no registo — link cortado, código tapado. */
  logBody: string
}

/** Constrói o e-mail de UM trabalhador, só com os dados dele. */
export function construirEmailTrabalhador({ template, subject, body, worker, origin, senderName, subjectPrefix }: {
  template: WorkerEmailTemplate
  subject: string
  body: string
  worker: WorkerEmailRecipient
  origin: string
  senderName: string
  subjectPrefix?: string
}): EmailConstruido {
  const comuns = { '{nome}': worker.name, '{instrucoes}': instrucoesInstalacao(worker.phone_os) }
  // Na mensagem livre os marcadores secretos já foram recusados por validarModelo;
  // mesmo assim só se preenche {nome}/{instrucoes} para nunca poderem sair segredos.
  const reais = template === 'acesso'
    ? { ...comuns, '{link}': linkPonto(origin, worker.access_token), '{codigo}': String(worker.pin) }
    : comuns
  const tapados = template === 'acesso'
    ? { ...comuns, '{link}': linkTapado(origin, worker.access_token), '{codigo}': CODIGO_TAPADO }
    : comuns

  return {
    to: String(worker.email ?? '').trim(),
    toName: worker.name,
    subject: applySubjectPrefix(preencher(subject, comuns), subjectPrefix),
    body: preencher(body, reais).trimEnd() + assinatura(senderName),
    logBody: preencher(body, tapados).trimEnd() + assinatura(senderName),
  }
}

export interface ResultadoEnvio {
  workerId: string
  name: string
  email: string | null
  status: 'enviado' | 'erro' | 'ignorado'
  motivo?: string
}

export interface EnvioDeps {
  /** Envia UM e-mail (um único destinatário em `to`). */
  send: (m: { to: string; cc: string[]; subject: string; body: string }) => Promise<void>
  record: (r: {
    toEmail: string; toName: string; ccEmails: string[]; subject: string; body: string
    context: string; status: 'enviado' | 'erro'; errorMessage?: string | null
  }) => Promise<void>
  /** Administradores para CC — só usados na mensagem livre. */
  adminEmails: string[]
}

/**
 * Envia um e-mail individual a cada trabalhador, um de cada vez.
 * Um falhar não impede os seguintes; cada tentativa fica registada.
 */
export async function enviarEmailsTrabalhadores({ workers, template, subject, body, origin, senderName, subjectPrefix }: {
  workers: WorkerEmailRecipient[]
  template: WorkerEmailTemplate
  subject: string
  body: string
  origin: string
  senderName: string
  subjectPrefix?: string
}, deps: EnvioDeps): Promise<ResultadoEnvio[]> {
  const resultados: ResultadoEnvio[] = []
  const vistos = new Set<string>()

  for (const w of workers) {
    if (vistos.has(w.id)) continue
    vistos.add(w.id)
    const base = { workerId: w.id, name: w.name, email: w.email }

    if (!w.email || !emailValido(w.email)) {
      resultados.push({ ...base, status: 'ignorado', motivo: 'sem e-mail válido' })
      continue
    }
    if (template === 'acesso' && !w.active) {
      resultados.push({ ...base, status: 'ignorado', motivo: 'trabalhador inativo — o acesso dele está desligado' })
      continue
    }

    const email = construirEmailTrabalhador({ template, subject, body, worker: w, origin, senderName, subjectPrefix })
    const cc = template === 'livre'
      ? deps.adminEmails.filter(a => a.toLowerCase() !== email.to.toLowerCase())
      : []
    const registo = {
      toEmail: email.to, toName: email.toName, ccEmails: cc, subject: email.subject,
      body: email.logBody, context: CONTEXTO_REGISTO[template],
    }

    try {
      await deps.send({ to: email.to, cc, subject: email.subject, body: email.body })
      await deps.record({ ...registo, status: 'enviado' })
      resultados.push({ ...base, status: 'enviado' })
    } catch (e: any) {
      const msg = e?.message ?? 'Erro desconhecido'
      await deps.record({ ...registo, status: 'erro', errorMessage: msg })
      resultados.push({ ...base, status: 'erro', motivo: msg })
    }
  }
  return resultados
}
