import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'

// An error we raise on purpose, with a status and a stable code the client can rely on.
export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details: unknown

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function errorBody(code: string, message: string, details?: unknown) {
  return {
    error: { code, message, ...(details === undefined ? {} : { details }) },
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send(errorBody(error.code, error.message, error.details))
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((issue) => ({
      where: error.validationContext,
      path: issue.instancePath,
      message: issue.message,
    }))
    return reply
      .status(400)
      .send(errorBody('validation_error', 'The request is not valid', details))
  }

  // Problems Fastify itself found with the request, such as a body that is not valid JSON.
  if (
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return reply
      .status(error.statusCode)
      .send(errorBody('bad_request', error.message))
  }

  // Anything else is our bug: log the real error, tell the client nothing about it.
  request.log.error({ err: error }, 'unhandled error')
  return reply
    .status(500)
    .send(errorBody('internal_error', 'Something went wrong on our side'))
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send(errorBody('not_found', 'No such route'))
}
