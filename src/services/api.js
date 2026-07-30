const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8080').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(status, code, message, fieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export async function apiRequest(path, options = {}) {
  const {
    auth = true,
    body,
    headers: customHeaders = {},
    ...fetchOptions
  } = options
  const headers = new Headers(customHeaders)

  if (auth) {
    const token = localStorage.getItem('accessToken')
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.code ?? `HTTP_${response.status}`,
      payload?.message ?? payload?.detail ?? '요청을 처리하지 못했습니다.',
      payload?.fieldErrors ?? {},
    )
  }

  return payload
}
