/**
 * Moldura HTML comum a todos os e-mails enviados pela aplicação
 * (cabeçalho verde com o remetente, corpo, rodapé com a localização).
 *
 * Partilhada por /api/send-email e /api/send-worker-email para os e-mails
 * terem todos o mesmo aspeto.
 */

/** Escapa HTML antes de embutir texto (assunto, remetente, corpo) no template do e-mail. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildAppEmailHtml({ displayName, body, fromName, footerNote }: {
  displayName: string
  body: string
  fromName: string
  footerNote?: string | null
}): string {
  const appLocation = process.env.NEXT_PUBLIC_APP_LOCATION ?? 'Évora'
  const footer = footerNote
    ? `${escapeHtml(footerNote)} · ${escapeHtml(appLocation)}`
    : `${escapeHtml(fromName)} · ${escapeHtml(appLocation)}`

  return `
<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
    <div style="background:#059669;padding:24px 32px">
      <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:700">${escapeHtml(displayName)}</h1>
      <p style="margin:4px 0 0;color:#a7f3d0;font-size:13px">${escapeHtml(appLocation)}</p>
    </div>
    <div style="padding:32px;color:#374151;font-size:15px;line-height:1.7">
      ${escapeHtml(body).replace(/\n/g, '<br>')}
    </div>
    <div style="padding:16px 32px;background:#f3f4f6;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
      ${footer}
    </div>
  </div>
</body>
</html>`
}
