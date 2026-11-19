import type { LightMyRequestResponse } from 'fastify'

// Every Set-Cookie header of a response, as text.
export function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers['set-cookie']
  if (header === undefined) return []
  return Array.isArray(header) ? header : [String(header)]
}

// The value of the session cookie a response sets, or undefined when it sets none
// (or clears it, which sends an empty value).
export function sessionTokenFrom(
  res: LightMyRequestResponse,
): string | undefined {
  for (const cookie of setCookies(res)) {
    const match = /^session=([^;]+)/.exec(cookie)
    if (match?.[1]) return match[1]
  }
  return undefined
}
export interface UploadPart {
  name: string
  value?: string
  filename?: string
  contentType?: string
  data?: Buffer
}

// Builds a multipart/form-data body by hand, the way a browser's upload form does.
export function multipartBody(parts: UploadPart[]): {
  payload: Buffer
  headers: Record<string, string>
} {
  const boundary = '----beer-league-test-boundary'
  const chunks: Buffer[] = []

  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    if (part.data !== undefined) {
      const filename = part.filename ?? 'photo.jpg'
      const type = part.contentType ?? 'image/jpeg'
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
        ),
      )
      chunks.push(part.data)
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ''}`,
        ),
      )
    }
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}
