import pino from 'pino'
import type { EnvToLoggerType } from './types'

const envToLogger: EnvToLoggerType = {
  pretty: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        colorize: true,
      },
    },
  },
  json: {
    transport: undefined,
  },
}

const loggerInstance = envToLogger[process.env.LOG_TYPE || 'pretty']

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: loggerInstance ? loggerInstance.transport : undefined,
})
